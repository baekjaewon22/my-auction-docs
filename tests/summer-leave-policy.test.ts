import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import {
  isSummerLeaveRequestPeriod,
  isSummerLeaveUsageDate,
  SUMMER_LEAVE_REQUEST_PERIOD_ERROR,
  SUMMER_LEAVE_SPECIAL_USAGE_PERIOD_ERROR,
  SUMMER_LEAVE_USAGE_PERIOD_ERROR,
} from '../src/shared/summer-leave-policy.ts';
import { planSummerLeave } from '../src/shared/leave-calendar.ts';
import { createToken } from '../src/worker/middleware/auth.ts';
import leave from '../src/worker/routes/leave.ts';
import type { AuthEnv, JwtPayload } from '../src/worker/types.ts';

type D1Statement = D1PreparedStatement & { run(): Promise<D1Result> };

function d1FromSqlite(sqlite: Database.Database): D1Database {
  const prepare = (sql: string, params: unknown[] = []): D1Statement => {
    const statement = sqlite.prepare(sql);
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      all: async <T>() => ({ results: statement.all(...params) as T[] }),
      first: async <T>() => (statement.get(...params) as T | undefined) || null,
      run: async () => {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
      },
    } as D1Statement;
  };
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await (statement as D1Statement).run());
      return results;
    },
  } as unknown as D1Database;
}

const JWT_SECRET = 'summer-leave-policy-secret-1234567890';

async function setupLeaveRoute() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, team_id TEXT,
      branch TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      position_title TEXT NOT NULL DEFAULT '', login_type TEXT NOT NULL DEFAULT 'employee',
      approved INTEGER NOT NULL DEFAULT 1, auth_version INTEGER NOT NULL DEFAULT 0,
      hire_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE leave_requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', half_day_period TEXT NOT NULL DEFAULT '',
      summer_request_year TEXT
    );
    INSERT INTO users (id, email, name, role, branch, department)
    VALUES ('member-1', 'member@example.com', '담당자', 'member', '의정부지사', '경매사업부');
  `);

  const db = d1FromSqlite(sqlite);
  const env = { DB: db, JWT_SIGNING_SECRET: JWT_SECRET } as Env;
  const app = new Hono<AuthEnv>().route('/api/leave', leave);
  const payload: JwtPayload = {
    sub: 'member-1', email: 'member@example.com', name: '담당자', phone: '',
    role: 'member', team_id: null, branch: '의정부지사', department: '경매사업부',
    position_title: '', login_type: 'employee', auth_version: 0,
  };
  const authorization = `Bearer ${await createToken(payload, env)}`;
  const post = (path: string, body: unknown) => app.request(`/api/leave${path}`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env);

  return { sqlite, post };
}

test('여름휴가 신청은 KST 9월 30일 끝까지 허용하고 10월 1일부터 막는다', () => {
  assert.equal(isSummerLeaveRequestPeriod(new Date('2026-09-30T14:59:59.999Z')), true);
  assert.equal(isSummerLeaveRequestPeriod(new Date('2026-09-30T15:00:00.000Z')), false);
});

test('여름휴가 신청 기간은 KST 7월부터 9월까지다', () => {
  assert.equal(isSummerLeaveRequestPeriod(new Date('2026-06-30T14:59:59.999Z')), false);
  assert.equal(isSummerLeaveRequestPeriod(new Date('2026-06-30T15:00:00.000Z')), true);
  assert.equal(isSummerLeaveRequestPeriod(new Date('invalid')), false);
});

test('여름휴가와 연결 연차는 7~9월 날짜만 허용한다', () => {
  assert.equal(isSummerLeaveUsageDate('2026-07-01'), true);
  assert.equal(isSummerLeaveUsageDate('2026-09-30'), true);
  assert.equal(isSummerLeaveUsageDate('2026-06-30'), false);
  assert.equal(isSummerLeaveUsageDate('2026-10-01'), false);
  assert.equal(isSummerLeaveUsageDate('2026-09-31'), false);
  assert.equal(isSummerLeaveUsageDate('not-a-date'), false);
});

test('9월 말 휴가 계산 결과가 10월로 넘어가면 기간 정책에서 거절된다', () => {
  const holidays = new Set<string>();
  const oneDay = planSummerLeave({
    startDate: '2026-09-30', summerDays: 1, chainDays: 0, chainPosition: 'after', holidays,
  });
  const twoDays = planSummerLeave({
    startDate: '2026-09-30', summerDays: 2, chainDays: 0, chainPosition: 'after', holidays,
  });
  const connectedAnnual = planSummerLeave({
    startDate: '2026-09-30', summerDays: 1, chainDays: 1, chainPosition: 'after', holidays,
  });
  const dates = (plan: typeof oneDay) => [
    plan.specialStartDate, plan.specialEndDate, plan.annualStartDate, plan.annualEndDate,
  ].filter((date): date is string => Boolean(date));

  assert.equal(dates(oneDay).every(isSummerLeaveUsageDate), true);
  assert.equal(dates(twoDays).every(isSummerLeaveUsageDate), false);
  assert.equal(twoDays.specialEndDate, '2026-10-01');
  assert.equal(dates(connectedAnnual).every(isSummerLeaveUsageDate), false);
  assert.equal(connectedAnnual.annualStartDate, '2026-10-01');
});

test('백엔드의 신규·구형 신청 경로는 7~9월 동작과 기존 7~8월 문구를 함께 사용한다', () => {
  const leaveRoute = readFileSync(new URL('../src/worker/routes/leave.ts', import.meta.url), 'utf8');

  assert.equal((leaveRoute.match(/if \(!isSummerLeaveRequestPeriod\(\)\)/g) || []).length, 2);
  assert.equal((leaveRoute.match(/!isSummerLeaveUsageDate\(/g) || []).length, 4);
  assert.equal((leaveRoute.match(/SUMMER_LEAVE_REQUEST_PERIOD_ERROR/g) || []).length, 3);
  assert.equal((leaveRoute.match(/SUMMER_LEAVE_USAGE_PERIOD_ERROR/g) || []).length, 3);
  assert.equal((leaveRoute.match(/SUMMER_LEAVE_SPECIAL_USAGE_PERIOD_ERROR/g) || []).length, 2);
  assert.match(SUMMER_LEAVE_REQUEST_PERIOD_ERROR, /7~8월/);
  assert.match(SUMMER_LEAVE_REQUEST_PERIOD_ERROR, /9월부터/);
  assert.match(SUMMER_LEAVE_USAGE_PERIOD_ERROR, /7~8월/);
  assert.match(SUMMER_LEAVE_SPECIAL_USAGE_PERIOD_ERROR, /7~8월/);
});

test('전용 여름휴가 API는 KST 9월 30일에는 기간 검사를 통과하고 10월 1일에는 거절한다', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T14:59:59.000Z') });
  const { sqlite, post } = await setupLeaveRoute();
  const body = {
    start_date: '2026-09-28', summer_days: 3, chain_days: 0,
    chain_position: 'after', summer_reason: '[여름휴가] 잘못된 일수',
  };

  const september = await post('/request/summer', body);
  assert.equal(september.status, 400);
  assert.notEqual((await september.json() as { error: string }).error, SUMMER_LEAVE_REQUEST_PERIOD_ERROR);

  const crossingOctober = await post('/request/summer', {
    ...body,
    start_date: '2026-09-30',
    summer_days: 2,
    summer_reason: '[여름휴가] 2일',
  });
  assert.equal(crossingOctober.status, 400);
  assert.equal((await crossingOctober.json() as { error: string }).error, SUMMER_LEAVE_USAGE_PERIOD_ERROR);

  const connectedAnnualInOctober = await post('/request/summer', {
    ...body,
    start_date: '2026-09-30',
    summer_days: 1,
    chain_days: 1,
    summer_reason: '[여름휴가] 1일 (연차 1일 연결 뒤)',
    annual_reason: '[여름휴가 연결] 1일',
  });
  assert.equal(connectedAnnualInOctober.status, 400);
  assert.equal((await connectedAnnualInOctober.json() as { error: string }).error, SUMMER_LEAVE_USAGE_PERIOD_ERROR);

  t.mock.timers.setTime(new Date('2026-09-30T15:00:00.000Z').getTime());
  const october = await post('/request/summer', body);
  assert.equal(october.status, 400);
  assert.equal((await october.json() as { error: string }).error, SUMMER_LEAVE_REQUEST_PERIOD_ERROR);
  sqlite.close();
});

test('구형 일반 휴가 API도 KST 9월 허용·10월 거절 정책을 동일하게 적용한다', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T14:59:59.000Z') });
  const { sqlite, post } = await setupLeaveRoute();
  const body = {
    leave_type: '특별휴가', start_date: '2026-09-28', end_date: '2026-09-30',
    reason: '[여름휴가] 잘못된 일수',
  };

  const september = await post('/request', body);
  assert.equal(september.status, 400);
  assert.notEqual((await september.json() as { error: string }).error, SUMMER_LEAVE_REQUEST_PERIOD_ERROR);

  const crossingOctober = await post('/request', {
    ...body,
    start_date: '2026-09-30',
    summer_days: 2,
    reason: '[여름휴가] 2일',
  });
  assert.equal(crossingOctober.status, 400);
  assert.equal(
    (await crossingOctober.json() as { error: string }).error,
    SUMMER_LEAVE_SPECIAL_USAGE_PERIOD_ERROR,
  );

  t.mock.timers.setTime(new Date('2026-09-30T15:00:00.000Z').getTime());
  const october = await post('/request', body);
  assert.equal(october.status, 400);
  assert.equal((await october.json() as { error: string }).error, SUMMER_LEAVE_REQUEST_PERIOD_ERROR);
  sqlite.close();
});
