import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/react-app/pages/AdminNotes.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/worker/routes/admin-notes.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../d1/migrate-admin-notes-list-performance.sql', import.meta.url), 'utf8');

test('사내 커뮤니티 목록은 사용자·카테고리별 단기 캐시와 최신 요청만 사용한다', () => {
  assert.match(page, /ADMIN_NOTES_CACHE_TTL_MS = 60_000/);
  assert.match(page, /user\?\.id \|\| 'anonymous'/);
  assert.match(page, /requestId !== listRequestId\.current/);
  assert.match(page, /invalidateAdminNotesListCache/);
  assert.doesNotMatch(page, /if \(loading\) return <div className="page-loading"/);
});

test('목록 API는 30건 단위 페이지 조회와 더보기를 지원한다', () => {
  assert.match(api, /page_size\?: number/);
  assert.match(route, /pageSize \+ 1/);
  assert.match(route, /LIMIT \? OFFSET \?/);
  assert.match(page, /게시글 더보기/);
});

test('스키마 보강은 Worker DB 인스턴스당 한 번만 수행하고 목록 복합 인덱스를 사용한다', () => {
  assert.match(route, /adminNoteSchemaPromises = new WeakMap/);
  assert.match(route, /adminNoteSchemaPromises\.get\(key\)/);
  assert.match(route, /idx_admin_notes_list_order/);
  assert.match(route, /idx_admin_notes_category_order/);
  assert.match(route, /WHERE n\.category = \?/);
  assert.match(migration, /category, legal_subcategory, pinned DESC, created_at DESC/);
});
