import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { resolveSalesCustomer, searchSalesCustomers } from '../src/worker/lib/sales-customer-master.ts';

function d1FromSqlite(db: Database.Database): any {
  const prepare = (sql: string) => {
    const statement = db.prepare(sql);
    return {
      bind(...params: unknown[]) {
        return {
          async run() { const info = statement.run(...params); return { meta: { changes: info.changes } }; },
          async all() { return { results: statement.all(...params) }; },
          async first() { return statement.get(...params) || null; },
        };
      },
      async run() { const info = statement.run(); return { meta: { changes: info.changes } }; },
      async all() { return { results: statement.all() }; },
      async first() { return statement.get() || null; },
    };
  };
  return {
    prepare,
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

function createDb(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);
  INSERT INTO users VALUES ('owner-1');
  CREATE TABLE sales_records (
    id TEXT PRIMARY KEY, user_id TEXT, type TEXT, client_name TEXT, client_phone TEXT,
    status TEXT, customer_id TEXT, created_at TEXT, updated_at TEXT
  )`);
  return sqlite;
}

test('고객 마스터는 담당자 ID와 이름·전화번호 조합으로 동명이인을 분리한다', async () => {
  const sqlite = createDb();
  const db = d1FromSqlite(sqlite);
  const first = await resolveSalesCustomer(db, { ownerId: 'owner-1', name: '홍 길동', phone: '010-1111-2222' });
  const same = await resolveSalesCustomer(db, { ownerId: 'owner-1', name: '홍길동', phone: '01011112222' });
  const otherOwner = await resolveSalesCustomer(db, { ownerId: 'owner-2', name: '홍길동', phone: '010-1111-2222' });
  const namesake = await resolveSalesCustomer(db, { ownerId: 'owner-1', name: '홍길동', phone: '010-3333-4444' });

  assert.equal(same.id, first.id);
  assert.notEqual(otherOwner.id, first.id);
  assert.notEqual(namesake.id, first.id);
  assert.equal((await searchSalesCustomers(db, 'owner-1', '홍')).length, 2);
  assert.equal((await searchSalesCustomers(db, 'owner-2', '홍')).length, 1);
  sqlite.close();
});

test('고객 마스터 선택은 소유 담당자와 등록 연락처가 모두 일치해야 한다', async () => {
  const sqlite = createDb();
  const db = d1FromSqlite(sqlite);
  const customer = await resolveSalesCustomer(db, { ownerId: 'owner-1', name: '김고객', phone: '010-1234-5678' });
  await assert.rejects(
    resolveSalesCustomer(db, { ownerId: 'owner-2', name: '김고객', phone: '010-1234-5678', customerId: customer.id }),
    /선택한 고객을 찾을 수 없습니다/,
  );
  await assert.rejects(
    resolveSalesCustomer(db, { ownerId: 'owner-1', name: '김고객', phone: '010-9999-9999', customerId: customer.id }),
    /고객 정보가 변경되었습니다/,
  );
  sqlite.close();
});

test('마이그레이션은 기존 계약·낙찰을 고객 마스터로 백필한다', () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);
  INSERT INTO users VALUES ('owner-1');
  CREATE TABLE sales_records (
    id TEXT PRIMARY KEY, user_id TEXT, type TEXT, client_name TEXT, client_phone TEXT,
    created_at TEXT, updated_at TEXT
  );
  INSERT INTO sales_records VALUES
    ('contract-1', 'owner-1', '계약', '홍길동', '010-1111-2222', '2026-01-01', '2026-01-01'),
    ('won-1', 'owner-1', '낙찰', '홍 길동', '01011112222', '2026-02-01', '2026-02-01');`);
  sqlite.exec(readFileSync(new URL('../d1/migrate-sales-customer-master.sql', import.meta.url), 'utf8'));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sales_customers').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(DISTINCT customer_id) AS count FROM sales_records').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sales_customer_contacts').get().count, 1);
  sqlite.close();
});

test('업무성과 자동완성은 선택하거나 무시하고 신규 고객으로 계속 작성할 수 있다', () => {
  const page = readFileSync(new URL('../src/react-app/pages/Sales.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../d1/migrate-sales-customer-master.sql', import.meta.url), 'utf8');
  assert.match(page, /api\.sales\.customerSearch/);
  assert.match(page, /해당 고객이 아니면 선택하지 않고 계속 작성하세요/);
  assert.match(page, /customer_id: selectedCustomerId/);
  assert.match(route, /resolveSalesCustomer/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sales_customer_contacts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sales_customer_addresses/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sales_customer_cases/);
});
