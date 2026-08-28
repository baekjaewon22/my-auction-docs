import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const accountingSession = readFileSync(
  new URL('../src/react-app/pages/AccountingSessionOne.tsx', import.meta.url),
  'utf8',
);

function section(start: string, end: string) {
  const startIndex = accountingSession.indexOf(start);
  const endIndex = accountingSession.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return accountingSession.slice(startIndex, endIndex);
}

test('restricted-branch accounting assistants do not receive report navigation', () => {
  const accessHelper = section(
    'function canAccessAccountingReportsForUser',
    'function canAccessAccountingReportKindForUser',
  );
  const workflow = section('function AccountingWorkflowNav', 'function UploadBox');

  assert.match(accessHelper, /!!user && isAccountingAsstAllowedBranch\(user\)/);
  assert.match(
    workflow,
    /\.filter\(\(step\) => step\.id !== 'reports' \|\| canAccessAccountingReportsForUser\(user\)\)/,
  );
  assert.match(workflow, /const next = steps\[index \+ 1\]/);
});

test('report cards are filtered by the shared per-user access helper', () => {
  const review = section('export function AccountingSessionTwo', 'export function AccountingReportsHub');
  const hub = section('export function AccountingReportsHub', 'export function AccountingSalesLedgerReport');

  assert.match(review, /if \(card\.kind\) return canAccessAccountingReportKindForUser\(card\.kind, user\)/);
  assert.match(review, /if \(!canAccessAccountingReportsForUser\(user\)\) return false/);
  assert.match(hub, /if \(!canAccessAccountingReportsForUser\(user\)\) \{\s*return <Navigate to="\/accounting-session2" replace \/>/);
  assert.match(hub, /reportKinds\.map\(\(kind\) =>/);
});

test('direct report URLs normalize before loading or rendering a forbidden report kind', () => {
  const reportPage = section('function AccountingLedgerReportPage', 'function statementMoney');

  assert.match(reportPage, /const canAccessRequestedReport = visibleReportKinds\.includes\(reportType\)/);
  assert.match(
    reportPage,
    /if \(!canAccessRequestedReport\) \{\s*setData\(\{ rows: \[\], summary: \{\}, months: \[\] \}\)/,
  );
  assert.match(
    reportPage,
    /if \(!canAccessRequestedReport\) \{[\s\S]*?return <Navigate to=\{fallbackPath\} replace \/>/,
  );
  assert.match(reportPage, /visibleReportKinds\.map\(\(kind\) =>/);
});
