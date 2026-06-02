const XLSX = require('xlsx');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/analyze-expense-workbook.cjs <xlsx>');
  process.exit(1);
}

function trim(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return trim(v);
}

function nonEmptyCount(row) {
  return row.filter((v) => trim(v) !== '').length;
}

const wb = XLSX.readFile(file, { cellDates: true, dense: false });
const summary = [];

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
  const rowCount = rows.length;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let headerIndex = -1;
  let bestScore = -1;
  rows.slice(0, 30).forEach((row, idx) => {
    const texts = row.map(cellText);
    const score = nonEmptyCount(texts)
      + texts.filter((v) => /일자|날짜|구분|항목|내용|금액|지출|입금|출금|카드|거래|분류|계정|지사|부서|성명|담당|비고|적요/.test(v)).length * 3;
    if (score > bestScore) {
      bestScore = score;
      headerIndex = idx;
    }
  });
  const headers = (rows[headerIndex] || []).map(cellText);
  const dataRows = rows.slice(headerIndex + 1).filter((row) => nonEmptyCount(row.map(cellText)) > 0);
  const samples = dataRows.slice(0, 8).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      const key = h || `COL${i + 1}`;
      const value = cellText(row[i]);
      if (value) obj[key] = value;
    });
    return obj;
  });
  summary.push({
    sheetName,
    rowCount,
    width,
    detectedHeaderRow: headerIndex + 1,
    headers,
    dataRowCount: dataRows.length,
    samples,
  });
}

console.log(JSON.stringify({ file, sheetCount: wb.SheetNames.length, sheets: summary }, null, 2));
