import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');

test('mobile layout keeps the viewport bounded and uses the dynamic viewport height', () => {
  assert.match(css, /html,\s*body,\s*#root\s*{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(css, /\.app-layout\s*{[\s\S]*?min-height:\s*100dvh/);
  assert.match(css, /padding-top:\s*max\(10px,\s*env\(safe-area-inset-top\)\)/);
  assert.match(css, /padding-bottom:\s*env\(safe-area-inset-bottom\)/);
});

test('long mobile text, controls, dialogs, and data tables have explicit overflow rules', () => {
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /word-break:\s*keep-all/);
  assert.match(css, /\.modal\s*{[\s\S]*?max-height:\s*calc\(100dvh - 16px\)/);
  assert.match(css, /\.table-wrapper,[\s\S]*?\.freelancer-bid-table-wrap\s*{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.approval-bar,[\s\S]*?\.document-tool-tabs\s*{[\s\S]*?overflow-x:\s*auto/);
});

test('dense inline grids expose mobile stacking hooks', () => {
  const sources = [
    '../src/react-app/components/ComprehensiveAnalysis.tsx',
    '../src/react-app/components/LegalGlossaryTool.tsx',
    '../src/react-app/pages/Accounting.tsx',
    '../src/react-app/pages/AdminNotes.tsx',
    '../src/react-app/pages/FinanceAnalytics.tsx',
    '../src/react-app/pages/LawitgoSettlementLedger.tsx',
    '../src/react-app/pages/Leave.tsx',
    '../src/react-app/pages/Sales.tsx',
    '../src/react-app/pages/Statistics.tsx',
  ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));

  assert.ok(sources.some((source) => source.includes('mobile-stack-grid')));
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*?\.mobile-stack-grid\s*{[\s\S]*?grid-template-columns:\s*1fr\s*!important/);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*?\.dashboard-page \.stats-grid\s*{[\s\S]*?display:\s*none/);
});

test('mobile community tabs and lawitgo progress timeline cannot stretch into broken columns', () => {
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*?\.admin-notes-page \.admin-notes-section-tabs\s*{[\s\S]*?align-items:\s*center\s*!important/);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*?\.admin-notes-page \.admin-notes-section-tabs > \.btn\s*{[\s\S]*?max-height:\s*52px\s*!important/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?\.lawitgo-stage-track\s*{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?\.lawitgo-stage-track > div::after,[\s\S]*?\.lawitgo-stage-track::before,[\s\S]*?\.lawitgo-stage-track::after\s*{[\s\S]*?content:\s*none\s*!important/);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]*?\.lawitgo-stage-track > div\s*{[\s\S]*?position:\s*static\s*!important/);
});

test('tablet shell keeps the sidebar in a drawer until content has safe desktop width', () => {
  assert.match(layout, /matchMedia\('\(max-width: 1024px\)'\)/);
  assert.match(css, /@media \(max-width:\s*1024px\)\s*{[\s\S]*?\.mobile-header\s*{\s*display:\s*flex/);
  assert.match(css, /@media \(max-width:\s*1024px\)\s*{[\s\S]*?\.sidebar\s*{[\s\S]*?position:\s*fixed/);
  assert.match(css, /@media \(max-width:\s*1024px\)\s*{[\s\S]*?\.diagnosis-floating-box,[\s\S]*?display:\s*none/);
});

test('money summaries and external delivery cards use responsive tracks', () => {
  const accounting = readFileSync(new URL('../src/react-app/pages/Accounting.tsx', import.meta.url), 'utf8');
  assert.match(css, /\.stats-grid\s*{[\s\S]*?repeat\(auto-fit,\s*minmax\(140px,\s*1fr\)\)/);
  assert.match(css, /\.acc-kpi-grid\s*{[\s\S]*?repeat\(auto-fit,\s*minmax\(min\(100%,\s*220px\),\s*1fr\)\)/);
  assert.match(css, /\.lawitgo-winning-summary\s*{[^}]*repeat\(auto-fit,\s*minmax\(120px,\s*1fr\)\)/);
  assert.match(css, /\.accounting-session2-kpis\s*{[\s\S]*?repeat\(auto-fit,\s*minmax\(150px,\s*1fr\)\)/);
  assert.match(accounting, /className="acc-branch-summary-grid"/);
  assert.doesNotMatch(accounting, /gridTemplateColumns:\s*`repeat\(\$\{Math\.min\(cardSummary\.by_branch/);
});

test('mobile dialogs, popovers, payroll tables, and outdoor rows remain recoverable', () => {
  const propertyReport = readFileSync(new URL('../src/react-app/pages/PropertyReport.tsx', import.meta.url), 'utf8');
  const payroll = readFileSync(new URL('../src/react-app/pages/Payroll.tsx', import.meta.url), 'utf8');
  const linkReview = readFileSync(new URL('../src/react-app/pages/LinkReview.tsx', import.meta.url), 'utf8');
  const documentEdit = readFileSync(new URL('../src/react-app/pages/DocumentEdit.tsx', import.meta.url), 'utf8');

  assert.match(propertyReport, /className="property-report-reject-dialog"/);
  assert.doesNotMatch(propertyReport, /minWidth:\s*360/);
  assert.match(propertyReport, /wrapRef\.current\?\.clientWidth/);
  assert.match(propertyReport, /new ResizeObserver\(calcScale\)/);
  assert.ok((payroll.match(/className="payroll-table-scroll"/g) || []).length >= 6);
  assert.match(css, /\.payroll-table-scroll[\s\S]*?overflow-x:\s*auto/);
  assert.match(linkReview, /className="outdoor-entry-row"/);
  assert.match(documentEdit, /className="outdoor-entry-row/);
  assert.match(css, /\.bi-addmenu\s*{[\s\S]*?position:\s*fixed[\s\S]*?bottom:\s*max\(10px,\s*env\(safe-area-inset-bottom\)\)/);
});
