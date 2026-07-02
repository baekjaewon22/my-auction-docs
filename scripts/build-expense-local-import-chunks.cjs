const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const input = process.argv[2] || 'tmp-expense-classification/session2_payload_rows.json';
const outDir = process.argv[3] || 'tmp-expense-classification/sql-chunks';
const chunkSize = Number(process.argv[4] || 100);

function sql(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function id(prefix, key) {
  return `${prefix}_${crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 32)}`;
}

function rowSql(row, batchId) {
  const sourceId = id('src', `${row.source_type}:${row.source_key}`);
  const reconId = id('rec', `${row.source_type}:${row.source_key}`);
  const ledgerId = id('led', `${row.source_type}:${row.source_key}`);
  const sourceAmount = Math.round(Number(row.amount || 0));
  const ledgerAmount = Math.abs(sourceAmount);
  const rawJson = JSON.stringify(row.raw || {});

  return `
INSERT INTO accounting_source_rows
  (id, batch_id, source_type, row_index, source_key, transaction_at, amount, direction, merchant_name, description, card_last4, balance, raw_json)
VALUES
  (${sql(sourceId)}, ${sql(batchId)}, ${sql(row.source_type)}, ${Number(row.row_index || 0)}, ${sql(row.source_key)}, ${sql(row.transaction_at || '')}, ${sourceAmount}, 'expense', ${sql(row.merchant_name || '')}, ${sql(row.description || '')}, ${sql(row.card_last4 || '')}, NULL, ${sql(rawJson)})
ON CONFLICT(source_type, source_key) DO UPDATE SET
  batch_id = excluded.batch_id,
  row_index = excluded.row_index,
  transaction_at = excluded.transaction_at,
  amount = excluded.amount,
  direction = excluded.direction,
  merchant_name = excluded.merchant_name,
  description = excluded.description,
  card_last4 = excluded.card_last4,
  raw_json = excluded.raw_json;

INSERT INTO accounting_reconciliation_items
  (id, source_row_id, linked_sales_record_id, branch, owner_name, category, item, memo, duplicate_group_key, duplicate_status, ledger_policy, status, reviewed_by, reviewed_at)
VALUES
  (${sql(reconId)}, ${sql(sourceId)}, '', ${sql(row.branch || '')}, ${sql(row.owner_name || '')}, ${sql(row.category || '')}, ${sql(row.item || '')}, ${sql(row.memo || '')}, ${sql(row.source_key)}, 'unique', ${sql(row.ledger_policy || '지출원장')}, 'reviewed', 'local-import', datetime('now', '+9 hours'))
ON CONFLICT(source_row_id) DO UPDATE SET
  branch = excluded.branch,
  owner_name = excluded.owner_name,
  category = excluded.category,
  item = excluded.item,
  memo = excluded.memo,
  duplicate_group_key = excluded.duplicate_group_key,
  duplicate_status = excluded.duplicate_status,
  ledger_policy = excluded.ledger_policy,
  status = 'reviewed',
  reviewed_by = 'local-import',
  reviewed_at = datetime('now', '+9 hours'),
  updated_at = datetime('now', '+9 hours');

INSERT INTO accounting_ledger_entries
  (id, reconciliation_id, source_row_id, ledger_type, entry_date, branch, owner_name, category, item, amount, direction, memo, status, created_by, updated_at)
VALUES
  (${sql(ledgerId)}, ${sql(reconId)}, ${sql(sourceId)}, 'expense', ${sql(String(row.transaction_at || '').slice(0, 10))}, ${sql(row.branch || '')}, ${sql(row.owner_name || '')}, ${sql(row.category || '')}, ${sql(row.item || '')}, ${ledgerAmount}, 'expense', ${sql(row.memo || '')}, 'confirmed', 'local-import', datetime('now', '+9 hours'))
ON CONFLICT(source_row_id, ledger_type) DO UPDATE SET
  reconciliation_id = excluded.reconciliation_id,
  entry_date = excluded.entry_date,
  branch = excluded.branch,
  owner_name = excluded.owner_name,
  category = excluded.category,
  item = excluded.item,
  amount = excluded.amount,
  direction = excluded.direction,
  memo = excluded.memo,
  status = 'confirmed',
  created_by = 'local-import',
  updated_at = datetime('now', '+9 hours');
`;
}

const rows = JSON.parse(fs.readFileSync(input, 'utf8'));
const batchId = 'batch_expense_v2_202601_202605_local';
const fileHash = crypto.createHash('sha1').update(JSON.stringify(rows.map((row) => row.source_key))).digest('hex');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const batchSql = `
INSERT INTO accounting_import_batches
  (id, source_type, file_name, file_hash, row_count, status, uploaded_by, uploaded_at, confirmed_at, confirmed_by, notes)
VALUES
  (${sql(batchId)}, 'session2', '지출내역v2 2026-01~05.xlsx', ${sql(fileHash)}, ${rows.length}, 'confirmed', 'local-import', datetime('now', '+9 hours'), datetime('now', '+9 hours'), 'local-import', '로컬 테스트 등록')
ON CONFLICT(source_type, file_hash) DO UPDATE SET
  row_count = excluded.row_count,
  status = 'confirmed',
  uploaded_at = datetime('now', '+9 hours'),
  confirmed_at = datetime('now', '+9 hours'),
  notes = excluded.notes;
`;
fs.writeFileSync(path.join(outDir, '000-batch.sql'), batchSql, 'utf8');

for (let i = 0; i < rows.length; i += chunkSize) {
  const chunk = rows.slice(i, i + chunkSize);
  const file = path.join(outDir, `${String(Math.floor(i / chunkSize) + 1).padStart(3, '0')}-rows.sql`);
  fs.writeFileSync(file, chunk.map((row) => rowSql(row, batchId)).join('\n'), 'utf8');
}

console.log(JSON.stringify({ outDir, rows: rows.length, chunkSize, files: 1 + Math.ceil(rows.length / chunkSize) }, null, 2));
