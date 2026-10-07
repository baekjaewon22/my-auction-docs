import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  assertLawitgoWinningSaleDeletable,
  buildLawitgoWinningItem,
  isLawitgoWinningDeliverySlot,
  LawitgoWinningOverrideError,
  LawitgoWinningSaleDeleteBlockedError,
  prepareLawitgoWinningOverrideContext,
  runLawitgoWinningManualDelivery,
  stageLawitgoWinningOutbox,
  upsertLawitgoWinningOverride,
  upsertValidatedLawitgoWinningOverride,
  validateLawitgoWinningOverrideInput,
} from '../src/worker/lib/lawitgo-winning-delivery.ts';

function d1FromSqlite(sqlite: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...params: unknown[]) { values = params; return statement; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
        async first<T>() { return (sqlite.prepare(sql).get(...values) as T | undefined) || null; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: result.changes } }; },
      };
      return statement;
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map(statement => statement.run()));
    },
  } as unknown as D1Database;
}

function createSourceDatabase(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, branch TEXT NOT NULL DEFAULT '',
      approved INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL DEFAULT 'member'
    );
    CREATE TABLE lawitgo_consultant_mappings (
      user_id TEXT PRIMARY KEY, consultant_id TEXT NOT NULL UNIQUE,
      updated_by TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE journal_entries (
      id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT, branch TEXT, data TEXT
    );
    CREATE TABLE freelancer_auction_schedules (
      id TEXT PRIMARY KEY, user_id TEXT, target_date TEXT, branch TEXT, data TEXT
    );
    CREATE TABLE freelancer_bid_entries (
      id TEXT PRIMARY KEY, user_id TEXT, bid_date TEXT, court TEXT, case_number TEXT,
      item_no TEXT, client_name TEXT, bidder_name TEXT, property_type TEXT,
      suggested_price INTEGER, actual_bid_price INTEGER, winning_price INTEGER,
      bid_result TEXT, deviation_reason TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE bid_analysis_entries (
      id TEXT PRIMARY KEY, bid_result TEXT, assignee_user_id TEXT, assignee_name TEXT,
      branch_name TEXT, source_type TEXT, source_id TEXT, bid_datetime TEXT,
      client_name TEXT, case_number TEXT, property_type TEXT, updated_at TEXT
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, user_id TEXT, branch TEXT, client_name TEXT, client_phone TEXT,
      contract_date TEXT, type_detail TEXT, journal_entry_id TEXT, external_id TEXT,
      type TEXT, amount INTEGER, direction TEXT, status TEXT, created_at TEXT
    );
  `);
  return sqlite;
}

const base = {
  sales_record_id: 'sale-1', assignee_user_id: 'user-1', assignee_name: '홍길동', consultant_id: 'law-1',
  branch: '서초지사', customer_name: '고객', customer_phone: '010-1234-5678', winning_date: '2026-08-14',
  type_detail: '', journal_data: JSON.stringify({ court: '서울중앙지방법원', caseNo: '2026타경123', propertyType: '아파트' }),
  schedule_data: null, analysis_case_number: null, analysis_property_type: null, analysis_bid_datetime: null,
};

test('공매는 법원과 Lawitgo 매핑 없이 저장하고 기존 미발송 전송건을 제외한다', async () => {
  const sqlite = createSourceDatabase();
  const db = d1FromSqlite(sqlite);
  sqlite.exec(`
    INSERT INTO users (id, name, branch) VALUES ('public-user', '공매 담당자', '서초지사');
    INSERT INTO freelancer_auction_schedules VALUES
      ('public-schedule', 'public-user', '2026-10-01', '서초지사', '{"auctionKind":"public","caseNo":"2026-12345-001","propertyType":"아파트"}');
    INSERT INTO sales_records VALUES
      ('public-sale','public-user','서초지사','공매 고객','01012345678','2026-10-01','물건번호 원본',NULL,'auction-schedule:public-schedule','낙찰',2200000,'income','pending','2026-10-01 10:00:00'),
      ('manual-public-sale','public-user','서초지사','공매 고객','01012345678','2026-10-01','[공매] · 물건번호: 2026-12345-002',NULL,NULL,'낙찰',2200000,'income','pending','2026-10-01 10:00:00');
  `);
  try {
    const validated = await validateLawitgoWinningOverrideInput(db, {
      auctionKind: 'public', customerName: '공매 고객', customerPhone: '01012345678',
      court: '', caseNumber: '2026-12345-002', propertyType: '아파트',
      winningDate: '2026-10-01', assigneeUserId: 'public-user',
    });
    assert.equal(validated.court, '');
    assert.equal(validated.consultantId, '');
    await upsertLawitgoWinningOverride(db, 'manual-public-sale', validated, 'public-user');
    assert.equal(sqlite.prepare('SELECT auction_kind FROM lawitgo_winning_overrides').pluck().get(), 'public');
    sqlite.prepare("UPDATE sales_records SET type_detail = '담당자 메모 변경' WHERE id = 'manual-public-sale'").run();
    sqlite.exec(`INSERT INTO lawitgo_winning_outbox (id,sales_record_id,status)
      VALUES ('old-public','public-sale','blocked'), ('old-manual-public','manual-public-sale','pending')`);
    assert.deepEqual(await stageLawitgoWinningOutbox(db), { staged: 0, blocked: 0 });
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM lawitgo_winning_outbox').pluck().get(), 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) FROM sales_records').pluck().get(), 2);
    assert.equal(sqlite.prepare('SELECT case_number FROM lawitgo_winning_overrides').pluck().get(), '2026-12345-002');
    await assert.rejects(validateLawitgoWinningOverrideInput(db, { ...validated, auctionKind: 'court' }), /법원/);
  } finally {
    sqlite.close();
  }
});

test('낙찰 전송 payload는 합의된 사건 정보만 포함하고 수수료·정산정보를 포함하지 않는다', () => {
  const result = buildLawitgoWinningItem(base);
  assert.deepEqual(result.missingFields, []);
  assert.deepEqual(result.item, {
    externalId: 'sale-1', customerName: '고객', customerPhone: '01012345678',
    court: '서울중앙지방법원', caseNumber: '2026타경123', propertyType: '아파트', winningDate: '2026-08-14',
    assignee: { myDocsUserId: 'user-1', consultantId: 'law-1', name: '홍길동', branch: '서초지사' },
  });
  assert.equal('feeAmount' in result.item, false);
  assert.equal('winningPrice' in result.item, false);
});

test('부분 schedule이 있어도 각 필드는 journal→analysis→type_detail 순서로 계속 보완한다', () => {
  const result = buildLawitgoWinningItem({
    ...base,
    customer_name: '',
    customer_phone: 'invalid',
    winning_date: '2026-02-30',
    schedule_data: JSON.stringify({
      court: '의정부지방법원',
      caseNo: '2026타경456',
      itemNo: '2',
      clientPhone: '010-9999-8888',
    }),
    schedule_target_date: 'not-a-date',
    journal_data: JSON.stringify({ client: '김고객', propertyType: '근린상가' }),
    analysis_bid_datetime: '2026-08-22 10:00:00',
  });
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.item.customerName, '김고객');
  assert.equal(result.item.customerPhone, '01099998888');
  assert.equal(result.item.court, '의정부지방법원');
  assert.equal(result.item.caseNumber, '2026타경456(2)');
  assert.equal(result.item.propertyType, '근린상가');
  assert.equal(result.item.winningDate, '2026-08-22');
});

test('master manual delivery sends selected outbox rows once and records the actor', async () => {
  const sqlite = createSourceDatabase();
  sqlite.exec(`
    INSERT INTO users (id, name, branch) VALUES ('u1', '담당자', '서초지사');
    INSERT INTO lawitgo_consultant_mappings (user_id, consultant_id) VALUES ('u1', 'law-1');
    INSERT INTO freelancer_auction_schedules (id, user_id, target_date, branch, data)
      VALUES ('schedule-1', 'u1', '2026-08-20', '서초지사', '{"court":"서울중앙지방법원","caseNo":"2026타경123","propertyType":"아파트"}');
    INSERT INTO bid_analysis_entries
      (id,bid_result,assignee_user_id,assignee_name,branch_name,source_type,source_id,bid_datetime,client_name,case_number,property_type,updated_at)
      VALUES ('analysis-1','낙찰','u1','담당자','서초지사','freelancer','auction-schedule:schedule-1','2026-08-20','고객','2026타경123','아파트','2026-08-20 16:00:00');
    INSERT INTO sales_records VALUES ('sale-1','u1','서초지사','고객','010-1234-5678','2026-08-20','',NULL,'auction-schedule:schedule-1','낙찰',2200000,'income','confirmed','2026-08-20 16:00:00');
  `);
  const db = d1FromSqlite(sqlite);
  await stageLawitgoWinningOutbox(db);
  const outboxId = String((sqlite.prepare('SELECT id FROM lawitgo_winning_outbox').get() as any).id);
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body || '{}')));
    return new Response('', { status: 200, headers: { 'X-Request-Id': 'lawitgo-request-1' } });
  };
  try {
    const first = await runLawitgoWinningManualDelivery({ DB: db, LAWITGO_WINNING_API_KEY: 'test-key' }, 'master-1', [outboxId]);
    const second = await runLawitgoWinningManualDelivery({ DB: db, LAWITGO_WINNING_API_KEY: 'test-key' }, 'master-1', [outboxId]);
    assert.equal(first.sent, 1);
    assert.equal(first.requestId, 'lawitgo-request-1');
    assert.equal(second.sent, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].items[0].externalId, 'sale-1');
    assert.deepEqual(sqlite.prepare('SELECT status, remote_request_id FROM lawitgo_winning_outbox').get(), { status: 'sent', remote_request_id: 'lawitgo-request-1' });
    assert.equal((sqlite.prepare('SELECT actor_user_id FROM lawitgo_winning_manual_runs ORDER BY started_at LIMIT 1').get() as any).actor_user_id, 'master-1');
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test('전화번호나 담당자 매핑 등 필수 정보가 없으면 전송 대신 보완 대기로 분류한다', () => {
  const result = buildLawitgoWinningItem({ ...base, customer_phone: '', consultant_id: null, journal_data: '{}' });
  assert.deepEqual(result.missingFields.sort(), ['assignee.consultantId', 'caseNumber', 'court', 'customerPhone', 'propertyType'].sort());
});

test('낙찰 일괄 전송은 KST 09·12·15·18시 정각에만 실행한다', () => {
  for (const hour of [0, 3, 6, 9]) assert.equal(isLawitgoWinningDeliverySlot(new Date(`2026-08-14T${String(hour).padStart(2, '0')}:00:00Z`)), true);
  assert.equal(isLawitgoWinningDeliverySlot(new Date('2026-08-14T01:00:00Z')), false);
  assert.equal(isLawitgoWinningDeliverySlot(new Date('2026-08-14T03:30:00Z')), false);
});

test('D1 호환 SQL로 낙찰 매출과 직접 연결된 분석을 전송함에 적재한다', async () => {
  const sqlite = createSourceDatabase();
  sqlite.exec(`
    INSERT INTO users (id, name, branch) VALUES ('u1', '홍길동', '서초지사');
    INSERT INTO lawitgo_consultant_mappings (user_id, consultant_id) VALUES ('u1', 'law-1');
    INSERT INTO freelancer_auction_schedules (id, user_id, target_date, branch, data)
      VALUES ('schedule-1', 'u1', '2026-08-20', '서초지사', '{"court":"서울중앙지방법원","caseNo":"2026타경123","propertyType":"아파트"}');
    INSERT INTO bid_analysis_entries
      (id,bid_result,assignee_user_id,assignee_name,branch_name,source_type,source_id,bid_datetime,client_name,case_number,property_type,updated_at)
      VALUES ('analysis-1','낙찰','u1','홍길동','서초지사','freelancer','auction-schedule:schedule-1','2026-08-20','고객','2026타경123','아파트','2026-08-20 16:00:00');
    INSERT INTO sales_records VALUES ('sale-1','u1','서초지사','고객','010-1234-5678','2026-08-20','',NULL,'auction-schedule:schedule-1','낙찰',2200000,'income','confirmed','2026-08-20 16:00:00');
  `);
  const result = await stageLawitgoWinningOutbox(d1FromSqlite(sqlite));
  assert.deepEqual(result, { staged: 1, blocked: 0 });
  assert.deepEqual(sqlite.prepare('SELECT sales_record_id, status, missing_fields FROM lawitgo_winning_outbox').get(), {
    sales_record_id: 'sale-1', status: 'pending', missing_fields: '[]',
  });
  sqlite.close();
});

test('환불·유형변경 등으로 자격을 잃은 미전송 queue는 제거하고 sent/sending 감사행은 보존한다', async () => {
  const sqlite = createSourceDatabase();
  sqlite.exec(`
    INSERT INTO users (id, name, branch) VALUES ('u1', '담당자', '서초지사');
    INSERT INTO journal_entries VALUES
      ('journal-1','u1','2026-08-20','서초지사','{"court":"서울중앙지방법원","caseNo":"2026타경1","propertyType":"아파트"}');
    INSERT INTO sales_records VALUES
      ('sale-drop','u1','서초지사','고객','010-1111-2222','2026-08-20','', 'journal-1',NULL,'낙찰',1000,'income','confirmed','2026-08-20 10:00:00'),
      ('sale-sent','u1','서초지사','고객','010-1111-2222','2026-08-20','', 'journal-1',NULL,'낙찰',1000,'income','confirmed','2026-08-20 10:00:00'),
      ('sale-sending','u1','서초지사','고객','010-1111-2222','2026-08-20','', 'journal-1',NULL,'낙찰',1000,'income','confirmed','2026-08-20 10:00:00');
  `);
  const db = d1FromSqlite(sqlite);
  await stageLawitgoWinningOutbox(db);
  sqlite.exec(`
    UPDATE lawitgo_winning_outbox SET status='sent' WHERE sales_record_id='sale-sent';
    UPDATE lawitgo_winning_outbox SET status='sending' WHERE sales_record_id='sale-sending';
    UPDATE sales_records SET type='계약' WHERE id IN ('sale-drop','sale-sent','sale-sending');
  `);
  await stageLawitgoWinningOutbox(db);
  assert.equal(sqlite.prepare(`SELECT 1 FROM lawitgo_winning_outbox WHERE sales_record_id='sale-drop'`).get(), undefined);
  assert.deepEqual(sqlite.prepare(`SELECT sales_record_id, status FROM lawitgo_winning_outbox ORDER BY sales_record_id`).all(), [
    { sales_record_id: 'sale-sending', status: 'sending' },
    { sales_record_id: 'sale-sent', status: 'sent' },
  ]);
  sqlite.close();
});

test('Lawitgo 발송 중·완료 매출만 삭제를 차단하고 미전송 상태는 기존처럼 허용한다', async () => {
  const sqlite = createSourceDatabase();
  sqlite.exec(`
    INSERT INTO sales_records VALUES
      ('sale-guard','u1','서초지사','고객','010-1111-2222','2026-08-20','',NULL,NULL,'낙찰',1000,'income','pending','2026-08-20 10:00:00');
  `);
  const db = d1FromSqlite(sqlite);

  await assert.doesNotReject(assertLawitgoWinningSaleDeletable(db, 'sale-guard'));
  sqlite.prepare(`INSERT INTO lawitgo_winning_outbox
    (id, sales_record_id, payload_json, missing_fields, status)
    VALUES ('outbox-guard', 'sale-guard', '{}', '[]', ?)`
  ).run('pending');

  for (const status of ['pending', 'blocked', 'failed']) {
    sqlite.prepare("UPDATE lawitgo_winning_outbox SET status = ? WHERE id = 'outbox-guard'").run(status);
    await assert.doesNotReject(assertLawitgoWinningSaleDeletable(db, 'sale-guard'), status);
  }
  for (const status of ['sending', 'sent']) {
    sqlite.prepare("UPDATE lawitgo_winning_outbox SET status = ? WHERE id = 'outbox-guard'").run(status);
    await assert.rejects(
      assertLawitgoWinningSaleDeletable(db, 'sale-guard'),
      (error: unknown) => error instanceof LawitgoWinningSaleDeleteBlockedError
        && error.status === 409,
      status,
    );
  }
  assert.throws(
    () => sqlite.prepare("DELETE FROM sales_records WHERE id = 'sale-guard'").run(),
    /LAWITGO_WINNING_AUDIT_LOCKED/,
  );
  assert.deepEqual(sqlite.prepare("SELECT id FROM sales_records WHERE id = 'sale-guard'").get(), { id: 'sale-guard' });
  sqlite.close();
});

test('담당자 ID가 없는 수동 분석은 이름·지사·날짜·고객이 유일할 때만 연결하고 legacy bid도 보완한다', async () => {
  const sqlite = createSourceDatabase();
  sqlite.exec(`
    INSERT INTO users (id, name, branch) VALUES ('u1', '홍길동', '대전지사');
    INSERT INTO bid_analysis_entries
      (id,bid_result,assignee_user_id,assignee_name,branch_name,source_type,source_id,bid_datetime,client_name,case_number,property_type,updated_at)
      VALUES ('manual-1','낙찰',NULL,'홍길동','대전지사','manual',NULL,'2026-08-21','김고객','2026타경777','아파트','2026-08-21 11:00:00');
    INSERT INTO sales_records VALUES
      ('sale-manual','u1','대전지사','김고객','010-1111-2222','2026-08-21','대전지방법원',NULL,NULL,'낙찰',1000,'income','confirmed','2026-08-21 12:00:00');
  `);
  const db = d1FromSqlite(sqlite);
  await stageLawitgoWinningOutbox(db);
  const manualPayload = JSON.parse(String((sqlite.prepare(`SELECT payload_json FROM lawitgo_winning_outbox
    WHERE sales_record_id='sale-manual'`).get() as any).payload_json));
  assert.equal(manualPayload.caseNumber, '2026타경777');
  assert.equal(manualPayload.propertyType, '아파트');
  assert.equal(manualPayload.assignee.consultantId, 'u1');

  // A second equally plausible row makes the fallback ambiguous, so it must
  // stop using analysis instead of attaching another person's case data.
  sqlite.exec(`
    INSERT INTO bid_analysis_entries
      (id,bid_result,assignee_user_id,assignee_name,branch_name,source_type,source_id,bid_datetime,client_name,case_number,property_type,updated_at)
      VALUES ('manual-2','낙찰',NULL,'홍길동','대전지사','excel',NULL,'2026-08-21','김고객','2026타경999','연립','2026-08-21 12:00:00');
  `);
  await stageLawitgoWinningOutbox(db);
  const ambiguous = sqlite.prepare(`SELECT status, missing_fields FROM lawitgo_winning_outbox
    WHERE sales_record_id='sale-manual'`).get() as any;
  assert.equal(ambiguous.status, 'blocked');
  assert.deepEqual(JSON.parse(ambiguous.missing_fields).sort(), ['caseNumber', 'propertyType'].sort());

  // The mapping schema was already warmed above. A later approved signup must
  // still receive a mapping before the next staging pass.
  sqlite.exec(`
    INSERT INTO users (id, name, branch) VALUES ('u2', '이신규', '부산지사');
    INSERT INTO freelancer_bid_entries VALUES
      ('legacy-1','u2','2026-08-22','부산지방법원','2026타경888','3','박고객','박고객','오피스텔',NULL,NULL,NULL,'낙찰','','2026-08-22','2026-08-22');
    INSERT INTO sales_records VALUES
      ('sale-legacy','u2','부산지사','박고객','010-3333-4444','2026-08-22','',NULL,'freelancer-bid:legacy-1','낙찰',2000,'income','confirmed','2026-08-22 12:00:00');
  `);
  await stageLawitgoWinningOutbox(db);
  const legacyPayload = JSON.parse(String((sqlite.prepare(`SELECT payload_json FROM lawitgo_winning_outbox
    WHERE sales_record_id='sale-legacy'`).get() as any).payload_json));
  assert.equal(legacyPayload.court, '부산지방법원');
  assert.equal(legacyPayload.caseNumber, '2026타경888(3)');
  assert.equal(legacyPayload.propertyType, '오피스텔');
  assert.equal(legacyPayload.assignee.consultantId, 'u2');
  assert.deepEqual(sqlite.prepare(`SELECT consultant_id FROM lawitgo_consultant_mappings WHERE user_id='u2'`).get(), { consultant_id: 'u2' });
  sqlite.close();
});

test('영구 보완값은 blocked를 pending으로 복원하고 sent payload는 불변으로 보존한다', async () => {
  const sqlite = createSourceDatabase();
  sqlite.exec(`
    INSERT INTO users (id, name, branch) VALUES
      ('u1', '기존담당', '서초지사'), ('u2', '보완담당', '의정부지사'), ('master-1', '마스터', '의정부지사');
    INSERT INTO sales_records VALUES
      ('sale-repair','u1','서초지사','고객','','2026-08-23','',NULL,NULL,'낙찰',3000,'income','confirmed','2026-08-23 10:00:00');
  `);
  const db = d1FromSqlite(sqlite);
  await stageLawitgoWinningOutbox(db);
  assert.equal((sqlite.prepare(`SELECT status FROM lawitgo_winning_outbox WHERE sales_record_id='sale-repair'`).get() as any).status, 'blocked');

  const repaired = await upsertLawitgoWinningOverride(db, 'sale-repair', {
    customerName: '고객', customerPhone: '010-5555-6666', court: '의정부지방법원',
    caseNumber: '2026타경1234', propertyType: '아파트', winningDate: '2026-08-23',
    assigneeUserId: 'u2',
  }, 'master-1');
  assert.deepEqual(repaired.missingFields, []);
  await stageLawitgoWinningOutbox(db);
  const pending = sqlite.prepare(`SELECT status, missing_fields, payload_json FROM lawitgo_winning_outbox
    WHERE sales_record_id='sale-repair'`).get() as any;
  assert.equal(pending.status, 'pending');
  assert.equal(pending.missing_fields, '[]');
  const repairedPayload = JSON.parse(pending.payload_json);
  assert.equal(repairedPayload.assignee.myDocsUserId, 'u2');
  assert.equal(repairedPayload.assignee.consultantId, 'u2');
  assert.equal(repairedPayload.customerPhone, '01055556666');

  sqlite.prepare(`UPDATE lawitgo_winning_outbox SET status='sending' WHERE sales_record_id='sale-repair'`).run();
  sqlite.prepare(`UPDATE lawitgo_winning_overrides SET customer_name='경합 중 변경' WHERE sales_record_id='sale-repair'`).run();
  await stageLawitgoWinningOutbox(db);
  const sendingSnapshot = sqlite.prepare(`SELECT status, payload_json FROM lawitgo_winning_outbox
    WHERE sales_record_id='sale-repair'`).get() as any;
  assert.equal(sendingSnapshot.status, 'sending');
  assert.equal(sendingSnapshot.payload_json, pending.payload_json);

  sqlite.prepare(`UPDATE lawitgo_winning_outbox SET status='sent' WHERE sales_record_id='sale-repair'`).run();
  sqlite.prepare(`UPDATE lawitgo_winning_overrides SET customer_name='발송 후 변경' WHERE sales_record_id='sale-repair'`).run();
  await stageLawitgoWinningOutbox(db);
  const sentSnapshot = sqlite.prepare(`SELECT status, payload_json FROM lawitgo_winning_outbox
    WHERE sales_record_id='sale-repair'`).get() as any;
  assert.equal(sentSnapshot.status, 'sent');
  assert.equal(sentSnapshot.payload_json, pending.payload_json);
  await assert.rejects(
    upsertLawitgoWinningOverride(db, 'sale-repair', {
      customerName: '다른 고객', customerPhone: '010-9999-0000', court: '서울중앙지방법원',
      caseNumber: '2026타경9', propertyType: '상가', winningDate: '2026-08-23', assigneeUserId: 'u2',
    }, 'master-1'),
    (error: unknown) => error instanceof LawitgoWinningOverrideError && error.status === 409,
  );
  sqlite.close();
});

test('보완 저장은 실제 날짜·전화·활성 담당자와 낙찰 매출을 모두 검증한다', async () => {
  const sqlite = createSourceDatabase();
  sqlite.exec(`
    INSERT INTO users (id, name, branch, approved, role) VALUES
      ('u1', '담당자', '대전지사', 1, 'member'), ('retired', '퇴사자', '대전지사', 1, 'resigned');
    INSERT INTO sales_records VALUES
      ('not-winning','u1','대전지사','고객','010-1111-2222','2026-08-23','',NULL,NULL,'계약',3000,'income','confirmed','2026-08-23 10:00:00'),
      ('bulk-winning','u1','대전지사','고객','010-1111-2222','2026-08-23','',NULL,NULL,'낙찰',3000,'income','confirmed','2026-08-23 10:00:00');
  `);
  const db = d1FromSqlite(sqlite);
  const valid = {
    customerName: '고객', customerPhone: '010-1111-2222', court: '대전지방법원',
    caseNumber: '2026타경10', propertyType: '아파트', winningDate: '2026-08-23', assigneeUserId: 'u1',
  };
  await assert.rejects(
    validateLawitgoWinningOverrideInput(db, { ...valid, winningDate: '2026-02-30' }),
    (error: unknown) => error instanceof LawitgoWinningOverrideError && error.status === 400,
  );
  await assert.rejects(
    validateLawitgoWinningOverrideInput(db, { ...valid, customerPhone: '1234' }),
    (error: unknown) => error instanceof LawitgoWinningOverrideError && error.status === 400,
  );
  await assert.rejects(
    validateLawitgoWinningOverrideInput(db, { ...valid, assigneeUserId: 'retired' }),
    (error: unknown) => error instanceof LawitgoWinningOverrideError && error.status === 400,
  );
  await assert.rejects(
    upsertLawitgoWinningOverride(db, 'not-winning', valid, 'u1'),
    (error: unknown) => error instanceof LawitgoWinningOverrideError && error.status === 404,
  );
  const context = await prepareLawitgoWinningOverrideContext(db);
  const validated = await validateLawitgoWinningOverrideInput(db, valid, context);
  await upsertValidatedLawitgoWinningOverride(db, 'bulk-winning', validated, 'u1', context);
  assert.deepEqual(sqlite.prepare(`SELECT court, assignee_user_id FROM lawitgo_winning_overrides
    WHERE sales_record_id='bulk-winning'`).get(), { court: '대전지방법원', assignee_user_id: 'u1' });
  sqlite.close();
});

test('전송관리 테이블·중복키·재시도·서버 전용 API 설정을 사용한다', () => {
  const migration = readFileSync('d1/migrate-lawitgo-winning-outbox.sql', 'utf8');
  const overrideMigration = readFileSync('d1/migrate-lawitgo-winning-overrides.sql', 'utf8');
  const deleteGuardMigration = readFileSync('d1/migrate-lawitgo-winning-audit-delete-guard.sql', 'utf8');
  const source = readFileSync('src/worker/lib/lawitgo-winning-delivery.ts', 'utf8');
  const worker = readFileSync('src/worker/index.ts', 'utf8');
  assert.match(migration, /sales_record_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /lawitgo_winning_delivery_runs/);
  assert.match(overrideMigration, /CREATE TABLE IF NOT EXISTS lawitgo_winning_overrides/);
  assert.match(overrideMigration, /FOREIGN KEY \(sales_record_id\)[\s\S]*?ON DELETE CASCADE/);
  assert.match(deleteGuardMigration, /CREATE TRIGGER IF NOT EXISTS trg_sales_records_preserve_lawitgo_audit/);
  assert.match(deleteGuardMigration, /status IN \('sending', 'sent'\)/);
  assert.match(source, /https:\/\/www\.lawitgo\.com\/api\/integrations\/mydocs\/winning-cases\/batch/);
  assert.match(source, /LAWITGO_WINNING_API_KEY/);
  assert.doesNotMatch(source, /env\.LAWITGO_API_KEY/);
  assert.match(source, /'X-API-Key': apiKey/);
  assert.doesNotMatch(source, /lawitgo_consultant_mappings m ON[^\n]+m\.active/);
  assert.match(source, /stale delivery claim recovered/);
  assert.match(source, /stale delivery run recovered/);
  assert.match(source, /external_id LIKE 'auction-schedule:%'/);
  assert.match(source, /datetime\('now', '\+12 hours'\)/);
  assert.match(source, /status='failed'/);
  assert.match(worker, /runLawitgoWinningDelivery/);
});
