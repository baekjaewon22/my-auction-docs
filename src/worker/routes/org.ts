import { Hono } from 'hono';
import type { AuthEnv, OrgNode } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const org = new Hono<AuthEnv>();
org.use('*', authMiddleware);

// GET /api/org — 전체 조직도 노드 조회
org.get('/', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(
    'SELECT o.*, u.name as user_name, u.role as user_role, u.position_title FROM org_nodes o LEFT JOIN users u ON o.user_id = u.id ORDER BY o.tier, o.sort_order'
  ).all();
  return c.json({ nodes: result.results });
});

// PUT /api/org/sync — 전체 조직도 동기화 (localStorage → DB 일괄 저장)
org.put('/sync', requireRole('master', 'ceo', 'admin'), async (c) => {
  const { nodes } = await c.req.json<{ nodes: { id: string; label: string; user_id?: string; parent_id?: string; tier: number; sort_order: number }[] }>();
  const db = c.env.DB;

  // 기존 전체 삭제 후 재삽입
  await db.prepare('DELETE FROM org_nodes').run();

  for (const n of nodes) {
    await db.prepare(
      'INSERT INTO org_nodes (id, label, user_id, parent_id, tier, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(n.id, n.label, n.user_id || null, n.parent_id || null, n.tier, n.sort_order).run();
  }

  // 사용자 레코드 자동 동기화: 조직도 배치 기반으로 부서/지사/보직 업데이트
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  for (const n of nodes) {
    if (!n.user_id) continue;

    // 위로 올라가며 부서명과 지사명 추출
    let department = '';
    let branch = '';

    // 자기 자신의 노드 라벨 분석
    const ownLabel = n.label.replace(/ — .+$/, '').trim();
    if (n.tier === 2) {
      // tier 2 = 지사 레벨 → 자기 자신을 branch로
      branch = ownLabel.replace(/지사|지점|본부/g, '').trim() || ownLabel;
    } else if (n.tier === 3) {
      // tier 3 = 부서 레벨 → 자기 자신을 department로
      department = ownLabel;
    }

    let currentId: string | undefined = n.parent_id;

    while (currentId) {
      const parent = nodeMap.get(currentId);
      if (!parent) break;
      const parentLabel = parent.label.replace(/ — .+$/, '').trim();

      // 지사 추출: tier 2 또는 라벨에 "지사/지점/본부" 포함
      const isbranchNode = parent.tier <= 2 && parent.parent_id && (
        parentLabel.includes('지사') || parentLabel.includes('지점') || parentLabel.includes('본부') || parent.tier === 2
      );
      if (!branch && isbranchNode) {
        branch = parentLabel.replace(/지사|지점|본부/g, '').trim() || parentLabel;
      }
      // 부서 추출: 지사가 아닌 상위 노드 (팀/부서 레벨)
      if (!department && !isbranchNode && parent.tier >= 2 && parent.tier <= 3) {
        department = parentLabel;
      }

      currentId = parent.parent_id;
    }

    // 조직도는 지사/부서만 설정, 보직(position_title)은 건드리지 않음
    await db.prepare(
      "UPDATE users SET department = ?, branch = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(department, branch, n.user_id).run();
  }

  return c.json({ success: true, count: nodes.length });
});

// POST /api/org/node — 단일 노드 추가
org.post('/node', requireRole('master', 'ceo', 'admin'), async (c) => {
  const { id, label, user_id, parent_id, tier, sort_order } = await c.req.json<{
    id: string; label: string; user_id?: string; parent_id?: string; tier: number; sort_order?: number;
  }>();
  const db = c.env.DB;

  await db.prepare(
    'INSERT INTO org_nodes (id, label, user_id, parent_id, tier, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, label, user_id || null, parent_id || null, tier, sort_order || 0).run();

  return c.json({ success: true });
});

// DELETE /api/org/node/:id — 노드 삭제 (하위도 CASCADE)
org.delete('/node/:id', requireRole('master', 'ceo', 'admin'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.prepare('DELETE FROM org_nodes WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// GET /api/org/chain/:userId — 특정 유저의 결재선 계산
org.get('/chain/:userId', async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;

  // 1) 해당 유저의 org_node 찾기
  const userNode = await db.prepare(
    'SELECT * FROM org_nodes WHERE user_id = ?'
  ).bind(userId).first<OrgNode>();

  if (!userNode) {
    return c.json({ chain: [], error: '조직도에 배치되지 않은 사용자입니다.' });
  }

  // 2) 위로 올라가며 승인자 수집 (본인 제외, 최대 2단계)
  const chain: { user_id: string; name: string; tier: number; label: string }[] = [];
  let currentParentId = userNode.parent_id;
  let steps = 0;
  const maxSteps = 2; // 본인 포함 3단계 → 승인자 최대 2명

  while (currentParentId && steps < maxSteps) {
    const parentNode = await db.prepare(
      'SELECT o.*, u.name as user_name FROM org_nodes o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?'
    ).bind(currentParentId).first<OrgNode & { user_name: string }>();

    if (!parentNode) break;

    if (parentNode.user_id) {
      chain.push({
        user_id: parentNode.user_id,
        name: parentNode.user_name || parentNode.label,
        tier: parentNode.tier,
        label: parentNode.label,
      });
      steps++;
    }

    // 팀장(manager)은 1단계만
    const user = await db.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: string }>();
    if (user && user.role === 'manager') break;

    currentParentId = parentNode.parent_id;
  }

  // 3) 최상위급(지사장/본부장 등)이고 chain이 비었거나 위에 대표뿐이면 → CC 사용
  if (chain.length === 0 || (userNode.tier <= 2 && !currentParentId)) {
    const ccList = await db.prepare(
      'SELECT ac.*, u.name as cc_user_name FROM approval_cc ac JOIN users u ON ac.cc_user_id = u.id'
    ).all<{ cc_user_id: string; cc_user_name: string }>();

    if (ccList.results && ccList.results.length > 0) {
      // 기존 chain 대신 CC 승인자 사용
      return c.json({
        chain: ccList.results.map((cc) => ({
          user_id: cc.cc_user_id,
          name: cc.cc_user_name,
          tier: 0,
          label: 'CC',
        })),
        type: 'cc',
      });
    }
  }

  return c.json({ chain, type: chain.length <= 1 ? 'direct' : 'hierarchical' });
});

// === CC 설정 ===

// GET /api/org/cc — CC 목록 조회
org.get('/cc', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(
    'SELECT ac.*, u.name as cc_user_name, u.email as cc_user_email FROM approval_cc ac JOIN users u ON ac.cc_user_id = u.id ORDER BY ac.created_at'
  ).all();
  return c.json({ ccList: result.results });
});

// POST /api/org/cc — CC 추가
org.post('/cc', requireRole('master', 'ceo'), async (c) => {
  const user = c.get('user');
  const { cc_user_id } = await c.req.json<{ cc_user_id: string }>();
  const db = c.env.DB;

  // 중복 체크
  const exists = await db.prepare('SELECT id FROM approval_cc WHERE cc_user_id = ?').bind(cc_user_id).first();
  if (exists) return c.json({ error: '이미 CC로 등록된 사용자입니다.' }, 400);

  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO approval_cc (id, cc_user_id, created_by) VALUES (?, ?, ?)'
  ).bind(id, cc_user_id, user.sub).run();

  return c.json({ success: true, id });
});

// DELETE /api/org/cc/:id — CC 삭제
org.delete('/cc/:id', requireRole('master', 'ceo'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.prepare('DELETE FROM approval_cc WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default org;
