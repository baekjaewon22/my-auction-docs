import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';

const casesSource = fs.readFileSync(new URL('../src/worker/routes/cases.ts', import.meta.url), 'utf8');
const payrollSource = fs.readFileSync(new URL('../src/worker/routes/payroll.ts', import.meta.url), 'utf8');
const payrollUiSource = fs.readFileSync(new URL('../src/react-app/pages/Payroll.tsx', import.meta.url), 'utf8');
const progressRouteSource = fs.readFileSync(new URL('../src/worker/routes/lawitgo-progress.ts', import.meta.url), 'utf8');
const progressUiSource = fs.readFileSync(new URL('../src/react-app/pages/LawitgoProgress.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../d1/migrate-lawitgo-new-settlements.sql', import.meta.url), 'utf8');
const progressLinkMigration = fs.readFileSync(new URL('../d1/migrate-lawitgo-new-settlement-progress-link.sql', import.meta.url), 'utf8');

test('신정산 원장은 externalId 기준으로 한 행만 유지하고 월과 지급액을 갱신한다', () => {
  const db = new Database(':memory:');
  db.exec(migration);
  db.exec(progressLinkMigration);
  const upsert = db.prepare(`
    INSERT INTO lawitgo_new_settlements (
      id, external_id, case_id, consultant_user_id, client_name,
      settlement_date, payroll_month, consultant_share,
      statement_title, statement_format, statement_content, source_registered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_id) DO UPDATE SET
      payroll_month = excluded.payroll_month,
      consultant_share = excluded.consultant_share,
      statement_content = COALESCE(excluded.statement_content, lawitgo_new_settlements.statement_content)
  `);
  upsert.run('s1', 'lawitgo-1', 'c1', 'u1', '홍길동', '2026-08-14', '2026-08', 872727, '결산내역서', 'text', '최초 내역', '2026-08-14T18:00:00+09:00');
  upsert.run('s2', 'lawitgo-1', 'c1', 'u1', '홍길동', '2026-09-01', '2026-09', 900000, null, null, null, '2026-09-01T09:00:00+09:00');

  const rows = db.prepare('SELECT * FROM lawitgo_new_settlements').all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payroll_month, '2026-09');
  assert.equal(rows[0].consultant_share, 900000);
  assert.equal(rows[0].statement_content, '최초 내역');
  db.close();
});

test('신정산 내부 배분액은 저장 스키마와 안전 payload에 포함되지 않는다', () => {
  assert.doesNotMatch(migration, /mau_share|myungseung_share|gross_amount/i);
  const safePayloadBlock = casesSource.slice(
    casesSource.indexOf('const safePayload = isNewSettlement'),
    casesSource.indexOf('const rawPayload =', casesSource.indexOf('const safePayload = isNewSettlement')),
  );
  assert.doesNotMatch(safePayloadBlock, /mauShare|myungseungShare|grossAmount/);
  assert.match(safePayloadBlock, /consultantShare: feeAmount/);
});

test('신정산 지급액은 기존 안건 수당과 분리되어 급여 응답 및 화면 합계에 반영된다', () => {
  assert.match(casesSource, /NOT EXISTS \(SELECT 1 FROM lawitgo_new_settlements lns WHERE lns\.case_id = c\.id\)/);
  assert.match(payrollSource, /lawitgo_new_settlements: lawitgoNewSettlements/);
  assert.match(payrollSource, /savedSnapshot\.response,[\s\S]*lawitgo_new_settlements: lawitgoNewSettlements/);
  assert.match(payrollUiSource, /lawitgoNewSettlementTotal/);
  assert.match(payrollUiSource, /신 안건수당/);
  assert.doesNotMatch(payrollUiSource, /결산내역서 확인/);
});

test('완료된 명도 진행사항의 최하단에서만 결산내역서 버튼을 제공한다', () => {
  assert.match(casesSource, /progressId/);
  assert.match(progressRouteSource, /getLawitgoStatementByProgress/);
  assert.match(progressRouteSource, /consultantStatement/);
  assert.match(progressUiSource, /isCompleted\(selected\) && detail\?\.consultantStatement/);
  assert.match(progressUiSource, /> 결산내역서/);
});

test('신정산 API 응답은 결산내역서 및 급여 저장 결과를 반환한다', () => {
  assert.match(casesSource, /consultantStatementSaved: isNewSettlement && !!statement/);
  assert.match(casesSource, /payrollItemSaved: isNewSettlement/);
  assert.match(casesSource, /CONSULTANT_MAPPING_NOT_FOUND/);
  assert.match(casesSource, /fee\.amount and settlement\.consultantShare must match/);
});
