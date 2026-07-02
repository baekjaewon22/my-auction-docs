const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const outDir = process.argv[2] || 'tmp-expense-classification/session2-draft-ledger-sql';
const batchId = process.argv[3] || '77982124-0a94-4d1f-aeb4-9c4d6e5d6e06';

function sql(value) {
  if (value === null || value === undefined) return "''";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function idFor(sourceId) {
  return `led_${crypto.createHash('sha1').update(String(sourceId)).digest('hex').slice(0, 32)}`;
}

const querySql = `
SELECT
  sr.id AS source_row_id,
  ri.id AS reconciliation_id,
  sr.transaction_at,
  sr.amount,
  sr.direction,
  sr.description,
  sr.merchant_name,
  ri.branch,
  ri.owner_name,
  ri.category,
  ri.item,
  ri.memo,
  ri.ledger_policy,
  ri.duplicate_status
FROM accounting_reconciliation_items ri
JOIN accounting_source_rows sr ON sr.id = ri.source_row_id
LEFT JOIN accounting_ledger_entries le ON le.source_row_id = sr.id
WHERE sr.batch_id = ${sql(batchId)}
  AND COALESCE(ri.duplicate_status, 'unique') IN ('unique', 'forced_unique')
  AND le.id IS NULL;
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '000-select-missing.sql'), querySql, 'utf8');

function normalizeLedgerType(policy, category, direction) {
  if (String(policy || '').includes('환불') && direction === 'income') return 'expense_refund';
  if (String(policy || '').includes('환불') && direction === 'expense') return 'expense';
  if (String(policy || '').includes('대체') || String(policy || '').includes('증빙')) return 'evidence';
  if (category === '매출' || direction === 'income') return 'sales';
  return 'expense';
}

const dbFile = fs.readdirSync('.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
  .filter((name) => name.endsWith('.sqlite'))
  .map((name) => path.join('.wrangler/state/v3/d1/miniflare-D1DatabaseObject', name))
  .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];

if (!dbFile) throw new Error('Local D1 sqlite file was not found.');

const db = new Database(dbFile);
const rows = db.prepare(querySql).all();
const insert = db.prepare(`
  INSERT INTO accounting_ledger_entries
    (id, reconciliation_id, source_row_id, ledger_type, entry_date, branch, owner_name, category, item, amount, direction, memo, status, created_by, updated_at)
  VALUES
    (@id, @reconciliation_id, @source_row_id, @ledger_type, @entry_date, @branch, @owner_name, @category, @item, @amount, @direction, @memo, 'confirmed', 'local-backfill', datetime('now', '+9 hours'))
`);
const updateRecon = db.prepare(`
  UPDATE accounting_reconciliation_items
  SET status = 'reviewed',
      reviewed_by = 'local-backfill',
      reviewed_at = datetime('now', '+9 hours'),
      updated_at = datetime('now', '+9 hours')
  WHERE id = ?
`);

let inserted = 0;
let skippedEvidence = 0;
let skippedDuplicate = 0;
const tx = db.transaction(() => {
  for (const row of rows) {
    if (row.duplicate_status && !['unique', 'forced_unique'].includes(row.duplicate_status)) {
      skippedDuplicate += 1;
      continue;
    }
    const ledgerType = normalizeLedgerType(row.ledger_policy, row.category, row.direction);
    if (ledgerType === 'evidence') {
      skippedEvidence += 1;
      updateRecon.run(row.reconciliation_id);
      continue;
    }
    insert.run({
      id: idFor(row.source_row_id),
      reconciliation_id: row.reconciliation_id,
      source_row_id: row.source_row_id,
      ledger_type: ledgerType,
      entry_date: String(row.transaction_at || '').slice(0, 10),
      branch: row.branch || '',
      owner_name: row.owner_name || '',
      category: row.category || '',
      item: row.item || '',
      amount: Math.abs(Number(row.amount || 0)),
      direction: row.direction || (Number(row.amount || 0) > 0 ? 'income' : 'expense'),
      memo: row.memo || row.description || row.merchant_name || '',
    });
    updateRecon.run(row.reconciliation_id);
    inserted += 1;
  }
});

tx();
db.close();

console.log(JSON.stringify({
  outDir,
  batchId,
  dbFile,
  selected: rows.length,
  inserted,
  skippedEvidence,
  skippedDuplicate,
  selectFile: path.join(outDir, '000-select-missing.sql'),
}, null, 2));
