import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware } from '../middleware/auth';

const rooms = new Hono<AuthEnv>();
rooms.use('*', authMiddleware);

// 지사별 회의실 구성 (프론트와 동일)
const ROOM_CONFIG: Record<string, string[]> = {
  '의정부': ['1회의실', '2회의실'],
  '서초': ['1회의실', '2회의실'],
  '대전': ['1회의실'],
  '부산': ['1회의실', '2회의실', '3회의실'],
};

const VALID_BRANCHES = Object.keys(ROOM_CONFIG);
const TIME_REGEX = /^(?:0[9]|1[0-7]):(?:00|30)$|^18:00$/;

function isValidBranch(b: string) { return VALID_BRANCHES.includes(b); }
function isValidRoom(branch: string, room: string) { return (ROOM_CONFIG[branch] || []).includes(room); }
// KST 기준 YYYY-MM-DD (Workers는 UTC로 돌기 때문에 +9h 보정)
function todayKST(offsetDays = 0) {
  const ms = Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}
function isWeekendKST(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  // UTC 노이즈 제거를 위해 로컬 Date 생성 → getDay 사용
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

// GET /api/rooms/config — 지사별 회의실 구성 반환
rooms.get('/config', (c) => c.json({ config: ROOM_CONFIG }));

// GET /api/rooms/reservations?branch=&date=&from=&to=&include_cancelled=1
rooms.get('/reservations', async (c) => {
  const db = c.env.DB;
  const { branch, date, from, to, room, include_cancelled } = c.req.query();
  if (!branch || !isValidBranch(branch)) return c.json({ error: '지사 선택 오류' }, 400);

  let query = `
    SELECT r.id, r.user_id, r.branch, r.room_name, r.reservation_date, r.start_time, r.end_time,
      r.title, r.note, r.status, r.created_at,
      u.name as user_name, u.department as user_department,
      u.position_title as user_position, u.branch as user_branch
    FROM room_reservations r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.branch = ?
  `;
  const params: any[] = [branch];
  if (!include_cancelled) { query += " AND r.status = 'active'"; }
  if (room) { query += ' AND r.room_name = ?'; params.push(room); }
  if (date) { query += ' AND r.reservation_date = ?'; params.push(date); }
  if (from && to) { query += ' AND r.reservation_date >= ? AND r.reservation_date <= ?'; params.push(from, to); }
  query += ' ORDER BY r.reservation_date ASC, r.start_time ASC';

  const result = await db.prepare(query).bind(...params).all();
  return c.json({ reservations: result.results || [] });
});

// POST /api/rooms/reservations — 예약 생성 (시간 겹침 체크)
rooms.post('/reservations', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const { branch, room_name, reservation_date, start_time, end_time, title, note } =
    await c.req.json<{ branch: string; room_name: string; reservation_date: string; start_time: string; end_time: string; title?: string; note?: string }>();

  if (!isValidBranch(branch)) return c.json({ error: '지사 선택 오류' }, 400);
  if (!isValidRoom(branch, room_name)) return c.json({ error: '회의실 선택 오류' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reservation_date)) return c.json({ error: '날짜 형식 오류' }, 400);
  if (!TIME_REGEX.test(start_time) || !TIME_REGEX.test(end_time)) return c.json({ error: '시간은 30분 단위로만 설정 가능합니다.' }, 400);
  if (start_time >= end_time) return c.json({ error: '종료시간이 시작시간보다 빨라야 합니다.' }, 400);
  if (start_time < '09:00' || end_time > '18:00') return c.json({ error: '예약 가능 시간은 09:00~18:00 입니다.' }, 400);

  // 주말 예약 차단
  if (isWeekendKST(reservation_date)) return c.json({ error: '주말(토·일)은 예약할 수 없습니다.' }, 400);
  // 2주 범위 제한 (KST 기준 오늘 ~ 오늘+13일)
  const today = todayKST();
  const maxDate = todayKST(13);
  if (reservation_date < today || reservation_date > maxDate) return c.json({ error: '예약은 2주일 이내만 가능합니다.' }, 400);

  // 겹침 체크: 새 시작 < 기존 종료 AND 기존 시작 < 새 종료
  const overlap = await db.prepare(
    `SELECT id FROM room_reservations
     WHERE branch = ? AND room_name = ? AND reservation_date = ? AND status = 'active'
       AND ? < end_time AND start_time < ? LIMIT 1`
  ).bind(branch, room_name, reservation_date, start_time, end_time).first();
  if (overlap) return c.json({ error: '해당 시간대에 이미 예약이 있습니다.' }, 409);

  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO room_reservations (id, user_id, branch, room_name, reservation_date, start_time, end_time, title, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.sub, branch, room_name, reservation_date, start_time, end_time, title || '', note || '').run();
  return c.json({ success: true, id });
});

// DELETE /api/rooms/reservations/:id — 본인 예약 또는 관리자만
rooms.delete('/reservations/:id', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await db.prepare('SELECT user_id FROM room_reservations WHERE id = ?').bind(id).first<{ user_id: string }>();
  if (!row) return c.json({ error: '예약을 찾을 수 없습니다.' }, 404);
  const isAdmin = ['master', 'ceo', 'cc_ref', 'admin'].includes(user.role);
  if (row.user_id !== user.sub && !isAdmin) return c.json({ error: '본인 예약만 취소할 수 있습니다.' }, 403);
  await db.prepare("UPDATE room_reservations SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  return c.json({ success: true });
});

export default rooms;
