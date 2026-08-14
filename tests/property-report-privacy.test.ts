import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/react-app/pages/PropertyReport.tsx', 'utf8');

test('물건분석보고서는 수집·이용과 법무법인 명승 제3자 제공 동의를 분리한다', () => {
  assert.match(source, /개인정보 수집·이용: ☐ 동의함[^\n]+☐ 동의하지 않음/);
  assert.match(source, /법무법인 명승 제3자 제공: ☐ 동의함[^\n]+☐ 동의하지 않음/);
  assert.match(source, /의뢰하신 경매 물건의 권리관계와 법률상 쟁점을 검토하고 자문의견을 제공하기 위함/);
  assert.match(source, /자문 목적 달성 후 즉시 파기/);
  assert.match(source, /제3자 제공 동의를 거부할 수 있으며/);
});

test('권리분석 자문에는 최소한의 개인정보만 제공하고 주민등록번호를 요구하지 않는다', () => {
  assert.match(source, />생년월일<\/th>/);
  assert.match(source, /성명, 생년월일, 전화번호, 사건번호 및 권리분석 대상 물건 정보/);
  assert.doesNotMatch(source, />주민번호<\/th>/);
  assert.doesNotMatch(source, /성명, 주민등록번호, 전화번호/);
});

test('물건분석보고서는 고정 A4 두 페이지만 렌더링한다', () => {
  assert.equal((source.match(/className="pr-page"/g) || []).length, 2);
  assert.equal((source.match(/height: '297mm'/g) || []).length, 2);
  assert.equal((source.match(/overflow: 'hidden'/g) || []).length >= 2, true);
});
