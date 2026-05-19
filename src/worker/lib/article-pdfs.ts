const KST_NOW_SQL = "datetime('now', '+9 hours')";

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

export function safePdfFileName(name: string): string {
  const base = String(name || 'article.pdf').replace(/[\\/:*?"<>|]+/g, '_').trim();
  return (base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`).slice(0, 180);
}

export function articleObjectKey(articleDate: string, id: string, fileName: string): string {
  const ym = articleDate.slice(0, 7).replace('-', '/');
  return `articles/${ym}/${articleDate}_${id}_${safePdfFileName(fileName)}`;
}

export async function cleanupExpiredArticlePdfs(env: { DB: D1Database; ARTICLE_BUCKET?: R2Bucket }, limit = 50): Promise<CleanupResult> {
  const db = env.DB;
  await ensureArticlePdfTable(db);
  const rows = await db.prepare(`
    SELECT id, object_key
    FROM article_pdf_uploads
    WHERE deleted_at IS NULL
      AND expires_at <= date('now', '+9 hours')
    ORDER BY expires_at ASC
    LIMIT ?
  `).bind(limit).all<{ id: string; object_key: string }>();

  let deleted = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const row of rows.results || []) {
    try {
      if (env.ARTICLE_BUCKET) await env.ARTICLE_BUCKET.delete(row.object_key);
      await db.prepare(`UPDATE article_pdf_uploads SET deleted_at = ${KST_NOW_SQL} WHERE id = ?`).bind(row.id).run();
      deleted++;
    } catch (err: any) {
      failed++;
      errors.push(`${row.id}: ${String(err?.message || err).slice(0, 160)}`);
    }
  }

  return { scanned: rows.results?.length || 0, deleted, failed, errors };
}

interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
      first<T = unknown>(): Promise<T | null>;
    };
    run(): Promise<unknown>;
  };
}
