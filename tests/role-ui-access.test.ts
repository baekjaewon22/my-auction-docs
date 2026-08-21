import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
const adminNotes = readFileSync(new URL('../src/react-app/pages/AdminNotes.tsx', import.meta.url), 'utf8');

test('director does not see the statistics category', () => {
  const statisticsMenu = layout.slice(layout.indexOf('{/* 통계:'), layout.indexOf('{/* 명도 사건'));
  assert.match(statisticsMenu, /\['master', 'ceo', 'admin'\]/);
  assert.doesNotMatch(statisticsMenu, /director/);
});

test('support cannot enter sales by direct URL', () => {
  assert.match(app, /function SalesRoute[\s\S]*?user\.role === 'support'[\s\S]*?Navigate to="\/dashboard"/);
  assert.match(app, /path="sales" element=\{<SalesRoute><Sales \/><\/SalesRoute>\}/);
  assert.match(layout, /\{!isSupport && \([\s\S]*?to="\/sales"/);
});

test('CC reference and accounting popup managers do not see the delete action', () => {
  assert.match(adminNotes, /const canDeleteNoticePopup = !!user && \['master', 'ceo', 'admin'\]\.includes\(user\.role\)/);
  assert.match(adminNotes, /\{canDelete && <button[^>]*btn-danger[^>]*onClick=\{\(\) => deletePopup\(popup\)\}/);
  assert.match(adminNotes, /<PopupNoticeManager canManage=\{canCreateNotice\} canDelete=\{canDeleteNoticePopup\} \/>/);
});
