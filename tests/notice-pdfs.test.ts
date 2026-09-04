import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { normalizeNoticeAttachments, NoticeAttachmentValidationError } from '../src/worker/lib/admin-note-attachments.ts';
import {
  cleanupNoticePdfObjects,
  ensureNoticePdfTables,
  loadNoticePdfForDelivery,
  noticePdfCleanupDelete,
  noticePdfCleanupUpsert,
  noticePdfMetadataInsert,
  noticePdfObjectKey,
  stageNoticePdfUpload,
  type NoticePdfMetadata,
} from '../src/worker/lib/notice-pdfs.ts';

type TestStatement = D1PreparedStatement & { runSyncForBatch(): D1Result };

function d1FromSqlite(sqlite: Database.Database): D1Database {
  const prepare = (sql: string, params: unknown[] = []): TestStatement => {
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
        items.map(statement => (statement as TestStatement).runSyncForBatch())
      ));
      return transaction(statements);
    },
  } as unknown as D1Database;
}

class MemoryBucket {
  readonly objects = new Map<string, ArrayBuffer>();
  getCalls = 0;
  throwAfterPut = false;
  failDelete = false;
  readonly failDeleteKeys = new Set<string>();

  async put(key: string, value: ArrayBuffer) {
    this.objects.set(key, value.slice(0));
    if (this.throwAfterPut) throw new Error('R2 put response lost');
    return {};
  }

  async get(key: string) {
    this.getCalls++;
    const value = this.objects.get(key);
    if (!value) return null;
    return {
      size: value.byteLength,
      arrayBuffer: async () => value.slice(0),
    };
  }

  async delete(key: string) {
    if (this.failDelete || this.failDeleteKeys.has(key)) throw new Error('R2 delete failed');
    this.objects.delete(key);
  }
}

function setupStorage() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE admin_notes (id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT 'notice');
  `);
  const db = d1FromSqlite(sqlite);
  return { sqlite, db };
}

function pdfBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
  return bytes;
}

function pdfDataUrl(bytes: Uint8Array): string {
  return `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`;
}

function metadata(noteId = 'notice-1', id = 'pdf-1', size = 3 * 1024 * 1024): NoticePdfMetadata {
  return {
    id,
    noteId,
    objectKey: noticePdfObjectKey(noteId, id, 'notice.pdf'),
    fileName: 'notice.pdf',
    fileSize: size,
    sha256: 'sha256',
    uploadedBy: 'master-1',
  };
}

test('2-10 MiB notice PDFs use queue-first R2 storage while non-PDF D1 values stay below the row ceiling', async () => {
  const { sqlite, db } = setupStorage();
  await ensureNoticePdfTables(db);
  const bucket = new MemoryBucket();
  const bytes = pdfBytes(2 * 1024 * 1024 + 1);
  const [normalized] = normalizeNoticeAttachments([{
    file_name: 'notice.pdf', file_type: 'application/pdf', file_size: 1, file_data: pdfDataUrl(bytes),
  }]);
  assert.equal(normalized.decoded_buffer.byteLength, bytes.byteLength);
  const item = metadata('notice-r2', 'pdf-r2', normalized.file_size);

  await stageNoticePdfUpload(db, bucket as unknown as R2Bucket, item, bytes.buffer);
  assert.equal(bucket.objects.has(item.objectKey), true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM notice_pdf_cleanup_queue').get().count, 1);

  await db.batch([
    db.prepare("INSERT INTO admin_notes (id, category) VALUES (?, 'notice')").bind(item.noteId),
    noticePdfMetadataInsert(db, item),
    noticePdfCleanupDelete(db, item.objectKey),
  ]);
  assert.equal(sqlite.prepare('SELECT file_size FROM notice_pdf_attachments WHERE id = ?').get(item.id).file_size, bytes.byteLength);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM notice_pdf_cleanup_queue').get().count, 0);

  const nonPdf = new Uint8Array(1024 * 1024 + 1);
  assert.throws(() => normalizeNoticeAttachments([{
    file_name: 'large.bin', file_type: 'application/octet-stream',
    file_data: `data:application/octet-stream;base64,${Buffer.from(nonPdf).toString('base64')}`,
  }]), (error: unknown) => error instanceof NoticeAttachmentValidationError && error.status === 413);
});

test('R2 put response loss and final D1 transaction failure leave queued objects for bounded cleanup', async () => {
  const { sqlite, db } = setupStorage();
  await ensureNoticePdfTables(db);
  const bytes = pdfBytes(64);

  const responseLossBucket = new MemoryBucket();
  responseLossBucket.throwAfterPut = true;
  const responseLoss = metadata('lost-note', 'lost-pdf', bytes.byteLength);
  await assert.rejects(stageNoticePdfUpload(db, responseLossBucket as unknown as R2Bucket, responseLoss, bytes.buffer));
  sqlite.prepare("UPDATE notice_pdf_cleanup_queue SET not_before = datetime('now', '-1 minute')").run();
  responseLossBucket.throwAfterPut = false;
  const cleanedLoss = await cleanupNoticePdfObjects({ DB: db, ARTICLE_BUCKET: responseLossBucket as unknown as R2Bucket }, 10);
  assert.deepEqual({ deleted: cleanedLoss.deleted, failed: cleanedLoss.failed }, { deleted: 1, failed: 0 });

  const transactionBucket = new MemoryBucket();
  const transactionFailure = metadata('failed-note', 'failed-pdf', bytes.byteLength);
  await stageNoticePdfUpload(db, transactionBucket as unknown as R2Bucket, transactionFailure, bytes.buffer);
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO admin_notes (id, category) VALUES (?, 'notice')").bind(transactionFailure.noteId),
    noticePdfMetadataInsert(db, transactionFailure),
    db.prepare("INSERT INTO admin_notes (id, category) VALUES (?, 'notice')").bind(transactionFailure.noteId),
    noticePdfCleanupDelete(db, transactionFailure.objectKey),
  ]));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_notes WHERE id = ?').get(transactionFailure.noteId).count, 0);
  sqlite.prepare("UPDATE notice_pdf_cleanup_queue SET not_before = datetime('now', '-1 minute')").run();
  const cleanedFailure = await cleanupNoticePdfObjects({ DB: db, ARTICLE_BUCKET: transactionBucket as unknown as R2Bucket }, 10);
  assert.equal(cleanedFailure.deleted, 1);
});

test('cleanup preserves a live R2 reference after D1 response ambiguity and drains deletion queues', async () => {
  const { sqlite, db } = setupStorage();
  await ensureNoticePdfTables(db);
  const bucket = new MemoryBucket();
  const bytes = pdfBytes(64);
  const item = metadata('live-note', 'live-pdf', bytes.byteLength);
  await stageNoticePdfUpload(db, bucket as unknown as R2Bucket, item, bytes.buffer);
  sqlite.prepare("INSERT INTO admin_notes (id, category) VALUES (?, 'notice')").run(item.noteId);
  await noticePdfMetadataInsert(db, item).run();
  sqlite.prepare("UPDATE notice_pdf_cleanup_queue SET not_before = datetime('now', '-1 minute')").run();

  const retained = await cleanupNoticePdfObjects({ DB: db, ARTICLE_BUCKET: bucket as unknown as R2Bucket }, 10);
  assert.deepEqual({ retained: retained.retained, deleted: retained.deleted }, { retained: 1, deleted: 0 });
  assert.equal(bucket.objects.has(item.objectKey), true);

  await db.batch([
    noticePdfCleanupUpsert(db, item, 'notice_delete', 0),
    db.prepare('DELETE FROM notice_pdf_attachments WHERE id = ?').bind(item.id),
    db.prepare('DELETE FROM admin_notes WHERE id = ?').bind(item.noteId),
  ]);
  const deleted = await cleanupNoticePdfObjects({ DB: db, ARTICLE_BUCKET: bucket as unknown as R2Bucket }, 10);
  assert.equal(deleted.deleted, 1);
  assert.equal(bucket.objects.has(item.objectKey), false);
});

test('failed cleanup entries back off and cannot starve later healthy queue items', async () => {
  const { sqlite, db } = setupStorage();
  await ensureNoticePdfTables(db);
  const bucket = new MemoryBucket();
  const items = ['failed-a', 'failed-b', 'healthy'].map((id) => metadata(`${id}-note`, id, 64));
  for (const item of items) {
    bucket.objects.set(item.objectKey, pdfBytes(64).buffer);
    await noticePdfCleanupUpsert(db, item, 'notice_delete', 0).run();
  }
  bucket.failDeleteKeys.add(items[0].objectKey);
  bucket.failDeleteKeys.add(items[1].objectKey);

  const first = await cleanupNoticePdfObjects({ DB: db, ARTICLE_BUCKET: bucket as unknown as R2Bucket }, 2);
  assert.equal(first.failed, 2);
  const healthy = await cleanupNoticePdfObjects({ DB: db, ARTICLE_BUCKET: bucket as unknown as R2Bucket }, 1);
  assert.equal(healthy.deleted, 1);
  assert.equal(bucket.objects.has(items[2].objectKey), false);
  const failedRows = sqlite.prepare("SELECT attempts, not_before FROM notice_pdf_cleanup_queue WHERE object_key != ? ORDER BY object_key")
    .all(items[2].objectKey) as Array<{ attempts: number; not_before: string }>;
  assert.deepEqual(failedRows.map(row => row.attempts), [1, 1]);
});

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('hex');
}

async function setupRoute(visibility: string) {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE admin_notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
      author_id TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '', pinned INTEGER DEFAULT 0,
      source_type TEXT, source_id TEXT, is_anonymous INTEGER DEFAULT 0, visibility TEXT DEFAULT 'all',
      author_branch TEXT DEFAULT '', author_department TEXT DEFAULT '', category TEXT DEFAULT 'community',
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT, branch TEXT, department TEXT, team_id TEXT);
    CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE admin_note_attachments (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL, file_name TEXT NOT NULL,
      file_type TEXT, file_size INTEGER, file_data TEXT NOT NULL,
      FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
    );
    CREATE TABLE service_tokens (
      id TEXT PRIMARY KEY, name TEXT, token_hash TEXT, scope TEXT, expires_at TEXT, revoked_at TEXT,
      last_used_at TEXT, last_used_ip TEXT, updated_at TEXT
    );
  `);
  const db = d1FromSqlite(sqlite);
  await ensureNoticePdfTables(db);
  const token = 'notice-test-service-token';
  sqlite.prepare("INSERT INTO service_tokens (id, name, token_hash, scope) VALUES ('svc', 'test', ?, 'read')").run(await sha256(token));
  sqlite.prepare(`INSERT INTO admin_notes
    (id, title, content, author_id, author_name, visibility, author_branch, author_department, category)
    VALUES ('notice-route', 'title', 'body', 'author', 'Author', ?, '', '', 'notice')`).run(visibility);
  const bytes = pdfBytes(64);
  const item = metadata('notice-route', 'route-pdf', bytes.byteLength);
  sqlite.prepare(`INSERT INTO notice_pdf_attachments
    (id, note_id, object_key, file_name, file_size, sha256, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(item.id, item.noteId, item.objectKey, item.fileName, item.fileSize, item.sha256, item.uploadedBy);
  const bucket = new MemoryBucket();
  bucket.objects.set(item.objectKey, bytes.buffer);
  return { db, token, bucket, item };
}

test('notice PDF delivery authenticates and authorizes before any R2 read', async () => {
  const denied = await setupRoute('user:someone-else');
  const deniedResponse = await loadNoticePdfForDelivery(
    denied.db, denied.bucket as unknown as R2Bucket, denied.item.id, 'view', () => false,
  );
  assert.equal(deniedResponse.ok, false);
  if (!deniedResponse.ok) assert.equal(deniedResponse.status, 403);
  assert.equal(denied.bucket.getCalls, 0);

  const allowed = await setupRoute('all');
  const allowedResponse = await loadNoticePdfForDelivery(
    allowed.db, allowed.bucket as unknown as R2Bucket, allowed.item.id, 'view', () => true,
  );
  assert.equal(allowedResponse.ok, true);
  assert.equal(allowed.bucket.getCalls, 1);
  if (allowedResponse.ok) assert.equal(allowedResponse.headers['Content-Disposition'].startsWith('inline;'), true);
});

test('legacy D1 PDFs retain capped preview and uncapped authenticated download', async () => {
  const legacy = await setupRoute('all');
  const bytes = pdfBytes(10 * 1024 * 1024 + 1);
  legacy.db.prepare(`INSERT INTO admin_note_attachments
    (id, note_id, file_name, file_type, file_size, file_data)
    VALUES ('legacy-pdf', 'notice-route', 'legacy.pdf', 'application/pdf', ?, ?)`)
    .bind(bytes.byteLength, pdfDataUrl(bytes)).run();

  const preview = await loadNoticePdfForDelivery(
    legacy.db, legacy.bucket as unknown as R2Bucket, 'legacy-pdf', 'view', () => true,
  );
  assert.equal(preview.ok, false);
  if (!preview.ok) assert.equal(preview.status, 413);

  const download = await loadNoticePdfForDelivery(
    legacy.db, legacy.bucket as unknown as R2Bucket, 'legacy-pdf', 'download', () => true,
  );
  assert.equal(download.ok, true);
  if (download.ok) {
    assert.equal(download.storage, 'd1');
    assert.equal(download.body.byteLength, bytes.byteLength);
    assert.equal(download.headers['Content-Disposition'].startsWith('attachment;'), true);
  }
});

test('notice PDF forward migration is idempotent and bounded cleanup is wired to the daily cron', () => {
  const sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE admin_notes (id TEXT PRIMARY KEY)');
  const migration = readFileSync(new URL('../d1/migrate-notice-pdf-r2.sql', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../d1/schema.sql', import.meta.url), 'utf8');
  sqlite.exec(migration);
  sqlite.exec(migration);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('notice_pdf_attachments', 'notice_pdf_cleanup_queue')").get().count, 2);

  const worker = readFileSync(new URL('../src/worker/index.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/worker/routes/admin-notes.ts', import.meta.url), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS notice_pdf_attachments/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS notice_pdf_cleanup_queue/);
  assert.match(route, /await ensureNoticePdfTables\(db\)/);
  const dailyStart = worker.indexOf("cron === '0 15 * * *'");
  const nextBranch = worker.indexOf('} else if (cron ===', dailyStart + 1);
  const dailyBranch = worker.slice(dailyStart, nextBranch < 0 ? undefined : nextBranch);
  assert.match(dailyBranch, /cleanupNoticePdfObjects\(env, 100\)/);

  const createStart = route.indexOf("adminNotes.post('/', async (c) =>");
  const stage = route.indexOf('await stageNoticePdfUpload(', createStart);
  const createBatchStart = route.indexOf('await db.batch([', stage);
  const createBatchEnd = route.indexOf(']);', createBatchStart);
  const createBatch = route.slice(createBatchStart, createBatchEnd);
  assert.ok(createStart >= 0 && stage > createStart && createBatchStart > stage);
  const noticeStorageBranch = route.slice(route.lastIndexOf("if (category === 'notice')", stage), createBatchEnd);
  assert.match(noticeStorageBranch, /const buffer = file\.decoded_buffer/);
  assert.doesNotMatch(noticeStorageBranch, /decodeAttachmentDataUrl/);
  assert.match(createBatch, /adminNoteInsert/);
  assert.match(createBatch, /noticePostInsert/);
  assert.match(createBatch, /noticeAttachmentStatements/);
  assert.match(createBatch, /noticePdfCleanupDelete/);

  const deleteRouteStart = route.indexOf("adminNotes.delete('/:id'");
  const noticeDeleteStart = route.indexOf("if (note.category === 'notice')", deleteRouteStart);
  const deleteBatchStart = route.indexOf('await db.batch([', noticeDeleteStart);
  const deleteBatchEnd = route.indexOf(']);', deleteBatchStart);
  const deleteBatch = route.slice(deleteBatchStart, deleteBatchEnd);
  const bestEffortR2Delete = route.indexOf('await c.env.ARTICLE_BUCKET.delete(file.object_key)', deleteBatchEnd);
  assert.ok(deleteRouteStart >= 0 && noticeDeleteStart > deleteRouteStart && deleteBatchStart > noticeDeleteStart && bestEffortR2Delete > deleteBatchEnd);
  assert.match(deleteBatch, /noticePdfCleanupUpsert/);
  assert.match(deleteBatch, /DELETE FROM notice_pdf_attachments/);
  assert.match(deleteBatch, /DELETE FROM notice_posts/);
  assert.match(deleteBatch, /DELETE FROM admin_notes/);

  assert.match(route, /const noticePdfAttachments = await db\.prepare\([\s\S]*FROM notice_pdf_attachments/);
  assert.match(route, /const noticeR2Attachments = \(noticePdfAttachments\.results \|\| \[\]\)\.map/);
  assert.match(route, /attachments: \[\.\.\.inlineAttachments, \.\.\.noticeR2Attachments/);
});
