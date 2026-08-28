import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
const managementSupport = readFileSync(new URL('../src/react-app/pages/ManagementSupport.tsx', import.meta.url), 'utf8');
const adminNotes = readFileSync(new URL('../src/react-app/pages/AdminNotes.tsx', import.meta.url), 'utf8');
const payroll = readFileSync(new URL('../src/react-app/pages/Payroll.tsx', import.meta.url), 'utf8');

test('support does not see the document approval management category', () => {
  const canApproveDeclaration = layout.match(/const canApprove = ([^;]+);/)?.[1] || '';

  assert.match(canApproveDeclaration, /'master'/);
  assert.doesNotMatch(canApproveDeclaration, /'support'/);
});

test('general admin does not see the phone directory card, while the approved extra user does', () => {
  const adminCardFilter = managementSupport.slice(
    managementSupport.indexOf("if (role === 'admin')"),
    managementSupport.indexOf("if (item.to === '/finance-analytics')"),
  );

  assert.doesNotMatch(
    adminCardFilter,
    /\['\/management-support\/holidays', '\/phone-directory'/,
  );
  assert.match(
    adminCardFilter,
    /isManagementSupportExtraUser && item\.to === '\/phone-directory'/,
  );
});

test('accounting assistants do not see the business-income tax card', () => {
  const businessIncomeCardFilter = managementSupport.match(
    /if \(item\.to === '\/payroll-business-income'\) return \[([^\]]+)\]\.includes\(role\)/,
  )?.[1] || '';

  assert.match(businessIncomeCardFilter, /'accountant'/);
  assert.doesNotMatch(businessIncomeCardFilter, /'accountant_asst'/);
});

test('freelancers do not see or open the cooperation category', () => {
  assert.match(adminNotes, /const canUseCooperation = !isFreelancer/);
  assert.match(
    adminNotes,
    /CATEGORIES\.filter\(\(\{ key \}\) => key !== 'cooperation' \|\| canUseCooperation\)/,
  );
  assert.match(
    adminNotes,
    /if \(tab === 'cooperation' && !canUseCooperation\) \{\s*setSearchParams\(\{\}, \{ replace: true \}\)/,
  );
});

test('payroll hides the business-income tab and content from unauthorized roles', () => {
  const businessIncomeRoles = payroll.match(
    /const canAccessBusinessIncome = [^\n]+\[([^\]]+)\]\.includes\(currentUser\.role\)/,
  )?.[1] || '';

  assert.match(businessIncomeRoles, /'master'/);
  assert.match(businessIncomeRoles, /'ceo'/);
  assert.match(businessIncomeRoles, /'accountant'/);
  assert.doesNotMatch(businessIncomeRoles, /'accountant_asst'/);
  assert.match(payroll, /\{canAccessBusinessIncome && \(\s*<button[^>]+business_income/s);
  assert.match(
    payroll,
    /tab === 'business_income' && canAccessBusinessIncome && <BusinessIncomeTab/,
  );
});

test('user-management navigation matches its explicit server role list', () => {
  const menuRoles = layout.match(/const canManageUsers = [^\n]+\[([^\]]+)\]\.includes\(role\)/)?.[1] || '';
  const routeGuard = app.slice(
    app.indexOf('function AccountingOrApproverRoute'),
    app.indexOf('function StatsRoute'),
  );

  assert.match(menuRoles, /'manager'/);
  assert.doesNotMatch(menuRoles, /'cc_ref'/);
  assert.match(routeGuard, /'manager'/);
  assert.doesNotMatch(routeGuard, /'cc_ref'/);
  assert.match(routeGuard, /login_type === 'freelancer'/);
});

test('employee-only management links are hidden in freelancer mode', () => {
  assert.match(layout, /const canViewOrg = !isFreelancer/);
  assert.match(layout, /const canManageUsers = !isFreelancer/);
  assert.match(layout, /!isFreelancer && \['master', 'accountant', 'admin'\]\.includes\(role\)/);
  assert.match(layout, /!isFreelancer && \['master', 'ceo', 'cc_ref', 'admin'\]\.includes\(role\)/);
  assert.match(layout, /const canPayroll = canAccounting \|\| \(!isFreelancer && PAYROLL_EXTRA_IDS/);
});

test('sensitive management routes retain direct-url guards in addition to hidden menus', () => {
  for (const routeName of [
    'TopRoute',
    'MissingDocumentsRoute',
    'StatsRoute',
    'AdminRoute',
    'OrgRoute',
    'AccountingRoute',
    'PayrollRoute',
    'ManagementSupportRoute',
    'ManagementSupportHomeRoute',
    'FinanceAnalyticsRoute',
    'LinkReviewRoute',
  ]) {
    const start = app.indexOf(`function ${routeName}`);
    const next = app.indexOf('\nfunction ', start + 1);
    const guard = app.slice(start, next === -1 ? undefined : next);
    assert.ok(start >= 0, `${routeName} should exist`);
    assert.match(guard, /login_type === 'freelancer'/, `${routeName} should reject freelancer mode`);
  }
});
