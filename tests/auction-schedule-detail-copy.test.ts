import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  buildAuctionDetailCopy,
  formatAuctionDetailValue,
  formatAuctionPrice,
} from '../src/react-app/lib/auctionScheduleDetailCopy.ts';

test('금액은 천 단위 콤마로 표시하고 숫자가 아닌 값은 그대로 둔다', () => {
  assert.equal(formatAuctionPrice('123456789'), '123,456,789');
  assert.equal(formatAuctionPrice('123,456,789'), '123,456,789');
  assert.equal(formatAuctionPrice('1000원'), '1,000');
  assert.equal(formatAuctionPrice(''), '');
  assert.equal(formatAuctionPrice('1억'), '1억');
  assert.equal(formatAuctionPrice('추후 작성'), '추후 작성');
  assert.equal(formatAuctionDetailValue('bidPrice', '90000000'), '90,000,000');
  assert.equal(formatAuctionDetailValue('suggestedPrice', '85000000'), '85,000,000');
  assert.equal(formatAuctionDetailValue('caseNo', '2026타경12345'), '2026타경12345');
});

test('상세 여러 줄 복사는 라벨<TAB>값 한 줄씩 줄맞춤한다', () => {
  const copy = buildAuctionDetailCopy([
    ['구분', '아파트 입찰'],
    ['사건번호', '2026타경12345'],
    ['메모', '첫 줄\n둘째 줄'],
    ['물건종류', '아파트'],
  ]);
  assert.equal(copy.text, '구분\t아파트 입찰\n사건번호\t2026타경12345\n메모\t첫 줄 둘째 줄\n물건종류\t아파트');
  assert.match(copy.html, /^<table><tr><td>구분<\/td><td>아파트 입찰<\/td><\/tr>/);
  assert.equal(buildAuctionDetailCopy([['a<b', '"x"&']]).html, '<table><tr><td>a&lt;b</td><td>&quot;x&quot;&amp;</td></tr></table>');
});

test('경매 스케줄 상세 팝업은 복사 핸들러와 금액 포맷을 사용한다', () => {
  const page = readFileSync(new URL('../src/react-app/pages/AuctionSchedule.tsx', import.meta.url), 'utf8');
  assert.match(page, /className="auction-schedule-detail-grid" onCopy=\{handleDetailCopy\}/);
  assert.match(page, /formatAuctionDetailValue\(key, value\)/);
  const form = readFileSync(new URL('../src/react-app/journal/JournalForm.tsx', import.meta.url), 'utf8');
  assert.match(form, /useState\(formatAuctionPrice\(stringValue\(initialData, 'bidPrice'\)\)\)/);
});
