import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  accountingEntryInitialStatus,
  effectiveSalesStatus,
  isConfirmedSale,
  recognizedSalesDate,
} from '../src/shared/sales-recognition.ts';
import {
  analyticsSalesBucketSql,
  confirmedSalesSql,
  pendingCardSettlementSql,
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
      ,direction TEXT NOT NULL DEFAULT 'income'
    );
  `);
  const insert = db.prepare('INSERT INTO sales_records (id, amount, status, payment_type, contract_date, deposit_date, card_deposit_date) VALUES (?, ?, ?, ?, ?, ?, ?)');
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

test('card expenses are recognized immediately and never enter the sales settlement queue', () => {
  const expense = {
    direction: 'expense', payment_type: '카드', status: 'card_pending',
    card_deposit_date: '', deposit_date: '', contract_date: '2026-07-05',
  };
  assert.equal(effectiveSalesStatus(expense), 'confirmed');
  assert.equal(recognizedSalesDate(expense), '2026-07-05');
  assert.equal(accountingEntryInitialStatus('expense', '카드'), 'confirmed');
  assert.equal(accountingEntryInitialStatus('income', '카드'), 'card_pending');
  assert.equal(effectiveSalesStatus({
    direction: 'expense',
    payment_type: '카드',
    status: 'confirmed',
    card_deposit_date: '',
  }), 'confirmed');

  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, amount INTEGER, status TEXT, payment_type TEXT,
      contract_date TEXT, deposit_date TEXT, card_deposit_date TEXT, direction TEXT
    );
    INSERT INTO sales_records VALUES
      ('expense-card', 100, 'card_pending', '카드', '2026-07-05', '', '', 'expense'),
      ('income-card', 200, 'card_pending', '카드', '2026-07-05', '', '', 'income');
  `);
  const recognized = db.prepare(`
    SELECT id, ${recognizedSalesDateSql('sr')} AS recognized_date
    FROM sales_records sr WHERE ${confirmedSalesSql('sr')} ORDER BY id
  `).all() as Array<{ id: string; recognized_date: string }>;
  assert.deepEqual(recognized, [{ id: 'expense-card', recognized_date: '2026-07-05' }]);
  const settlementQueue = db.prepare(`
    SELECT id FROM sales_records sr WHERE ${pendingCardSettlementSql('sr')} ORDER BY id
  `).all() as Array<{ id: string }>;
  assert.deepEqual(settlementQueue, [{ id: 'income-card' }]);
  db.close();
});

test('card recognition repair SQL never downgrades confirmed expense rows', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      payment_type TEXT,
      card_deposit_date TEXT,
      direction TEXT,
      updated_at TEXT
    );
    INSERT INTO sales_records VALUES
      ('expense-card', 'confirmed', '카드', '', 'expense', ''),
      ('income-card', 'confirmed', '카드', '', 'income', '');
  `);
  db.exec(readFileSync(new URL('../d1/repair-card-sales-recognition.sql', import.meta.url), 'utf8'));

  const rows = db.prepare('SELECT id, status FROM sales_records ORDER BY id').all();
  assert.deepEqual(rows, [
    { id: 'expense-card', status: 'confirmed' },
    { id: 'income-card', status: 'card_pending' },
  ]);
  db.close();
});

test('analytics groups settled cards as confirmed and unsettled cards as pending', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sales_records (
      id TEXT PRIMARY KEY, user_id TEXT, amount INTEGER, status TEXT, payment_type TEXT,
      contract_date TEXT, deposit_date TEXT, card_deposit_date TEXT, direction TEXT
    );
    INSERT INTO sales_records VALUES
      ('settled', 'u1', 100, 'card_pending', '카드', '2026-07-01', '', '2026-07-10', 'income'),
      ('unsettled', 'u1', 50, 'card_pending', '카드', '2026-07-01', '', '', 'income'),
      ('transfer', 'u1', 70, 'confirmed', '이체', '2026-07-01', '', '', 'income');
  `);
  const rows = db.prepare(`
    SELECT user_id, ${analyticsSalesBucketSql('sales_records')} AS effective_status,
      COUNT(*) AS count, SUM(amount) AS total
    FROM sales_records
    GROUP BY 1, 2
    ORDER BY effective_status
  `).all() as Array<{ user_id: string; effective_status: string; count: number; total: number }>;
  assert.deepEqual(rows, [
    { user_id: 'u1', effective_status: 'confirmed', count: 2, total: 170 },
    { user_id: 'u1', effective_status: 'pending', count: 1, total: 50 },
  ]);
  db.close();
});
