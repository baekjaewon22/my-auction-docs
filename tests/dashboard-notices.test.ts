import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DASHBOARD_NOTICE_LIMIT,
  dashboardNoticeItems,
} from '../src/react-app/lib/dashboard-notices.ts';

test('dashboard notices preserve the API pinned/created order and expose only the first three', () => {
  const apiOrderedNotices = [
    { id: 'pinned-old', pinned: 1, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: 'newest', pinned: 0, created_at: '2026-09-03', updated_at: '2026-09-03' },
    { id: 'second', pinned: 0, created_at: '2026-09-02', updated_at: '2026-09-02' },
    { id: 'edited', pinned: 0, created_at: '2026-01-02', updated_at: '2026-09-04' },
  ];

  assert.equal(DASHBOARD_NOTICE_LIMIT, 3);
  assert.deepEqual(
    dashboardNoticeItems(apiOrderedNotices).map((notice) => notice.id),
    ['pinned-old', 'newest', 'second'],
  );
  assert.deepEqual(apiOrderedNotices.map((notice) => notice.id), [
    'pinned-old',
    'newest',
    'second',
    'edited',
  ]);
});

test('employee and freelancer dashboards share the three-item notice selector and detail deep link', () => {
  const dashboard = readFileSync(new URL('../src/react-app/pages/Dashboard.tsx', import.meta.url), 'utf8');

  assert.equal((dashboard.match(/dashboardNoticeItems\(/g) || []).length, 3);
  assert.equal(
    (dashboard.match(/to=\{`\/admin-notes\?section=notice&note=\$\{notice\.id\}`\}/g) || []).length,
    2,
  );
  assert.doesNotMatch(dashboard, /latestNotices[\s\S]{0,250}updated_at/);
});

test('freelancers keep the notice section for list, detail, and back navigation without gaining create access', () => {
  const adminNotes = readFileSync(new URL('../src/react-app/pages/AdminNotes.tsx', import.meta.url), 'utf8');
  const noticeButton = adminNotes.slice(
    adminNotes.indexOf("communitySection === 'notice' ? 'btn-primary'"),
    adminNotes.indexOf("communitySection === 'resource_library' ? 'btn-primary'"),
  );

  assert.match(adminNotes, /searchParams\.get\('section'\) === 'notice' \? 'notice' : 'posts'/);
  assert.match(adminNotes, /requestedSection === 'notice'\s*\? 'notice'/);
  assert.match(noticeButton, /setCommunitySection\('notice'\)/);
  assert.doesNotMatch(noticeButton, /!isFreelancer/);
  assert.match(
    adminNotes,
    /communitySection === 'notice' && !canCreateNotice/,
    'notice creation must remain hidden from users without notice management permission',
  );
});

test('dashboard notice links provide a mobile-sized click target', () => {
  const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');
  const noticeItemRule = css.match(/\.dashboard-notice-item\s*\{([^}]+)\}/)?.[1] || '';

  assert.match(noticeItemRule, /min-height:\s*44px/);
  assert.match(noticeItemRule, /align-items:\s*center/);
});
