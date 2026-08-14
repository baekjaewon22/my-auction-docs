import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('담당자 매출성과는 프리랜서를 이름 예외 없이 계정 유형으로 분류한다', () => {
  const source = readFileSync(
    new URL('../src/worker/routes/sales.ts', import.meta.url),
    'utf8',
  );
  const routeStart = source.indexOf("sales.get('/manager-performance'");
  const routeEnd = source.indexOf("sales.get('/deposits'", routeStart);
  const routeSource = source.slice(routeStart, routeEnd);

  assert.match(routeSource, /employment_type/);
  assert.match(routeSource, /resolveEmploymentTypeFromHistory/);
  assert.match(routeSource, /loginType === 'freelancer'/);
  assert.match(routeSource, /member\.role === 'freelancer'/);
  assert.match(routeSource, /paySnapshot\.pay_type === 'commission'/);
  assert.match(routeSource, /applicableMonthsByUser/);
  assert.doesNotMatch(routeSource, /임태율/);
});

test('프리랜서 성과도 사람별 월 매출로 집계하되 기준매출은 적용하지 않는다', () => {
  const source = readFileSync(
    new URL('../src/worker/routes/sales.ts', import.meta.url),
    'utf8',
  );
  const routeStart = source.indexOf("sales.get('/manager-performance'");
  const routeEnd = source.indexOf("sales.get('/deposits'", routeStart);
  const routeSource = source.slice(routeStart, routeEnd);

  assert.match(routeSource, /GROUP BY sr\.user_id, substr/);
  assert.match(routeSource, /employmentType === 'freelancer'\s*\?\s*0/);
  assert.match(routeSource, /months: monthly/);
});

test('매출성과 화면에는 정규직과 프리랜서 전용 버튼이 있다', () => {
  const source = readFileSync(
    new URL('../src/react-app/pages/Sales.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /setEmploymentType\('employee'\)/);
  assert.match(source, /setEmploymentType\('freelancer'\)/);
  assert.match(source, /프리랜서별 확정 매출을 사람별·월별 실선 그래프로 확인합니다/);
  assert.match(source, /name=\{employmentType === 'freelancer' \? '월 매출' : '달성금액'\}/);
});

test('업무성과 조회 실패를 빈 목록으로 숨기지 않고 재시도 안내를 표시한다', () => {
  const page = readFileSync(new URL('../src/react-app/pages/Sales.tsx', import.meta.url), 'utf8');
  assert.match(page, /const \[loadError, setLoadError\]/);
  assert.match(page, /setLoadError\(err\?\.message/);
  assert.match(page, /role="alert"/);
  assert.match(page, />다시 불러오기<\/button>/);
});
