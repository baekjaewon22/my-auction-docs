import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';

const routeSource = fs.readFileSync(new URL('../src/worker/routes/lawitgo-settlement-ledger.ts', import.meta.url), 'utf8');
const settlementSource = fs.readFileSync(new URL('../src/worker/lib/lawitgo-new-settlement.ts', import.meta.url), 'utf8');
const casesSource = fs.readFileSync(new URL('../src/worker/routes/cases.ts', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
const layoutSource = fs.readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
const pageSource = fs.readFileSync(new URL('../src/react-app/pages/LawitgoSettlementLedger.tsx', import.meta.url), 'utf8');
const baseMigration = fs.readFileSync(new URL('../d1/migrate-lawitgo-new-settlements.sql', import.meta.url), 'utf8');
const managementMigration = fs.readFileSync(new URL('../d1/migrate-lawitgo-new-settlement-ledger-management.sql', import.meta.url), 'utf8');

test('신정산 원장 관리용 삭제·수정 표시와 감사 테이블을 별도로 보관한다', () => {
  const db = new Database(':memory:');
  db.exec(baseMigration);
  db.exec(managementMigration);
  const columns = db.prepare('PRAGMA table_info(lawitgo_new_settlements)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  for (const name of ['deleted_at', 'deleted_by', 'delete_reason', 'manual_override_at', 'manual_override_by']) {
    assert.equal(names.has(name), true, `${name} column`);
  }
  const auditTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lawitgo_new_settlement_audit'").get();
  assert.ok(auditTable);
  db.close();
});

test('총무 권한, 확정 급여 보호, 감사 이력과 소프트 삭제를 API에서 강제한다', () => {
  assert.match(routeSource, /'master', 'ceo', 'accountant', 'accountant_asst'/);
  assert.match(routeSource, /hasLockedPayroll/);
  assert.match(routeSource, /lawitgo_new_settlement_audit/);
  assert.match(routeSource, /UPDATE lawitgo_new_settlements SET deleted_at = datetime\('now'\)/);
  assert.match(routeSource, /INSERT INTO case_hidden/);
});

test('삭제 원장은 급여와 결산내역서에서 제외되고 수동 수정은 명승 재전송보다 우선한다', () => {
  assert.match(settlementSource, /AND deleted_at IS NULL/);
  assert.match(settlementSource, /AND l\.deleted_at IS NULL/);
  assert.match(casesSource, /manual_override_at IS NULL/);
});

test('관리 메뉴와 전용 페이지에서 조회·수정·삭제·이력을 제공한다', () => {
  assert.match(appSource, /path="lawitgo-settlement-ledger"/);
  assert.match(layoutSource, /명승 신정산 원장/);
  assert.match(pageSource, /lawitgoSettlementLedger\.update/);
  assert.match(pageSource, /lawitgoSettlementLedger\.delete/);
  assert.match(pageSource, /lawitgoSettlementLedger\.history/);
});
