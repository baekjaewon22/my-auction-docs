const fs = require('fs');
const path = require('path');

const input = process.argv[2] || 'tmp-expense-classification/session2_payload_rows.json';
const outDir = process.argv[3] || 'tmp-expense-classification/normalize-sql';
const rows = JSON.parse(fs.readFileSync(input, 'utf8'));

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function pick(raw, label) {
  const wanted = clean(label);
  const found = Object.entries(raw || {}).find(([key]) => clean(key) === wanted);
  return clean(found?.[1]);
}

function sql(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlText(value) {
  if (value === null || value === undefined) return "''";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sourceLabel(payment, sourceType) {
  const text = clean(payment);
  if (/체크/.test(text) || sourceType === 'checkCard') return '체크';
  if (/계좌|이체|자동/.test(text) || sourceType === 'bank') return '계좌이체';
  return text || '계좌이체';
}

function normalizeRow(row) {
  const raw = row.raw || {};
  const rawItem = pick(raw, '항목') || clean(row.item).split('/').pop()?.trim() || clean(row.item);
  const rawMemo = pick(raw, '비고');
  const evidence = [pick(raw, '증빙'), pick(raw, '우편건')]
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .join(' / ');
  const payment = pick(raw, '결제') || clean(row.raw?.payment) || clean(row.payment);
  const content = rawMemo || rawItem || clean(row.merchant_name) || clean(row.description);
  return {
    source_key: row.source_key,
    merchant_name: content,
    description: content,
    card_last4: clean(row.card_last4),
    item: rawItem,
    memo: evidence,
    ledger_policy: sourceLabel(payment, row.source_type),
  };
}

fs.mkdirSync(outDir, { recursive: true });
const targets = rows.filter((row) => clean(row.source_key).startsWith('expense-v2:')).map(normalizeRow);
const chunkSize = 120;
let chunk = 0;

for (let i = 0; i < targets.length; i += chunkSize) {
  chunk += 1;
  const lines = ['BEGIN TRANSACTION;'];
  for (const row of targets.slice(i, i + chunkSize)) {
    lines.push(`
UPDATE accounting_source_rows
SET merchant_name = ${sqlText(row.merchant_name)},
    description = ${sqlText(row.description)},
    card_last4 = ${sqlText(row.card_last4)}
WHERE source_key = ${sql(row.source_key)};

UPDATE accounting_reconciliation_items
SET item = ${sqlText(row.item)},
    memo = ${sqlText(row.memo)},
    ledger_policy = ${sqlText(row.ledger_policy)},
    updated_at = datetime('now', '+9 hours')
WHERE source_row_id IN (
  SELECT id FROM accounting_source_rows WHERE source_key = ${sql(row.source_key)}
);

UPDATE accounting_ledger_entries
SET item = ${sqlText(row.item)},
    memo = ${sqlText(row.memo)},
    updated_at = datetime('now', '+9 hours')
WHERE source_row_id IN (
  SELECT id FROM accounting_source_rows WHERE source_key = ${sql(row.source_key)}
) AND ledger_type = 'expense';
`);
  }
  lines.push('COMMIT;');
  const fileName = `${String(chunk).padStart(3, '0')}-normalize.sql`;
  fs.writeFileSync(path.join(outDir, fileName), lines.join('\n'), 'utf8');
}

fs.writeFileSync(
  path.join(outDir, 'summary.json'),
  JSON.stringify({ input, totalRows: targets.length, chunkSize, chunkCount: chunk }, null, 2),
  'utf8',
);

console.log(JSON.stringify({ totalRows: targets.length, chunkCount: chunk, outDir }, null, 2));
