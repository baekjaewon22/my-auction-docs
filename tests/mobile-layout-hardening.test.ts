import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');

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
  assert.match(css, /@media \(max-width:\s*480px\)[\s\S]*?\.dashboard-page \.stats-grid\s*{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});
