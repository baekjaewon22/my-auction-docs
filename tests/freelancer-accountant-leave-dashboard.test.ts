import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../src/react-app/pages/Dashboard.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');
const freelancerDashboard = dashboard.slice(
  dashboard.indexOf('function FreelancerDashboard()'),
  dashboard.indexOf('export default function Dashboard()'),
);

test('employee and freelancer dashboards render the same accountant leave notice component', () => {
  assert.match(dashboard, /function AccountantLeaveNotice\(/);
  assert.equal(
    (dashboard.match(/<AccountantLeaveNotice\s+[\s\S]*?leaves=\{accountantLeaves\}/g) || []).length,
    2,
  );
  assert.match(freelancerDashboard, /<AccountantLeaveNotice leaves=\{accountantLeaves\} \/>/);
});

test('freelancer dashboard waits for accountant leave data and fails closed to an empty notice', () => {
  assert.match(
    freelancerDashboard,
    /const \[accountantLeaves, setAccountantLeaves\] = useState<AccountantLeave\[]>\(\[\]\)/,
  );
  assert.match(
    freelancerDashboard,
    /api\.leave\.accountantLeaves\(\)\.catch\(\(\) => null\)/,
  );
  assert.match(
    freelancerDashboard,
    /accountantLeavesRes\]\) => \{[\s\S]*?if \(accountantLeavesRes\) setAccountantLeaves\(accountantLeavesRes\.leaves \|\| \[\]\)/,
  );
  assert.match(freelancerDashboard, /\.finally\(\(\) => setLoading\(false\)\)/);
});

test('shared accountant leave notice keeps the existing employee labels and mobile layout', () => {
  const sharedNotice = dashboard.slice(
    dashboard.indexOf('function AccountantLeaveNotice('),
    dashboard.indexOf('function FreelancerDashboard()'),
  );

  assert.match(sharedNotice, /총무 휴무 안내/);
  assert.match(sharedNotice, /결재 관련 문의는 다른 총무 담당자에게 연락해주세요/);
  assert.match(sharedNotice, /leave\.leave_type === '특별휴가'/);
  assert.match(sharedNotice, /dashboard-accountant-leave-badge today/);
  assert.match(sharedNotice, /dashboard-accountant-leave-badge tomorrow/);
  assert.match(css, /@media \(max-width: 480px\) \{[\s\S]*?\.dashboard-accountant-leave-panel\s*\{[\s\S]*?padding:\s*12px/);
  assert.match(css, /\.dashboard-accountant-leave-title\s*\{[\s\S]*?line-height:\s*1\.45/);
});
