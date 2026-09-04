import { safePdfFileName } from './article-pdfs.ts';
import {
  decodeAttachmentDataUrl,
  hasPdfSignature,
  MAX_NOTICE_ATTACHMENT_BYTES,
  NoticeAttachmentValidationError,
  noticePdfDownloadResponseHeaders,
  noticePdfResponseHeaders,
} from './admin-note-attachments.ts';

const KST_NOW_SQL = "datetime('now', '+9 hours')";

export interface NoticePdfMetadata {
  id: string;
  noteId: string;
  objectKey: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  uploadedBy: string;
}

export type NoticePdfCleanupResult = {
  scanned: number;
  deleted: number;
  retained: number;
  failed: number;
  errors: string[];
};

export type NoticePdfAccessRow = {
  id: string;
  note_id: string;
  file_name: string;
  file_size?: number;
  object_key?: string;
  author_id: string;
  visibility: string;
  author_branch: string;
  author_department: string;
  category: string;
};

export type NoticePdfDeliveryResult =
  | { ok: true; body: ArrayBuffer; headers: Record<string, string>; storage: 'r2' | 'd1' }
  | { ok: false; status: 403 | 404 | 413 | 415 | 503; error: string };

export async function ensureNoticePdfTables(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS notice_pdf_attachments (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      uploaded_by TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', '+9 hours')),
      FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS notice_pdf_cleanup_queue (
      object_key TEXT PRIMARY KEY,
      attachment_id TEXT,
      note_id TEXT,
      reason TEXT NOT NULL DEFAULT 'cleanup',
      not_before TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT DEFAULT (datetime('now', '+9 hours'))
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_notice_pdf_note ON notice_pdf_attachments(note_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_notice_pdf_cleanup_due ON notice_pdf_cleanup_queue(not_before, created_at)').run();
}

export function noticePdfObjectKey(noteId: string, attachmentId: string, fileName: string): string {
  return `notice-pdfs/${noteId}/${attachmentId}-${safePdfFileName(fileName)}`;
}

export function noticePdfMetadataInsert(db: D1Database, metadata: NoticePdfMetadata): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO notice_pdf_attachments
      (id, note_id, object_key, file_name, file_size, sha256, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ${KST_NOW_SQL})
  `).bind(
    metadata.id,
    metadata.noteId,
    metadata.objectKey,
    metadata.fileName,
    metadata.fileSize,
    metadata.sha256,
    metadata.uploadedBy,
  );
}

export function noticePdfCleanupDelete(db: D1Database, objectKey: string): D1PreparedStatement {
  return db.prepare('DELETE FROM notice_pdf_cleanup_queue WHERE object_key = ?').bind(objectKey);
}

export function noticePdfCleanupUpsert(
  db: D1Database,
  metadata: Pick<NoticePdfMetadata, 'id' | 'noteId' | 'objectKey'>,
  reason: 'upload_pending' | 'notice_delete',
  delayMinutes: number,
): D1PreparedStatement {
  const normalizedDelay = Math.max(0, Math.floor(delayMinutes));
  return db.prepare(`
    INSERT INTO notice_pdf_cleanup_queue
      (object_key, attachment_id, note_id, reason, not_before, attempts, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now', '+9 hours', ?), 0, '', ${KST_NOW_SQL}, ${KST_NOW_SQL})
    ON CONFLICT(object_key) DO UPDATE SET
      attachment_id = excluded.attachment_id,
      note_id = excluded.note_id,
      reason = excluded.reason,
      not_before = excluded.not_before,
      updated_at = ${KST_NOW_SQL}
  `).bind(metadata.objectKey, metadata.id, metadata.noteId, reason, `+${normalizedDelay} minutes`);
}

export async function queueNoticePdfCleanup(
  db: D1Database,
  metadata: Pick<NoticePdfMetadata, 'id' | 'noteId' | 'objectKey'>,
  reason: 'upload_pending' | 'notice_delete',
  delayMinutes: number,
): Promise<void> {
  await noticePdfCleanupUpsert(db, metadata, reason, delayMinutes).run();
}

export async function stageNoticePdfUpload(
  db: D1Database,
  bucket: R2Bucket,
  metadata: NoticePdfMetadata,
  buffer: ArrayBuffer,
): Promise<void> {
  // Queue first so an R2 put that succeeds but loses its response is recoverable.
  await queueNoticePdfCleanup(db, metadata, 'upload_pending', 60);
  try {
    await bucket.put(metadata.objectKey, buffer, {
      httpMetadata: {
        contentType: 'application/pdf',
        contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`,
      },
      customMetadata: {
        sha256: metadata.sha256,
        noteId: metadata.noteId,
        attachmentId: metadata.id,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await db.prepare(`
      UPDATE notice_pdf_cleanup_queue
      SET attempts = attempts + 1, last_error = ?, updated_at = ${KST_NOW_SQL}
      WHERE object_key = ?
    `).bind(message.slice(0, 500), metadata.objectKey).run().catch(() => undefined);
    throw error;
  }
}

export async function cleanupNoticePdfObjects(
  env: { DB: D1Database; ARTICLE_BUCKET?: R2Bucket },
  limit = 50,
): Promise<NoticePdfCleanupResult> {
  const db = env.DB;
  await ensureNoticePdfTables(db);
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const queued = await db.prepare(`
    SELECT object_key, attachment_id, note_id
    FROM notice_pdf_cleanup_queue
    WHERE not_before <= ${KST_NOW_SQL}
    ORDER BY attempts ASC, not_before ASC, created_at ASC
    LIMIT ?
  `).bind(normalizedLimit).all<{ object_key: string; attachment_id: string | null; note_id: string | null }>();

  const result: NoticePdfCleanupResult = { scanned: 0, deleted: 0, retained: 0, failed: 0, errors: [] };
  for (const row of queued.results || []) {
    result.scanned++;
    try {
      const live = await db.prepare(
        'SELECT id FROM notice_pdf_attachments WHERE object_key = ? LIMIT 1'
      ).bind(row.object_key).first<{ id: string }>();
      if (live) {
        await noticePdfCleanupDelete(db, row.object_key).run();
        result.retained++;
        continue;
      }
      if (!env.ARTICLE_BUCKET) throw new Error('ARTICLE_BUCKET is not configured');
      await env.ARTICLE_BUCKET.delete(row.object_key);
      await noticePdfCleanupDelete(db, row.object_key).run();
      result.deleted++;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed++;
      result.errors.push(`${row.object_key}: ${message.slice(0, 160)}`);
      await db.prepare(`
        UPDATE notice_pdf_cleanup_queue
        SET attempts = attempts + 1,
          not_before = datetime('now', '+9 hours', '+60 minutes'),
          last_error = ?, updated_at = ${KST_NOW_SQL}
        WHERE object_key = ?
      `).bind(message.slice(0, 500), row.object_key).run().catch(() => undefined);
    }
  }
  return result;
}

export async function loadNoticePdfForDelivery(
  db: D1Database,
  bucket: R2Bucket | undefined,
  attachmentId: string,
  mode: 'view' | 'download',
  canRead: (row: NoticePdfAccessRow) => boolean | Promise<boolean>,
): Promise<NoticePdfDeliveryResult> {
  let storage: 'r2' | 'd1' = 'r2';
  let row = await db.prepare(`
    SELECT a.id, a.note_id, a.file_name, a.file_size, a.object_key,
      n.author_id, n.visibility, n.author_branch, n.author_department, n.category
    FROM notice_pdf_attachments a
    JOIN admin_notes n ON n.id = a.note_id
    WHERE a.id = ? AND n.category = 'notice'
    LIMIT 1
  `).bind(attachmentId).first<NoticePdfAccessRow>();
  if (!row) {
    storage = 'd1';
    row = await db.prepare(`
      SELECT a.id, a.note_id, a.file_name, a.file_size,
        n.author_id, n.visibility, n.author_branch, n.author_department, n.category
      FROM admin_note_attachments a
      JOIN admin_notes n ON n.id = a.note_id
      WHERE a.id = ? AND n.category = 'notice'
      LIMIT 1
    `).bind(attachmentId).first<NoticePdfAccessRow>();
  }
  if (!row) return { ok: false, status: 404, error: 'PDF 첨부파일을 찾을 수 없습니다.' };
  if (!await canRead(row)) return { ok: false, status: 403, error: '열람 권한이 없습니다.' };

  let buffer: ArrayBuffer;
  if (storage === 'r2') {
    if (!bucket) return { ok: false, status: 503, error: 'PDF 저장소가 설정되지 않았습니다.' };
    const object = await bucket.get(String(row.object_key || ''));
    if (!object) return { ok: false, status: 404, error: 'PDF 첨부파일 원본을 찾을 수 없습니다.' };
    if (mode === 'view' && object.size > MAX_NOTICE_ATTACHMENT_BYTES) {
      return { ok: false, status: 413, error: '10MB를 넘는 PDF는 다운로드 후 확인해주세요.' };
    }
    buffer = await object.arrayBuffer();
  } else {
    const stored = await db.prepare(
      'SELECT file_data FROM admin_note_attachments WHERE id = ? AND note_id = ? LIMIT 1'
    ).bind(row.id, row.note_id).first<{ file_data: string }>();
    if (!stored) return { ok: false, status: 404, error: 'PDF 첨부파일을 찾을 수 없습니다.' };
    try {
      const parsed = decodeAttachmentDataUrl(
        String(stored.file_data || ''),
        mode === 'view' ? MAX_NOTICE_ATTACHMENT_BYTES : Number.POSITIVE_INFINITY,
      );
      if (!parsed) return { ok: false, status: 415, error: '유효한 PDF 첨부파일이 아닙니다.' };
      buffer = parsed.buffer;
    } catch (error) {
      if (error instanceof NoticeAttachmentValidationError) {
        return { ok: false, status: error.status === 400 ? 415 : error.status, error: error.message };
      }
      throw error;
    }
  }
  if (!hasPdfSignature(buffer)) return { ok: false, status: 415, error: '유효한 PDF 첨부파일이 아닙니다.' };

  return {
    ok: true,
    body: buffer,
    headers: mode === 'view'
      ? noticePdfResponseHeaders(row.file_name, buffer.byteLength)
      : noticePdfDownloadResponseHeaders(row.file_name, buffer.byteLength),
    storage,
  };
}
