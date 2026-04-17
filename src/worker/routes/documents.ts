import { Hono } from 'hono';
import type { AuthEnv, Document, OrgNode } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { sendAlimtalkByTemplate, APP_URL } from '../alimtalk';

// 결재선 자동 계산: 조직도를 위로 탐색하여 승인자 목록 반환
async function buildApprovalChain(db: D1Database, authorId: string): Promise<string[]> {
  // 1) 작성자의 org_node 찾기
  const userNode = await db.prepare(
    'SELECT * FROM org_nodes WHERE user_id = ?'
  ).bind(authorId).first<OrgNode>();
  if (!userNode) return [];

  const author = await db.prepare('SELECT role FROM users WHERE id = ?').bind(authorId).first<{ role: string }>();
  if (!author) return [];

  // 2) 위로 올라가며 승인자 수집 (본인 제외)
  // 팀원→팀장→지사장→대표, 팀장→지사장→대표, 관리자→대표
  const chain: string[] = [];
  let currentParentId = userNode.parent_id;
  const maxSteps = author.role === 'admin' ? 1 : author.role === 'manager' ? 2 : 3;

  while (currentParentId && chain.length < maxSteps) {
    const parentNode = await db.prepare(
      'SELECT * FROM org_nodes WHERE id = ?'
    ).bind(currentParentId).first<OrgNode>();
    if (!parentNode) break;

    if (parentNode.user_id) {
      // 프리랜서는 결재선에서 제외
      const approver = await db.prepare('SELECT login_type FROM users WHERE id = ?').bind(parentNode.user_id).first<{ login_type: string }>();
      if (approver?.login_type === 'freelancer') { currentParentId = parentNode.parent_id; continue; }
      chain.push(parentNode.user_id);
    }
    currentParentId = parentNode.parent_id;
  }

  // 3) 최상위급(tier <= 2)이고 chain이 비었으면 → CC 승인자 사용
  if (chain.length === 0 && userNode.tier <= 2) {
    const ccList = await db.prepare(
      'SELECT cc_user_id FROM approval_cc'
    ).all<{ cc_user_id: string }>();
    if (ccList.results) {
      for (const cc of ccList.results) {
        chain.push(cc.cc_user_id);
      }
    }
  }

  return chain;
}

const documents = new Hono<AuthEnv>();
documents.use('*', authMiddleware);

// Permission-based document visibility:
// master/ceo: all documents
// admin: same branch only
// manager: same branch + same department only
// member: own documents only

// GET /api/documents/cancel-requests — 취소 신청 목록 (관리자용) — /:id 보다 먼저 정의
documents.get('/cancel-requests', requireRole('master', 'ceo', 'cc_ref', 'admin'), async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(
    `SELECT d.*, u.name as author_name FROM documents d
     LEFT JOIN users u ON d.author_id = u.id
     WHERE d.cancel_requested = 1 AND d.cancelled = 0
     ORDER BY d.updated_at DESC`
  ).all();
  return c.json({ documents: result.results });
});

// GET /api/documents
documents.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const status = c.req.query('status');

  let query = 'SELECT d.*, u.name as author_name FROM documents d LEFT JOIN users u ON d.author_id = u.id';
  const conditions: string[] = [];
  const params: string[] = [];

  if (user.role === 'master' || user.role === 'ceo' || user.role === 'cc_ref') {
    // Full access — 단, 타인의 draft는 제외
    conditions.push("(d.status != 'draft' OR d.author_id = ?)");
    params.push(user.sub);
  } else if (user.role === 'accountant' || user.role === 'accountant_asst') {
    // 총무(담당/보조): 전체 문서함 열람 가능 — 타인 draft 제외
    conditions.push("(d.status != 'draft' OR d.author_id = ?)");
    params.push(user.sub);
  } else if (user.role === 'director') {
    // 총괄이사: 본인 + 대전/부산 지사 — 타인 draft 제외
    conditions.push("(d.author_id = ? OR d.branch IN ('대전', '부산'))");
    conditions.push("(d.status != 'draft' OR d.author_id = ?)");
    params.push(user.sub, user.sub);
  } else if (user.role === 'admin' && user.branch === '의정부') {
    // 의정부 관리자: 전체 열람 — 타인 draft 제외
    conditions.push("(d.status != 'draft' OR d.author_id = ?)");
    params.push(user.sub);
  } else if (user.role === 'admin') {
    // 기타 지사 관리자: 본인 지사 — 타인 draft 제외
    conditions.push('d.branch = ?');
    conditions.push("(d.status != 'draft' OR d.author_id = ?)");
    params.push(user.branch);
    params.push(user.sub);
  } else if (user.role === 'manager') {
    conditions.push('d.branch = ?');
    conditions.push('d.department = ?');
    conditions.push("(d.status != 'draft' OR d.author_id = ?)");
    params.push(user.branch);
    params.push(user.department);
    params.push(user.sub);
  } else {
    conditions.push('d.author_id = ?');
    params.push(user.sub);
  }

  if (status) {
    conditions.push('d.status = ?');
    params.push(status);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY d.updated_at DESC';

  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ documents: result.results });
});

// GET /api/documents/:id
documents.get('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare(
    'SELECT d.*, u.name as author_name FROM documents d LEFT JOIN users u ON d.author_id = u.id WHERE d.id = ?'
  ).bind(id).first<Document & { author_name: string }>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);

  // Permission check
  if (user.role === 'member' && doc.author_id !== user.sub) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }
  if (user.role === 'manager' && doc.author_id !== user.sub && (doc.branch !== user.branch || doc.department !== user.department)) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }
  // 의정부 관리자는 타지사 열람 가능, 기타 관리자는 본인 지사만
  if (user.role === 'admin' && user.branch !== '의정부' && doc.branch !== user.branch && doc.author_id !== user.sub) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }

  return c.json({ document: doc });
});

// POST /api/documents
documents.post('/', async (c) => {
  const user = c.get('user');
  const { title, content, template_id } = await c.req.json<{
    title: string; content?: string; template_id?: string;
  }>();
  if (!title) return c.json({ error: '문서 제목은 필수입니다.' }, 400);

  const db = c.env.DB;
  const id = crypto.randomUUID();

  let initialContent = content || '{}';
  if (template_id && !content) {
    const template = await db.prepare('SELECT content FROM templates WHERE id = ?').bind(template_id).first<{ content: string }>();
    if (template) {
      const profile = await db.prepare(
        'SELECT name, department, position_title, branch, phone, email FROM users WHERE id = ?'
      ).bind(user.sub).first<{ name: string; department: string; position_title: string; branch: string; phone: string; email: string }>();

      let html = template.content;

      if (profile) {
        // KST 날짜
        const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const yyyy = now.getUTCFullYear();
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(now.getUTCDate()).padStart(2, '0');

        // {{변수}} 치환
        const vars: Record<string, string> = {
          '이름': profile.name,
          '성명': profile.name,
          '부서': profile.department,
          '팀': profile.department,
          '직급': profile.position_title,
          '보직': profile.position_title,
          '지사': profile.branch,
          '전화번호': profile.phone,
          '이메일': profile.email,
          '이름_직급': `${profile.name} ${profile.position_title}`,
          '날짜': `${yyyy}-${mm}-${dd}`,
          '년도': String(yyyy),
          '월': String(now.getUTCMonth() + 1),
          '일': String(now.getUTCDate()),
          '작성일': `${yyyy}년 ${Number(mm)}월 ${Number(dd)}일`,
        };

        for (const [key, value] of Object.entries(vars)) {
          html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }

        // 기존 테이블 구조 호환 (성 명 / 부 서 / 직 급 셀)
        html = html.replace(
          /(<th[^>]*>성\s*명<\/th>\s*<td[^>]*>)(.*?)(<\/td>)/,
          `$1${profile.name}$3`
        );
        html = html.replace(
          /(<th[^>]*>부\s*서<\/th>\s*<td[^>]*>)(.*?)(<\/td>)/,
          `$1${profile.department}$3`
        );
        html = html.replace(
          /(<th[^>]*>직\s*급<\/th>\s*<td[^>]*>)(.*?)(<\/td>)/,
          `$1${profile.position_title}$3`
        );
      }
      initialContent = html;
    }
  }

  await db.prepare(
    'INSERT INTO documents (id, title, content, template_id, author_id, team_id, branch, department, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, title, initialContent, template_id || null, user.sub, user.team_id || null, user.branch, user.department, 'draft').run();

  await db.prepare(
    'INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), id, user.sub, 'created', '문서가 생성되었습니다.').run();

  return c.json({ document: { id, title, status: 'draft' } }, 201);
});

// PUT /api/documents/:id
documents.put('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  // 승인된 문서는 절대 수정 불가
  if (doc.status === 'approved') return c.json({ error: '승인된 문서는 수정할 수 없습니다.' }, 400);
  // draft/rejected: 본인만 수정 가능 (master 예외)
  if ((doc.status === 'draft' || doc.status === 'rejected') && doc.author_id !== user.sub && user.role !== 'master') {
    return c.json({ error: '작성중/반려 문서는 본인만 수정할 수 있습니다.' }, 403);
  }
  // submitted: 관리자 이상만 수정 가능 (본인도 불가)
  if (doc.status === 'submitted' && !['master', 'ceo', 'cc_ref', 'admin'].includes(user.role)) {
    return c.json({ error: '제출된 문서는 관리자만 수정할 수 있습니다.' }, 403);
  }

  const { title, content } = await c.req.json<{ title?: string; content?: string }>();
  await db.prepare("UPDATE documents SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(title || doc.title, content || doc.content, id).run();
  return c.json({ success: true });
});

// POST /api/documents/:id/submit
documents.post('/:id/submit', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (doc.author_id !== user.sub) return c.json({ error: '본인 문서만 제출할 수 있습니다.' }, 403);
  if (doc.status !== 'draft' && doc.status !== 'rejected') return c.json({ error: '작성중 또는 반려된 문서만 제출할 수 있습니다.' }, 400);

  // 결재선 자동 생성
  let chain = await buildApprovalChain(db, user.sub);

  // 외근 보고서는 대표(CEO) 결재 불필요 — 결재선에서 CEO 제외
  const NO_CEO_TEMPLATES = ['tpl-work-007'];
  if (doc.template_id && NO_CEO_TEMPLATES.includes(doc.template_id)) {
    const ceoIds: string[] = [];
    for (const uid of chain) {
      const u = await db.prepare('SELECT role FROM users WHERE id = ?').bind(uid).first<{ role: string }>();
      if (u?.role === 'ceo') ceoIds.push(uid);
    }
    chain = chain.filter(uid => !ceoIds.includes(uid));
  }

  // 기존 결재선 삭제 (반려 후 재제출 대응)
  await db.prepare('DELETE FROM approval_steps WHERE document_id = ?').bind(id).run();

  // 팀장 중 오늘 휴가자는 자동 건너뛰기 (role='manager'만 대상)
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayLeaves = await db.prepare(
    "SELECT user_id FROM leave_requests WHERE status = 'approved' AND start_date <= ? AND end_date >= ?"
  ).bind(today, today).all();
  const onLeaveIds = new Set((todayLeaves.results || []).map((r: any) => r.user_id));

  // 결재선 INSERT (팀장+휴가중 → skipped 상태로 기록)
  for (let i = 0; i < chain.length; i++) {
    const approverId = chain[i];
    const approverInfo = await db.prepare('SELECT role FROM users WHERE id = ?').bind(approverId).first<{ role: string }>();
    const isManagerOnLeave = approverInfo?.role === 'manager' && onLeaveIds.has(approverId);
    const status = isManagerOnLeave ? 'approved' : 'pending';
    const comment = isManagerOnLeave ? '팀장 휴무로 자동 승인' : null;
    await db.prepare(
      'INSERT INTO approval_steps (id, document_id, step_order, approver_id, status, comment, signed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), id, i + 1, approverId, status, comment, isManagerOnLeave ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null).run();
  }

  await db.prepare("UPDATE documents SET status = 'submitted', reject_reason = NULL, updated_at = datetime('now') WHERE id = ?").bind(id).run();

  const chainNames = [];
  for (const uid of chain) {
    const u = await db.prepare('SELECT name FROM users WHERE id = ?').bind(uid).first<{ name: string }>();
    chainNames.push(u?.name || uid);
  }
  const details = chain.length > 0
    ? `문서가 제출되었습니다. 결재선: ${chainNames.join(' → ')}`
    : '문서가 제출되었습니다. (결재선 없음 — 조직도 미배치)';

  await db.prepare('INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), id, user.sub, 'submitted', details).run();

  // 알림톡: 결재선 첫 번째 결재자에게 DOC_SUBMITTED
  if (chain.length > 0) {
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const firstApprover = await db.prepare('SELECT phone FROM users WHERE id = ?').bind(chain[0]).first<{ phone: string }>();
    if (firstApprover?.phone) {
      c.executionCtx.waitUntil(sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>, 'DOC_SUBMITTED',
        { author_name: user.name, doc_title: doc.title, department: user.department || '', submit_date: today, link: `${APP_URL}/documents/${id}` },
        [firstApprover.phone],
      ).catch(() => {}));
    }
  }

  return c.json({ success: true, chain: chain.length });
});

// POST /api/documents/:id/approve (다단계 결재)
documents.post('/:id/approve', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (doc.status !== 'submitted') return c.json({ error: '제출된 문서만 승인할 수 있습니다.' }, 400);

  // 결재선에서 현재 대기중인 내 단계 찾기
  const myStep = await db.prepare(
    "SELECT * FROM approval_steps WHERE document_id = ? AND approver_id = ? AND status = 'pending'"
  ).bind(id, user.sub).first<{ id: string; step_order: number }>();

  if (!myStep) {
    // 결재선에 없어도 권한자는 대리 승인 가능
    if (['master', 'ceo', 'cc_ref', 'admin', 'accountant'].includes(user.role)) {
      // 모든 pending 단계를 승인 처리 (대리 서명자 기록)
      await db.prepare(
        "UPDATE approval_steps SET status = 'approved', signed_at = datetime('now'), comment = ? WHERE document_id = ? AND status = 'pending'"
      ).bind('proxy:' + user.sub, id).run();
    } else {
      return c.json({ error: '현재 승인 차례가 아니거나 결재선에 포함되지 않았습니다.' }, 403);
    }
  } else {
    // 앞 단계가 모두 승인되었는지 확인
    const prevPending = await db.prepare(
      "SELECT COUNT(*) as cnt FROM approval_steps WHERE document_id = ? AND step_order < ? AND status != 'approved'"
    ).bind(id, myStep.step_order).first<{ cnt: number }>();

    if (prevPending && prevPending.cnt > 0) {
      return c.json({ error: '이전 단계 승인이 완료되지 않았습니다.' }, 400);
    }

    // 내 단계 승인
    await db.prepare(
      "UPDATE approval_steps SET status = 'approved', signed_at = datetime('now') WHERE id = ?"
    ).bind(myStep.id).run();
  }

  // 남은 pending 단계 확인
  const remaining = await db.prepare(
    "SELECT COUNT(*) as cnt FROM approval_steps WHERE document_id = ? AND status = 'pending'"
  ).bind(id).first<{ cnt: number }>();

  const allDone = !remaining || remaining.cnt === 0;

  if (allDone) {
    // 전체 승인 완료
    await db.prepare("UPDATE documents SET status = 'approved', updated_at = datetime('now') WHERE id = ?").bind(id).run();
    await db.prepare('INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, user.sub, 'approved', '문서가 최종 승인되었습니다.').run();

    // 연차/월차/반차 문서 승인 시 자동 차감 + leave_requests 등록
    const title = doc.title || '';
    if (title.includes('연차') || title.includes('월차') || title.includes('반차')) {
      const days = title.includes('반차') ? 0.5 : 1;
      const leaveType = title.includes('반차') ? '반차' : title.includes('월차') ? '월차' : '연차';
      const existing = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(doc.author_id).first<any>();
      if (!existing) {
        await db.prepare('INSERT INTO annual_leave (id, user_id, total_days, used_days, leave_type, monthly_days, monthly_used) VALUES (?, ?, 15, 0, \'annual\', 0, 0)')
          .bind(crypto.randomUUID(), doc.author_id).run();
      }
      // 월차 사용자면 monthly_used 차감, 연차 사용자면 used_days 차감
      const leaveData = await db.prepare('SELECT leave_type FROM annual_leave WHERE user_id = ?').bind(doc.author_id).first<any>();
      if (leaveData?.leave_type === 'monthly') {
        await db.prepare("UPDATE annual_leave SET monthly_used = monthly_used + ?, updated_at = datetime('now') WHERE user_id = ?")
          .bind(days, doc.author_id).run();
      } else {
        await db.prepare("UPDATE annual_leave SET used_days = used_days + ?, updated_at = datetime('now') WHERE user_id = ?")
          .bind(days, doc.author_id).run();
      }
      // leave_requests에 자동 등록 (휴가 신청 내역 연동)
      const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      // 문서 내용에서 날짜 추출 시도
      const contentText = (doc.content || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
      let startDate = today;
      let endDate = today;
      // "휴가일 : 2026년 4월 17일" 또는 "시작일 : ...", "기간 : ..." 등
      const dateMatch = contentText.match(/(\d{4})\s*년?\s*(\d{1,2})\s*월?\s*(\d{1,2})\s*일/);
      if (dateMatch) {
        startDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
        endDate = startDate;
      }
      await db.prepare(
        "INSERT INTO leave_requests (id, user_id, leave_type, start_date, end_date, days, reason, status, approved_by, approved_at, branch, department) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, datetime('now'), ?, ?)"
      ).bind(
        crypto.randomUUID(), doc.author_id, leaveType, startDate, endDate, days,
        `문서결재 자동등록 (${doc.title})`, user.sub, doc.branch || '', doc.department || ''
      ).run();
    }
    // 알림톡: 최종 승인 → 작성자에게 DOC_FINAL_APPROVED
    const author = await db.prepare('SELECT phone FROM users WHERE id = ?').bind(doc.author_id).first<{ phone: string }>();
    if (author?.phone) {
      const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      c.executionCtx.waitUntil(sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>, 'DOC_FINAL_APPROVED',
        { doc_title: doc.title, approver_name: user.name, approve_date: today },
        [author.phone],
      ).catch(() => {}));
    }
  } else {
    // 중간 단계 승인 로그
    await db.prepare('INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, user.sub, 'step_approved', `${user.name}님이 승인하였습니다.`).run();

    // 알림톡: 단계 승인 → 다음 결재자에게 DOC_STEP_APPROVED
    const nextStep = await db.prepare(
      "SELECT approver_id FROM approval_steps WHERE document_id = ? AND status = 'pending' ORDER BY step_order ASC LIMIT 1"
    ).bind(id).first<{ approver_id: string }>();
    if (nextStep) {
      const nextUser = await db.prepare('SELECT phone FROM users WHERE id = ?').bind(nextStep.approver_id).first<{ phone: string }>();
      if (nextUser?.phone) {
        c.executionCtx.waitUntil(sendAlimtalkByTemplate(
          c.env as unknown as Record<string, unknown>, 'DOC_STEP_APPROVED',
          { approver_name: user.name, doc_title: doc.title, author_name: (await db.prepare('SELECT name FROM users WHERE id = ?').bind(doc.author_id).first<{ name: string }>())?.name || '', department: doc.department || '', link: `${APP_URL}/documents/${id}` },
          [nextUser.phone],
        ).catch(() => {}));
      }
    }
  }

  return c.json({ success: true, final: allDone });
});

// POST /api/documents/:id/reject (결재선 기반 반려)
documents.post('/:id/reject', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const { reason } = await c.req.json<{ reason?: string }>();
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (doc.status !== 'submitted') return c.json({ error: '제출된 문서만 반려할 수 있습니다.' }, 400);

  // 결재선에 포함된 사용자이거나 master/ceo만 반려 가능
  const myStep = await db.prepare(
    "SELECT * FROM approval_steps WHERE document_id = ? AND approver_id = ? AND status = 'pending'"
  ).bind(id, user.sub).first();

  if (!myStep && user.role !== 'master' && user.role !== 'ceo' && user.role !== 'cc_ref') {
    return c.json({ error: '결재선에 포함되지 않았습니다.' }, 403);
  }

  // 내 단계를 rejected로, 나머지 pending도 모두 rejected로
  await db.prepare(
    "UPDATE approval_steps SET status = 'rejected' WHERE document_id = ? AND status = 'pending'"
  ).bind(id).run();

  await db.prepare("UPDATE documents SET status = 'rejected', reject_reason = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(reason || '', id).run();
  await db.prepare('INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), id, user.sub, 'rejected', `문서가 반려되었습니다. 사유: ${reason || '없음'}`).run();

  // 알림톡: 반려 → 작성자에게 DOC_REJECTED
  const author = await db.prepare('SELECT phone FROM users WHERE id = ?').bind(doc.author_id).first<{ phone: string }>();
  if (author?.phone) {
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'DOC_REJECTED',
      { doc_title: doc.title, rejector_name: user.name, reject_reason: reason || '없음', link: `${APP_URL}/documents/${id}` },
      [author.phone],
    ).catch(() => {}));
  }

  return c.json({ success: true });
});

// DELETE /api/documents/:id
documents.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  // 승인된 문서는 삭제 불가 (master만 예외)
  if (doc.status === 'approved' && user.role !== 'master') return c.json({ error: '승인된 문서는 삭제할 수 없습니다.' }, 400);

  // 제출 중: 본인 또는 관리자 이상만 삭제 가능
  if (doc.status === 'submitted') {
    if (doc.author_id !== user.sub && !['master', 'ceo', 'cc_ref', 'admin'].includes(user.role)) {
      return c.json({ error: '제출된 문서는 작성자 또는 관리자만 삭제할 수 있습니다.' }, 403);
    }
  } else {
    // draft/rejected: 본인 또는 관리자 이상
    if (doc.author_id !== user.sub && !['master', 'ceo', 'cc_ref', 'admin'].includes(user.role)) {
      return c.json({ error: '권한이 없습니다.' }, 403);
    }
  }

  // 제출 중인 문서 삭제 시 결재선도 삭제
  if (doc.status === 'submitted') {
    await db.prepare('DELETE FROM approval_steps WHERE document_id = ?').bind(id).run();
  }

  await db.prepare('DELETE FROM documents WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// GET /api/documents/:id/steps — 결재선 단계 조회
documents.get('/:id/steps', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const result = await db.prepare(
    'SELECT s.*, u.name as approver_name, u.position_title as approver_title, u.role as approver_role FROM approval_steps s LEFT JOIN users u ON s.approver_id = u.id WHERE s.document_id = ? ORDER BY s.step_order'
  ).bind(id).all();
  return c.json({ steps: result.results });
});

// GET /api/documents/:id/logs
documents.get('/:id/logs', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const result = await db.prepare(
    'SELECT dl.*, u.name as user_name FROM document_logs dl LEFT JOIN users u ON dl.user_id = u.id WHERE dl.document_id = ? ORDER BY dl.created_at DESC'
  ).bind(id).all();
  return c.json({ logs: result.results });
});

// POST /api/documents/:id/cancel-request — 취소 신청 (작성자)
documents.post('/:id/cancel-request', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  const { reason } = await c.req.json<{ reason?: string }>();

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (doc.author_id !== user.sub && user.role !== 'master') {
    return c.json({ error: '본인 문서만 취소 신청할 수 있습니다.' }, 403);
  }
  if (doc.status !== 'approved' && doc.status !== 'submitted') {
    return c.json({ error: '제출 또는 승인된 문서만 취소 신청 가능합니다.' }, 400);
  }

  await db.prepare(
    "UPDATE documents SET cancel_requested = 1, cancel_reason = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(reason || '', id).run();

  await db.prepare('INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), id, user.sub, 'cancel_requested', `취소 신청. 사유: ${reason || '없음'}`).run();

  return c.json({ success: true });
});

// POST /api/documents/:id/cancel-approve — 취소 승인 (관리자)
documents.post('/:id/cancel-approve', requireRole('master', 'ceo', 'cc_ref', 'admin'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (!doc.cancel_requested) {
    return c.json({ error: '취소 신청된 문서가 아닙니다.' }, 400);
  }

  await db.prepare(
    "UPDATE documents SET cancelled = 1, cancel_requested = 0, updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run();

  // 연차/월차/반차 문서였고 승인 완료 상태였으면 휴가 복원
  if (doc.status === 'approved' && (doc.title.includes('연차') || doc.title.includes('월차') || doc.title.includes('반차'))) {
    const days = doc.title.includes('반차') ? 0.5 : 1;
    const leaveData = await db.prepare('SELECT leave_type FROM annual_leave WHERE user_id = ?').bind(doc.author_id).first<any>();
    if (leaveData?.leave_type === 'monthly') {
      await db.prepare("UPDATE annual_leave SET monthly_used = MAX(0, monthly_used - ?), updated_at = datetime('now') WHERE user_id = ?")
        .bind(days, doc.author_id).run();
    } else {
      await db.prepare("UPDATE annual_leave SET used_days = MAX(0, used_days - ?), updated_at = datetime('now') WHERE user_id = ?")
        .bind(days, doc.author_id).run();
    }
    // leave_requests에서 문서결재 자동등록 건 삭제
    await db.prepare("DELETE FROM leave_requests WHERE user_id = ? AND reason LIKE ? AND status = 'approved'")
      .bind(doc.author_id, `%${doc.title}%`).run();
  }

  await db.prepare('INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), id, user.sub, 'cancelled', `취소 승인 처리. 사유: ${doc.cancel_reason || '없음'}`).run();

  return c.json({ success: true });
});

export default documents;
