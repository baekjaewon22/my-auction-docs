import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  buildLawitgoWinningItem,
  isLawitgoWinningDeliverySlot,
  stageLawitgoWinningOutbox,
} from '../src/worker/lib/lawitgo-winning-delivery.ts';

function d1FromSqlite(sqlite: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...params: unknown[]) { values = params; return statement; },
        async all<T>() { return { results: sqlite.prepare(sql).all(...values) as T[] }; },
        async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: result.changes } }; },
      };
      return statement;
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map(statement => statement.run()));
    },
  } as unknown as D1Database;
}

const base = {
  sales_record_id: 'sale-1', assignee_user_id: 'user-1', assignee_name: '홍길동', consultant_id: 'law-1',
  branch: '서초지사', customer_name: '고객', customer_phone: '010-1234-5678', winning_date: '2026-08-14',
  type_detail: '', journal_data: JSON.stringify({ court: '서울중앙지방법원', caseNo: '2026타경123', propertyType: '아파트' }),
  schedule_data: null, analysis_case_number: null, analysis_property_type: null, analysis_bid_datetime: null,
};

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
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE lawitgo_consultant_mappings (user_id TEXT PRIMARY KEY, consultant_id TEXT);
    CREATE TABLE journal_entries (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE freelancer_auction_schedules (id TEXT PRIMARY KEY, data TEXT);
    CREATE TABLE bid_analysis_entries (
      id TEXT PRIMARY KEY, bid_result TEXT, assignee_user_id TEXT, source_id TEXT,
      bid_datetime TEXT, client_name TEXT, case_number TEXT, property_type TEXT, updated_at TEXT
    );
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, user_id TEXT, branch TEXT, client_name TEXT, client_phone TEXT,
      contract_date TEXT, type_detail TEXT, journal_entry_id TEXT, external_id TEXT,
      type TEXT, amount INTEGER, direction TEXT, status TEXT, created_at TEXT
    );
    INSERT INTO users VALUES ('u1', '홍길동');
    INSERT INTO lawitgo_consultant_mappings VALUES ('u1', 'law-1');
    INSERT INTO freelancer_auction_schedules VALUES ('schedule-1', '{"court":"서울중앙지방법원","caseNo":"2026타경123","propertyType":"아파트"}');
    INSERT INTO bid_analysis_entries VALUES ('analysis-1','낙찰','u1','auction-schedule:schedule-1','2026-08-20','고객','2026타경123','아파트','2026-08-20 16:00:00');
    INSERT INTO sales_records VALUES ('sale-1','u1','서초지사','고객','010-1234-5678','2026-08-20','',NULL,'auction-schedule:schedule-1','낙찰',2200000,'income','confirmed','2026-08-20 16:00:00');
  `);
  const result = await stageLawitgoWinningOutbox(d1FromSqlite(sqlite));
  assert.deepEqual(result, { staged: 1, blocked: 0 });
  assert.deepEqual(sqlite.prepare('SELECT sales_record_id, status, missing_fields FROM lawitgo_winning_outbox').get(), {
    sales_record_id: 'sale-1', status: 'pending', missing_fields: '[]',
  });
  sqlite.close();
});

test('전송관리 테이블·중복키·재시도·서버 전용 API 설정을 사용한다', () => {
  const migration = readFileSync('d1/migrate-lawitgo-winning-outbox.sql', 'utf8');
  const source = readFileSync('src/worker/lib/lawitgo-winning-delivery.ts', 'utf8');
  const worker = readFileSync('src/worker/index.ts', 'utf8');
  assert.match(migration, /sales_record_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /lawitgo_winning_delivery_runs/);
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
