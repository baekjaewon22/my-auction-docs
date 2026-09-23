import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  articleObjectKey,
  articleDateFromCanonicalObjectKey,
  cleanupExpiredArticlePdfs,
  decodeArticleUploadHeader,
  ensureArticlePdfTable,
  hasObviousArticleTextEncodingDamage,
  isCanonicalArticleObjectExpired,
  isExpiredArticleDate,
  normalizeArticleDate,
  safePdfFileName,
} from '../src/worker/lib/article-pdfs.ts';

type TestStatement = D1PreparedStatement & { runSyncForBatch(): D1Result };

function d1FromSqlite(
  sqlite: Database.Database,
  options: { failObjectReferenceLookup?: boolean } = {},
): D1Database {
  const prepare = (sql: string, params: unknown[] = []): TestStatement => {
    if (options.failObjectReferenceLookup && /SELECT object_key FROM article_pdf_uploads WHERE object_key/.test(sql)) {
      throw new Error('D1 reference lookup failed');
    }
    const statement = sqlite.prepare(sql);
    const runSyncForBatch = () => {
      const result = statement.run(...params);
      return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
    };
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      all: async <T>() => ({ results: statement.all(...params) as T[] }),
      first: async <T>() => (statement.get(...params) as T | undefined) || null,
      run: async () => runSyncForBatch(),
      runSyncForBatch,
    } as unknown as TestStatement;
  };

  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const transaction = sqlite.transaction((items: D1PreparedStatement[]) => (
        items.map((statement) => (statement as TestStatement).runSyncForBatch())
      ));
      return transaction(statements);
    },
  } as unknown as D1Database;
}

async function setupDatabase(options: { failObjectReferenceLookup?: boolean } = {}) {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE admin_notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'article_news',
      source_type TEXT, source_id TEXT
    );
    CREATE TABLE admin_note_comments (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL,
      FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
    );
    CREATE TABLE admin_note_view_logs (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL,
      FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
    );
    CREATE TABLE admin_note_attachments (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL,
      FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
    );
  `);
  const db = d1FromSqlite(sqlite, options);
  await ensureArticlePdfTable(db);
  return { sqlite, db };
}

function insertArticle(
  sqlite: Database.Database,
  input: {
    id: string;
    noteId?: string;
    articleDate?: string;
    expiresAt?: string;
    deletedAt?: string | null;
    objectKey?: string;
    noteCategory?: string;
    noteSourceType?: string;
    noteSourceId?: string;
  },
) {
  const noteId = input.noteId || `${input.id}-note`;
  sqlite.prepare(`INSERT INTO admin_notes (id, title, category, source_type, source_id)
    VALUES (?, ?, ?, ?, ?)`).run(
    noteId,
    input.id,
    input.noteCategory ?? 'article_news',
    input.noteSourceType ?? 'article_pdf',
    input.noteSourceId ?? input.id,
  );
  sqlite.prepare(`INSERT INTO article_pdf_uploads
    (id, note_id, object_key, file_name, article_date, expires_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    input.id,
    noteId,
    input.objectKey || `articles/${input.id}.pdf`,
    `${input.id}.pdf`,
    input.articleDate || '2000-01-01',
    input.expiresAt || '2000-02-01',
    input.deletedAt ?? null,
  );
  sqlite.prepare('INSERT INTO admin_note_comments (id, note_id) VALUES (?, ?)')
    .run(`${input.id}-comment`, noteId);
  sqlite.prepare('INSERT INTO admin_note_view_logs (id, note_id) VALUES (?, ?)')
    .run(`${input.id}-view`, noteId);
  sqlite.prepare('INSERT INTO admin_note_attachments (id, note_id) VALUES (?, ?)')
    .run(`${input.id}-attachment`, noteId);
  return noteId;
}

type FakeR2Object = { key: string; uploaded?: Date };

function fakeBucket(options: {
  failingKeys?: string[];
  objects?: FakeR2Object[];
  listError?: string;
  pageSize?: number;
} = {}) {
  const deletedKeys: string[] = [];
  const failures = new Set(options.failingKeys || []);
  const objects = new Map((options.objects || []).map((object) => [object.key, object]));
  let listCalls = 0;
  const bucket = {
    delete: async (key: string) => {
      deletedKeys.push(key);
      if (failures.has(key)) throw new Error(`R2 delete failed: ${key}`);
      objects.delete(key);
    },
    list: async (listOptions: R2ListOptions = {}) => {
      listCalls++;
      if (options.listError) throw new Error(options.listError);
      const all = Array.from(objects.values())
        .filter((object) => object.key.startsWith(listOptions.prefix || ''))
        .sort((left, right) => left.key.localeCompare(right.key));
      const offset = listOptions.cursor
        ? all.findIndex((object) => object.key > listOptions.cursor!)
        : 0;
      const requested = listOptions.limit || 1000;
      const pageSize = Math.min(requested, options.pageSize || requested);
      const safeOffset = offset < 0 ? all.length : offset;
      const page = all.slice(safeOffset, safeOffset + pageSize);
      const hasNextPage = safeOffset + page.length < all.length;
      return {
        objects: page.map((object) => ({
          key: object.key,
          uploaded: object.uploaded || new Date('2000-01-01T00:00:00Z'),
          size: 1,
          etag: 'test',
          httpEtag: '"test"',
          checksums: {},
          storageClass: 'Standard',
        })),
        delimitedPrefixes: [],
        truncated: hasNextPage,
        cursor: hasNextPage ? page.at(-1)?.key : undefined,
      } as unknown as R2Objects;
    },
  } as unknown as R2Bucket;
  return { bucket, deletedKeys, get listCalls() { return listCalls; } };
}

test('article upload metadata rejects unmistakable CP949/replacement damage without blocking valid Unicode', () => {
  const brokenSource = 'KR \u00bd\u00c3\u00c0\u00e5 \u00ba\uae2e\u00c7\u00ce';
  assert.equal(hasObviousArticleTextEncodingDamage(brokenSource), true);
  assert.equal(hasObviousArticleTextEncodingDamage('\u00b0\u00e6\u00c1\u00a6 \u00b5\u00bf\u00c7\u00e2'), true);
  assert.equal(hasObviousArticleTextEncodingDamage('\u00bd\u200b\u00c3\u00c0\u00e5'), true);
  assert.equal(hasObviousArticleTextEncodingDamage('\u00bd\u200d\u00c3\u00c0\u00e5'), true);
  assert.equal(hasObviousArticleTextEncodingDamage('%BD%C3%C0%E5'), true);
  assert.equal(hasObviousArticleTextEncodingDamage(`2026-08-26 \uae30\uc0ac PDF - ${brokenSource}`), true);
  assert.equal(hasObviousArticleTextEncodingDamage('source \uFFFD name'), true);
  assert.equal(hasObviousArticleTextEncodingDamage('\u00ef\u00bf\u00bd'), true);
  assert.equal(hasObviousArticleTextEncodingDamage('KR \uc2dc\uc7a5 \ube0c\ub9ac\ud551'), false);
  assert.equal(hasObviousArticleTextEncodingDamage("Caf\u00e9 de l'\u00c9conomie"), false);
  assert.equal(hasObviousArticleTextEncodingDamage('M\u00fcnchner B\u00f6rse / S\u00e3o Paulo'), false);
  assert.equal(hasObviousArticleTextEncodingDamage('Fran\u00e7ois / Cr\u00e8me br\u00fbl\u00e9e'), false);
  assert.equal(hasObviousArticleTextEncodingDamage('\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66 \uac00\uc871'), false);
  assert.equal(hasObviousArticleTextEncodingDamage('\ud83d\udc69\ud83c\udffd\u200d\ud83d\udcbb \uc9c1\uc5c5'), false);
  assert.equal(hasObviousArticleTextEncodingDamage('Reuters Market Briefing'), false);
});

test('short and visibly separated CP949 byte pairs cannot bypass detection', () => {
  assert.equal(hasObviousArticleTextEncodingDamage('\u00b0\u00e6'), true);
  assert.equal(hasObviousArticleTextEncodingDamage('\u00b0\u00e6-\u00c1\u00a6'), true);
  assert.equal(hasObviousArticleTextEncodingDamage('\u00e9\u00e0 \u00f6\u00fc'), false);
});

test('raw upload headers decode only real percent escapes while preserving ordinary percent text', () => {
  assert.equal(decodeArticleUploadHeader('\uae08\ub9ac 3%'), '\uae08\ub9ac 3%');
  assert.equal(decodeArticleUploadHeader('%EA%B8%88%EB%A6%AC%203%25'), '\uae08\ub9ac 3%');
  assert.equal(decodeArticleUploadHeader('100%A'), '100%A');
  assert.throws(() => decodeArticleUploadHeader('%E0%A4%A'), URIError);
});

test('long PDF filenames reserve the suffix and remain canonical orphan keys', () => {
  const longStem = '\uae30'.repeat(240);
  const normalized = safePdfFileName(`${longStem}.PDF`);
  assert.equal(Array.from(normalized).length, 180);
  assert.equal(normalized.endsWith('.pdf'), true);
  assert.equal(normalized.endsWith('.pdf.pdf'), false);
  const key = articleObjectKey(
    '2000-01-01',
    '11111111-1111-4111-8111-111111111111',
    `${longStem}.PDF`,
  );
  assert.equal(articleDateFromCanonicalObjectKey(key), '2000-01-01');
});

test('article dates are real KST dates and cannot be future-dated', () => {
  assert.equal(normalizeArticleDate('', '2026-09-02'), '2026-09-02');
  assert.equal(normalizeArticleDate('2026-09-02', '2026-09-02'), '2026-09-02');
  assert.equal(normalizeArticleDate('2026-02-29', '2026-09-02'), null);
  assert.equal(normalizeArticleDate('2026-09-03', '2026-09-02'), null);
  assert.equal(normalizeArticleDate('9999-12-31', '2026-09-02'), null);
  assert.equal(normalizeArticleDate('not-a-date', '2026-09-02'), null);
});

test('only canonical dated article object keys are eligible for orphan expiry', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const valid = `articles/2000/01/2000-01-01_${id}_\uc2dc\uc7a5.pdf`;
  assert.equal(articleDateFromCanonicalObjectKey(valid), '2000-01-01');
  assert.equal(isCanonicalArticleObjectExpired(valid, '2000-02-01'), true);
  assert.equal(isCanonicalArticleObjectExpired(valid, '2000-01-31'), false);
  assert.equal(articleDateFromCanonicalObjectKey(`articles/2000/02/2000-01-01_${id}_a.pdf`), null);
  assert.equal(articleDateFromCanonicalObjectKey(`articles/2000/02/2000-02-30_${id}_a.pdf`), null);
  assert.equal(articleDateFromCanonicalObjectKey('articles/2000/01/2000-01-01_not-a-uuid_a.pdf'), null);
  assert.equal(articleDateFromCanonicalObjectKey(`${valid}/extra.pdf`), null);
  assert.equal(isExpiredArticleDate('2000-01-01', '2000-02-01'), true);
  assert.equal(isExpiredArticleDate('2000-01-01', '2000-01-31'), false);
});

test('article upload rejects expired dates and duplicate article identity before R2 writes', () => {
  const source = readFileSync('src/worker/routes/admin-notes.ts', 'utf8');
  const uploadStart = source.indexOf("adminNotes.post('/articles/upload-pdf'");
  const expiryCheck = source.indexOf('isExpiredArticleDate(articleDate, kstToday)', uploadStart);
  const shaDuplicate = source.indexOf('WHERE sha256 = ?', uploadStart);
  const identityDuplicate = source.indexOf('const identityDuplicate = await db.prepare', uploadStart);
  const r2Write = source.indexOf('ARTICLE_BUCKET.put(objectKey', uploadStart);
  assert.ok(uploadStart >= 0);
  assert.ok(expiryCheck > uploadStart && expiryCheck < r2Write);
  assert.ok(shaDuplicate > uploadStart && shaDuplicate < identityDuplicate);
  assert.ok(identityDuplicate < r2Write);
  assert.match(source.slice(identityDuplicate, r2Write), /ap\.article_date = \?/);
  assert.match(source.slice(identityDuplicate, r2Write), /lower\(trim\(COALESCE\(ap\.source_name, ''\)\)\) = \?/);
  assert.match(source.slice(identityDuplicate, r2Write), /lower\(trim\(COALESCE\(n\.title, ''\)\)\) = \?/);
  assert.match(source.slice(identityDuplicate, r2Write), /lower\(trim\(COALESCE\(ap\.file_name, ''\)\)\) = \?/);
});

test('multipart and raw article upload metadata converge on damage rejection before any R2 or DB write', () => {
  const source = readFileSync('src/worker/routes/admin-notes.ts', 'utf8');
  const uploadStart = source.indexOf("adminNotes.post('/articles/upload-pdf'");
  const multipartSource = source.indexOf("sourceName = String(form.get('source_name')", uploadStart);
  const rawSource = source.indexOf("sourceName = decodeArticleUploadHeader(c.req.header('x-source-name'))", uploadStart);
  const validation = source.indexOf('hasObviousArticleTextEncodingDamage(title)', uploadStart);
  const r2Write = source.indexOf('ARTICLE_BUCKET.put(objectKey', uploadStart);
  const dbWrite = source.indexOf('INSERT INTO admin_notes', uploadStart);
  assert.ok(uploadStart >= 0 && multipartSource > uploadStart);
  assert.ok(rawSource > multipartSource);
  assert.ok(validation > rawSource);
  assert.ok(validation < r2Write);
  assert.ok(validation < dbWrite);
  assert.match(source.slice(validation, r2Write), /UTF-8[\s\S]*?400/);
  assert.match(source.slice(uploadStart, validation), /mediaType === 'multipart\/form-data'/);
  assert.match(source.slice(uploadStart, validation), /mediaType === 'application\/pdf'/);
  assert.match(source.slice(uploadStart, validation), /PDF \uba54\ud0c0\ub370\uc774\ud130 \ud5e4\ub354[\s\S]*?400/);
  assert.match(source.slice(validation, r2Write), /hasObviousArticleTextEncodingDamage\(fileName\)/);
  assert.match(source.slice(validation, r2Write), /hasObviousArticleTextEncodingDamage\(content/);
  assert.match(source.slice(r2Write), /R2 rollback delete failed; retention cleanup will retry the orphan/);
});

test('31-day cleanup hard-deletes active and legacy soft rows plus the exact generated notes and logs', async () => {
  const { sqlite, db } = await setupDatabase();
  const expiredNote = insertArticle(sqlite, {
    id: 'expired', articleDate: '2000-01-01', expiresAt: '2999-01-01',
  });
  const softNote = insertArticle(sqlite, {
    id: 'soft', articleDate: '2000-01-02', expiresAt: '2999-01-01', deletedAt: '2000-02-02',
  });
  const futureNote = insertArticle(sqlite, {
    id: 'future', articleDate: '2999-01-01', expiresAt: '2000-01-01',
  });
  const { bucket, deletedKeys } = fakeBucket();

  const result = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: bucket }, 50);
  assert.deepEqual(result, { scanned: 2, deleted: 2, failed: 0, errors: [] });
  assert.deepEqual(deletedKeys.sort(), ['articles/expired.pdf', 'articles/soft.pdf']);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM article_pdf_uploads').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_notes WHERE id IN (?, ?)').get(expiredNote, softNote).count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_comments').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_view_logs').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_attachments').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_notes WHERE id = ?').get(futureNote).count, 1);

  const replay = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: bucket }, 50);
  assert.deepEqual(replay, { scanned: 0, deleted: 0, failed: 0, errors: [] });
  sqlite.close();
});

test('cleanup preserves an unrelated or mismatched note while purging only its expired article row', async () => {
  const { sqlite, db } = await setupDatabase();
  const mismatchNote = insertArticle(sqlite, {
    id: 'mismatch', noteSourceType: 'community', noteSourceId: 'someone-else',
  });
  const categoryMismatchNote = insertArticle(sqlite, {
    id: 'category-mismatch', noteCategory: 'notice',
  });
  const unrelatedNote = insertArticle(sqlite, {
    id: 'unrelated-article', noteId: 'unrelated-note', articleDate: '2999-01-01',
  });
  const { bucket } = fakeBucket();

  const result = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: bucket }, 50);
  assert.deepEqual(result, { scanned: 2, deleted: 2, failed: 0, errors: [] });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM article_pdf_uploads WHERE id = ?').get('mismatch').count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_notes WHERE id = ?').get(mismatchNote).count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_comments WHERE note_id = ?').get(mismatchNote).count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_view_logs WHERE note_id = ?').get(mismatchNote).count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_attachments WHERE note_id = ?').get(mismatchNote).count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_notes WHERE id = ?').get(categoryMismatchNote).count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_comments WHERE note_id = ?').get(categoryMismatchNote).count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_view_logs WHERE note_id = ?').get(categoryMismatchNote).count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_attachments WHERE note_id = ?').get(categoryMismatchNote).count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_notes WHERE id = ?').get(unrelatedNote).count, 1);
  sqlite.close();
});

test('R2 failure or missing binding preserves all DB rows for retry', async () => {
  const { sqlite, db } = await setupDatabase();
  const noteId = insertArticle(sqlite, { id: 'r2-failure' });
  const { bucket } = fakeBucket({ failingKeys: ['articles/r2-failure.pdf'] });

  const failed = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: bucket }, 50);
  assert.equal(failed.scanned, 1);
  assert.equal(failed.deleted, 0);
  assert.equal(failed.failed, 1);
  assert.match(failed.errors[0], /R2 delete failed/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM article_pdf_uploads').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_notes WHERE id = ?').get(noteId).count, 1);

  const missingBucket = await cleanupExpiredArticlePdfs({ DB: db }, 50);
  assert.equal(missingBucket.deleted, 0);
  assert.equal(missingBucket.failed, 1);
  assert.match(missingBucket.errors[0], /ARTICLE_BUCKET is not configured/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM article_pdf_uploads').get().count, 1);
  sqlite.close();
});

test('DB batch rollback keeps metadata and dependent logs after R2 success, then retry succeeds', async () => {
  const { sqlite, db } = await setupDatabase();
  const noteId = insertArticle(sqlite, { id: 'db-retry' });
  sqlite.exec(`CREATE TRIGGER block_article_note_delete
    BEFORE DELETE ON admin_notes WHEN OLD.id = '${noteId}'
    BEGIN SELECT RAISE(ABORT, 'blocked test delete'); END`);
  const { bucket, deletedKeys } = fakeBucket();

  const failed = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: bucket }, 1);
  assert.equal(failed.deleted, 0);
  assert.equal(failed.failed, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM article_pdf_uploads').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_notes').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_comments').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_view_logs').get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_note_attachments').get().count, 1);

  sqlite.exec('DROP TRIGGER block_article_note_delete');
  const retried = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: bucket }, 1);
  assert.deepEqual(retried, { scanned: 1, deleted: 1, failed: 0, errors: [] });
  assert.deepEqual(deletedKeys, ['articles/db-retry.pdf', 'articles/db-retry.pdf']);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM article_pdf_uploads').get().count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_notes').get().count, 0);
  sqlite.close();
});

test('cleanup honors its batch limit', async () => {
  const { sqlite, db } = await setupDatabase();
  insertArticle(sqlite, { id: 'limit-a', articleDate: '2000-01-01' });
  insertArticle(sqlite, { id: 'limit-b', articleDate: '2000-01-02' });
  const { bucket } = fakeBucket();

  const first = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: bucket }, 1);
  assert.deepEqual(first, { scanned: 1, deleted: 1, failed: 0, errors: [] });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM article_pdf_uploads').get().count, 1);
  const second = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: bucket }, 1);
  assert.deepEqual(second, { scanned: 1, deleted: 1, failed: 0, errors: [] });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM article_pdf_uploads').get().count, 0);
  sqlite.close();
});

test('orphan cleanup paginates R2 and deletes only expired canonical unreferenced objects', async () => {
  const { sqlite, db } = await setupDatabase();
  const liveKey = 'articles/2000/01/2000-01-01_00000000-0000-4000-8000-000000000001_live.pdf';
  const orphanKey = 'articles/2000/01/2000-01-01_00000000-0000-4000-8000-000000000002_orphan.pdf';
  const recentKey = 'articles/2000/01/2000-01-01_00000000-0000-4000-8000-000000000003_recent.pdf';
  const futureKey = 'articles/2999/01/2999-01-01_00000000-0000-4000-8000-000000000004_future.pdf';
  const wrongMonthKey = 'articles/2000/02/2000-01-01_00000000-0000-4000-8000-000000000005_wrong.pdf';
  insertArticle(sqlite, {
    id: 'live-reference',
    articleDate: '2999-01-01',
    expiresAt: '2999-02-01',
    objectKey: liveKey,
  });
  const fake = fakeBucket({
    objects: [
      { key: liveKey },
      { key: orphanKey },
      { key: recentKey, uploaded: new Date() },
      { key: futureKey },
      { key: wrongMonthKey },
      { key: 'articles/2000/01/not-canonical.pdf' },
    ],
    pageSize: 1,
  });

  const result = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: fake.bucket }, 10);
  assert.deepEqual(result, { scanned: 1, deleted: 1, failed: 0, errors: [] });
  assert.deepEqual(fake.deletedKeys, [orphanKey]);
  assert.ok(fake.listCalls > 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM article_pdf_uploads WHERE object_key = ?').get(liveKey).count, 1);
  sqlite.close();
});

test('D1 live-reference lookup failure is fail-closed for R2 orphans', async () => {
  const { sqlite, db } = await setupDatabase({ failObjectReferenceLookup: true });
  const orphanKey = 'articles/2000/01/2000-01-01_00000000-0000-4000-8000-000000000006_orphan.pdf';
  const fake = fakeBucket({ objects: [{ key: orphanKey }] });

  const result = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: fake.bucket }, 5);
  assert.equal(result.scanned, 1);
  assert.equal(result.deleted, 0);
  assert.equal(result.failed, 1);
  assert.match(result.errors[0], /D1 reference lookup failed/);
  assert.deepEqual(fake.deletedKeys, []);
  sqlite.close();
});

test('R2 list failure does not roll back completed tracked-row cleanup', async () => {
  const { sqlite, db } = await setupDatabase();
  insertArticle(sqlite, { id: 'tracked-before-list-error' });
  const fake = fakeBucket({ listError: 'R2 list unavailable' });

  const result = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: fake.bucket }, 2);
  assert.equal(result.scanned, 1);
  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 1);
  assert.match(result.errors[0], /orphan-list: R2 list unavailable/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM article_pdf_uploads').get().count, 0);
  sqlite.close();
});

test('tracked and orphan cleanup share one exact mutation limit', async () => {
  const { sqlite, db } = await setupDatabase();
  insertArticle(sqlite, { id: 'tracked-limit' });
  const firstOrphan = 'articles/2000/01/2000-01-01_00000000-0000-4000-8000-000000000007_a.pdf';
  const secondOrphan = 'articles/2000/01/2000-01-01_00000000-0000-4000-8000-000000000008_b.pdf';
  const fake = fakeBucket({ objects: [{ key: firstOrphan }, { key: secondOrphan }] });

  const first = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: fake.bucket }, 2);
  assert.deepEqual(first, { scanned: 2, deleted: 2, failed: 0, errors: [] });
  assert.equal(fake.deletedKeys.length, 2);
  const second = await cleanupExpiredArticlePdfs({ DB: db, ARTICLE_BUCKET: fake.bucket }, 2);
  assert.deepEqual(second, { scanned: 1, deleted: 1, failed: 0, errors: [] });
  assert.equal(fake.deletedKeys.length, 3);
  sqlite.close();
});

test('manual article-note deletion removes R2 before DB metadata and cron logs cleanup failures', () => {
  const routeSource = readFileSync('src/worker/routes/admin-notes.ts', 'utf8');
  const deleteStart = routeSource.indexOf("adminNotes.delete('/:id'");
  const articleDelete = routeSource.indexOf("note.category === 'article_news'", deleteStart);
  const r2Delete = routeSource.indexOf('ARTICLE_BUCKET.delete(object.object_key)', articleDelete);
  const dbDelete = routeSource.indexOf("DELETE FROM admin_notes WHERE id = ?", articleDelete);
  assert.ok(deleteStart >= 0 && articleDelete > deleteStart);
  assert.ok(r2Delete > articleDelete && dbDelete > r2Delete);

  const workerSource = readFileSync('src/worker/index.ts', 'utf8');
  assert.match(workerSource, /cleanupExpiredArticlePdfs[\s\S]*?r\.scanned > 0 \|\| r\.failed > 0/);
});
