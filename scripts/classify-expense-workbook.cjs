const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const file = process.argv[2];
const outDir = process.argv[3] || path.join(process.cwd(), 'tmp-expense-classification');
if (!file) {
  console.error('Usage: node scripts/classify-expense-workbook.cjs <xlsx> [outDir]');
  process.exit(1);
}

const MAIN_SHEET = '정산내역2019년v2';
const MEMO_SHEET = '분류 메모';
const CHECK_CARD_SHEET = '체크카드현황';
const CREDIT_CARD_SHEET = '신용카드현황';

function clean(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function number(v) {
  if (typeof v === 'number') return Math.round(v);
  const n = Number(clean(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function excelDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date((v - 25569) * 86400000).toISOString().slice(0, 10);
  const raw = clean(v);
  const m = raw.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

function sheetRows(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
}

function pick(row, name) {
  if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  const key = Object.keys(row).find((k) => clean(k) === name);
  return key ? row[key] : '';
}

function cardLast4(value) {
  const digits = clean(value).replace(/\D/g, '');
  return digits.slice(-4);
}

function inferMajorCategory(category, item) {
  const text = `${category} ${item}`;
  if (/인건비|급여|직원급여|실적급여|퇴직금|4대보험|보험/.test(text)) return '인건비';
  if (/세금|부가세|소득세|주민세|원천세|법인세/.test(text)) return '세금';
  if (/사무실|임대료|관리비|월세|전기|수도|가스|통신|인터넷|복합기|정수기/.test(text)) return '사무실관련';
  if (/우편|등기|DM|발송|택배/.test(text)) return '우편료';
  if (/광고|홍보|마케팅|블로그|문자|알림톡/.test(text)) return '광고홍보';
  if (/식대|회식|간식|커피|음료/.test(text)) return '식대';
  if (/교통|주유|톨비|주차|출장|외근|택시|KTX/.test(text)) return '교통출장';
  if (/소모품|비품|문구|프린터|용지|토너/.test(text)) return '소모품비';
  if (/수수료|수수|이체|은행|PG|카드/.test(text)) return '수수료';
  if (/교육|도서|세미나/.test(text)) return '교육훈련';
  return '기타지출';
}

function normalizeBranch(branch, category, item) {
  const raw = clean(branch);
  const compact = raw.replace(/\s+/g, '');
  if (/인건비/.test(category) && /직원급여/.test(item)) return '본사관리';
  if (compact === '본사관리') return '본사관리';
  if (compact === '본사' || compact === '의정부' || compact === '의정부지사' || compact === '의정부본사') return '의정부본사';
  if (compact === '강남' || compact === '강남지사' || compact === '서초' || compact === '서초지사') return '서초지사';
  if (compact === '대전' || compact === '대전지사') return '대전지사';
  if (compact === '부산' || compact === '부산지사') return '부산지사';
  return raw || '미지정';
}

function sourceType(payment) {
  const text = clean(payment);
  if (/체크/.test(text)) return 'checkCard';
  if (/법인|신용/.test(text)) return 'creditCardLegacy';
  if (/계좌|이체/.test(text)) return 'bank';
  return 'expenseWorkbook';
}

function buildCardMaps(wb) {
  const checkRows = XLSX.utils.sheet_to_json(wb.Sheets[CHECK_CARD_SHEET] || {}, { header: 1, defval: '' });
  const creditRows = XLSX.utils.sheet_to_json(wb.Sheets[CREDIT_CARD_SHEET] || {}, { header: 1, defval: '' });
  const cards = [];
  for (const row of checkRows) {
    const joined = row.map(clean).filter(Boolean).join(' ');
    const last4 = cardLast4(joined);
    const owner = row.map(clean).find((v) => v && !/\d{4}/.test(v) && !/법인|입출금|분실/.test(v)) || '';
    const label = row.map(clean).find((v) => /법인\(\d{4}\)/.test(v)) || '';
    if (last4 && (owner || label)) cards.push({ card_last4: last4, owner_name: owner, label, source: 'check' });
  }
  for (const row of creditRows) {
    const joined = row.map(clean).filter(Boolean).join(' ');
    const last4 = cardLast4(joined);
    const owner = clean(row[4] || '');
    if (last4 && owner) cards.push({ card_last4: last4, owner_name: owner, label: `법인(${last4})`, source: 'credit' });
  }
  return cards.filter((card, idx, arr) => card.card_last4 && arr.findIndex((x) => x.card_last4 === card.card_last4) === idx);
}

function classifyRows(wb) {
  const rows = sheetRows(wb, MAIN_SHEET);
  return rows.map((r, index) => {
    const date = excelDate(pick(r, '날짜'));
    const category = clean(pick(r, '분류'));
    const item = clean(pick(r, '항목'));
    const payment = clean(pick(r, '결제'));
    const amounts = {
      other: number(pick(r, '그외지출')),
      corp: number(pick(r, '법인')),
      transfer: number(pick(r, '이체')),
      vat: number(pick(r, '부가세')),
    };
    const amount = amounts.other + amounts.corp + amounts.transfer;
    const branch = normalizeBranch(pick(r, '구분'), category, item);
    const owner = clean(pick(r, '담당'));
    const memoParts = [clean(pick(r, '비고')), clean(pick(r, '증빙')), clean(pick(r, '태그2')), clean(pick(r, '우편건')) ? `우편건:${clean(pick(r, '우편건'))}` : ''].filter(Boolean);
    const major = inferMajorCategory(category, item);
    const src = sourceType(payment);
    const last4 = cardLast4(payment);
    const missing = [];
    if (!date) missing.push('날짜');
    if (!amount) missing.push('금액');
    if (!category) missing.push('분류');
    if (!item) missing.push('항목');
    if (!branch || branch === '미지정') missing.push('지사');
    const confidence = missing.length ? '확인필요' : (major === '기타지출' ? '중간' : '높음');
    const sourceKey = crypto
      .createHash('sha1')
      .update(['expense-workbook-v2', date, index + 2, branch, category, item, amount, owner, payment, clean(r['비고'])].join('|'))
      .digest('hex');
    return {
      row_index: index + 2,
      transaction_at: date,
      amount,
      import_amount: src === 'checkCard' ? Math.abs(amount) : -Math.abs(amount),
      direction: 'expense',
      branch,
      owner_name: owner,
      category,
      major_category: major,
      item,
      merchant_name: item || category,
      description: [category, item, payment, ...memoParts].filter(Boolean).join(' / '),
      payment,
      source_type: src === 'checkCard' ? 'checkCard' : 'bank',
      raw_source_type: src,
      card_last4: last4,
      vat_amount: amounts.vat,
      evidence: clean(pick(r, '증빙')),
      memo: memoParts.join(' / '),
      ledger_policy: '지출원장',
      complete: missing.length === 0,
      confidence,
      check_needed: missing.join(','),
      source_key: `expense-v2:${sourceKey}`,
      raw: r,
    };
  }).filter((row) => row.transaction_at || row.amount || row.category || row.item);
}

function group(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key] || '';
    const cur = map.get(k) || { name: k, count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += Number(row.amount || 0);
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
}

function writeCsv(fileName, rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  fs.writeFileSync(path.join(outDir, fileName), csv, 'utf8');
}

const wb = XLSX.readFile(file, { cellDates: true });
const rows = classifyRows(wb);
const cards = buildCardMaps(wb);
fs.mkdirSync(outDir, { recursive: true });

const summary = {
  file,
  totalRows: rows.length,
  amountTotal: rows.reduce((sum, row) => sum + row.amount, 0),
  byMonth: group(rows.map((row) => ({ ...row, month: row.transaction_at.slice(0, 7) || '미지정' })), 'month'),
  byBranch: group(rows, 'branch'),
  byMajorCategory: group(rows, 'major_category'),
  byCategory: group(rows, 'category').slice(0, 80),
  bySourceType: group(rows, 'raw_source_type'),
  checkNeededCount: rows.filter((row) => row.check_needed).length,
  checkNeededSamples: rows.filter((row) => row.check_needed || row.confidence !== '높음').slice(0, 30),
  cardMapCount: cards.length,
  cards,
};

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
writeCsv('classified_rows.csv', rows.map(({ raw, ...row }) => row));
writeCsv('check_needed.csv', rows.filter((row) => row.check_needed || row.confidence !== '높음').map(({ raw, ...row }) => row));
writeCsv('card_map.csv', cards);
fs.writeFileSync(path.join(outDir, 'session2_payload_rows.json'), JSON.stringify(rows.map((row) => ({
  source_type: row.source_type,
  source_key: row.source_key,
  row_index: row.row_index,
  transaction_at: row.transaction_at,
  amount: row.import_amount,
  merchant_name: row.merchant_name,
  description: row.description,
  card_last4: row.card_last4,
  balance: null,
  raw: { ...row.raw, import_note: 'expense-workbook-v2', original_amount: row.amount, vat_amount: row.vat_amount, payment: row.payment },
  branch: row.branch,
  owner_name: row.owner_name,
  category: row.major_category || row.category,
  item: [row.category, row.item].filter(Boolean).join(' / '),
  memo: row.description,
  linked_sales_record_id: '',
  duplicate_status: 'unique',
  ledger_policy: row.ledger_policy,
  complete: row.complete,
  duplicate: false,
})), null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
