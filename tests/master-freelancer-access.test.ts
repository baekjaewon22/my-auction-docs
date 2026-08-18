import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canUseEmployeeLaborFeatures,
  isFreelancerAccessRestricted,
} from '../src/shared/employment-access.ts';

test('마스터는 프리랜서 세션에서도 직원·관리 기능 제한 대상이 아니다', () => {
  assert.equal(isFreelancerAccessRestricted({ role: 'master', login_type: 'freelancer' }), false);
  assert.equal(canUseEmployeeLaborFeatures({ role: 'master', login_type: 'freelancer' }), true);
  assert.equal(isFreelancerAccessRestricted({ role: 'member', login_type: 'freelancer' }), true);
  assert.equal(isFreelancerAccessRestricted({ role: 'manager', login_type: 'freelancer' }), true);
});

test('마스터 프리랜서 세션은 전체 사이드바와 일반 마스터 대시보드를 사용한다', () => {
  const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../src/react-app/pages/Dashboard.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');

  assert.match(layout, /login_type === 'freelancer' && role !== 'master'/);
  assert.match(dashboard, /login_type === 'freelancer' && user\?\.role !== 'master'/);
  assert.match(app, /login_type === 'freelancer' && user\.role !== 'master'/);
});

test('마스터 프리랜서 세션은 사용자·팀·일지·휴가·분석 API 권한을 유지한다', () => {
  for (const relativePath of [
    '../src/worker/routes/users.ts',
    '../src/worker/routes/teams.ts',
    '../src/worker/routes/journal.ts',
    '../src/worker/routes/leave.ts',
    '../src/worker/routes/analytics-comprehensive.ts',
    '../src/worker/routes/cooperation.ts',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /login_type === 'freelancer' && user\.role !== 'master'/, relativePath);
  }
});

test('일반 프리랜서도 업무성과 계약 등수를 조회하고 화면에서 볼 수 있다', () => {
  const salesPage = readFileSync(new URL('../src/react-app/pages/Sales.tsx', import.meta.url), 'utf8');
  const salesRoute = readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
  const rankingRoute = salesRoute.slice(
    salesRoute.indexOf("sales.get('/ranking'"),
    salesRoute.indexOf("sales.get('/customer-contracts'"),
  );

  assert.match(salesPage, /api\.sales\.ranking\(startMonth, endMonth\)/);
  assert.match(salesPage, /className="sales-ranking"/);
  assert.doesNotMatch(rankingRoute, /requireRole|login_type|접근 권한/);
  assert.match(rankingRoute, /return c\.json\(\{ ranking: result\.results \|\| \[\] \}\)/);
});
