import { APP_URL } from '../alimtalk';
import type { JwtPayload } from '../types';

type RoomReservationSlackInput = {
  reservationId?: string;
  user: JwtPayload;
  branch: string;
  roomName: string;
  reservationDate: string;
  startTime: string;
  endTime: string;
  title?: string;
  note?: string;
};

type RoomReservationSlackEnv = Record<string, unknown> & {
  DB?: D1Database;
};

type SlackWebhookChoice = {
  url: string;
  source: string;
};

function valueOrDash(value: unknown): string {
  const text = String(value || '').trim();
  return text || '-';
}

function userLabel(user: JwtPayload): string {
  const parts = [
    valueOrDash(user.name),
    valueOrDash(user.department),
    valueOrDash(user.position_title),
  ].filter((part) => part !== '-');
  return parts.length > 0 ? parts.join(' / ') : valueOrDash(user.email);
}

function renderRoomReservationSlackMessage(input: RoomReservationSlackInput): string {
  const lines = [
    ':spiral_calendar_pad: 회의실 예약 알림',
    '',
    `예약자: ${userLabel(input.user)}`,
    `일시: ${input.reservationDate} ${input.startTime}-${input.endTime}`,
    `장소: ${input.branch} / ${input.roomName}`,
    `제목: ${valueOrDash(input.title)}`,
  ];

  const note = String(input.note || '').trim();
  if (note) lines.push(`메모: ${note}`);

  lines.push('', `바로가기: ${APP_URL}/rooms`);
  return lines.join('\n');
}

function validSlackWebhookUrl(value: unknown): string {
  const text = String(value || '').trim();
  if (!text.startsWith('https://hooks.slack.com/services/')) return '';
  return text;
}

function chooseSlackWebhook(env: RoomReservationSlackEnv): SlackWebhookChoice {
  const candidates: Array<[string, unknown]> = [
    ['SLACK_ACCOUNTING_WEBHOOK_URL', env.SLACK_ACCOUNTING_WEBHOOK_URL],
    ['SLACK_ROOM_RESERVATION_WEBHOOK_URL', env.SLACK_ROOM_RESERVATION_WEBHOOK_URL],
    ['SLACK_WEBHOOK_URL', env.SLACK_WEBHOOK_URL],
  ];

  for (const [source, value] of candidates) {
    const url = validSlackWebhookUrl(value);
    if (url) return { url, source };
  }

  return { url: '', source: '' };
}

async function ensureRoomSlackLogTable(db?: D1Database): Promise<void> {
  if (!db) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS room_reservation_slack_logs (
      id TEXT PRIMARY KEY,
      reservation_id TEXT NOT NULL DEFAULT '',
      webhook_source TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_room_res_slack_logs_reservation
    ON room_reservation_slack_logs(reservation_id, created_at)
  `).run();
}

async function insertRoomSlackLog(
  env: RoomReservationSlackEnv,
  input: {
    reservationId?: string;
    webhookSource?: string;
    status: 'success' | 'failed' | 'skipped';
    errorMessage?: string;
  },
): Promise<void> {
  try {
    await ensureRoomSlackLogTable(env.DB);
    if (!env.DB) return;
    await env.DB.prepare(`
      INSERT INTO room_reservation_slack_logs
        (id, reservation_id, webhook_source, status, error_message)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.reservationId || '',
      input.webhookSource || '',
      input.status,
      (input.errorMessage || '').slice(0, 500),
    ).run();
  } catch (err) {
    console.error('[room reservation slack] failed to write log', err);
  }
}

async function postToSlack(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack webhook failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

export async function sendRoomReservationSlackNotification(
  env: RoomReservationSlackEnv,
  input: RoomReservationSlackInput,
): Promise<{ sent: boolean; skipped?: boolean }> {
  const webhook = chooseSlackWebhook(env);

  if (!webhook.url) {
    console.warn('[room reservation slack] skipped: missing valid Slack webhook URL');
    await insertRoomSlackLog(env, {
      reservationId: input.reservationId,
      status: 'skipped',
      errorMessage: 'missing valid Slack webhook URL',
    });
    return { sent: false, skipped: true };
  }

  try {
    await postToSlack(webhook.url, renderRoomReservationSlackMessage(input));
    await insertRoomSlackLog(env, {
      reservationId: input.reservationId,
      webhookSource: webhook.source,
      status: 'success',
    });
  } catch (err: any) {
    await insertRoomSlackLog(env, {
      reservationId: input.reservationId,
      webhookSource: webhook.source,
      status: 'failed',
      errorMessage: err?.message || String(err),
    });
    throw err;
  }

  return { sent: true };
}

export async function sendRoomReservationSlackTest(
  env: RoomReservationSlackEnv,
): Promise<{ sent: boolean; skipped?: boolean }> {
  return sendRoomReservationSlackNotification(env, {
    user: {
      sub: 'manual-test',
      email: 'manual-test@example.com',
      name: 'Slack 테스트',
      phone: '',
      role: 'admin',
      team_id: null,
      branch: '테스트',
      department: '시스템',
      position_title: '테스트',
    },
    branch: '의정부본사',
    roomName: '1회의실',
    reservationDate: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
    startTime: '09:00',
    endTime: '09:30',
    title: '회의실 예약 Slack 테스트',
    note: '이 메시지가 보이면 웹훅 연결이 정상입니다.',
  });
}
