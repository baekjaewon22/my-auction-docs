import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware } from '../middleware/auth';
import { isSafeLawitgoProgressId } from '../lib/lawitgo-progress';
import { resolveLawitgoConsultantId } from '../lib/lawitgo-consultant-mapping';
import { cachedLawitgoDetail, cachedLawitgoList } from '../lib/lawitgo-progress-cache';
import { canViewAllEvictionProgress } from '../../shared/eviction-quote-access';
import { getLawitgoStatementByProgress } from '../lib/lawitgo-new-settlement';

const lawitgoProgress = new Hono<AuthEnv>();

lawitgoProgress.use('*', authMiddleware);
lawitgoProgress.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store, private');
  await next();
});

type ViewerScope = {
  ownConsultantId: string | null;
  canViewAll: boolean;
};

async function currentViewerScope(c: any): Promise<ViewerScope | null> {
  const sessionUser = c.get('user');
  if (!sessionUser?.sub || sessionUser.auth_type === 'service_token') return null;
  const user = await c.env.DB.prepare(`
    SELECT u.id, u.role, u.department, COALESCE(t.name, '') AS team_name
    FROM users u
    LEFT JOIN teams t ON t.id = u.team_id
    WHERE u.id = ? AND u.approved = 1 AND u.role != 'resigned'
    LIMIT 1
  `).bind(sessionUser.sub).first() as {
    id: string;
    role: string;
    department: string;
    team_name: string;
  } | null;
  if (!user) return null;
  return {
    ownConsultantId: await resolveLawitgoConsultantId(c.env.DB, user.id),
    canViewAll: canViewAllEvictionProgress({
      userId: user.id,
      role: user.role,
      department: user.department,
      teamName: user.team_name,
    }),
  };
}

function cachedUiDocument(css: string, html: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: https://www.lawitgo.com; font-src data: https://www.lawitgo.com; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;padding:0;background:#f7f8fa}${css}</style></head><body>${html}</body></html>`;
}

lawitgoProgress.get('/', async (c) => {
  const scope = await currentViewerScope(c);
  if (!scope) return c.json({ error: '담당자 계정을 확인할 수 없습니다.' }, 403);
  if (!scope.canViewAll && !scope.ownConsultantId) {
    return c.json({ error: '담당자 매핑을 확인할 수 없습니다.' }, 403);
  }
  return c.json(await cachedLawitgoList(c.env.DB, scope.canViewAll ? undefined : scope.ownConsultantId!));
});

lawitgoProgress.get('/:id/render', async (c) => {
  const id = c.req.param('id');
  if (!isSafeLawitgoProgressId(id)) return c.json({ error: '사건 ID가 올바르지 않습니다.' }, 400);
  const scope = await currentViewerScope(c);
  if (!scope) return c.json({ error: '담당자 계정을 확인할 수 없습니다.' }, 403);
  if (!scope.canViewAll && !scope.ownConsultantId) return c.json({ error: '담당자 매핑을 확인할 수 없습니다.' }, 403);
  const detail = await cachedLawitgoDetail(c.env.DB, id, scope.canViewAll ? undefined : scope.ownConsultantId!);
  if (!detail) return c.json({ error: '캐시된 사건 진행사항을 찾을 수 없습니다.' }, 404);
  return c.html(cachedUiDocument(detail.ui.css, detail.ui.html), 200, {
    'Cache-Control': 'no-store, private',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: https://www.lawitgo.com; font-src data: https://www.lawitgo.com; base-uri 'none'; form-action 'none'",
    'Referrer-Policy': 'no-referrer',
  });
});

lawitgoProgress.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!isSafeLawitgoProgressId(id)) return c.json({ error: '사건 ID가 올바르지 않습니다.' }, 400);
  const scope = await currentViewerScope(c);
  if (!scope) return c.json({ error: '담당자 계정을 확인할 수 없습니다.' }, 403);
  if (!scope.canViewAll && !scope.ownConsultantId) return c.json({ error: '담당자 매핑을 확인할 수 없습니다.' }, 403);
  const detail = await cachedLawitgoDetail(c.env.DB, id, scope.canViewAll ? undefined : scope.ownConsultantId!);
  if (!detail) return c.json({ error: '캐시된 사건 진행사항을 찾을 수 없습니다.' }, 404);
  const consultantStatement = await getLawitgoStatementByProgress(c.env.DB, id);
  return c.json({ ...detail, consultantStatement });
});

export default lawitgoProgress;
