import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('layout provides a persisted dark-mode toggle on desktop and mobile', () => {
  const layout = readFileSync('src/react-app/components/Layout.tsx', 'utf8');
  const html = readFileSync('index.html', 'utf8');

  assert.match(layout, /localStorage\.getItem\('theme'\)/);
  assert.match(layout, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(layout, /className="btn-footer theme-toggle-btn"/);
  assert.match(layout, /className="mobile-theme-btn"/);
  assert.match(layout, /aria-pressed=\{theme === 'dark'\}/);
  assert.match(html, /document\.documentElement\.dataset\.theme = theme/);
});

test('dark theme defines global variables and common surface overrides', () => {
  const css = readFileSync('src/react-app/index.css', 'utf8');

  assert.match(css, /:root\[data-theme='dark'\]/);
  assert.match(css, /--bg: #0b1120/);
  assert.match(css, /\.theme-toggle-btn\[aria-pressed='true'\]/);
  assert.match(css, /\.mobile-theme-btn/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.card[\s\S]*?\.modal[\s\S]*?\.table-wrap/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.form-input[\s\S]*?\.table-input/);
});

test('dark theme keeps dashboard notice surfaces and text readable', () => {
  const css = readFileSync('src/react-app/index.css', 'utf8');

  assert.match(css, /:root\[data-theme='dark'\] \.page :where\([\s\S]*?\[class\$='-card'\][\s\S]*?\[class\$='-panel'\][\s\S]*?\[class\$='-tabs'\][\s\S]*?\[class\$='-wrapper'\]/);
  assert.match(css, /:not\(\.document-page\):not\(\.print-page\):not\(\.minutes-pdf-page\):not\(\.pdf-page\)/);
  assert.match(css, /background: #94a3b8 !important/);
  assert.match(css, /color: #0b1120 !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.page :where\([\s\S]*?\[class\$='-list'\][\s\S]*?\)[\s\S]*?background: transparent !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.page :where\([\s\S]*?\[class\$='-item'\][\s\S]*?\[class\$='-row'\][\s\S]*?background: #a8b5c6 !important/);
  assert.match(css, /\.admin-notes-section-tabs/);
  assert.match(css, /:where\(button, a, \.btn\)/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.dashboard-notice-panel[\s\S]*?\.dashboard-today-news-panel[\s\S]*?\.dashboard-top-alert-panel/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.announcement-popup-card[\s\S]*?\.popup-manager-panel[\s\S]*?\.popup-manager-item/);
  assert.match(css, /:root\[data-theme='dark'\] \.dashboard-notice-panel/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.dashboard-notice-item[\s\S]*?\.dashboard-today-news-item[\s\S]*?\.dashboard-my-alert-item/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.dashboard-notice-line strong[\s\S]*?\.dashboard-today-news-title/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.dashboard-notice-line time[\s\S]*?\.dashboard-today-news-empty/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.announcement-popup-head[\s\S]*?\.announcement-popup-foot/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.page-header[\s\S]*?\.filter-bar[\s\S]*?\.sales-filter-bar[\s\S]*?\)[\s\S]*?background: var\(--bg\) !important/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.stats-grid \.stat-card[\s\S]*?\.bid-stats-grid \.bid-stat-card[\s\S]*?\)[\s\S]*?background: var\(--bg\) !important/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.dashboard-today-bids-date[\s\S]*?\.doc-meta[\s\S]*?\.archive-doc-meta[\s\S]*?\)[\s\S]*?color: var\(--text\) !important/);
  assert.match(css, /:root\[data-theme='dark'\] :where\(\.lawitgo-case-sidebar, \.lawitgo-case-search\)[\s\S]*?background: #94a3b8 !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.auction-schedule-current-week,[\s\S]*?:root\[data-theme='dark'\] \.auction-schedule-current-week strong[\s\S]*?color: #f8fafc !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.filter-bar \.filter-btn[\s\S]*?color: #0b1120 !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.filter-bar \.filter-btn\.active[\s\S]*?color: #f8fafc !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.document-select-wrap[\s\S]*?border-radius: 18px !important/);
  assert.match(css, /:root\[data-theme='dark'\] :where\(\.freelancer-bid-page, \.unified-bid-history-page\)[\s\S]*?color: #f8fafc !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.ct-card-grid \.ct-card[\s\S]*?background: #94a3b8 !important/);
  assert.match(css, /:root\[data-theme='dark'\] :where\(\.doc-card, \.template-card, \.management-support-card\)[\s\S]*?background: #94a3b8 !important/);
  assert.match(css, /:root\[data-theme='dark'\] :where\(\.doc-card, \.template-card, \.management-support-card\) :where\([\s\S]*?\.management-support-title[\s\S]*?\.management-support-desc[\s\S]*?\)[\s\S]*?color: #0b1120 !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.template-card \.template-myauction-btn :where\(span, svg\),[\s\S]*?:root\[data-theme='dark'\] \.template-card \.template-myauction-btn\.active[\s\S]*?color: #f8fafc !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.management-support-icon[\s\S]*?background: #0b1120 !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.announcement-popup-body[\s\S]*?font-size: 1rem !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.expense-receipt-archive-item[\s\S]*?background: #94a3b8 !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.expense-receipt-archive-summary > div[\s\S]*?background: #94a3b8 !important[\s\S]*?border-color: #7f8fa4 !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.expense-receipt-archive-summary :where\(span, strong, small\)[\s\S]*?color: #0b1120 !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.expense-receipt-archive-page \.archive-category-tabs[\s\S]*?background: #94a3b8 !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.expense-receipt-archive-item \.status-badge[\s\S]*?color: #f8fafc !important/);
  assert.match(css, /:root\[data-theme='dark'\] \.expense-receipt-archive-actions \.btn,[\s\S]*?:root\[data-theme='dark'\] \.expense-receipt-pagination \.btn[\s\S]*?color: #f8fafc !important/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.expense-receipt-page-header h2[\s\S]*?\.expense-receipt-archive-header h2[\s\S]*?\)[\s\S]*?color: #f8fafc !important/);
});

test('announcement popup window uses larger readable text', () => {
  const app = readFileSync('src/react-app/App.tsx', 'utf8');

  assert.match(app, /h1 \{ margin: 0; font-size: 21px/);
  assert.match(app, /p \{ margin: 0 0 12px; font-size: 15\.5px/);
  assert.match(app, /label \{ display: inline-flex[\s\S]*?font-size: 14px/);
});
