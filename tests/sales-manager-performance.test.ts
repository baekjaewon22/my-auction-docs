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
  assert.match(routeSource, /COALESCE\(u\.login_type, 'employee'\) = 'freelancer'/);
  assert.match(routeSource, /OR u\.role = 'freelancer'/);
  assert.match(routeSource, /OR COALESCE\(ua\.pay_type, ''\) = 'commission'/);
  assert.match(routeSource, /COALESCE\(ua\.pay_type, ''\) != 'commission'/);
  assert.doesNotMatch(routeSource, /임태율/);
});

test('프리랜서 성과는 월 합산 대신 실제 확정 매출을 건별로 반환한다', () => {
  const source = readFileSync(
    new URL('../src/worker/routes/sales.ts', import.meta.url),
    'utf8',
  );
  const conditionStart = source.indexOf("if (employmentType === 'freelancer')");
  const routeStart = source.indexOf("if (employmentType === 'freelancer')", conditionStart + 1);
  const routeEnd = source.indexOf('\n  const salesResult = await db.prepare(`', routeStart);
  const freelancerSource = source.slice(routeStart, routeEnd);

  assert.match(freelancerSource, /recognized_date/);
  assert.match(freelancerSource, /client_name/);
  assert.match(freelancerSource, /sales: individualSales/);
  assert.doesNotMatch(freelancerSource, /GROUP BY sr\.user_id/);
});

test('매출성과 화면에는 정규직과 프리랜서 전용 버튼이 있다', () => {
  const source = readFileSync(
    new URL('../src/react-app/pages/Sales.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /setEmploymentType\('employee'\)/);
  assert.match(source, /setEmploymentType\('freelancer'\)/);
  assert.match(source, /프리랜서별 실제 확정 매출을 월 합산 없이 건별로 확인합니다/);
  assert.match(source, /row\.sales!\.map/);
});
