// 경매 스케줄 상세 팝업의 금액 표시·복사 도우미.

const PRICE_KEYS = new Set(['suggestedPrice', 'bidPrice', 'winPrice']);

/**
 * 숫자(콤마·공백·'원' 허용)로만 된 금액에 천 단위 콤마를 붙인다.
 * "1억"처럼 다른 글자가 섞인 값은 숫자가 바뀌지 않도록 원문을 그대로 돌려준다.
 */
export function formatAuctionPrice(value: unknown): string {
  const raw = String(value ?? '');
  if (!/^[\d,\s]+원?$/.test(raw.trim())) return raw;
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? Number(digits).toLocaleString('ko-KR') : raw;
}

/** 상세 항목 값 표시: 금액 항목만 콤마 형식으로 바꾼다. */
export function formatAuctionDetailValue(key: string, value: unknown): string {
  return PRICE_KEYS.has(key) ? formatAuctionPrice(value) : String(value ?? '');
}

function oneLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\t/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 상세 항목(라벨·값) 여러 줄을 복사할 때 한 줄에 "라벨<TAB>값" 형태로 만든다.
 * 엑셀·스프레드시트에는 두 칸으로, 메신저·메모장에는 줄맞춤된 목록으로 붙는다.
 */
export function buildAuctionDetailCopy(pairs: Array<[string, string]>): { text: string; html: string } {
  const rows = pairs
    .map(([label, value]) => [oneLine(label), oneLine(value)] as const)
    .filter(([label, value]) => label || value);
  return {
    text: rows.map(([label, value]) => `${label}\t${value}`).join('\n'),
    html: `<table>${rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join('')}</table>`,
  };
}
