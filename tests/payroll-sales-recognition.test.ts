import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { normalizeSalesRecognition } from '../src/shared/sales-recognition.ts';
import { payrollRecognizedOrRefundedSql } from '../src/worker/lib/sales-recognition.ts';

test('급여 매출 조회와 합계는 정산일이 있는 card_pending 행을 동일하게 확정 처리한다', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      amount INTEGER,
      status TEXT,
      payment_type TEXT,
      card_deposit_date TEXT,
      direction TEXT
    );
    INSERT INTO sales_records VALUES
      ('settled-card', 'u1', 300000, 'card_pending', '카드', '2026-07-10', 'income'),
      ('unsettled-card', 'u1', 200000, 'card_pending', '카드', '', 'income'),
      ('refund', 'u1', 100000, 'refunded', '이체', '', 'income');
  `);

  const rows = db.prepare(`
    SELECT * FROM sales_records
    WHERE user_id = ? AND ${payrollRecognizedOrRefundedSql('sales_records')}
    ORDER BY id
  `).all('u1') as Array<Record<string, unknown>>;
  const normalized = rows.map((row) => normalizeSalesRecognition(row));

  assert.deepEqual(normalized.map((row) => [row.id, row.status]), [
    ['refund', 'refunded'],
    ['settled-card', 'confirmed'],
  ]);
  assert.equal(
    normalized
      .filter((row) => row.status === 'confirmed')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0),
    300000,
  );
  db.close();
});
