import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import {
  GOOGLE_CLIENT_ID, DRIVE_SCOPES,
  resolveRedirectUri, decryptToken,
  refreshAccessToken,
  findOrCreateFolder,
} from '../drive-oauth';

const OAUTH_STATE_SECRET = new TextEncoder().encode('drive-oauth-state-v1');

const drive = new Hono<AuthEnv>();

const DRIVE_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;
const DRIVE_ADMIN_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'] as const;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OAuth 연결 — 인증이 필요 없음 (콜백은 쿠키/state로 보호)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/drive/oauth/start — 로그인된 관리자만 호출 (fetch).
// 전체 페이지 redirect 대신 URL을 JSON으로 반환하여 Authorization 헤더 인증 유지
// state는 JWT 서명 토큰 — 쿠키 대신 사용하여 Safari ITP 등 쿠키 차단 환경 대응
drive.get('/oauth/start', authMiddleware, requireRole(...DRIVE_ADMIN_ROLES), async (c) => {
  const user = c.get('user');
  const redirectUri = resolveRedirectUri(c.req.raw);
  // 10분 유효 JWT — userId + 랜덤 nonce 포함
  const state = await new SignJWT({ sub: user.sub, nonce: crypto.randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(OAUTH_STATE_SECRET);
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', DRIVE_SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent'); // refresh_token 재발급 보장
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('state', state);
  return c.json({ url: authUrl.toString(), state });
});

export { OAUTH_STATE_SECRET };

// OAuth callback은 최상위 경로 /oauth/drive/callback (index.ts)에서 직접 처리

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 인증된 API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
drive.use('/*', authMiddleware);

// GET /api/drive/settings — 현재 설정 + 통계 반환
drive.get('/settings', requireRole(...DRIVE_ROLES), async (c) => {
  const db = c.env.DB;
  const s = await db.prepare("SELECT * FROM drive_settings WHERE id = 'default'").first<any>();
  const lastLog = await db.prepare(
    "SELECT run_at, status FROM drive_backup_logs WHERE status = 'success' ORDER BY run_at DESC LIMIT 1"
  ).first<any>();
  const pending = await db.prepare(`
    SELECT COUNT(*) as cnt FROM documents d
    WHERE d.status = 'approved' AND d.cancelled = 0
      AND NOT EXISTS (
        SELECT 1 FROM approval_steps s WHERE s.document_id = d.id AND s.status != 'approved'
      )
      AND NOT EXISTS (
        SELECT 1 FROM drive_backup_logs b WHERE b.document_id = d.id AND b.status = 'success'
      )
  `).first<{ cnt: number }>();
  const failed = await db.prepare(`
    SELECT COUNT(*) as cnt FROM drive_backup_logs WHERE status = 'failed' AND run_at > datetime('now', '-7 days')
  `).first<{ cnt: number }>();
  return c.json({
    settings: {
      ...s,
      // 민감 필드 제외
      refresh_token_encrypted: undefined,
      token_iv: undefined,
      connected: !!(s?.refresh_token_encrypted),
    },
    last_backup_at: lastLog?.run_at || null,
    pending_count: pending?.cnt || 0,
    failed_last_7d: failed?.cnt || 0,
  });
});

// PUT /api/drive/settings — 폴더 패턴/파일명 패턴 저장 (관리자만)
drive.put('/settings', requireRole(...DRIVE_ADMIN_ROLES), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    folder_pattern?: string;
    filename_pattern?: string;
    root_folder_name?: string;
    auto_enabled?: boolean;
  }>();
  await db.prepare(`
    UPDATE drive_settings SET
      folder_pattern = COALESCE(?, folder_pattern),
      filename_pattern = COALESCE(?, filename_pattern),
      root_folder_name = COALESCE(?, root_folder_name),
      auto_enabled = COALESCE(?, auto_enabled),
      updated_at = datetime('now')
    WHERE id = 'default'
  `).bind(
    body.folder_pattern ?? null,
    body.filename_pattern ?? null,
    body.root_folder_name ?? null,
    body.auto_enabled === undefined ? null : (body.auto_enabled ? 1 : 0),
  ).run();
  return c.json({ success: true });
});

// POST /api/drive/disconnect — 연결 해제 (refresh_token 삭제)
drive.post('/disconnect', requireRole(...DRIVE_ADMIN_ROLES), async (c) => {
  const db = c.env.DB;
  await db.prepare(`
    UPDATE drive_settings SET
      refresh_token_encrypted = '',
      token_iv = '',
      connected_email = '',
      connected_at = NULL,
      auto_enabled = 0,
      updated_at = datetime('now')
    WHERE id = 'default'
  `).run();
  return c.json({ success: true });
});

// GET /api/drive/pending — 백업 대상 문서 (UI 표시용)
drive.get('/pending', requireRole(...DRIVE_ROLES), async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(`
    SELECT d.id, d.title, d.template_id, d.branch, d.department, d.created_at, d.updated_at,
      u.name as author_name, u.branch as author_branch, u.department as author_department,
      u.position_title as author_position,
      t.title as template_name,
      (SELECT MAX(s.signed_at) FROM approval_steps s WHERE s.document_id = d.id AND s.status = 'approved') as approved_at
    FROM documents d
    LEFT JOIN users u ON u.id = d.author_id
    LEFT JOIN templates t ON t.id = d.template_id
    WHERE d.status = 'approved' AND d.cancelled = 0
      AND NOT EXISTS (
        SELECT 1 FROM approval_steps s WHERE s.document_id = d.id AND s.status != 'approved'
      )
      AND NOT EXISTS (
        SELECT 1 FROM drive_backup_logs b WHERE b.document_id = d.id AND b.status = 'success'
      )
    ORDER BY approved_at ASC
    LIMIT 500
  `).all();
  return c.json({ documents: result.results || [] });
});

// GET /api/drive/logs — 최근 로그
drive.get('/logs', requireRole(...DRIVE_ROLES), async (c) => {
  const db = c.env.DB;
  const limit = Math.min(100, Number(c.req.query('limit') || 30));
  const result = await db.prepare(`
    SELECT b.*, d.title as document_title, u.name as triggered_by_name
    FROM drive_backup_logs b
    LEFT JOIN documents d ON d.id = b.document_id
    LEFT JOIN users u ON u.id = b.triggered_by
    ORDER BY b.run_at DESC
    LIMIT ?
  `).bind(limit).all();
  return c.json({ logs: result.results || [] });
});

// POST /api/drive/run-now — 관리자가 수동으로 cron과 동일한 배치 실행 트리거
drive.post('/run-now', requireRole(...DRIVE_ADMIN_ROLES), async (c) => {
  const { runBackupBatch } = await import('../drive-backup-runner');
  const env = c.env as any;
  const user = c.get('user');
  const result = await runBackupBatch(env, { triggered_by: user.sub, limit: 30 });
  return c.json(result);
});

// POST /api/drive/test-send — 특정 문서(들)만 테스트 백업 (재백업 허용)
drive.post('/test-send', requireRole(...DRIVE_ADMIN_ROLES), async (c) => {
  const { runBackupBatch } = await import('../drive-backup-runner');
  const body = await c.req.json<{ document_ids: string[] }>();
  if (!body.document_ids || body.document_ids.length === 0) {
    return c.json({ error: 'document_ids 누락' }, 400);
  }
  if (body.document_ids.length > 5) {
    return c.json({ error: '테스트는 최대 5건까지 가능합니다.' }, 400);
  }
  const env = c.env as any;
  const user = c.get('user');
  const result = await runBackupBatch(env, {
    triggered_by: user.sub,
    document_ids: body.document_ids,
  });
  return c.json(result);
});

// access_token을 잠깐만 발급해서 돌려주는 헬퍼 — 관리자용 검증/테스트 전용
drive.get('/test-access-token', requireRole(...DRIVE_ADMIN_ROLES), async (c) => {
  const db = c.env.DB;
  const clientSecret = (c.env as any).GOOGLE_CLIENT_SECRET as string | undefined;
  if (!clientSecret) return c.json({ error: 'GOOGLE_CLIENT_SECRET 미설정' }, 500);
  const s = await db.prepare("SELECT refresh_token_encrypted, token_iv FROM drive_settings WHERE id = 'default'").first<any>();
  if (!s?.refresh_token_encrypted) return c.json({ error: '연결 안 됨' }, 400);
  try {
    const refresh = await decryptToken(s.refresh_token_encrypted, s.token_iv, clientSecret);
    const tok = await refreshAccessToken(refresh, clientSecret);
    // 실제 동작 검증: 루트 폴더 조회
    await findOrCreateFolder(tok.access_token, 'root', '_drive_test_ok').catch(() => {});
    return c.json({ success: true, expires_in: tok.expires_in });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default drive;
