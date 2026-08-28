import { EXPENSE_RECEIPT_TEMPLATE_ID } from '../../shared/expense-receipt.ts';

export { EXPENSE_RECEIPT_TEMPLATE_ID } from '../../shared/expense-receipt.ts';
export const MAX_EXPENSE_RECEIPT_FILES = 10;
export const MAX_EXPENSE_RECEIPT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_EXPENSE_RECEIPT_TOTAL_BYTES = 40 * 1024 * 1024;
export const MAX_EXPENSE_RECEIPT_TOTAL_PIXELS = 60_000_000;

const schemaPromises = new WeakMap<object, Promise<void>>();

type ExpenseReceiptEnv = {
  DB: D1Database;
  ARTICLE_BUCKET?: R2Bucket;
};

export type ExpenseReceiptAttachment = {
  id: string;
  document_id: string;
  object_key: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  image_width: number;
  image_height: number;
  sha256: string;
  sort_order: number;
  deleted_at: string | null;
  purged_at: string | null;
  created_at: string;
};

const EXPENSE_RECEIPT_FULL_READ_ROLES = new Set(['master', 'ceo', 'accountant', 'accountant_asst']);

export function canReadExpenseReceipt(
  user: { sub: string; role: string; login_type?: string },
  document: { author_id: string; status: string },
): boolean {
  if (user.sub === document.author_id || user.role === 'master') return true;
  if (user.login_type === 'freelancer') return false;
  return document.status !== 'draft' && EXPENSE_RECEIPT_FULL_READ_ROLES.has(user.role);
}

export function canEditExpenseReceipt(
  user: { sub: string; role: string },
  document: { author_id: string; status: string },
): boolean {
  return (user.sub === document.author_id || user.role === 'master')
    && (document.status === 'draft' || document.status === 'rejected');
}

export async function ensureExpenseReceiptSchema(db: D1Database): Promise<void> {
  const key = db as unknown as object;
  const existing = schemaPromises.get(key);
  if (existing) return existing;
  const pending = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_submission_claims (
      document_id TEXT PRIMARY KEY, claim_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_document_revisions (
      document_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_attachments (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, object_key TEXT UNIQUE,
      file_name TEXT NOT NULL, file_type TEXT NOT NULL, file_size INTEGER NOT NULL DEFAULT 0,
      image_width INTEGER NOT NULL DEFAULT 0, image_height INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT, purged_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_expense_receipt_attachments_document ON expense_receipt_attachments(document_id, deleted_at, sort_order)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_expense_receipt_attachments_sha ON expense_receipt_attachments(document_id, sha256, deleted_at)'),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_receipt_attachments_active_sha
      ON expense_receipt_attachments(document_id, sha256)
      WHERE deleted_at IS NULL AND purged_at IS NULL AND sha256 != ''`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_receipt_attachments_active_order
      ON expense_receipt_attachments(document_id, sort_order)
      WHERE deleted_at IS NULL AND purged_at IS NULL`),
    db.prepare('DROP TRIGGER IF EXISTS trg_expense_receipt_attachment_insert_editable'),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_insert_editable
      BEFORE INSERT ON expense_receipt_attachments
      WHEN NOT EXISTS (SELECT 1 FROM documents WHERE id=NEW.document_id
        AND template_id='${EXPENSE_RECEIPT_TEMPLATE_ID}' AND status IN ('draft','rejected'))
        OR EXISTS (SELECT 1 FROM expense_receipt_submission_claims
          WHERE document_id=NEW.document_id AND claim_token NOT LIKE 'attachment:%')
      BEGIN SELECT RAISE(ABORT, 'expense receipt document is not editable'); END`),
    db.prepare('DROP TRIGGER IF EXISTS trg_expense_receipt_attachment_order_editable'),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_order_editable
      BEFORE UPDATE OF sort_order ON expense_receipt_attachments
      WHEN NOT EXISTS (SELECT 1 FROM documents WHERE id=NEW.document_id
        AND template_id='${EXPENSE_RECEIPT_TEMPLATE_ID}' AND status IN ('draft','rejected'))
        OR EXISTS (SELECT 1 FROM expense_receipt_submission_claims
          WHERE document_id=NEW.document_id AND claim_token NOT LIKE 'attachment:%')
      BEGIN SELECT RAISE(ABORT, 'expense receipt document is not editable'); END`),
    db.prepare('DROP TRIGGER IF EXISTS trg_expense_receipt_attachment_delete_editable'),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_delete_editable
      BEFORE UPDATE OF deleted_at ON expense_receipt_attachments
      WHEN NOT EXISTS (SELECT 1 FROM documents WHERE id=NEW.document_id
        AND template_id='${EXPENSE_RECEIPT_TEMPLATE_ID}' AND status IN ('draft','rejected'))
        OR EXISTS (SELECT 1 FROM expense_receipt_submission_claims
          WHERE document_id=NEW.document_id AND claim_token NOT LIKE 'attachment:%')
      BEGIN SELECT RAISE(ABORT, 'expense receipt document is not editable'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_revision_insert
      AFTER INSERT ON expense_receipt_attachments
      BEGIN
        INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
        VALUES (NEW.document_id, 1, datetime('now'))
        ON CONFLICT(document_id) DO UPDATE SET revision=revision+1, updated_at=datetime('now');
      END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_revision_update
      AFTER UPDATE OF object_key, file_name, file_type, file_size, sha256, sort_order, deleted_at, purged_at
      ON expense_receipt_attachments
      BEGIN
        INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
        VALUES (NEW.document_id, 1, datetime('now'))
        ON CONFLICT(document_id) DO UPDATE SET revision=revision+1, updated_at=datetime('now');
      END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_revision_delete
      AFTER DELETE ON expense_receipt_attachments
      BEGIN
        INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
        VALUES (OLD.document_id, 1, datetime('now'))
        ON CONFLICT(document_id) DO UPDATE SET revision=revision+1, updated_at=datetime('now');
      END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_limit
      BEFORE INSERT ON expense_receipt_attachments
      WHEN (SELECT COUNT(*) FROM expense_receipt_attachments
        WHERE document_id=NEW.document_id AND deleted_at IS NULL AND purged_at IS NULL) >= 10
      BEGIN SELECT RAISE(ABORT, 'expense receipt attachment count limit exceeded'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_total_bytes
      BEFORE INSERT ON expense_receipt_attachments
      WHEN COALESCE((SELECT SUM(file_size) FROM expense_receipt_attachments
        WHERE document_id=NEW.document_id AND deleted_at IS NULL AND purged_at IS NULL), 0) + NEW.file_size > 41943040
      BEGIN SELECT RAISE(ABORT, 'expense receipt attachment byte limit exceeded'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_total_pixels
      BEFORE INSERT ON expense_receipt_attachments
      WHEN COALESCE((SELECT SUM(image_width * image_height) FROM expense_receipt_attachments
        WHERE document_id=NEW.document_id AND deleted_at IS NULL AND purged_at IS NULL), 0)
        + (NEW.image_width * NEW.image_height) > ${MAX_EXPENSE_RECEIPT_TOTAL_PIXELS}
      BEGIN SELECT RAISE(ABORT, 'expense receipt attachment pixel limit exceeded'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_reactivate_limit
      BEFORE UPDATE OF deleted_at, purged_at ON expense_receipt_attachments
      WHEN NEW.deleted_at IS NULL AND NEW.purged_at IS NULL
        AND (OLD.deleted_at IS NOT NULL OR OLD.purged_at IS NOT NULL)
        AND (SELECT COUNT(*) FROM expense_receipt_attachments
          WHERE document_id=NEW.document_id AND id!=NEW.id
            AND deleted_at IS NULL AND purged_at IS NULL) >= ${MAX_EXPENSE_RECEIPT_FILES}
      BEGIN SELECT RAISE(ABORT, 'expense receipt attachment count limit exceeded'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_update_total_bytes
      BEFORE UPDATE OF deleted_at, purged_at, file_size ON expense_receipt_attachments
      WHEN NEW.deleted_at IS NULL AND NEW.purged_at IS NULL
        AND (OLD.deleted_at IS NOT NULL OR OLD.purged_at IS NOT NULL OR NEW.file_size != OLD.file_size)
        AND COALESCE((SELECT SUM(file_size) FROM expense_receipt_attachments
          WHERE document_id=NEW.document_id AND id!=NEW.id
            AND deleted_at IS NULL AND purged_at IS NULL), 0) + NEW.file_size > ${MAX_EXPENSE_RECEIPT_TOTAL_BYTES}
      BEGIN SELECT RAISE(ABORT, 'expense receipt attachment byte limit exceeded'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_update_total_pixels
      BEFORE UPDATE OF deleted_at, purged_at, image_width, image_height ON expense_receipt_attachments
      WHEN NEW.deleted_at IS NULL AND NEW.purged_at IS NULL
        AND (OLD.deleted_at IS NOT NULL OR OLD.purged_at IS NOT NULL
          OR NEW.image_width != OLD.image_width OR NEW.image_height != OLD.image_height)
        AND COALESCE((SELECT SUM(image_width * image_height) FROM expense_receipt_attachments
          WHERE document_id=NEW.document_id AND id!=NEW.id
            AND deleted_at IS NULL AND purged_at IS NULL), 0)
          + (NEW.image_width * NEW.image_height) > ${MAX_EXPENSE_RECEIPT_TOTAL_PIXELS}
      BEGIN SELECT RAISE(ABORT, 'expense receipt attachment pixel limit exceeded'); END`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_pdf_artifacts (
      document_id TEXT PRIMARY KEY, object_key TEXT UNIQUE, file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL DEFAULT '',
      drive_file_id TEXT NOT NULL DEFAULT '', drive_md5_checksum TEXT NOT NULL DEFAULT '',
      drive_folder_path TEXT NOT NULL DEFAULT '',
      drive_backed_up_at TEXT, purged_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_expense_receipt_pdf_artifacts_retention ON expense_receipt_pdf_artifacts(drive_backed_up_at, purged_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_retention_attempts (
      document_id TEXT PRIMARY KEY, last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_result TEXT NOT NULL DEFAULT 'checking',
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_expense_receipt_retention_attempts_time
      ON expense_receipt_retention_attempts(last_attempt_at, document_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_r2_cleanup_queue (
      object_key TEXT PRIMARY KEY, document_id TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '', attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT, last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_expense_receipt_r2_cleanup_queue_attempt
      ON expense_receipt_r2_cleanup_queue(last_attempt_at, created_at, object_key)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS print_render_sessions (
      jti TEXT PRIMARY KEY, document_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      consumed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_print_render_sessions_expiry ON print_render_sessions(expires_at, consumed_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_drive_claims (
      document_id TEXT PRIMARY KEY, claim_token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_expense_receipt_drive_claims_expiry ON expense_receipt_drive_claims(expires_at)'),
    db.prepare(`INSERT INTO templates
      (id, title, description, content, category, is_myauction, created_by, is_active)
      SELECT ?, '영수증 첨부 지출결의서',
        '지출결의서와 영수증 이미지를 합본 PDF로 보관하는 비용 승인 문서',
        COALESCE((SELECT content FROM templates WHERE id='tpl-exp-001'), '{}'),
        '경비/비용', 1, creator_id, 1
      FROM (SELECT COALESCE(
        (SELECT created_by FROM templates WHERE id='tpl-exp-001'),
        (SELECT id FROM users WHERE role='master' AND approved=1 ORDER BY created_at ASC LIMIT 1)
      ) AS creator_id)
      WHERE creator_id IS NOT NULL
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
        category=excluded.category, is_myauction=1, is_active=1, updated_at=datetime('now')`)
      .bind(EXPENSE_RECEIPT_TEMPLATE_ID),
  ]).then(async () => {
    // Runtime schema creation also covers environments where the initial
    // receipt migration ran before Drive fingerprints were introduced.
    const columns = await db.prepare('PRAGMA table_info(expense_receipt_pdf_artifacts)')
      .all<{ name: string }>();
    if (!(columns.results || []).some((column) => column.name === 'drive_md5_checksum')) {
      await db.prepare(`ALTER TABLE expense_receipt_pdf_artifacts
        ADD COLUMN drive_md5_checksum TEXT NOT NULL DEFAULT ''`).run();
    }
  }).then(() => undefined).catch((error) => {
    schemaPromises.delete(key);
    throw error;
  });
  schemaPromises.set(key, pending);
  return pending;
}

export async function acquireExpenseReceiptAttachmentMutationClaim(
  db: D1Database,
  documentId: string,
): Promise<string | null> {
  await ensureExpenseReceiptSchema(db);
  const claimToken = `attachment:${crypto.randomUUID()}`;
  const results = await db.batch([
    db.prepare(`DELETE FROM expense_receipt_submission_claims
      WHERE document_id=? AND created_at < datetime('now', '-30 minutes')`).bind(documentId),
    db.prepare(`INSERT OR IGNORE INTO expense_receipt_submission_claims (document_id, claim_token)
      SELECT id, ? FROM documents
      WHERE id=? AND template_id=? AND status IN ('draft','rejected')`)
      .bind(claimToken, documentId, EXPENSE_RECEIPT_TEMPLATE_ID),
  ]);
  return Number(results[1]?.meta?.changes || 0) === 1 ? claimToken : null;
}

export async function releaseExpenseReceiptAttachmentMutationClaim(
  db: D1Database,
  documentId: string,
  claimToken: string,
): Promise<void> {
  await db.prepare(`DELETE FROM expense_receipt_submission_claims
    WHERE document_id=? AND claim_token=? AND claim_token LIKE 'attachment:%'`)
    .bind(documentId, claimToken).run();
}

export function safeExpenseReceiptFileName(value: string): string {
  return Array.from(String(value || 'receipt'), (character) => character.charCodeAt(0) <= 0x1f ? '_' : character)
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'receipt';
}

export function expenseReceiptObjectKey(documentId: string, attachmentId: string, fileName: string, now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const month = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  return `expense-receipts/${month}/${documentId}/${attachmentId}-${safeExpenseReceiptFileName(fileName)}`;
}

export function expenseReceiptPdfObjectKey(documentId: string, now = new Date(), version = 'latest'): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const month = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  return `expense-receipt-pdfs/${month}/${documentId}/${safeExpenseReceiptFileName(version)}.pdf`;
}

export function sniffExpenseReceiptImage(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

function pngChunkCrc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function hasExpenseReceiptImageContainer(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/jpeg') {
    return bytes.length >= 4
      && bytes[0] === 0xff && bytes[1] === 0xd8
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (mime === 'image/png') {
    if (bytes.length < 45 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8, false) !== 13) return false;
    let offset = 8;
    let chunkIndex = 0;
    let sawImageData = false;
    let imageDataEnded = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset, false);
      const end = offset + 12 + length;
      if (end > bytes.length) return false;
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (pngChunkCrc32(bytes, offset + 4, offset + 8 + length) !== view.getUint32(offset + 8 + length, false)) {
        return false;
      }
      if (chunkIndex === 0 && (type !== 'IHDR' || length !== 13)) return false;
      if (chunkIndex > 0 && type === 'IHDR') return false;
      if (type === 'IDAT') {
        if (imageDataEnded || length === 0) return false;
        sawImageData = true;
      } else if (sawImageData && type !== 'IEND') {
        imageDataEnded = true;
      }
      if (type === 'IEND') return length === 0 && sawImageData && end === bytes.length;
      offset = end;
      chunkIndex += 1;
    }
    return false;
  }
  if (mime === 'image/webp') {
    if (bytes.length < 20) return false;
    const declaredSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8;
    return declaredSize === bytes.length;
  }
  return false;
}

export function expenseReceiptImageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  const be16 = (offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
  const le24 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  if (mime === 'image/png' && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (mime === 'image/jpeg') {
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 1 >= bytes.length) break;
      const length = be16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (sof.has(marker) && length >= 7) {
        const height = be16(offset + 3);
        const width = be16(offset + 5);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += length;
    }
    return null;
  }
  if (mime === 'image/webp' && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X') return { width: le24(24) + 1, height: le24(27) + 1 };
    if (chunk === 'VP8L' && bytes[20] === 0x2f && bytes.length >= 25) {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
    }
  }
  return null;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function countActiveExpenseReceiptAttachments(db: D1Database, documentId: string): Promise<number> {
  await ensureExpenseReceiptSchema(db);
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM expense_receipt_attachments
    WHERE document_id = ? AND deleted_at IS NULL AND purged_at IS NULL AND object_key IS NOT NULL`)
    .bind(documentId).first<{ count: number }>();
  return Number(row?.count || 0);
}

export async function acquireExpenseReceiptDriveClaim(
  db: D1Database,
  documentId: string,
): Promise<string | null> {
  await ensureExpenseReceiptSchema(db);
  const claimToken = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`DELETE FROM expense_receipt_drive_claims
      WHERE datetime(expires_at) <= datetime('now')`),
    db.prepare(`INSERT OR IGNORE INTO expense_receipt_drive_claims
        (document_id, claim_token, expires_at)
      SELECT id, ?, datetime('now', '+30 minutes') FROM documents
      WHERE id=? AND template_id=? AND status='approved' AND COALESCE(cancelled,0)=0`)
      .bind(claimToken, documentId, EXPENSE_RECEIPT_TEMPLATE_ID),
  ]);
  return Number(results[1]?.meta?.changes || 0) === 1 ? claimToken : null;
}

export async function releaseExpenseReceiptDriveClaim(
  db: D1Database,
  documentId: string,
  claimToken: string,
): Promise<void> {
  await db.prepare(`DELETE FROM expense_receipt_drive_claims
    WHERE document_id=? AND claim_token=?`).bind(documentId, claimToken).run();
}

export async function listActiveExpenseReceiptAttachments(db: D1Database, documentId: string): Promise<ExpenseReceiptAttachment[]> {
  await ensureExpenseReceiptSchema(db);
  const rows = await db.prepare(`SELECT * FROM expense_receipt_attachments
    WHERE document_id = ? AND deleted_at IS NULL AND purged_at IS NULL AND object_key IS NOT NULL
    ORDER BY sort_order ASC, created_at ASC`).bind(documentId).all<ExpenseReceiptAttachment>();
  return rows.results || [];
}

async function deleteBucketKeys(bucket: R2Bucket | undefined, keys: string[]): Promise<void> {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (unique.length === 0) return;
  if (!bucket) throw new Error('영수증 R2 저장소가 설정되지 않았습니다.');
  await bucket.delete(unique);
}

export async function enqueueExpenseReceiptR2Cleanup(
  db: D1Database,
  keys: string[],
  reason: string,
  documentId = '',
): Promise<number> {
  await ensureExpenseReceiptSchema(db);
  const unique = Array.from(new Set(keys.map((key) => String(key || '').trim()).filter(Boolean)));
  if (unique.length === 0) return 0;
  await db.batch(unique.map((key) => db.prepare(`INSERT INTO expense_receipt_r2_cleanup_queue
      (object_key, document_id, reason, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(object_key) DO UPDATE SET
      document_id=CASE WHEN excluded.document_id!='' THEN excluded.document_id ELSE document_id END,
      reason=excluded.reason, updated_at=datetime('now')`)
    .bind(key, documentId, reason.slice(0, 200))));
  return unique.length;
}

async function processQueuedExpenseReceiptR2Key(
  env: ExpenseReceiptEnv,
  objectKey: string,
): Promise<'deleted' | 'active' | 'failed'> {
  // D1 can commit and still lose the response. Always confirm that the key is
  // not authoritative before deleting the R2 object queued as compensation.
  const active = await env.DB.prepare(`SELECT 1 AS found
    FROM expense_receipt_attachments
    WHERE object_key=? AND purged_at IS NULL
    UNION ALL
    SELECT 1 AS found FROM expense_receipt_pdf_artifacts
    WHERE object_key=? AND purged_at IS NULL
    LIMIT 1`).bind(objectKey, objectKey).first<{ found: number }>();
  if (active) {
    await env.DB.prepare('DELETE FROM expense_receipt_r2_cleanup_queue WHERE object_key=?')
      .bind(objectKey).run();
    return 'active';
  }
  try {
    if (!env.ARTICLE_BUCKET) throw new Error('Expense receipt R2 bucket is not configured');
    await env.ARTICLE_BUCKET.delete(objectKey);
    await env.DB.prepare('DELETE FROM expense_receipt_r2_cleanup_queue WHERE object_key=?')
      .bind(objectKey).run();
    return 'deleted';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`UPDATE expense_receipt_r2_cleanup_queue SET
      attempt_count=attempt_count+1, last_attempt_at=datetime('now'),
      last_error=?, updated_at=datetime('now') WHERE object_key=?`)
      .bind(message.slice(0, 500), objectKey).run();
    return 'failed';
  }
}

/**
 * Durable queue-first R2 compensation. The queued key is checked against live
 * D1 references before any delete, so a committed write with a lost response
 * can never cause its authoritative object to be removed.
 */
export async function deleteExpenseReceiptR2ObjectsOrQueue(
  env: ExpenseReceiptEnv,
  keys: string[],
  reason: string,
  documentId = '',
): Promise<boolean> {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (unique.length === 0) return true;
  try {
    await enqueueExpenseReceiptR2Cleanup(env.DB, unique, reason, documentId);
  } catch (queueError) {
    console.error('Expense receipt R2 cleanup could not be persisted:', { documentId, reason, queueError });
    throw queueError;
  }
  const outcomes = await Promise.all(unique.map((key) => processQueuedExpenseReceiptR2Key(env, key)));
  const failed = outcomes.filter((outcome) => outcome === 'failed').length;
  if (failed > 0) {
    console.error('Expense receipt R2 cleanup queued for retry:', { documentId, reason, keys: unique, failed });
  }
  return failed === 0;
}

export type ExpenseReceiptR2CleanupResult = {
  scanned: number;
  deleted: number;
  active_references: number;
  failed: number;
};

export async function retryExpenseReceiptR2Cleanup(
  env: ExpenseReceiptEnv,
  limit = 100,
): Promise<ExpenseReceiptR2CleanupResult> {
  await ensureExpenseReceiptSchema(env.DB);
  if (!env.ARTICLE_BUCKET) throw new Error('Expense receipt R2 bucket is not configured');
  const rows = await env.DB.prepare(`SELECT object_key FROM expense_receipt_r2_cleanup_queue
    ORDER BY COALESCE(last_attempt_at, '') ASC, created_at ASC, object_key ASC LIMIT ?`)
    .bind(Math.min(500, Math.max(1, limit))).all<{ object_key: string }>();
  let deleted = 0;
  let activeReferences = 0;
  let failed = 0;
  for (const row of rows.results || []) {
    const outcome = await processQueuedExpenseReceiptR2Key(env, row.object_key);
    if (outcome === 'active') activeReferences += 1;
    else if (outcome === 'deleted') deleted += 1;
    else failed += 1;
  }
  return { scanned: (rows.results || []).length, deleted, active_references: activeReferences, failed };
}

export class ExpenseReceiptDocumentDeleteConflictError extends Error {
  constructor(message = '문서 상태가 변경되어 삭제하지 못했습니다.') {
    super(message);
    this.name = 'ExpenseReceiptDocumentDeleteConflictError';
  }
}

export async function deleteExpenseReceiptDocumentAndQueueArtifacts(
  env: ExpenseReceiptEnv,
  documentId: string,
  claimToken: string,
): Promise<void> {
  await ensureExpenseReceiptSchema(env.DB);
  const attachments = await env.DB.prepare(`SELECT object_key
    FROM expense_receipt_attachments WHERE document_id = ? AND object_key IS NOT NULL`)
    .bind(documentId).all<{ object_key: string }>();
  const artifact = await env.DB.prepare(`SELECT object_key FROM expense_receipt_pdf_artifacts
    WHERE document_id = ? AND object_key IS NOT NULL`)
    .bind(documentId).first<{ object_key: string }>();
  const keys = Array.from(new Set([
    ...(attachments.results || []).map((row) => row.object_key),
    artifact?.object_key || '',
  ].filter(Boolean)));
  const queueStatements = keys.map((key) => env.DB.prepare(`INSERT INTO expense_receipt_r2_cleanup_queue
      (object_key, document_id, reason, updated_at) VALUES (?, ?, 'document-delete', datetime('now'))
    ON CONFLICT(object_key) DO UPDATE SET
      document_id=excluded.document_id, reason=excluded.reason, updated_at=datetime('now')`)
    .bind(key, documentId));
  const statements = [
    ...queueStatements,
    env.DB.prepare(`DELETE FROM documents
      WHERE id=? AND template_id=? AND status IN ('draft','rejected')
        AND EXISTS (SELECT 1 FROM expense_receipt_submission_claims
          WHERE document_id=? AND claim_token=?)`)
      .bind(documentId, EXPENSE_RECEIPT_TEMPLATE_ID, documentId, claimToken),
  ];
  const results = await env.DB.batch(statements);
  if (Number(results[results.length - 1]?.meta?.changes || 0) !== 1) {
    throw new ExpenseReceiptDocumentDeleteConflictError();
  }
  // The document and durable cleanup intent are committed together. R2 is
  // only touched afterwards; failures remain queued for the daily retry.
  await retryExpenseReceiptR2Cleanup(env, Math.max(100, keys.length))
    .catch((error) => console.error('Expense receipt document R2 cleanup deferred:', { documentId, error }));
}

export async function storeExpenseReceiptPdfArtifact(
  env: ExpenseReceiptEnv,
  documentId: string,
  pdf: ArrayBuffer,
  drive: { fileId: string; folderPath: string; fileName?: string; md5Checksum?: string },
): Promise<{ objectKey: string; sha256: string }> {
  if (!env.ARTICLE_BUCKET) throw new Error('영수증 합본 PDF R2 저장소가 설정되지 않았습니다.');
  await ensureExpenseReceiptSchema(env.DB);
  const previous = await env.DB.prepare(`SELECT object_key FROM expense_receipt_pdf_artifacts
    WHERE document_id=?`).bind(documentId).first<{ object_key: string | null }>();
  // A unique object per attempt prevents a failed D1 upsert from deleting or
  // overwriting the previously verified site artifact during manual resend.
  const objectKey = expenseReceiptPdfObjectKey(documentId, new Date(), crypto.randomUUID());
  const sha256 = await sha256Hex(pdf);
  const fileName = safeExpenseReceiptFileName(drive.fileName || `${documentId}.pdf`);
  try {
    await env.ARTICLE_BUCKET.put(objectKey, pdf, {
      httpMetadata: { contentType: 'application/pdf', contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}` },
      customMetadata: { documentId, sha256, driveFileId: drive.fileId },
    });
  } catch (error) {
    // R2 can persist an object even when the response is lost. The key is
    // known before upload, so queue it and verify D1 references before delete.
    await deleteExpenseReceiptR2ObjectsOrQueue(env, [objectKey], 'pdf-artifact-upload-rollback', documentId)
      .catch((cleanupError) => console.error(`Expense receipt PDF upload cleanup was not persisted for ${documentId}:`, cleanupError));
    throw error;
  }
  try {
    await env.DB.prepare(`INSERT INTO expense_receipt_pdf_artifacts
      (document_id, object_key, file_name, file_size, sha256, drive_file_id, drive_md5_checksum,
       drive_folder_path, drive_backed_up_at, purged_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), NULL, datetime('now'))
      ON CONFLICT(document_id) DO UPDATE SET object_key=excluded.object_key, file_name=excluded.file_name,
        file_size=excluded.file_size, sha256=excluded.sha256, drive_file_id=excluded.drive_file_id,
        drive_md5_checksum=excluded.drive_md5_checksum, drive_folder_path=excluded.drive_folder_path,
        drive_backed_up_at=datetime('now'), purged_at=NULL,
        updated_at=datetime('now')`)
      .bind(
        documentId, objectKey, fileName, pdf.byteLength, sha256, drive.fileId,
        String(drive.md5Checksum || '').trim().toLowerCase(), drive.folderPath,
      ).run();
  } catch (error) {
    // If the swap committed but its response was lost, the new key is live and
    // the previous key became orphaned. Queueing both lets the live-reference
    // check choose correctly for both committed and rolled-back outcomes.
    await deleteExpenseReceiptR2ObjectsOrQueue(
      env,
      [objectKey, previous?.object_key || ''],
      'pdf-artifact-upsert-rollback',
      documentId,
    )
      .catch((cleanupError) => console.error(`New expense receipt PDF cleanup was not persisted for ${documentId}:`, cleanupError));
    throw error;
  }
  if (previous?.object_key && previous.object_key !== objectKey) {
    await deleteExpenseReceiptR2ObjectsOrQueue(env, [previous.object_key], 'superseded-pdf-artifact', documentId)
      .catch((error) => {
        console.error(`Previous expense receipt PDF cleanup was not persisted for ${documentId}; new artifact remains authoritative:`, error);
      });
  }
  return { objectKey, sha256 };
}

export type ExpenseReceiptRetentionResult = {
  retention_days: number;
  eligible: number;
  purged_documents: number;
  deleted_objects: number;
  drive_unverified: number;
  failed_documents: number;
};

export type ExpenseReceiptDriveVerifier = (
  driveFileId: string,
  expectedSize: number,
  expectedMd5Checksum: string,
  expectedSha256: string,
) => Promise<boolean>;

export async function cleanupBackedUpExpenseReceipts(
  env: ExpenseReceiptEnv,
  limit = 100,
  verifyDriveFile?: ExpenseReceiptDriveVerifier,
): Promise<ExpenseReceiptRetentionResult> {
  await ensureExpenseReceiptSchema(env.DB);
  const candidates = await env.DB.prepare(`SELECT d.id, p.drive_file_id, p.file_size,
      p.drive_md5_checksum, p.sha256
    FROM documents d
    JOIN expense_receipt_pdf_artifacts p ON p.document_id=d.id
    LEFT JOIN expense_receipt_retention_attempts r ON r.document_id=d.id
    WHERE d.template_id = ? AND d.status = 'approved' AND COALESCE(d.cancelled, 0) = 0
      AND COALESCE((SELECT MAX(s.signed_at) FROM approval_steps s
        WHERE s.document_id=d.id AND s.status='approved'), d.updated_at) < datetime('now', '-30 days')
      AND EXISTS (SELECT 1 FROM drive_backup_logs b WHERE b.document_id=d.id AND b.status='success')
      AND p.drive_backed_up_at IS NOT NULL
      AND p.object_key IS NOT NULL AND p.drive_file_id != ''
    ORDER BY COALESCE(r.last_attempt_at, '') ASC, d.updated_at ASC, d.id ASC LIMIT ?`)
    .bind(EXPENSE_RECEIPT_TEMPLATE_ID, Math.min(500, Math.max(1, limit)))
    .all<{ id: string; drive_file_id: string; file_size: number; drive_md5_checksum: string; sha256: string }>();
  let purgedDocuments = 0;
  let deletedObjects = 0;
  let driveUnverified = 0;
  let failedDocuments = 0;
  for (const candidate of candidates.results || []) {
    const markAttempt = async (result: string) => {
      await env.DB.prepare(`INSERT INTO expense_receipt_retention_attempts
        (document_id, last_attempt_at, last_result) VALUES (?, datetime('now'), ?)
        ON CONFLICT(document_id) DO UPDATE SET
          last_attempt_at=datetime('now'), last_result=excluded.last_result`)
        .bind(candidate.id, result).run();
    };
    await markAttempt('checking');
    // Share the per-document lease with Drive generation/manual resend so a
    // verified site copy cannot be purged while another worker is rendering or
    // replacing that same artifact.
    const retentionClaim = await acquireExpenseReceiptDriveClaim(env.DB, candidate.id);
    if (!retentionClaim) {
      await markAttempt('drive-locked');
      continue;
    }
    try {
      // The old success log is insufficient: a user can trash/delete the Drive
      // file later. Never remove the last site copy unless Drive confirms the
      // exact artifact still exists and is not trashed immediately before purge.
      try {
        if (!verifyDriveFile || !await verifyDriveFile(
          candidate.drive_file_id,
          Number(candidate.file_size || 0),
          candidate.drive_md5_checksum || '',
          candidate.sha256 || '',
        )) {
          driveUnverified += 1;
          await markAttempt('drive-unverified');
          continue;
        }
      } catch (error) {
        driveUnverified += 1;
        await markAttempt('drive-error');
        console.error(`Expense receipt Drive verification failed for ${candidate.id}; site originals retained:`, error);
        continue;
      }
      const attachments = await env.DB.prepare(`SELECT id, object_key, purged_at FROM expense_receipt_attachments
        WHERE document_id=? AND object_key IS NOT NULL`)
        .bind(candidate.id).all<{ id: string; object_key: string; purged_at: string | null }>();
      const artifact = await env.DB.prepare(`SELECT object_key, purged_at FROM expense_receipt_pdf_artifacts
        WHERE document_id=? AND object_key IS NOT NULL`).bind(candidate.id)
        .first<{ object_key: string; purged_at: string | null }>();
      const attachmentRows = attachments.results || [];
      const keys = [...attachmentRows.map((row) => row.object_key), artifact?.object_key || ''].filter(Boolean);
      await env.DB.batch([
        ...attachmentRows.map((row) => env.DB.prepare(`UPDATE expense_receipt_attachments
          SET purged_at=COALESCE(purged_at, datetime('now')), updated_at=datetime('now') WHERE id=?`).bind(row.id)),
        ...(artifact ? [env.DB.prepare(`UPDATE expense_receipt_pdf_artifacts
          SET purged_at=COALESCE(purged_at, datetime('now')), updated_at=datetime('now') WHERE document_id=?`).bind(candidate.id)] : []),
      ]);
      try {
        await deleteBucketKeys(env.ARTICLE_BUCKET, keys);
      } catch (error) {
        await env.DB.batch([
          ...attachmentRows.map((row) => env.DB.prepare(`UPDATE expense_receipt_attachments
            SET purged_at=?, updated_at=datetime('now') WHERE id=?`).bind(row.purged_at, row.id)),
          ...(artifact ? [env.DB.prepare(`UPDATE expense_receipt_pdf_artifacts
            SET purged_at=?, updated_at=datetime('now') WHERE document_id=?`).bind(artifact.purged_at, candidate.id)] : []),
        ]).catch((restoreError) => console.error('Expense receipt retention metadata restore failed:', restoreError));
        failedDocuments += 1;
        await markAttempt('r2-delete-failed');
        console.error(`Expense receipt retention R2 delete failed for ${candidate.id}; continuing with later documents:`, error);
        continue;
      }
      try {
        await env.DB.batch([
          env.DB.prepare(`UPDATE expense_receipt_attachments SET object_key=NULL,
            updated_at=datetime('now') WHERE document_id=? AND purged_at IS NOT NULL`).bind(candidate.id),
          env.DB.prepare(`UPDATE expense_receipt_pdf_artifacts SET object_key=NULL,
            updated_at=datetime('now') WHERE document_id=? AND purged_at IS NOT NULL`).bind(candidate.id),
        ]);
      } catch (error) {
        console.error(`Expense receipt retention key finalization failed for ${candidate.id}; tombstones retained:`, error);
      }
      deletedObjects += keys.length;
      purgedDocuments += 1;
      await markAttempt('purged');
    } finally {
      await releaseExpenseReceiptDriveClaim(env.DB, candidate.id, retentionClaim).catch((error) => {
        console.error(`Expense receipt retention claim release failed for ${candidate.id}:`, error);
      });
    }
  }
  return {
    retention_days: 30,
    eligible: (candidates.results || []).length,
    purged_documents: purgedDocuments,
    deleted_objects: deletedObjects,
    drive_unverified: driveUnverified,
    failed_documents: failedDocuments,
  };
}
