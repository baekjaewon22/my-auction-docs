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
  assert.match(css, /--bg: #0c1521/);
  assert.match(css, /--surface: #132131/);
  assert.match(css, /--surface-elevated: #1d3044/);
  assert.match(css, /--text: #dce7f1/);
  assert.match(css, /--text-muted: #b7c5d4/);
  assert.match(css, /\.theme-toggle-btn\[aria-pressed='true'\]/);
  assert.match(css, /\.mobile-theme-btn/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.card[\s\S]*?\.modal[\s\S]*?\.table-wrap/);
  assert.match(css, /:root\[data-theme='dark'\] :where\([\s\S]*?\.form-input[\s\S]*?\.table-input/);
});

test('dark theme applies the comfortable navy safeguard after legacy page overrides', () => {
  const css = readFileSync('src/react-app/index.css', 'utf8');
  const safeguardIndex = css.indexOf('Comfortable navy dark mode safeguard');

  assert.ok(safeguardIndex > css.lastIndexOf('background: #94a3b8 !important'), 'navy safeguard must override legacy light-gray surfaces');
  const safeguard = css.slice(safeguardIndex);
  assert.match(safeguard, /\[class\$='-card'\][\s\S]*?\[class\$='-panel'\][\s\S]*?\[class\$='-wrapper'\]/);
  assert.match(safeguard, /:not\(\.document-page\):not\(\.print-page\):not\(\.minutes-pdf-page\):not\(\.pdf-page\)/);
  assert.match(safeguard, /background: var\(--surface\) !important/);
  assert.match(safeguard, /background: var\(--surface-elevated\) !important/);
  assert.match(safeguard, /background-color: var\(--input-bg\) !important/);
  assert.match(safeguard, /color: var\(--text\) !important/);
  assert.match(safeguard, /color: var\(--text-muted\) !important/);
  assert.match(safeguard, /\.alert-success[\s\S]*?\.alert-warning[\s\S]*?\.alert-danger/);
  assert.match(safeguard, /tbody tr:hover/);
  assert.match(safeguard, /::selection/);
});

test('dark theme replaces legacy black inline text while preserving printable pages', () => {
  const css = readFileSync('src/react-app/index.css', 'utf8');
  const select = readFileSync('src/react-app/components/Select.tsx', 'utf8');
  const safeguard = css.slice(css.indexOf('Comfortable navy dark mode safeguard'));

  assert.match(safeguard, /\[style\*='color: #0f172a' i\]/);
  assert.match(safeguard, /\[style\*='color: rgb\(15, 23, 42\)' i\]/);
  assert.match(safeguard, /\[style\*='color: #3c4043' i\]/);
  assert.match(safeguard, /\[style\*='color: #5f6368' i\]/);
  assert.match(safeguard, /:not\(\.document-page, \.document-page \*, \.print-page, \.print-page \*, \.pr-page, \.pr-page \*/);
  assert.match(safeguard, /:where\(h1, h2, h3, h4, h5, h6, legend, pre, code\):not/);
  assert.match(safeguard, /color: var\(--text\) !important/);
  assert.match(safeguard, /color: var\(--text-muted\) !important/);
  assert.match(select, /backgroundColor: 'var\(--input-bg\)'/);
  assert.match(select, /color: 'var\(--text\)'/);
  assert.match(select, /color: 'var\(--text-subtle\)'/);
});

test('calendar and My Page routes receive a dedicated dark text scope', () => {
  const layout = readFileSync('src/react-app/components/Layout.tsx', 'utf8');
  const css = readFileSync('src/react-app/index.css', 'utf8');

  assert.match(layout, /const MY_PAGE_ROUTE_PREFIXES = \[/);
  assert.match(layout, /'\/auction-schedule'/);
  assert.match(layout, /'\/personal-calendar'/);
  assert.match(layout, /'\/my-statistics'/);
  assert.match(layout, /'\/rooms'/);
  assert.match(layout, /main-content\$\{isMyPageRoute \? ' my-page-dark-scope' : ''\}/);
  assert.match(css, /:where\(\.page, \.main-content\.my-page-dark-scope\)/);
  assert.match(css, /\.personal-calendar-page[\s\S]*?\.personal-calendar-day[\s\S]*?\.personal-calendar-event-chip/);
  assert.match(css, /\.personal-calendar-toolbar \.personal-calendar-month-title strong[\s\S]*?color: #dce7f1 !important/);
  assert.match(css, /\.personal-calendar-weekdays > span[\s\S]*?color: #b7c5d4 !important/);
  assert.match(css, /\.auction-schedule-page[\s\S]*?\.auction-schedule-day[\s\S]*?\.auction-schedule-item/);
});

test('My Statistics has a final high-contrast dark text layer', () => {
  const css = readFileSync('src/react-app/index.css', 'utf8');
  const layer = css.slice(css.indexOf('My statistics: final high-contrast layer'));

  assert.match(layer, /\.my-stats-summary-card strong[\s\S]*?color: #f1f6fb !important/);
  assert.match(layer, /\.my-stats-summary-card > div > span[\s\S]*?color: #c6d4e1 !important/);
  assert.match(layer, /\.my-stats-bar-result span[\s\S]*?color: #add5fa !important/);
  assert.match(layer, /\.my-stats-coverage-note span[\s\S]*?color: #d6e3ee !important/);
  assert.match(layer, /\.my-stats-filters :where\(input, select, option\)[\s\S]*?color: #f4f8fc !important/);
  assert.match(layer, /\.my-stats-no-record[\s\S]*?color: #ffe09a !important/);
});

test('announcement popup window uses larger readable text', () => {
  const app = readFileSync('src/react-app/App.tsx', 'utf8');

  assert.match(app, /h1 \{ margin: 0; font-size: 21px/);
  assert.match(app, /p \{ margin: 0 0 12px; font-size: 15\.5px/);
  assert.match(app, /label \{ display: inline-flex[\s\S]*?font-size: 14px/);
});
