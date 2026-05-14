const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'bank-upload-test.xlsx');
const TMP_DIR = path.join(os.tmpdir(), 'my-auction-bank-import');
const WRANGLER_LOG_DIR = path.join(os.tmpdir(), 'wrangler-logs');
const CHUNK_SIZE = 20;

const CARD_KEYWORDS = [
  '카드', '헥토', '파이낸셜', '나이스', 'nice', '토스', 'toss', '이니시스', 'kg', 'kcp',
  '페이', 'pay', '스마트로', 'ksnet', '다날', '페이먼츠', 'pg',
];

function sql(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function amount(value) {
  return Math.abs(Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0);
}

function date(value) {
  if (typeof value === 'number') {
    return new Date((value - 25569) * 86400000).toISOString().slice(0, 10);
  }
  const raw = String(value || '').trim();
  const match = raw.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return raw.slice(0, 10);
}

function classify(direction, counterparty, description) {
  if (direction === 'expense') return 'expense';
  const text = `${counterparty} ${description}`.toLowerCase();
  if (CARD_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) return 'card_settlement';
  return 'sales_match';
}

function uuid() {
  return crypto.randomUUID();
}

function toRows() {
  const wb = XLSX.readFile(FILE, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  return rawRows.map((r) => {
    const transactionDate = date(r['거래일시'] || r['거래일'] || r['거래일자'] || r['날짜'] || r['입금일'] || '');
    const incomeAmount = amount(r['입금액'] || r['입금']);
    const expenseAmount = amount(r['출금액'] || r['출금']);
    const direction = expenseAmount > 0 && incomeAmount <= 0 ? 'expense' : 'income';
    const rowAmount = direction === 'expense' ? expenseAmount : incomeAmount;
    const counterparty = String(r['내용'] || r['적요'] || r['거래점명'] || r['거래점'] || '').trim();
    const description = Array.from(new Set([
      r['적요'], r['분류'], r['설명'], r['비고'], r['비고2'], r['거래점명'], r['거래점'], r['카드번호'],
    ].map((v) => String(v || '').trim()).filter(Boolean))).join(' / ');
    const category = classify(direction, counterparty, description);
    const raw = JSON.stringify({
      거래일시: r['거래일시'],
      적요: r['적요'],
      입금액: r['입금액'],
      출금액: r['출금액'],
      내용: r['내용'],
      잔액: r[' 잔액 '] || r['잔액'],
      거래점명: r['거래점명'] || r['거래점'],
      카드번호: r['카드번호'],
      분류: r['분류'],
      설명: r['설명'],
      비고: r['비고'],
      비고2: r['비고2'],
    });
    return { depositor: counterparty, counterparty, amount: rowAmount, transactionDate, description, direction, category, raw };
  }).filter((r) => r.depositor && r.amount > 0 && r.transactionDate);
}

function buildInsert(row) {
  const skipSales = row.direction === 'income' && row.category === 'sales_match'
    ? `AND NOT EXISTS (
        SELECT 1 FROM sales_records
        WHERE (depositor_name = ${sql(row.depositor)} OR client_name = ${sql(row.depositor)})
          AND amount = ${row.amount}
          AND deposit_date = ${sql(row.transactionDate)}
        LIMIT 1
      )`
    : '';

  return `
INSERT INTO bank_staging (id, depositor, amount, transaction_date, description, created_by, direction, counterparty, category, raw_json)
SELECT ${sql(uuid())}, ${sql(row.depositor)}, ${row.amount}, ${sql(row.transactionDate)}, ${sql(row.description)}, 'direct-import', ${sql(row.direction)}, ${sql(row.counterparty)}, ${sql(row.category)}, ${sql(row.raw)}
WHERE NOT EXISTS (
  SELECT 1 FROM bank_staging
  WHERE depositor = ${sql(row.depositor)}
    AND amount = ${row.amount}
    AND transaction_date = ${sql(row.transactionDate)}
    AND COALESCE(direction, 'income') = ${sql(row.direction)}
  LIMIT 1
)
${skipSales};
`;
}

function runSqlCommand(command) {
  fs.mkdirSync(WRANGLER_LOG_DIR, { recursive: true });
  const env = {
    ...process.env,
    WRANGLER_LOG_PATH: WRANGLER_LOG_DIR,
  };
  const options = { cwd: ROOT, stdio: 'pipe', timeout: 120000, env };
  const run = () => {
    execFileSync(process.execPath, [
      path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'd1',
      'execute',
      'auction-docs-db',
      '--remote',
      '--command',
      command,
    ], options);
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      run();
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      console.log(`Chunk failed, retrying (${attempt}/3)...`);
    }
  }
}

function main() {
  if (!fs.existsSync(FILE)) throw new Error(`Missing file: ${FILE}`);
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const rows = toRows();
  console.log(`Parsed ${rows.length} importable rows from ${path.basename(FILE)}`);

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const command = chunk.map(buildInsert).join('\n');
    runSqlCommand(command);
    console.log(`Imported chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(rows.length / CHUNK_SIZE)} (${Math.min(i + CHUNK_SIZE, rows.length)}/${rows.length})`);
  }
}

main();
