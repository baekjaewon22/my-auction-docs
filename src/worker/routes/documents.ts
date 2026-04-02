import { Hono } from 'hono';
import type { AuthEnv, Document, OrgNode } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

// 결재선 자동 계산: 조직도를 위로 탐색하여 승인자 목록 반환
async function buildApprovalChain(db: D1Database, authorId: string): Promise<string[]> {
  // 1) 작성자의 org_node 찾기
  const userNode = await db.prepare(
    'SELECT * FROM org_nodes WHERE user_id = ?'
  ).bind(authorId).first<OrgNode>();
  if (!userNode) return [];

  const author = await db.prepare('SELECT role FROM users WHERE id = ?').bind(authorId).first<{ role: string }>();
  if (!author) return [];

  // 2) 위로 올라가며 승인자 수집 (본인 제외, 최대 2명)
  const chain: string[] = [];
  let currentParentId = userNode.parent_id;
  const maxSteps = author.role === 'manager' ? 1 : 2; // 팀장은 1단계, 나머지 2단계

  while (currentParentId && chain.length < maxSteps) {
    const parentNode = await db.prepare(
      'SELECT * FROM org_nodes WHERE id = ?'
    ).bind(currentParentId).first<OrgNode>();
    if (!parentNode) break;

    if (parentNode.user_id) {
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

// GET /api/documents
documents.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const status = c.req.query('status');

  let query = 'SELECT d.*, u.name as author_name FROM documents d LEFT JOIN users u ON d.author_id = u.id';
  const conditions: string[] = [];
  const params: string[] = [];

  if (user.role === 'master' || user.role === 'ceo' || user.role === 'cc_ref') {
    // Full access
  } else if (user.role === 'admin' && user.branch === '의정부') {
    // 의정부 관리자: 전체 열람 가능
  } else if (user.role === 'admin') {
    // 기타 지사 관리자: 본인 지사만
    conditions.push('d.branch = ?');
    params.push(user.branch);
  } else if (user.role === 'manager') {
    conditions.push('d.branch = ?');
    conditions.push('d.department = ?');
    params.push(user.branch);
    params.push(user.department);
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
  if (doc.author_id !== user.sub && !['master', 'ceo', 'cc_ref'].includes(user.role)) return c.json({ error: '권한이 없습니다.' }, 403);
  if (doc.status !== 'draft' && doc.status !== 'rejected') return c.json({ error: '작성중 또는 반려된 문서만 수정할 수 있습니다.' }, 400);

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
  const chain = await buildApprovalChain(db, user.sub);

  // 기존 결재선 삭제 (반려 후 재제출 대응)
  await db.prepare('DELETE FROM approval_steps WHERE document_id = ?').bind(id).run();

  // 결재선 INSERT
  for (let i = 0; i < chain.length; i++) {
    await db.prepare(
      'INSERT INTO approval_steps (id, document_id, step_order, approver_id, status) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), id, i + 1, chain[i], 'pending').run();
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
    // 결재선에 없어도 master/ceo는 최종 승인 가능
    if (user.role === 'master' || user.role === 'ceo' || user.role === 'cc_ref') {
      // 모든 pending 단계를 승인 처리
      await db.prepare(
        "UPDATE approval_steps SET status = 'approved', signed_at = datetime('now') WHERE document_id = ? AND status = 'pending'"
      ).bind(id).run();
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

    // 연차/반차 문서 승인 시 자동 차감
    const title = doc.title || '';
    if (title.includes('연차') || title.includes('반차')) {
      const days = title.includes('반차') ? 0.5 : 1;
      const existing = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(doc.author_id).first<any>();
      if (!existing) {
        await db.prepare('INSERT INTO annual_leave (id, user_id, total_days, used_days) VALUES (?, ?, 15, 0)')
          .bind(crypto.randomUUID(), doc.author_id).run();
      }
      await db.prepare("UPDATE annual_leave SET used_days = used_days + ?, updated_at = datetime('now') WHERE user_id = ?")
        .bind(days, doc.author_id).run();
    }
  } else {
    // 중간 단계 승인 로그
    await db.prepare('INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, user.sub, 'step_approved', `${user.name}님이 승인하였습니다.`).run();
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
  return c.json({ success: true });
});

// DELETE /api/documents/:id
documents.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (doc.author_id !== user.sub && !['master', 'ceo', 'cc_ref'].includes(user.role)) return c.json({ error: '권한이 없습니다.' }, 403);

  // 제출/승인된 문서는 일반 사용자 삭제 불가 (대표/CC는 가능)
  if ((doc.status === 'submitted' || doc.status === 'approved') && !['master', 'ceo', 'cc_ref'].includes(user.role)) {
    return c.json({ error: '제출 또는 승인된 문서는 삭제할 수 없습니다.' }, 400);
  }

  await db.prepare('DELETE FROM documents WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// GET /api/documents/:id/steps — 결재선 단계 조회
documents.get('/:id/steps', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const result = await db.prepare(
    'SELECT s.*, u.name as approver_name FROM approval_steps s LEFT JOIN users u ON s.approver_id = u.id WHERE s.document_id = ? ORDER BY s.step_order'
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

export default documents;
