import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  EXPENSE_RECEIPT_TEMPLATE_ID,
  MAX_EXPENSE_RECEIPT_TOTAL_BYTES,
  acquireExpenseReceiptAttachmentMutationClaim,
  acquireExpenseReceiptDriveClaim,
  cleanupBackedUpExpenseReceipts,
  canEditExpenseReceipt,
  canReadExpenseReceipt,
  countActiveExpenseReceiptAttachments,
  deleteExpenseReceiptDocumentAndQueueArtifacts,
  ExpenseReceiptDocumentDeleteConflictError,
  ensureExpenseReceiptSchema,
  enqueueExpenseReceiptR2Cleanup,
  expenseReceiptImageDimensions,
  hasExpenseReceiptImageContainer,
  safeExpenseReceiptFileName,
  releaseExpenseReceiptDriveClaim,
  releaseExpenseReceiptAttachmentMutationClaim,
  retryExpenseReceiptR2Cleanup,
  sniffExpenseReceiptImage,
  storeExpenseReceiptPdfArtifact,
} from '../src/worker/lib/expense-receipts.ts';
import { cleanupOldDocuments } from '../src/worker/lib/document-retention.ts';
import { consumePrintRenderSession, issuePrintToken, verifyPrintToken } from '../src/worker/lib/print-render-session.ts';
import { driveFileStillExists } from '../src/worker/lib/drive-file-verification.ts';
import { validateExpenseReceiptPrintState } from '../src/worker/lib/expense-receipt-print-validation.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

class TestStatement {
  readonly database: Database.Database;
  readonly query: string;
  readonly params: unknown[];
  constructor(database: Database.Database, query: string, params: unknown[] = []) {
    this.database = database;
    this.query = query;
    this.params = params;
  }
  bind(...params: unknown[]) { return new TestStatement(this.database, this.query, params); }
  execute() {
    const result = this.database.prepare(this.query).run(...this.params as Database.BindParameters[]);
    return { meta: { changes: result.changes } };
  }
  async run() { return this.execute(); }
  async first<T>() { return (this.database.prepare(this.query).get(...this.params as Database.BindParameters[]) as T | undefined) || null; }
  async all<T>() { return { results: this.database.prepare(this.query).all(...this.params as Database.BindParameters[]) as T[] }; }
}

class TestD1 {
  readonly sqlite: Database.Database;
  constructor(sqlite = new Database(':memory:')) { this.sqlite = sqlite; }
  prepare(query: string) { return new TestStatement(this.sqlite, query); }
  async batch(statements: TestStatement[]) {
    return this.sqlite.transaction((items: TestStatement[]) => items.map((statement) => statement.execute()))(statements);
  }
}

function createReceiptDb() {
  const db = new TestD1();
  db.sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT, approved INTEGER, created_at TEXT);
    CREATE TABLE templates (id TEXT PRIMARY KEY, title TEXT, description TEXT, content TEXT, category TEXT,
      is_myauction INTEGER, created_by TEXT, is_active INTEGER, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT, content TEXT DEFAULT '{}', template_id TEXT,
      author_id TEXT, branch TEXT DEFAULT '', department TEXT DEFAULT '', status TEXT, cancelled INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE approval_steps (id TEXT PRIMARY KEY, document_id TEXT, status TEXT, signed_at TEXT);
    CREATE TABLE drive_backup_logs (id TEXT PRIMARY KEY, document_id TEXT, status TEXT, run_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), error_message TEXT);
    CREATE TABLE signatures (id TEXT PRIMARY KEY, document_id TEXT, user_id TEXT, signature_data TEXT);
    INSERT INTO users VALUES ('master-1', 'master', 1, '2020-01-01 00:00:00');
    INSERT INTO templates (id,title,description,content,category,is_myauction,created_by,is_active)
      VALUES ('tpl-exp-001','지출결의서','기존','<p>existing form</p>','경비/비용',1,'master-1',1);
  `);
  return db;
}

class BucketMock {
  objects = new Set<string>();
  deleted: string[] = [];
  failDelete = false;
  failPutAfterStore = false;
  async put(key: string) {
    this.objects.add(key);
    if (this.failPutAfterStore) throw new Error('R2 response lost after commit');
  }
  async delete(input: string | string[]) {
    if (this.failDelete) throw new Error('R2 unavailable');
    const keys = Array.isArray(input) ? input : [input];
    for (const key of keys) { this.deleted.push(key); this.objects.delete(key); }
  }
  async head(key: string) { return this.objects.has(key) ? { size: 1 } : null; }
}

test('versioned PDF replacement preserves the previous artifact when D1 swap fails', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status)
    VALUES (?,?,?,?,?)`).run('artifact-doc', 'artifact', EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'approved');
  db.sqlite.prepare(`INSERT INTO expense_receipt_pdf_artifacts
    (document_id,object_key,file_name,file_size,sha256,drive_file_id,drive_folder_path,drive_backed_up_at)
    VALUES (?,?,?,?,?,?,?,datetime('now'))`)
    .run('artifact-doc', 'pdf/old.pdf', 'old.pdf', 3, 'old-sha', 'drive-old', '/');
  const bucket = new BucketMock();
  bucket.objects.add('pdf/old.pdf');
  bucket.failDelete = true;
  const originalPrepare = db.prepare.bind(db);
  const failingStatement = {
    bind() { return this; },
    async run() { throw new Error('D1 swap failed'); },
  };
  db.prepare = ((query: string) => query.includes('INSERT INTO expense_receipt_pdf_artifacts')
    ? failingStatement as never
    : originalPrepare(query)) as typeof db.prepare;
  await assert.rejects(() => storeExpenseReceiptPdfArtifact(
    { DB: db as never, ARTICLE_BUCKET: bucket as never },
    'artifact-doc',
    new Uint8Array([1, 2, 3, 4]).buffer,
    { fileId: 'drive-new', folderPath: '/', fileName: 'new.pdf' },
  ), /D1 swap failed/);
  db.prepare = originalPrepare;
  assert.equal(bucket.objects.has('pdf/old.pdf'), true);
  const queued = db.sqlite.prepare(`SELECT object_key, reason FROM expense_receipt_r2_cleanup_queue`)
    .get() as { object_key: string; reason: string };
  assert.notEqual(queued.object_key, 'pdf/old.pdf');
  assert.equal(queued.reason, 'pdf-artifact-upsert-rollback');
  const row = db.sqlite.prepare('SELECT object_key,drive_file_id FROM expense_receipt_pdf_artifacts WHERE document_id=?')
    .get('artifact-doc') as Record<string, unknown>;
  assert.equal(row.object_key, 'pdf/old.pdf');
  assert.equal(row.drive_file_id, 'drive-old');
  bucket.failDelete = false;
  const cleanup = await retryExpenseReceiptR2Cleanup(
    { DB: db as never, ARTICLE_BUCKET: bucket as never },
  );
  assert.deepEqual(cleanup, { scanned: 1, deleted: 1, active_references: 0, failed: 0 });
  assert.deepEqual([...bucket.objects], ['pdf/old.pdf']);
});

test('a committed PDF swap with a lost D1 response never deletes the authoritative object', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status)
    VALUES (?,?,?,?,?)`).run('ambiguous-pdf', 'artifact', EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'approved');
  db.sqlite.prepare(`INSERT INTO expense_receipt_pdf_artifacts
    (document_id,object_key,file_name,file_size,sha256,drive_file_id,drive_folder_path,drive_backed_up_at)
    VALUES (?,?,?,?,?,?,?,datetime('now'))`)
    .run('ambiguous-pdf', 'pdf/ambiguous-old.pdf', 'old.pdf', 3, 'old-sha', 'drive-old', '/');
  const bucket = new BucketMock();
  bucket.objects.add('pdf/ambiguous-old.pdf');
  const originalPrepare = db.prepare.bind(db);
  db.prepare = ((query: string) => {
    const statement = originalPrepare(query);
    if (!query.includes('INSERT INTO expense_receipt_pdf_artifacts')) return statement;
    return {
      bind(...params: unknown[]) {
        const bound = statement.bind(...params);
        return {
          async run() {
            await bound.run();
            throw new Error('D1 response lost after commit');
          },
        };
      },
    } as never;
  }) as typeof db.prepare;
  await assert.rejects(() => storeExpenseReceiptPdfArtifact(
    { DB: db as never, ARTICLE_BUCKET: bucket as never },
    'ambiguous-pdf',
    new Uint8Array([9, 8, 7, 6]).buffer,
    { fileId: 'drive-ambiguous', folderPath: '/', fileName: 'ambiguous.pdf' },
  ), /response lost/);
  db.prepare = originalPrepare;
  const artifact = db.sqlite.prepare(`SELECT object_key FROM expense_receipt_pdf_artifacts WHERE document_id=?`)
    .get('ambiguous-pdf') as { object_key: string };
  assert.equal(bucket.objects.has(artifact.object_key), true);
  assert.equal(bucket.objects.has('pdf/ambiguous-old.pdf'), false);
  assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM expense_receipt_r2_cleanup_queue`).get().count, 0);
});

test('a committed R2 PDF upload with a lost response is durably compensated', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status)
    VALUES (?,?,?,?,?)`).run('ambiguous-r2-put', 'artifact', EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'approved');
  const bucket = new BucketMock();
  bucket.failPutAfterStore = true;
  await assert.rejects(() => storeExpenseReceiptPdfArtifact(
    { DB: db as never, ARTICLE_BUCKET: bucket as never },
    'ambiguous-r2-put',
    new Uint8Array([4, 3, 2, 1]).buffer,
    { fileId: 'drive-r2-ambiguous', folderPath: '/', fileName: 'ambiguous.pdf' },
  ), /R2 response lost/);
  assert.equal(bucket.objects.size, 0);
  assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM expense_receipt_r2_cleanup_queue`).get().count, 0);
  assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM expense_receipt_pdf_artifacts
    WHERE document_id='ambiguous-r2-put'`).get().count, 0);
});

test('superseded PDF cleanup is durable and the retry never deletes a live key', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status)
    VALUES (?,?,?,?,?)`).run('replace-doc', 'replace', EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'approved');
  db.sqlite.prepare(`INSERT INTO expense_receipt_pdf_artifacts
    (document_id,object_key,file_name,file_size,sha256,drive_file_id,drive_folder_path,drive_backed_up_at)
    VALUES (?,?,?,?,?,?,?,datetime('now'))`)
    .run('replace-doc', 'pdf/previous.pdf', 'old.pdf', 3, 'old-sha', 'drive-old', '/');
  const bucket = new BucketMock();
  bucket.objects.add('pdf/previous.pdf');
  bucket.failDelete = true;
  const stored = await storeExpenseReceiptPdfArtifact(
    { DB: db as never, ARTICLE_BUCKET: bucket as never },
    'replace-doc',
    new Uint8Array([5, 6, 7, 8]).buffer,
    { fileId: 'drive-new', folderPath: '/', fileName: 'new.pdf' },
  );
  const queuedOld = db.sqlite.prepare(`SELECT reason FROM expense_receipt_r2_cleanup_queue WHERE object_key=?`)
    .get('pdf/previous.pdf') as { reason: string };
  assert.equal(queuedOld.reason, 'superseded-pdf-artifact');
  await enqueueExpenseReceiptR2Cleanup(db as never, [stored.objectKey], 'ambiguous-live-key', 'replace-doc');
  const failedCleanup = await retryExpenseReceiptR2Cleanup(
    { DB: db as never, ARTICLE_BUCKET: bucket as never },
  );
  assert.deepEqual(failedCleanup, { scanned: 2, deleted: 0, active_references: 1, failed: 1 });
  const attempt = db.sqlite.prepare(`SELECT attempt_count, last_error
    FROM expense_receipt_r2_cleanup_queue WHERE object_key=?`).get('pdf/previous.pdf') as {
      attempt_count: number; last_error: string;
    };
  assert.equal(attempt.attempt_count, 2);
  assert.match(attempt.last_error, /R2 unavailable/);
  bucket.failDelete = false;
  const cleanup = await retryExpenseReceiptR2Cleanup(
    { DB: db as never, ARTICLE_BUCKET: bucket as never },
  );
  assert.deepEqual(cleanup, { scanned: 1, deleted: 1, active_references: 0, failed: 0 });
  assert.equal(bucket.objects.has('pdf/previous.pdf'), false);
  assert.equal(bucket.objects.has(stored.objectKey), true);
  const remaining = db.sqlite.prepare('SELECT COUNT(*) AS count FROM expense_receipt_r2_cleanup_queue')
    .get() as { count: number };
  assert.equal(remaining.count, 0);
});

test('stored PDF artifact binds the Drive MD5 fingerprint to the site SHA-256 copy', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status)
    VALUES (?,?,?,?,?)`).run('fingerprint-doc', 'fingerprint', EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'approved');
  const bucket = new BucketMock();
  const pdf = new Uint8Array([10, 20, 30, 40]).buffer;
  const stored = await storeExpenseReceiptPdfArtifact(
    { DB: db as never, ARTICLE_BUCKET: bucket as never },
    'fingerprint-doc',
    pdf,
    { fileId: 'drive-fingerprint', folderPath: '/', fileName: 'receipt.pdf', md5Checksum: 'AABBCCDD' },
  );
  const row = db.sqlite.prepare(`SELECT drive_file_id, drive_md5_checksum, sha256
    FROM expense_receipt_pdf_artifacts WHERE document_id=?`).get('fingerprint-doc') as Record<string, unknown>;
  assert.equal(row.drive_file_id, 'drive-fingerprint');
  assert.equal(row.drive_md5_checksum, 'aabbccdd');
  assert.equal(row.sha256, stored.sha256);
  assert.equal(bucket.objects.has(stored.objectKey), true);
});

test('Drive backup claim allows only one uploader and reclaims an expired lease', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status,cancelled)
    VALUES (?,?,?,?,?,0)`).run('claim-doc', 'claim', EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'approved');
  const [first, concurrent] = await Promise.all([
    acquireExpenseReceiptDriveClaim(db as never, 'claim-doc'),
    acquireExpenseReceiptDriveClaim(db as never, 'claim-doc'),
  ]);
  assert.ok(first || concurrent);
  assert.equal([first, concurrent].filter(Boolean).length, 1);
  const winningToken = String(first || concurrent);
  assert.equal(await acquireExpenseReceiptDriveClaim(db as never, 'claim-doc'), null);
  await releaseExpenseReceiptDriveClaim(db as never, 'claim-doc', winningToken);
  const afterRelease = await acquireExpenseReceiptDriveClaim(db as never, 'claim-doc');
  assert.ok(afterRelease);
  db.sqlite.prepare("UPDATE expense_receipt_drive_claims SET expires_at=datetime('now','-1 minute') WHERE document_id=?")
    .run('claim-doc');
  const afterExpiry = await acquireExpenseReceiptDriveClaim(db as never, 'claim-doc');
  assert.ok(afterExpiry);
  assert.notEqual(afterExpiry, afterRelease);
});

test('attachment mutation claim serializes uploads and excludes submit, sign, and document delete claims', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status)
    VALUES (?,?,?,?,?)`).run('attachment-claim-doc', 'claim', EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'draft');

  const claims = await Promise.all(Array.from({ length: 4 }, () =>
    acquireExpenseReceiptAttachmentMutationClaim(db as never, 'attachment-claim-doc')));
  const winners = claims.filter((claim): claim is string => !!claim);
  assert.equal(winners.length, 1);
  assert.match(winners[0], /^attachment:/);
  assert.equal(await acquireExpenseReceiptAttachmentMutationClaim(db as never, 'attachment-claim-doc'), null);

  db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'claim-a1', 'attachment-claim-doc', 'r2/claim-a1', 'a.jpg', 'image/jpeg', 10, 10, 10, 'claim-sha-a', 0,
    );
  await releaseExpenseReceiptAttachmentMutationClaim(db as never, 'attachment-claim-doc', winners[0]);

  for (const foreignClaim of ['submit:pending', 'sign:pending', 'delete:pending']) {
    db.sqlite.prepare(`INSERT INTO expense_receipt_submission_claims (document_id,claim_token)
      VALUES (?,?)`).run('attachment-claim-doc', foreignClaim);
    assert.throws(() => db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
      (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        `blocked-${foreignClaim}`, 'attachment-claim-doc', `r2/${foreignClaim}`, 'b.jpg',
        'image/jpeg', 10, 10, 10, `sha-${foreignClaim}`, 1,
      ), /not editable/i);
    assert.throws(() => db.sqlite.prepare(`UPDATE expense_receipt_attachments
      SET sort_order=1 WHERE id='claim-a1'`).run(), /not editable/i);
    assert.throws(() => db.sqlite.prepare(`UPDATE expense_receipt_attachments
      SET deleted_at=datetime('now') WHERE id='claim-a1'`).run(), /not editable/i);
    db.sqlite.prepare(`DELETE FROM expense_receipt_submission_claims
      WHERE document_id=?`).run('attachment-claim-doc');
  }

  db.sqlite.prepare(`INSERT INTO expense_receipt_submission_claims
    (document_id,claim_token,created_at) VALUES (?,?,'2020-01-01 00:00:00')`)
    .run('attachment-claim-doc', 'sign:stale');
  const reclaimed = await acquireExpenseReceiptAttachmentMutationClaim(db as never, 'attachment-claim-doc');
  assert.ok(reclaimed);
  assert.notEqual(reclaimed, 'sign:stale');
  await releaseExpenseReceiptAttachmentMutationClaim(db as never, 'attachment-claim-doc', reclaimed!);
});

test('attachment aggregate invariants also guard tombstone rollback and metadata updates', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  const addDocument = (id: string) => db.sqlite.prepare(`INSERT INTO documents
    (id,title,template_id,author_id,status) VALUES (?,?,?,?,?)`)
    .run(id, id, EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'draft');

  addDocument('reactivate-count');
  db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order,deleted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
      'count-hidden', 'reactivate-count', 'r2/count-hidden', 'hidden.jpg', 'image/jpeg', 1, 1, 1, 'count-hidden', 99,
    );
  for (let index = 0; index < 10; index += 1) {
    db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
      (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        `count-${index}`, 'reactivate-count', `r2/count-${index}`, `${index}.jpg`,
        'image/jpeg', 1, 1, 1, `count-sha-${index}`, index,
      );
  }
  assert.throws(() => db.sqlite.prepare(`UPDATE expense_receipt_attachments
    SET deleted_at=NULL WHERE id='count-hidden'`).run(), /count limit/i);

  addDocument('reactivate-bytes');
  db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order,deleted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
      'bytes-hidden', 'reactivate-bytes', 'r2/bytes-hidden', 'hidden.jpg', 'image/jpeg', 1, 1, 1, 'bytes-hidden', 1,
    );
  db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'bytes-active', 'reactivate-bytes', 'r2/bytes-active', 'active.jpg', 'image/jpeg',
      MAX_EXPENSE_RECEIPT_TOTAL_BYTES, 1, 1, 'bytes-active', 0,
    );
  assert.throws(() => db.sqlite.prepare(`UPDATE expense_receipt_attachments
    SET deleted_at=NULL WHERE id='bytes-hidden'`).run(), /byte limit/i);
  assert.throws(() => db.sqlite.prepare(`UPDATE expense_receipt_attachments
    SET file_size=? WHERE id='bytes-active'`).run(MAX_EXPENSE_RECEIPT_TOTAL_BYTES + 1), /byte limit/i);

  addDocument('reactivate-pixels');
  db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order,deleted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
      'pixels-hidden', 'reactivate-pixels', 'r2/pixels-hidden', 'hidden.jpg', 'image/jpeg', 1, 1, 1, 'pixels-hidden', 1,
    );
  db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'pixels-active', 'reactivate-pixels', 'r2/pixels-active', 'active.jpg', 'image/jpeg',
      1, 10_000, 6_000, 'pixels-active', 0,
    );
  assert.throws(() => db.sqlite.prepare(`UPDATE expense_receipt_attachments
    SET deleted_at=NULL WHERE id='pixels-hidden'`).run(), /pixel limit/i);
  assert.throws(() => db.sqlite.prepare(`UPDATE expense_receipt_attachments
    SET image_width=10001 WHERE id='pixels-active'`).run(), /pixel limit/i);
});

test('receipt PDF validation rejects loading screens and mismatched print metadata', () => {
  const valid = {
    ready: true,
    error: null,
    meta: {
      documentId: 'print-doc',
      templateId: EXPENSE_RECEIPT_TEMPLATE_ID,
      attachmentCount: 2,
    },
    receiptImageCount: 2,
    loadedReceiptImageCount: 2,
  };
  assert.doesNotThrow(() => validateExpenseReceiptPrintState('print-doc', 2, valid));
  assert.throws(() => validateExpenseReceiptPrintState('print-doc', 2, { ...valid, ready: false }), /준비 시간이 초과/);
  assert.throws(() => validateExpenseReceiptPrintState('print-doc', 2, {
    ...valid,
    meta: { ...valid.meta, documentId: 'other-doc' },
  }), /문서 ID/);
  assert.throws(() => validateExpenseReceiptPrintState('print-doc', 2, {
    ...valid,
    meta: { ...valid.meta, attachmentCount: 1 },
  }), /첨부 수/);
  assert.throws(() => validateExpenseReceiptPrintState('print-doc', 2, {
    ...valid,
    loadedReceiptImageCount: 1,
  }), /모두 로드되지 않아/);
  assert.throws(() => validateExpenseReceiptPrintState('print-doc', 0, valid), /영수증 원본이 없어/);
});

test('migration is executable and idempotently clones the existing expense template', () => {
  const db = createReceiptDb();
  const migration = source('d1/migrate-expense-receipts.sql');
  db.sqlite.exec(migration);
  db.sqlite.exec(migration);
  const template = db.sqlite.prepare('SELECT * FROM templates WHERE id=?').get(EXPENSE_RECEIPT_TEMPLATE_ID) as Record<string, unknown>;
  assert.equal(template.title, '영수증 첨부 지출결의서');
  assert.equal(template.content, '<p>existing form</p>');
  assert.equal(template.category, '경비/비용');
  assert.equal(template.is_myauction, 1);
  assert.equal(template.is_active, 1);
  assert.ok((db.sqlite.prepare('PRAGMA table_info(expense_receipt_pdf_artifacts)').all() as Array<{ name: string }>)
    .some((column) => column.name === 'drive_md5_checksum'));
  assert.ok(db.sqlite.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND name='expense_receipt_r2_cleanup_queue'`).get());
  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status)
    VALUES ('doc-x','x',?,'master-1','draft')`).run(EXPENSE_RECEIPT_TEMPLATE_ID);
  db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES ('a1','doc-x','k1','a.jpg','image/jpeg',10,1,1,'same',0)`).run();
  assert.throws(() => db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES ('a2','doc-x','k2','b.jpg','image/jpeg',10,1,1,'same',1)`).run(), /FOREIGN KEY|UNIQUE|constraint/i);
  db.sqlite.prepare("UPDATE documents SET status='submitted' WHERE id='doc-x'").run();
  assert.throws(() => db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES ('a3','doc-x','k3','c.jpg','image/jpeg',10,1,1,'new-sha',1)`).run(), /not editable/i);
  assert.throws(() => db.sqlite.prepare("UPDATE expense_receipt_attachments SET sort_order=2 WHERE id='a1'").run(), /not editable/i);
  assert.throws(() => db.sqlite.prepare("UPDATE expense_receipt_attachments SET deleted_at=datetime('now') WHERE id='a1'").run(), /not editable/i);
});

test('runtime schema enforces active SHA/count and preserves receipt metadata', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  assert.ok((db.sqlite.prepare('PRAGMA table_info(expense_receipt_pdf_artifacts)').all() as Array<{ name: string }>)
    .some((column) => column.name === 'drive_md5_checksum'));
  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status) VALUES (?,?,?,?,?)`)
    .run('doc-1', 'receipt', EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'draft');
  db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('a1', 'doc-1', 'r2/a1', 'a.jpg', 'image/jpeg', 10, 10, 10, 'sha-a', 0);
  assert.equal(await countActiveExpenseReceiptAttachments(db as never, 'doc-1'), 1);
  assert.equal(db.sqlite.prepare('SELECT revision FROM expense_receipt_document_revisions WHERE document_id=?').get('doc-1').revision, 1);
  assert.throws(() => db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('a2', 'doc-1', 'r2/a2', 'b.jpg', 'image/jpeg', 10, 10, 10, 'sha-a', 1), /UNIQUE/i);
  db.sqlite.prepare("UPDATE expense_receipt_attachments SET file_name='renamed.jpg' WHERE id='a1'").run();
  db.sqlite.prepare("UPDATE expense_receipt_attachments SET sort_order=2 WHERE id='a1'").run();
  assert.equal(db.sqlite.prepare('SELECT revision FROM expense_receipt_document_revisions WHERE document_id=?').get('doc-1').revision, 3);
  db.sqlite.prepare("UPDATE documents SET status='submitted' WHERE id='doc-1'").run();
  assert.throws(() => db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('a3', 'doc-1', 'r2/a3', 'c.jpg', 'image/jpeg', 10, 10, 10, 'sha-c', 1), /not editable/i);
  assert.throws(() => db.sqlite.prepare("UPDATE expense_receipt_attachments SET sort_order=3 WHERE id='a1'").run(), /not editable/i);
  assert.throws(() => db.sqlite.prepare("UPDATE expense_receipt_attachments SET deleted_at=datetime('now') WHERE id='a1'").run(), /not editable/i);
  assert.equal(db.sqlite.prepare('SELECT revision FROM expense_receipt_document_revisions WHERE document_id=?').get('doc-1').revision, 3);

  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status) VALUES (?,?,?,?,?)`)
    .run('cascade-doc', 'cascade', EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'draft');
  db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('cascade-a', 'cascade-doc', 'r2/cascade', 'c.jpg', 'image/jpeg', 10, 10, 10, 'sha-cascade', 0);
  db.sqlite.prepare("DELETE FROM expense_receipt_attachments WHERE id='cascade-a'").run();
  assert.equal(db.sqlite.prepare('SELECT revision FROM expense_receipt_document_revisions WHERE document_id=?').get('cascade-doc').revision, 2);
  db.sqlite.prepare("DELETE FROM documents WHERE id='cascade-doc'").run();
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM expense_receipt_document_revisions WHERE document_id=?').get('cascade-doc').count, 0);

  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status) VALUES (?,?,?,?,?)`)
    .run('pixel-doc', 'pixels', EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'draft');
  db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('pixel-a', 'pixel-doc', 'r2/pixel-a', 'a.jpg', 'image/jpeg', 10, 8000, 5000, 'pixel-a', 0);
  assert.throws(() => db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('pixel-b', 'pixel-doc', 'r2/pixel-b', 'b.jpg', 'image/jpeg', 10, 5000, 5000, 'pixel-b', 1), /pixel limit/i);
});

test('runtime schema backfills the Drive fingerprint column on an older receipt table', async () => {
  const db = createReceiptDb();
  db.sqlite.exec(`CREATE TABLE expense_receipt_pdf_artifacts (
    document_id TEXT PRIMARY KEY, object_key TEXT UNIQUE, file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL DEFAULT '',
    drive_file_id TEXT NOT NULL DEFAULT '', drive_folder_path TEXT NOT NULL DEFAULT '',
    drive_backed_up_at TEXT, purged_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await ensureExpenseReceiptSchema(db as never);
  const columns = db.sqlite.prepare('PRAGMA table_info(expense_receipt_pdf_artifacts)').all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === 'drive_md5_checksum'));
});

test('image magic, dimensions and safe names reject disguised or explosive inputs', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(png.buffer).setUint32(16, 1920, false);
  new DataView(png.buffer).setUint32(20, 1080, false);
  assert.equal(sniffExpenseReceiptImage(png), 'image/png');
  assert.deepEqual(expenseReceiptImageDimensions(png, 'image/png'), { width: 1920, height: 1080 });
  assert.equal(hasExpenseReceiptImageContainer(png, 'image/png'), false);
  const completePng = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ));
  assert.equal(hasExpenseReceiptImageContainer(completePng, 'image/png'), true);
  const corruptPng = completePng.slice();
  corruptPng[corruptPng.length - 8] ^= 0x01;
  assert.equal(hasExpenseReceiptImageContainer(corruptPng, 'image/png'), false);
  assert.equal(sniffExpenseReceiptImage(new TextEncoder().encode('not an image')), null);
  assert.equal(safeExpenseReceiptFileName('../bad:name?.png'), '.._bad_name_.png');
});

test('30-day purge starts at approval and accepts a newly completed verified Drive backup', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  const bucket = new BucketMock();
  const add = (id: string, driveStatus: string, backedUpAt: string, approvedAt = '2020-01-01 00:00:00') => {
    db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status,cancelled,updated_at)
      VALUES (?,?,?,?, 'draft',0,'2020-01-01 00:00:00')`).run(id, id, EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1');
    db.sqlite.prepare(`INSERT INTO approval_steps VALUES (?,?, 'approved',?)`).run(`step-${id}`, id, approvedAt);
    db.sqlite.prepare(`INSERT INTO drive_backup_logs (id,document_id,status,run_at) VALUES (?,?,?,'2020-01-02 00:00:00')`).run(`log-${id}`, id, driveStatus);
    db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
      (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
      VALUES (?,?,?,?,?,10,10,10,?,0)`).run(`att-${id}`, id, `receipt/${id}`, 'a.jpg', 'image/jpeg', `sha-${id}`);
    db.sqlite.prepare(`INSERT INTO expense_receipt_pdf_artifacts
      (document_id,object_key,file_name,file_size,sha256,drive_file_id,drive_folder_path,drive_backed_up_at)
      VALUES (?,?,?,100,?,?,?,?)`).run(id, `pdf/${id}`, `${id}.pdf`, `pdfsha-${id}`, `drive-${id}`, '/', backedUpAt);
    db.sqlite.prepare("UPDATE documents SET status='approved' WHERE id=?").run(id);
    bucket.objects.add(`receipt/${id}`); bucket.objects.add(`pdf/${id}`);
  };
  add('eligible', 'success', '2020-01-02 00:00:00');
  add('delayed-backup', 'success', new Date().toISOString().slice(0, 19).replace('T', ' '));
  add('drive-failed', 'failed', '2020-01-02 00:00:00');
  add(
    'too-recent-approval',
    'success',
    '2020-01-02 00:00:00',
    new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 19).replace('T', ' '),
  );
  const result = await cleanupBackedUpExpenseReceipts(
    { DB: db as never, ARTICLE_BUCKET: bucket as never },
    20,
    async () => true,
  );
  assert.equal(result.purged_documents, 2);
  assert.equal(bucket.objects.has('receipt/eligible'), false);
  assert.equal(bucket.objects.has('pdf/eligible'), false);
  assert.equal(bucket.objects.has('receipt/delayed-backup'), false);
  assert.equal(bucket.objects.has('pdf/delayed-backup'), false);
  assert.equal(bucket.objects.has('receipt/drive-failed'), true);
  assert.equal(bucket.objects.has('receipt/too-recent-approval'), true);
  const keptMetadata = db.sqlite.prepare('SELECT object_key,purged_at FROM expense_receipt_pdf_artifacts WHERE document_id=?').get('eligible') as Record<string, unknown>;
  assert.equal(keptMetadata.object_key, null);
  assert.ok(keptMetadata.purged_at);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM documents WHERE id=?').get('eligible').count, 1);
});

test('retention shares the Drive lease and cannot purge during render or resend', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  db.sqlite.exec(`
    INSERT INTO documents (id,title,template_id,author_id,status,cancelled,updated_at)
      VALUES ('leased-retention','r','${EXPENSE_RECEIPT_TEMPLATE_ID}','master-1','draft',0,'2020-01-01 00:00:00');
    INSERT INTO approval_steps VALUES ('s-leased','leased-retention','approved','2020-01-01 00:00:00');
    INSERT INTO drive_backup_logs (id,document_id,status,run_at)
      VALUES ('l-leased','leased-retention','success','2020-01-01 00:00:00');
    INSERT INTO expense_receipt_attachments
      (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
      VALUES ('a-leased','leased-retention','receipt/leased','a.jpg','image/jpeg',10,10,10,'leased-sha',0);
    INSERT INTO expense_receipt_pdf_artifacts
      (document_id,object_key,file_name,file_size,sha256,drive_file_id,drive_folder_path,drive_backed_up_at)
      VALUES ('leased-retention','pdf/leased','r.pdf',100,'pdf-leased','drive-leased','/','2020-01-01 00:00:00');
    UPDATE documents SET status='approved' WHERE id='leased-retention';
  `);
  const bucket = new BucketMock();
  bucket.objects.add('receipt/leased');
  bucket.objects.add('pdf/leased');
  const activeClaim = await acquireExpenseReceiptDriveClaim(db as never, 'leased-retention');
  assert.ok(activeClaim);
  const env = { DB: db as never, ARTICLE_BUCKET: bucket as never };
  const whileLocked = await cleanupBackedUpExpenseReceipts(env, 10, async () => true);
  assert.equal(whileLocked.purged_documents, 0);
  assert.equal(bucket.objects.has('receipt/leased'), true);
  await releaseExpenseReceiptDriveClaim(db as never, 'leased-retention', activeClaim!);
  const afterRelease = await cleanupBackedUpExpenseReceipts(env, 10, async () => true);
  assert.equal(afterRelease.purged_documents, 1);
  assert.equal(bucket.objects.has('receipt/leased'), false);
});

test('R2 purge failure restores tombstones and never purges Drive-failed records', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  const bucket = new BucketMock();
  bucket.failDelete = true;
  db.sqlite.exec(`
    INSERT INTO documents (id,title,template_id,author_id,status,cancelled,updated_at)
      VALUES ('restore','r','${EXPENSE_RECEIPT_TEMPLATE_ID}','master-1','draft',0,'2020-01-01 00:00:00');
    INSERT INTO approval_steps VALUES ('s-restore','restore','approved','2020-01-01 00:00:00');
    INSERT INTO drive_backup_logs (id,document_id,status,run_at) VALUES ('l-restore','restore','success','2020-01-01 00:00:00');
    INSERT INTO expense_receipt_attachments
      (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
      VALUES ('a-restore','restore','receipt/restore','a.jpg','image/jpeg',10,10,10,'restore-sha',0);
    INSERT INTO expense_receipt_pdf_artifacts
      (document_id,object_key,file_name,file_size,sha256,drive_file_id,drive_folder_path,drive_backed_up_at)
      VALUES ('restore','pdf/restore','r.pdf',100,'pdf-r','drive-r','/','2020-01-01 00:00:00');
    UPDATE documents SET status='approved' WHERE id='restore';
  `);
  const originalConsoleError = console.error;
  console.error = () => undefined;
  let result;
  try {
    result = await cleanupBackedUpExpenseReceipts(
      { DB: db as never, ARTICLE_BUCKET: bucket as never },
      10,
      async () => true,
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(result.failed_documents, 1);
  const attachment = db.sqlite.prepare('SELECT deleted_at,purged_at,object_key FROM expense_receipt_attachments WHERE id=?').get('a-restore') as Record<string, unknown>;
  const artifact = db.sqlite.prepare('SELECT purged_at,object_key FROM expense_receipt_pdf_artifacts WHERE document_id=?').get('restore') as Record<string, unknown>;
  assert.equal(attachment.purged_at, null);
  assert.equal(attachment.object_key, 'receipt/restore');
  assert.equal(artifact.purged_at, null);
  assert.equal(artifact.object_key, 'pdf/restore');
});

test('30-day purge fails closed for missing, trashed, or unverifiable Drive files', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  const bucket = new BucketMock();
  for (const id of ['missing', 'trashed', 'api-error']) {
    db.sqlite.prepare(`INSERT INTO documents
      (id,title,template_id,author_id,status,cancelled,updated_at)
      VALUES (?,?,?,?, 'draft',0,'2020-01-01 00:00:00')`)
      .run(id, id, EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1');
    db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
      (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
      VALUES (?,?,?,?,?,10,10,10,?,0)`)
      .run(`att-${id}`, id, `receipt/${id}`, 'a.jpg', 'image/jpeg', `sha-${id}`);
    db.sqlite.prepare("UPDATE documents SET status='approved' WHERE id=?").run(id);
    db.sqlite.prepare(`INSERT INTO approval_steps VALUES (?,?, 'approved','2020-01-01 00:00:00')`)
      .run(`step-${id}`, id);
    db.sqlite.prepare(`INSERT INTO drive_backup_logs (id,document_id,status,run_at)
      VALUES (?,?,'success','2020-01-01 00:00:00')`).run(`log-${id}`, id);
    db.sqlite.prepare(`INSERT INTO expense_receipt_pdf_artifacts
      (document_id,object_key,file_name,file_size,sha256,drive_file_id,drive_folder_path,drive_backed_up_at)
      VALUES (?,?,?,100,?,?,?,'2020-01-01 00:00:00')`)
      .run(id, `pdf/${id}`, `${id}.pdf`, `pdfsha-${id}`, `drive-${id}`, '/');
    bucket.objects.add(`receipt/${id}`);
    bucket.objects.add(`pdf/${id}`);
  }
  const originalConsoleError = console.error;
  console.error = () => undefined;
  let result;
  try {
    result = await cleanupBackedUpExpenseReceipts(
      { DB: db as never, ARTICLE_BUCKET: bucket as never },
      10,
      async (fileId) => {
        if (fileId === 'drive-api-error') throw new Error('Drive unavailable');
        return false;
      },
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(result.eligible, 3);
  assert.equal(result.drive_unverified, 3);
  assert.equal(result.purged_documents, 0);
  for (const id of ['missing', 'trashed', 'api-error']) {
    assert.equal(bucket.objects.has(`receipt/${id}`), true);
    assert.equal(bucket.objects.has(`pdf/${id}`), true);
  }
});

test('retention attempts rotate unverified rows so they cannot starve later valid receipts', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  const bucket = new BucketMock();
  for (const id of ['a-unverified', 'b-unverified', 'z-valid']) {
    db.sqlite.prepare(`INSERT INTO documents
      (id,title,template_id,author_id,status,cancelled,updated_at)
      VALUES (?,?,?,?, 'draft',0,'2020-01-01 00:00:00')`)
      .run(id, id, EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1');
    db.sqlite.prepare(`INSERT INTO expense_receipt_attachments
      (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
      VALUES (?,?,?,?,?,10,10,10,?,0)`)
      .run(`att-${id}`, id, `receipt/${id}`, 'a.jpg', 'image/jpeg', `sha-${id}`);
    db.sqlite.prepare("UPDATE documents SET status='approved' WHERE id=?").run(id);
    db.sqlite.prepare(`INSERT INTO approval_steps VALUES (?,?, 'approved','2020-01-01 00:00:00')`)
      .run(`step-${id}`, id);
    db.sqlite.prepare(`INSERT INTO drive_backup_logs (id,document_id,status,run_at)
      VALUES (?,?,'success','2020-01-01 00:00:00')`).run(`log-${id}`, id);
    db.sqlite.prepare(`INSERT INTO expense_receipt_pdf_artifacts
      (document_id,object_key,file_name,file_size,sha256,drive_file_id,drive_folder_path,drive_backed_up_at)
      VALUES (?,?,?,100,?,?,?,'2020-01-01 00:00:00')`)
      .run(id, `pdf/${id}`, `${id}.pdf`, `pdfsha-${id}`, `drive-${id}`, '/');
    bucket.objects.add(`receipt/${id}`);
    bucket.objects.add(`pdf/${id}`);
  }

  const env = { DB: db as never, ARTICLE_BUCKET: bucket as never };
  const first = await cleanupBackedUpExpenseReceipts(env, 2, async () => false);
  assert.equal(first.drive_unverified, 2);
  assert.equal(first.purged_documents, 0);
  const second = await cleanupBackedUpExpenseReceipts(
    env,
    2,
    async (fileId) => fileId === 'drive-z-valid',
  );
  assert.equal(second.purged_documents, 1);
  assert.equal(bucket.objects.has('receipt/z-valid'), false);
  assert.equal(bucket.objects.has('pdf/z-valid'), false);
  assert.equal(bucket.objects.has('receipt/a-unverified'), true);
  assert.equal(bucket.objects.has('receipt/b-unverified'), true);
});

test('Drive files.get verifier rejects missing/replaced files and verifies legacy SHA-256 content', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 404 });
    assert.equal(await driveFileStillExists('token', 'missing'), false);
    globalThis.fetch = async () => new Response(JSON.stringify({ id: 'trashed', trashed: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(await driveFileStillExists('token', 'trashed'), false);
    globalThis.fetch = async () => new Response(JSON.stringify({
      id: 'sized', trashed: false, size: '99', md5Checksum: 'aabbcc',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(await driveFileStillExists('token', 'sized', 99, 'aabbcc'), true);
    assert.equal(await driveFileStillExists('token', 'sized', 99, 'same-size-replacement'), false);
    assert.equal(await driveFileStillExists('token', 'sized', 100, 'aabbcc'), false);
    assert.equal(await driveFileStillExists('token', 'sized', 99), false);

    const legacyBytes = new Uint8Array([1, 2, 3, 4]);
    const legacyDigest = await crypto.subtle.digest('SHA-256', legacyBytes);
    const legacySha256 = Array.from(new Uint8Array(legacyDigest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    globalThis.fetch = async (input) => String(input).includes('alt=media')
      ? new Response(legacyBytes)
      : new Response(JSON.stringify({ id: 'legacy', trashed: false, size: String(legacyBytes.byteLength) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    assert.equal(await driveFileStillExists('token', 'legacy', legacyBytes.byteLength, '', legacySha256), true);
    assert.equal(await driveFileStillExists('token', 'legacy', legacyBytes.byteLength, '', '0'.repeat(64)), false);

    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    await assert.rejects(() => driveFileStillExists('token', 'api-error'), /503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manual document delete commits its durable R2 cleanup intent before deleting the object', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  db.sqlite.exec(`
    INSERT INTO documents (id,title,template_id,author_id,status)
      VALUES ('manual-delete','r','${EXPENSE_RECEIPT_TEMPLATE_ID}','master-1','draft');
    INSERT INTO expense_receipt_attachments
      (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
      VALUES ('manual-a','manual-delete','receipt/manual','a.jpg','image/jpeg',10,10,10,'manual-sha',0);
    INSERT INTO expense_receipt_submission_claims (document_id,claim_token)
      VALUES ('manual-delete','delete:manual');
  `);
  const bucket = new BucketMock();
  bucket.objects.add('receipt/manual');
  const regularBatch = db.batch.bind(db);
  db.batch = async (statements: TestStatement[]) => {
    const result = await regularBatch(statements);
    throw new Error('D1 response lost after committed delete');
  };
  await assert.rejects(() => deleteExpenseReceiptDocumentAndQueueArtifacts(
    { DB: db as never, ARTICLE_BUCKET: bucket as never },
    'manual-delete',
    'delete:manual',
  ), /response lost/);
  db.batch = regularBatch;
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM documents WHERE id=?').get('manual-delete').count, 0);
  assert.equal(bucket.objects.has('receipt/manual'), true);
  assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS count FROM expense_receipt_r2_cleanup_queue
    WHERE object_key='receipt/manual'`).get().count, 1);
  const cleanup = await retryExpenseReceiptR2Cleanup({ DB: db as never, ARTICLE_BUCKET: bucket as never });
  assert.deepEqual(cleanup, { scanned: 1, deleted: 1, active_references: 0, failed: 0 });
  assert.equal(bucket.objects.has('receipt/manual'), false);
  assert.equal(await countActiveExpenseReceiptAttachments(db as never, 'manual-delete'), 0);
});

test('manual document delete conflict preserves the document and every live R2 object', async () => {
  const db = createReceiptDb();
  await ensureExpenseReceiptSchema(db as never);
  db.sqlite.exec(`
    INSERT INTO documents (id,title,template_id,author_id,status)
      VALUES ('delete-conflict','r','${EXPENSE_RECEIPT_TEMPLATE_ID}','master-1','draft');
    INSERT INTO expense_receipt_attachments
      (id,document_id,object_key,file_name,file_type,file_size,image_width,image_height,sha256,sort_order)
      VALUES ('conflict-a','delete-conflict','receipt/conflict','a.jpg','image/jpeg',10,10,10,'conflict-sha',0);
    UPDATE documents SET status='submitted' WHERE id='delete-conflict';
    INSERT INTO expense_receipt_submission_claims (document_id,claim_token)
      VALUES ('delete-conflict','delete:conflict');
  `);
  const bucket = new BucketMock();
  bucket.objects.add('receipt/conflict');
  await assert.rejects(() => deleteExpenseReceiptDocumentAndQueueArtifacts(
    { DB: db as never, ARTICLE_BUCKET: bucket as never },
    'delete-conflict',
    'delete:conflict',
  ), ExpenseReceiptDocumentDeleteConflictError);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM documents WHERE id=?').get('delete-conflict').count, 1);
  assert.equal(bucket.objects.has('receipt/conflict'), true);
  const cleanup = await retryExpenseReceiptR2Cleanup({ DB: db as never, ARTICLE_BUCKET: bucket as never });
  assert.deepEqual(cleanup, { scanned: 1, deleted: 0, active_references: 1, failed: 0 });
  assert.equal(bucket.objects.has('receipt/conflict'), true);
});

test('global two-month document cleanup excludes the expense receipt template', async () => {
  const db = createReceiptDb();
  db.sqlite.exec(`
    CREATE TABLE document_logs (document_id TEXT);
    CREATE TABLE alert_approval_pending (document_id TEXT);
    CREATE TABLE document_journal_links (document_id TEXT);
    CREATE TABLE document_journal_link_candidates (document_id TEXT);
    CREATE TABLE document_journal_link_backfill_log (document_id TEXT);
    INSERT INTO documents (id,title,template_id,author_id,status,updated_at)
      VALUES ('receipt-old','r','${EXPENSE_RECEIPT_TEMPLATE_ID}','master-1','approved','2020-01-01 00:00:00');
    INSERT INTO documents (id,title,template_id,author_id,status,updated_at)
      VALUES ('normal-old','n','tpl-exp-001','master-1','approved','2020-01-01 00:00:00');
  `);
  const result = await cleanupOldDocuments(db as never, { dryRun: false });
  assert.equal(result.documents, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM documents WHERE id=?').get('receipt-old').count, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM documents WHERE id=?').get('normal-old').count, 0);
});

test('print render token is secret-bound, document-bound, expirable and consumed once', async () => {
  const db = createReceiptDb();
  db.sqlite.prepare(`INSERT INTO documents (id,title,template_id,author_id,status) VALUES (?,?,?,?,?)`)
    .run('print-doc', 'print', EXPENSE_RECEIPT_TEMPLATE_ID, 'master-1', 'approved');
  const env = { DB: db, JWT_SIGNING_SECRET: 'general-jwt-secret-that-is-longer-than-thirty-two-characters' };
  const issued = await issuePrintToken(env, 'print-doc');
  assert.deepEqual(await verifyPrintToken(issued.token, env), { docId: 'print-doc', jti: issued.jti });
  assert.equal(await verifyPrintToken(issued.token, { ...env, JWT_SIGNING_SECRET: 'different-jwt-secret-that-is-longer-than-thirty-two-characters' }), null);
  db.sqlite.prepare("UPDATE print_render_sessions SET expires_at=datetime('now','-1 minute') WHERE jti=?").run(issued.jti);
  assert.equal(await verifyPrintToken(issued.token, env), null);
  const second = await issuePrintToken(env, 'print-doc');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM print_render_sessions WHERE jti=?').get(issued.jti).count, 0);
  await consumePrintRenderSession(db as never, second.jti);
  assert.equal(await verifyPrintToken(second.token, env), null);
});

test('receipt route scopes edits and wires rollback, exact ordering, tombstones and signature invalidation', () => {
  const document = { author_id: 'author', status: 'draft' } as never;
  const author = { sub: 'author', role: 'member' } as never;
  const accountant = { sub: 'accountant', role: 'accountant' } as never;
  const freelancerAccountant = { sub: 'freelancer-accountant', role: 'accountant', login_type: 'freelancer' } as never;
  const freelancerMaster = { sub: 'freelancer-master', role: 'master', login_type: 'freelancer' } as never;
  const master = { sub: 'master', role: 'master' } as never;
  assert.equal(canEditExpenseReceipt(author, document), true);
  assert.equal(canEditExpenseReceipt(accountant, document), false);
  assert.equal(canEditExpenseReceipt(master, document), true);
  assert.equal(canReadExpenseReceipt(accountant, document), false);
  assert.equal(canReadExpenseReceipt(freelancerAccountant, { ...document, status: 'submitted' }), false);
  assert.equal(canReadExpenseReceipt(freelancerMaster, { ...document, status: 'submitted' }), true);
  assert.equal(canReadExpenseReceipt(master, document), true);
  const route = source('src/worker/routes/expense-receipts.ts');
  assert.match(route, /deleteExpenseReceiptR2ObjectsOrQueue\([\s\S]*prepared\.map\(\(item\) => item\.key\),[\s\S]*attachment-upload-rollback/);
  assert.match(route, /requested\.length !== expected\.length/);
  assert.match(route, /sort_order=sort_order\+1000/);
  assert.match(route, /signature_data != '\/LNCstemp\.png'/);
  assert.match(route, /deleted_at=datetime\('now'\)[\s\S]*DELETE FROM signatures/);
  assert.match(route, /isExpenseReceiptEditConflict[\s\S]*409/);
  assert.match(route, /user\.login_type !== 'freelancer'[\s\S]*FULL_READ_ROLES/);
  const index = source('src/worker/index.ts');
  assert.match(index, /path === '\/api\/templates'[\s\S]*path === '\/api\/documents'[\s\S]*ensureExpenseReceiptSchema/);
});

test('Print, Drive artifact compensation and cron retention are wired end-to-end', () => {
  const print = source('src/react-app/pages/Print.tsx');
  const drive = source('src/worker/drive-backup-runner.ts');
  const driveOAuth = source('src/worker/drive-oauth.ts');
  const driveVerification = source('src/worker/lib/drive-file-verification.ts');
  const receiptLib = source('src/worker/lib/expense-receipts.ts');
  const printSession = source('src/worker/lib/print-render-session.ts');
  const index = source('src/worker/index.ts');
  assert.match(print, /ExpenseReceiptPrint/);
  assert.match(print, /실제 승인자:/);
  assert.match(print, /api\/print\/expense-receipts/);
  assert.match(print, /__printMeta/);
  assert.match(drive, /uploadPdfBuffer[\s\S]*storeExpenseReceiptPdfArtifact/);
  assert.ok(
    drive.indexOf('await ensureExpenseReceiptSchema(db);') < drive.indexOf('const alreadyBackedUp'),
    'runtime schema backfill must precede receipt artifact fingerprint queries',
  );
  assert.match(drive, /deleteUploadedDriveFile\(accessToken, uploaded\.id\)/);
  assert.match(drive, /drive-compensation-pending:/);
  assert.ok(
    drive.indexOf("stage = 'drive-compensation-retry'") < drive.indexOf('const alreadyBackedUp'),
    'pending Drive compensation must run before the canonical-success skip',
  );
  assert.match(drive, /acquireExpenseReceiptDriveClaim/);
  assert.match(drive, /releaseExpenseReceiptDriveClaim/);
  assert.match(drive, /expectedReceiptAttachmentCount/);
  assert.match(drive, /validateExpenseReceiptPrintState/);
  assert.match(drive, /drive_file_id, drive_folder_path, error_message/);
  assert.match(drive, /artifact-log-recovery/);
  assert.match(drive, /alreadyBackedUp\.drive_file_id,[\s\S]*alreadyBackedUp\.file_size/);
  assert.match(drive, /recoverable\.drive_file_id,[\s\S]*recoverable\.file_size/);
  assert.match(driveOAuth, /fields=id,size,md5Checksum/);
  assert.match(drive, /md5Checksum: uploaded\.md5Checksum/);
  assert.match(driveVerification, /fields=id%2Ctrashed%2Csize%2Cmd5Checksum/);
  assert.match(driveVerification, /metadata\.trashed === true/);
  assert.match(driveVerification, /Number\(metadata\.size\) !== expectedSize/);
  assert.match(driveVerification, /alt=media/);
  assert.match(driveVerification, /SHA-256/);
  assert.doesNotMatch(`${drive}\n${printSession}`, /print-token-internal-key-2026/);
  assert.match(printSession, /print-render-session:/);
  assert.match(index, /createDriveFileVerifier[\s\S]*cleanupBackedUpExpenseReceipts\(env, 100, verifyDriveFile\)/);
  assert.match(index, /retryExpenseReceiptR2Cleanup\(env, 100\)/);
  assert.match(receiptLib, /\[objectKey, previous\?\.object_key \|\| ''\],[\s\S]*'pdf-artifact-upsert-rollback'/);
  assert.match(receiptLib, /deleteExpenseReceiptR2ObjectsOrQueue\(env, \[previous\.object_key\], 'superseded-pdf-artifact'/);
  assert.match(index, /listActiveExpenseReceiptAttachments/);
});
