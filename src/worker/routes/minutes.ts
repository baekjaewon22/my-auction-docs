import { Hono } from 'hono';
import type { AuthEnv, Role } from '../types';
import { authMiddleware, requireRole, verifyToken } from '../middleware/auth';
import { sendAlimtalkByTemplate, APP_URL } from '../alimtalk';

// txt → 회의록 기본 포맷팅 (API 키 없을 때)
function formatAsMinutes(title: string, raw: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = raw.split('\n').filter(l => l.trim());

  // 발언 패턴 감지 (이름: 내용, 이름 - 내용 등)
  const speakerPattern = /^([가-힣a-zA-Z]{2,10})\s*[:：\-]\s*(.+)/;
  const discussions: { speaker: string; content: string }[] = [];
  const otherLines: string[] = [];

  for (const line of lines) {
    const match = line.match(speakerPattern);
    if (match) {
      discussions.push({ speaker: match[1], content: match[2] });
    } else {
      otherLines.push(line);
    }
  }

  let html = `
<div style="max-width:800px;margin:0 auto;font-family:'Noto Sans KR',sans-serif;">
  <h2 style="text-align:center;border-bottom:3px solid #1a1a2e;padding-bottom:12px;margin-bottom:20px;">${title}</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px;">
    <tr><th style="background:#f1f3f4;padding:8px 12px;text-align:left;width:100px;border:1px solid #dadce0;">일시</th><td style="padding:8px 12px;border:1px solid #dadce0;">${today}</td></tr>
    <tr><th style="background:#f1f3f4;padding:8px 12px;text-align:left;border:1px solid #dadce0;">장소</th><td style="padding:8px 12px;border:1px solid #dadce0;"></td></tr>
    <tr><th style="background:#f1f3f4;padding:8px 12px;text-align:left;border:1px solid #dadce0;">참석자</th><td style="padding:8px 12px;border:1px solid #dadce0;">${[...new Set(discussions.map(d => d.speaker))].join(', ') || ''}</td></tr>
  </table>`;

  if (discussions.length > 0) {
    html += `<h3 style="color:#1a73e8;border-left:4px solid #1a73e8;padding-left:10px;margin-top:24px;">논의 내용</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px;">
    <thead><tr><th style="background:#1a1a2e;color:#fff;padding:8px;width:100px;">발언자</th><th style="background:#1a1a2e;color:#fff;padding:8px;">내용</th></tr></thead>
    <tbody>`;
    for (const d of discussions) {
      html += `<tr><td style="padding:8px;border:1px solid #dadce0;font-weight:600;vertical-align:top;">${d.speaker}</td><td style="padding:8px;border:1px solid #dadce0;">${d.content}</td></tr>`;
    }
    html += `</tbody></table>`;
  }

  if (otherLines.length > 0) {
    html += `<h3 style="color:#188038;border-left:4px solid #188038;padding-left:10px;margin-top:24px;">기타 내용</h3>
    <ul style="font-size:14px;line-height:1.8;">`;
    for (const l of otherLines) {
      html += `<li>${l}</li>`;
    }
    html += `</ul>`;
  }

  html += `
  <h3 style="color:#d93025;border-left:4px solid #d93025;padding-left:10px;margin-top:24px;">결정 사항</h3>
  <p style="color:#9aa0a6;font-size:13px;">내용을 확인 후 결정 사항을 기입하세요.</p>
  <h3 style="color:#7b1fa2;border-left:4px solid #7b1fa2;padding-left:10px;margin-top:24px;">후속 조치</h3>
  <p style="color:#9aa0a6;font-size:13px;">후속 조치 사항을 기입하세요.</p>
  <div style="margin-top:30px;padding-top:16px;border-top:1px solid #e8eaed;text-align:right;font-size:12px;color:#9aa0a6;">
    작성일: ${today} | 마이옥션 오피스
  </div>
</div>`;
  return html;
}

const minutes = new Hono<AuthEnv>();

// 일반 엔드포인트: 표준 인증
minutes.use('*', async (c, next) => {
  // 다운로드 엔드포인트는 쿼리 토큰 허용 (새 탭에서 열기)
  if (c.req.path.endsWith('/download')) {
    const tokenParam = c.req.query('token');
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : tokenParam;

    if (!token) return c.json({ error: '인증이 필요합니다.' }, 401);

    try {
      const payload = await verifyToken(token);
      // DB에서 최신 역할 확인
      const db = c.env.DB;
      const user = await db.prepare('SELECT role FROM users WHERE id = ?').bind(payload.sub).first<{ role: Role }>();
      if (!user || !['master', 'ceo', 'cc_ref', 'admin', 'director'].includes(user.role)) {
        return c.json({ error: '권한이 없습니다.' }, 403);
      }
      payload.role = user.role;
      c.set('user', payload);
      return next();
    } catch {
      return c.json({ error: '유효하지 않은 토큰입니다.' }, 401);
    }
  }

  // 그 외: 표준 미들웨어
  return authMiddleware(c, next);
});

// 다운로드/공유 외 엔드포인트에 역할 제한
minutes.use('*', async (c, next) => {
  if (c.req.path.endsWith('/download')) return next();
  if (c.req.path.includes('/shared')) return next(); // 공유 회의록은 모든 인증 사용자 접근
  return requireRole('master', 'ceo', 'cc_ref', 'admin')(c, next);
});

// GET /api/minutes - 목록 조회
// master는 전체, 그 외(ceo/cc_ref/admin)는 업로더 본인 또는 공유받은 회의록만
minutes.get('/', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  if (user.role === 'master') {
    const rows = await db.prepare(
      `SELECT m.id, m.title, m.description, m.file_name, m.file_size, m.created_at, u.name as uploader_name
       FROM meeting_minutes m
       LEFT JOIN users u ON m.uploaded_by = u.id
       ORDER BY m.created_at DESC`
    ).all();
    return c.json({ minutes: rows.results });
  }

  // 업로더 본인 또는 공유받은 건만
  const rows = await db.prepare(
    `SELECT DISTINCT m.id, m.title, m.description, m.file_name, m.file_size, m.created_at, u.name as uploader_name
     FROM meeting_minutes m
     LEFT JOIN users u ON m.uploaded_by = u.id
     WHERE m.uploaded_by = ?
        OR EXISTS (SELECT 1 FROM minutes_shares ms WHERE ms.minutes_id = m.id AND ms.shared_with = ?)
     ORDER BY m.created_at DESC`
  ).bind(user.sub, user.sub).all();
  return c.json({ minutes: rows.results });
});

// GET /api/minutes/:id/download - PDF 다운로드
minutes.get('/:id/download', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await db.prepare(
    'SELECT uploaded_by, file_name, file_data FROM meeting_minutes WHERE id = ?'
  ).bind(id).first<{ uploaded_by: string; file_name: string; file_data: string }>();

  if (!row) return c.json({ error: '파일을 찾을 수 없습니다.' }, 404);

  // 권한 체크: master || 업로더 본인 || 공유받은 사용자
  if (user.role !== 'master' && row.uploaded_by !== user.sub) {
    const share = await db.prepare(
      'SELECT 1 FROM minutes_shares WHERE minutes_id = ? AND shared_with = ?'
    ).bind(id, user.sub).first();
    if (!share) return c.json({ error: '열람 권한이 없습니다.' }, 403);
  }

  const binary = Uint8Array.from(atob(row.file_data), ch => ch.charCodeAt(0));
  return new Response(binary, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(row.file_name)}"`,
    },
  });
});

// POST /api/minutes - 업로드
minutes.post('/', async (c) => {
  const user = c.get('user');
  const formData = await c.req.formData();
  const title = formData.get('title') as string;
  const description = (formData.get('description') as string) || '';
  const file = formData.get('file') as File | null;

  if (!title || !file) {
    return c.json({ error: '제목과 파일은 필수입니다.' }, 400);
  }

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return c.json({ error: 'PDF 파일만 업로드 가능합니다.' }, 400);
  }

  // 5MB 제한
  if (file.size > 5 * 1024 * 1024) {
    return c.json({ error: '파일 크기는 5MB 이하만 가능합니다.' }, 400);
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binaryStr = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binaryStr += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binaryStr);

  const id = crypto.randomUUID();
  const db = c.env.DB;

  await db.prepare(
    'INSERT INTO meeting_minutes (id, title, description, file_name, file_data, file_size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, title, description, file.name, base64, file.size, user.sub).run();

  return c.json({ success: true, id }, 201);
});

// DELETE /api/minutes/:id
minutes.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  await db.prepare('DELETE FROM minutes_shares WHERE minutes_id = ?').bind(id).run();
  await db.prepare('DELETE FROM meeting_minutes WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// [7-1] POST /api/minutes/convert-txt — txt → 회의록 변환
minutes.post('/convert-txt', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { title, raw_text, share_with } = await c.req.json<{ title: string; raw_text: string; share_with?: string[] }>();

  if (!title || !raw_text) return c.json({ error: '제목과 내용을 입력하세요.' }, 400);

  // API 키 조회 (업로드한 사용자 또는 마스터의 키)
  const apiKeyRow = await db.prepare("SELECT api_key FROM users WHERE api_key != '' AND role IN ('master', 'ceo') LIMIT 1").first<{ api_key: string }>();

  let converted = '';
  if (apiKeyRow?.api_key) {
    // Claude API로 회의록 변환
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKeyRow.api_key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-20250514',
          max_tokens: 8192,
          system: `당신은 10년 경력의 전문 비서로, 회의 내용을 정리하여 공식 회의록을 작성하는 전문가입니다.

당신의 역할:
1. 원본 텍스트를 깊이 분석하여 회의의 맥락과 흐름을 완벽히 파악합니다.
2. 구어체, 비격식체를 격식있는 비즈니스 문서체로 자연스럽게 변환합니다.
3. 핵심 논의사항, 결정사항, 액션아이템을 정확히 구분합니다.
4. 원본에 있는 모든 구체적 정보(이름, 수치, 날짜, 금액, 지역명, 사건번호 등)를 빠짐없이 보존합니다.
5. 단순 나열이 아닌, 논리적 흐름에 따라 내용을 재구성합니다.

출력 규칙:
- 순수 HTML만 출력 (마크다운 코드블록, 설명문 없이)
- inline style 사용 (외부 CSS 의존 없이 독립 렌더링)
- 한국어 비즈니스 문서 스타일`,
          messages: [{
            role: 'user',
            content: `다음 원본 텍스트를 공식 회의록으로 작성해주세요.

회의 제목: ${title}

## 작성 지침

**구조:**
- 회의 개요 (일시/장소/참석자) → 테이블
- 주요 안건 목록
- 안건별 상세 논의 내용 (발언자 구분 시 발언자별 정리, 아니면 주제별 요약)
- 핵심 결정 사항 (구체적으로, 실행 가능한 수준으로)
- 후속 조치 사항 (담당자/기한/내용 테이블)
- 비고 또는 참고사항

**내용 정리 원칙:**
- 대화 속 핵심만 추출하되 중요한 맥락은 유지
- "~했으면 좋겠다" → "~하기로 결정" 등 결론 중심으로 재구성
- 중복 발언은 통합하여 한 번만 기술
- 의견 대립이 있었다면 양측 의견을 균형있게 기술 후 최종 결론 명시

**HTML 스타일:**
- max-width: 800px, margin: 0 auto, font-size: 14px, line-height: 1.8
- 제목: text-align center, border-bottom 3px solid #1a1a2e
- 섹션 제목: border-left 4px solid (파랑/#1a73e8, 초록/#188038, 빨강/#d93025 등 구분), padding-left 10px
- 테이블: width 100%, border-collapse, 헤더 background #1a1a2e color #fff
- 결정사항: background #e8f5e9 padding, 후속조치: background #fff3e0 padding

---
원본 텍스트:

${raw_text}
---`
          }]
        }),
      });
      const data = await res.json() as any;
      converted = data.content?.[0]?.text || '';
      if (!converted) throw new Error('empty');
    } catch {
      converted = formatAsMinutes(title, raw_text);
    }
  } else {
    converted = formatAsMinutes(title, raw_text);
  }

  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO meeting_minutes (id, title, description, file_name, file_data, file_size, uploaded_by, raw_text, converted_content, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, title, '', title + '.html', btoa(unescape(encodeURIComponent(converted))), converted.length, user.sub, raw_text, converted, 'txt').run();

  // [7-3] 공유 처리
  if (share_with && share_with.length > 0) {
    for (const userId of share_with) {
      const shareId = crypto.randomUUID();
      await db.prepare('INSERT INTO minutes_shares (id, minutes_id, shared_with, shared_by) VALUES (?, ?, ?, ?)')
        .bind(shareId, id, userId, user.sub).run();
    }
  }

  return c.json({ success: true, id, converted });
});

// [7-2] GET /api/minutes/:id — 상세 조회 (변환된 내용 포함)
minutes.get('/:id', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await db.prepare(
    `SELECT m.*, u.name as uploader_name FROM meeting_minutes m LEFT JOIN users u ON m.uploaded_by = u.id WHERE m.id = ?`
  ).bind(id).first<any>();
  if (!row) return c.json({ error: '회의록을 찾을 수 없습니다.' }, 404);

  // 권한 체크: master || 업로더 본인 || 공유받은 사용자
  if (user.role !== 'master' && row.uploaded_by !== user.sub) {
    const share = await db.prepare(
      'SELECT 1 FROM minutes_shares WHERE minutes_id = ? AND shared_with = ?'
    ).bind(id, user.sub).first();
    if (!share) return c.json({ error: '열람 권한이 없습니다.' }, 403);
  }

  const shares = await db.prepare(
    'SELECT ms.*, u.name as user_name FROM minutes_shares ms LEFT JOIN users u ON ms.shared_with = u.id WHERE ms.minutes_id = ?'
  ).bind(id).all();

  return c.json({ minute: row, shares: shares.results });
});

// [7-3] POST /api/minutes/:id/share — 공유 대상 추가
minutes.post('/:id/share', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = c.req.param('id');
  const { user_ids } = await c.req.json<{ user_ids: string[] }>();

  const minute = await db.prepare('SELECT title, created_at FROM meeting_minutes WHERE id = ?').bind(id).first<{ title: string; created_at: string }>();
  const newSharedPhones: string[] = [];

  for (const uid of user_ids) {
    const existing = await db.prepare('SELECT id FROM minutes_shares WHERE minutes_id = ? AND shared_with = ?').bind(id, uid).first();
    if (existing) continue;
    const shareId = crypto.randomUUID();
    await db.prepare('INSERT INTO minutes_shares (id, minutes_id, shared_with, shared_by) VALUES (?, ?, ?, ?)')
      .bind(shareId, id, uid, user.sub).run();
    const sharedUser = await db.prepare('SELECT phone FROM users WHERE id = ?').bind(uid).first<{ phone: string }>();
    if (sharedUser?.phone) newSharedPhones.push(sharedUser.phone);
  }

  // 알림톡: 회의록 공유 → 공유 대상에게 MINUTES_SHARED
  if (newSharedPhones.length > 0 && minute) {
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'MINUTES_SHARED',
      { author_name: user.name, title: minute.title, date: today, link: `${APP_URL}/minutes` },
      newSharedPhones,
    ).catch(() => {}));
  }

  return c.json({ success: true });
});

// [7-3] GET /api/minutes/shared — 나에게 공유된 회의록
minutes.get('/shared/me', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT m.id, m.title, m.description, m.source_type, m.created_at, u.name as uploader_name, ms.read_at
     FROM minutes_shares ms
     JOIN meeting_minutes m ON m.id = ms.minutes_id
     LEFT JOIN users u ON m.uploaded_by = u.id
     WHERE ms.shared_with = ?
     ORDER BY m.created_at DESC`
  ).bind(user.sub).all();
  return c.json({ minutes: rows.results });
});

// 공유 회의록 읽음 처리
minutes.put('/shared/:id/read', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const id = c.req.param('id');
  await db.prepare("UPDATE minutes_shares SET read_at = datetime('now') WHERE minutes_id = ? AND shared_with = ?")
    .bind(id, user.sub).run();
  return c.json({ success: true });
});

export default minutes;
