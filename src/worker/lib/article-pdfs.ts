const OBVIOUS_ARTICLE_TEXT_MOJIBAKE = [
  '\u00bd\u00c3\u00c0\u00e5', // CP949 "\uc2dc\uc7a5" decoded as Latin-1-like text
  '\u00ba\u00ea\u00b8\u00ae\u00c7\u00ce', // CP949 "\ube0c\ub9ac\ud551" decoded byte-for-byte
  '\u00ba\uae2e\u00c7\u00ce', // mixed decoder variant currently received from the Windows agent
  '\u00ef\u00bf\u00bd', // a replacement character that was mojibaked once more
] as const;

const ARTICLE_OBJECT_KEY_PATTERN = /^articles\/(\d{4})\/(\d{2})\/(\d{4}-\d{2}-\d{2})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([^/]+\.pdf)$/i;
const ARTICLE_ORPHAN_SETTLE_GRACE_MS = 24 * 60 * 60 * 1000;
const CP949_MOJIBAKE_ARTIFACT = /[¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿×÷]/u;

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeArticleDate(raw: unknown, kstToday: string): string | null {
  if (!isRealIsoDate(kstToday)) return null;
  const value = String(raw || '').trim() || kstToday;
  return isRealIsoDate(value) && value <= kstToday ? value : null;
}

export function isExpiredArticleDate(articleDate: string, kstToday: string, retentionDays = 31): boolean {
  if (!isRealIsoDate(articleDate) || !isRealIsoDate(kstToday)) return false;
  const expiry = new Date(`${articleDate}T00:00:00Z`);
  expiry.setUTCDate(expiry.getUTCDate() + retentionDays);
  return expiry.toISOString().slice(0, 10) <= kstToday;
}

function cp949DecodedKoreanCount(bytes: Uint8Array): number {
  try {
    const decoded = new TextDecoder('euc-kr', { fatal: true, ignoreBOM: false }).decode(bytes);
    return (decoded.match(/[\uac00-\ud7a3]/g) || []).length;
  } catch {
    // Unsupported labels and invalid byte sequences are not sufficient proof
    // that otherwise-valid Unicode metadata is damaged.
    return 0;
  }
}

function looksLikeCp949ByteRun(value: string): boolean {
  let decodedKoreanCount = 0;
  let artifactCount = 0;
  const matches = Array.from(value.matchAll(/[\u00a1-\u00ff]{2,}/gu));
  for (const match of matches) {
    const bytes = Uint8Array.from(Array.from(match[0]), (character) => character.charCodeAt(0));
    decodedKoreanCount += cp949DecodedKoreanCount(bytes);
    artifactCount += Array.from(match[0]).filter((character) => CP949_MOJIBAKE_ARTIFACT.test(character)).length;
  }
  if (decodedKoreanCount >= 2 && artifactCount > 0) return true;
  const trimmed = value.trim();
  return decodedKoreanCount === 1
    && artifactCount > 0
    && matches.length === 1
    && matches[0][0] === trimmed;
}

function hasSuspiciousPercentEncodedByteRun(value: string): boolean {
  for (const match of value.matchAll(/(?:%[0-9a-f]{2}){4,}/giu)) {
    const bytes = match[0].match(/[0-9a-f]{2}/giu) || [];
    const encoded = Uint8Array.from(bytes, (hex) => Number.parseInt(hex, 16));
    if (cp949DecodedKoreanCount(encoded) >= 2) return true;
  }
  return false;
}

function isExtendedPictographic(character: string | undefined): boolean {
  return Boolean(character && /\p{Extended_Pictographic}/u.test(character));
}

function isEmojiSequenceModifier(character: string | undefined): boolean {
  if (!character) return false;
  const codePoint = character.codePointAt(0) || 0;
  return codePoint === 0xfe0f || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff);
}

function isEmojiZeroWidthJoiner(characters: string[], index: number): boolean {
  let previous = index - 1;
  while (previous >= 0 && isEmojiSequenceModifier(characters[previous])) previous--;
  let next = index + 1;
  while (next < characters.length && isEmojiSequenceModifier(characters[next])) next++;
  return isExtendedPictographic(characters[previous]) && isExtendedPictographic(characters[next]);
}

/**
 * Reject only unmistakably damaged upload metadata. A broad "non-ASCII" rule
 * would incorrectly block valid Korean and sources such as Caf\u00e9 or M\u00fcnchen.
 */
export function hasObviousArticleTextEncodingDamage(
  value: unknown,
  options: { inspectPercentEncodedBytes?: boolean } = {},
): boolean {
  const text = String(value ?? '');
  if (!text) return false;
  const characters = Array.from(text);
  for (const [index, character] of characters.entries()) {
    const codePoint = character.codePointAt(0) || 0;
    const disallowedControl = (codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint))
      || (codePoint >= 0x7f && codePoint <= 0x9f);
    const invalidJoiner = codePoint === 0x200d && !isEmojiZeroWidthJoiner(characters, index);
    const invisibleFormat = (codePoint >= 0x200b && codePoint <= 0x200c)
      || (codePoint >= 0x200e && codePoint <= 0x200f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2060 && codePoint <= 0x206f)
      || codePoint === 0xfeff;
    if (disallowedControl || invalidJoiner || invisibleFormat || codePoint === 0xfffd) return true;
  }
  if (OBVIOUS_ARTICLE_TEXT_MOJIBAKE.some((fragment) => text.includes(fragment))) return true;
  if (looksLikeCp949ByteRun(text)) return true;
  return options.inspectPercentEncodedBytes !== false && hasSuspiciousPercentEncodedByteRun(text);
}

export function articleDateFromCanonicalObjectKey(objectKey: string): string | null {
  if (objectKey.length > 512) return null;
  const match = ARTICLE_OBJECT_KEY_PATTERN.exec(objectKey);
  if (!match || !isRealIsoDate(match[3])) return null;
  if (match[1] !== match[3].slice(0, 4) || match[2] !== match[3].slice(5, 7)) return null;
  return match[3];
}

export function isCanonicalArticleObjectExpired(objectKey: string, kstToday: string): boolean {
  if (!isRealIsoDate(kstToday)) return false;
  const articleDate = articleDateFromCanonicalObjectKey(objectKey);
  if (!articleDate) return false;
  return isExpiredArticleDate(articleDate, kstToday);
}

function kstDateAt(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type CleanupResult = {
  scanned: number;
  deleted: number;
  failed: number;
  errors: string[];
};

export async function ensureArticlePdfTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS article_pdf_uploads (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      article_date TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      uploaded_by TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', '+9 hours')),
      deleted_at TEXT,
      FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_article_pdf_note ON article_pdf_uploads(note_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_article_pdf_expires ON article_pdf_uploads(expires_at, deleted_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_article_pdf_sha ON article_pdf_uploads(sha256)').run();
}

export async function sha256Hex(input: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function decodeArticleUploadHeader(raw: string | undefined, fallback = ''): string {
  const value = raw || fallback;
  return /%[0-9a-f]{2}/i.test(value) ? decodeURIComponent(value) : value;
}

export function safePdfFileName(name: string): string {
  const base = String(name || 'article.pdf').replace(/[\\/:*?"<>|]+/g, '_').trim();
  const stem = base.toLowerCase().endsWith('.pdf') ? base.slice(0, -4) : base;
  const truncatedStem = Array.from(stem || 'article').slice(0, 176).join('');
  return `${truncatedStem}.pdf`;
}

export function articleObjectKey(articleDate: string, id: string, fileName: string): string {
  const ym = articleDate.slice(0, 7).replace('-', '/');
  return `articles/${ym}/${articleDate}_${id}_${safePdfFileName(fileName)}`;
}

async function cleanupExpiredArticleObjectOrphans(
  db: D1Database,
  bucket: R2Bucket,
  limit: number,
  now: Date,
): Promise<CleanupResult> {
  let scanned = 0;
  let deleted = 0;
  let failed = 0;
  const errors: string[] = [];
  const kstToday = kstDateAt(now);
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  while (scanned < limit) {
    let page: R2Objects;
    try {
      page = await bucket.list({ prefix: 'articles/', cursor, limit: 1000 });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failed++;
      errors.push(`orphan-list: ${message.slice(0, 160)}`);
      break;
    }

    let stopForReferenceFailure = false;
    for (const object of page.objects) {
      if (scanned >= limit) break;
      if (!isCanonicalArticleObjectExpired(object.key, kstToday)) continue;
      const uploadedAt = object.uploaded instanceof Date ? object.uploaded.getTime() : Number.NaN;
      if (!Number.isFinite(uploadedAt) || uploadedAt > now.getTime() - ARTICLE_ORPHAN_SETTLE_GRACE_MS) continue;

      let liveReference: { object_key: string } | null;
      try {
        liveReference = await db.prepare(
          'SELECT object_key FROM article_pdf_uploads WHERE object_key = ? LIMIT 1',
        ).bind(object.key).first<{ object_key: string }>();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        scanned++;
        failed++;
        errors.push(`orphan-ref ${object.key}: ${message.slice(0, 120)}`);
        stopForReferenceFailure = true;
        break;
      }
      if (liveReference) continue;

      scanned++;
      try {
        await bucket.delete(object.key);
        deleted++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        failed++;
        errors.push(`orphan-delete ${object.key}: ${message.slice(0, 120)}`);
      }
    }

    if (stopForReferenceFailure) break;

    if (!page.truncated || scanned >= limit) break;
    if (!page.cursor || seenCursors.has(page.cursor)) {
      failed++;
      errors.push('orphan-list: invalid or repeated R2 cursor');
      break;
    }
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  }

  return { scanned, deleted, failed, errors };
}

export async function cleanupExpiredArticlePdfs(env: { DB: D1Database; ARTICLE_BUCKET?: R2Bucket }, limit = 50): Promise<CleanupResult> {
  const db = env.DB;
  await ensureArticlePdfTable(db);
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const rows = await db.prepare(`
    SELECT id, note_id, object_key
    FROM article_pdf_uploads
    WHERE date(article_date, '+31 days') <= date('now', '+9 hours')
    ORDER BY random()
    LIMIT ?
  `).bind(normalizedLimit).all<{ id: string; note_id: string; object_key: string }>();

  let scanned = rows.results?.length || 0;
  let deleted = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const row of rows.results || []) {
    try {
      if (!env.ARTICLE_BUCKET) throw new Error('ARTICLE_BUCKET is not configured');
      // R2 deletion is idempotent. Only after it succeeds do we atomically
      // remove the metadata, the exact generated note, and its dependent rows.
      await env.ARTICLE_BUCKET.delete(row.object_key);
      const results = await db.batch([
        db.prepare(`DELETE FROM admin_note_comments
          WHERE note_id = ? AND EXISTS (
            SELECT 1 FROM admin_notes n
            WHERE n.id = ? AND n.category = 'article_news'
              AND n.source_type = 'article_pdf' AND n.source_id = ?
          )`).bind(row.note_id, row.note_id, row.id),
        db.prepare(`DELETE FROM admin_note_view_logs
          WHERE note_id = ? AND EXISTS (
            SELECT 1 FROM admin_notes n
            WHERE n.id = ? AND n.category = 'article_news'
              AND n.source_type = 'article_pdf' AND n.source_id = ?
          )`).bind(row.note_id, row.note_id, row.id),
        db.prepare(`DELETE FROM admin_note_attachments
          WHERE note_id = ? AND EXISTS (
            SELECT 1 FROM admin_notes n
            WHERE n.id = ? AND n.category = 'article_news'
              AND n.source_type = 'article_pdf' AND n.source_id = ?
          )`).bind(row.note_id, row.note_id, row.id),
        db.prepare('DELETE FROM article_pdf_uploads WHERE id = ? AND note_id = ?').bind(row.id, row.note_id),
        db.prepare(`DELETE FROM admin_notes
          WHERE id = ? AND category = 'article_news'
            AND source_type = 'article_pdf' AND source_id = ?`).bind(row.note_id, row.id),
      ]);
      const articleDelete = results[3] as { meta?: { changes?: number } } | undefined;
      if (Number(articleDelete?.meta?.changes || 0) > 0) deleted++;
    } catch (err: unknown) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${row.id}: ${message.slice(0, 160)}`);
    }
  }

  const orphanLimit = Math.max(0, normalizedLimit - (rows.results?.length || 0));
  if (orphanLimit > 0 && env.ARTICLE_BUCKET) {
    const orphanResult = await cleanupExpiredArticleObjectOrphans(db, env.ARTICLE_BUCKET, orphanLimit, new Date());
    scanned += orphanResult.scanned;
    deleted += orphanResult.deleted;
    failed += orphanResult.failed;
    errors.push(...orphanResult.errors);
  }

  return { scanned, deleted, failed, errors };
}

interface D1Database {
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  prepare(query: string): D1PreparedStatement;
}
