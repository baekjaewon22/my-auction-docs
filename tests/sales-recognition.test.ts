import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  effectiveSalesStatus,
  isConfirmedSale,
  recognizedSalesDate,
} from '../src/shared/sales-recognition.ts';
import {
  confirmedSalesSql,
  recognizedSalesDateSql,
  salesPeriodSql,
} from '../src/worker/lib/sales-recognition.ts';

test('card sale without a settlement date remains card_pending for every product type', () => {
  for (const type of ['낙찰', '계약', '권리분석보증서']) {
    const row = { type, payment_type: '카드', card_deposit_date: '', status: 'confirmed' };
    assert.equal(effectiveSalesStatus(row), 'card_pending');
    assert.equal(isConfirmedSale(row), false);
  }
});

test('card settlement date confirms a stale card_pending sale and becomes its recognition date', () => {
  const row = {
    payment_type: '카드',
    card_deposit_date: '2026-07-20',
    contract_date: '2026-06-10',
    deposit_date: '2026-06-11',
    status: 'card_pending',
  };
  assert.equal(effectiveSalesStatus(row), 'confirmed');
  assert.equal(isConfirmedSale(row), true);
  assert.equal(recognizedSalesDate(row), '2026-07-20');
});

test('non-card sale keeps the existing status and deposit/contract date basis', () => {
  assert.equal(effectiveSalesStatus({ payment_type: '이체', status: 'confirmed' }), 'confirmed');
  assert.equal(effectiveSalesStatus({ payment_type: '이체', status: 'card_pending' }), 'confirmed');
  assert.equal(recognizedSalesDate({ payment_type: '이체', deposit_date: '2026-07-03', contract_date: '2026-07-01' }), '2026-07-03');
  assert.equal(recognizedSalesDate({ payment_type: '이체', deposit_date: '', contract_date: '2026-07-01' }), '2026-07-01');
});

test('pending and refund workflow states are not bypassed by a card settlement date', () => {
  assert.equal(effectiveSalesStatus({ payment_type: '카드', card_deposit_date: '2026-07-20', status: 'pending' }), 'pending');
  assert.equal(effectiveSalesStatus({ payment_type: '카드', card_deposit_date: '', status: 'refund_requested' }), 'refund_requested');
  assert.equal(effectiveSalesStatus({ payment_type: '카드', card_deposit_date: '', status: 'refunded' }), 'refunded');
});

test('SQL aggregation recognizes cards only in their settlement month', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      payment_type TEXT,
      contract_date TEXT,
      deposit_date TEXT,
      card_deposit_date TEXT
    );
  `);
  const insert = db.prepare('INSERT INTO sales_records VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run('stale-card', 100, 'confirmed', '카드', '2026-07-01', '2026-07-01', '');
  insert.run('settled-card', 200, 'card_pending', '카드', '2026-06-01', '2026-06-01', '2026-07-15');
  insert.run('transfer', 300, 'confirmed', '이체', '2026-06-01', '2026-07-16', '');

  const rows = db.prepare(`
    SELECT id, ${recognizedSalesDateSql('sr')} AS recognized_date
    FROM sales_records sr
    WHERE ${confirmedSalesSql('sr')}
      AND ${recognizedSalesDateSql('sr')} BETWEEN ? AND ?
    ORDER BY id
  `).all('2026-07-01', '2026-07-31') as Array<{ id: string; recognized_date: string }>;

  assert.deepEqual(rows, [
    { id: 'settled-card', recognized_date: '2026-07-15' },
    { id: 'transfer', recognized_date: '2026-07-16' },
  ]);

  const visible = db.prepare(`SELECT id FROM sales_records sr WHERE ${salesPeriodSql('sr')} ORDER BY id`)
    .all('2026-07-01', '2026-07-31', '2026-07-01', '2026-07-31') as Array<{ id: string }>;
  assert.deepEqual(visible.map((row) => row.id), ['settled-card', 'stale-card', 'transfer']);
  db.close();
});
