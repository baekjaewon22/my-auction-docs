const schemaPromises = new WeakMap<object, Promise<void>>();

export const MAX_BRIEFING_MATERIAL_BYTES = 50 * 1024 * 1024;
export const BRIEFING_MATERIAL_EXTENSIONS = ['.pdf', '.ppt', '.pptx', '.pptm'] as const;

export async function ensureBriefingMaterialSchema(db: D1Database): Promise<void> {
  const key = db as object;
  const existing = schemaPromises.get(key);
  if (existing) return existing;
  const promise = (async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS briefing_materials (
      id TEXT PRIMARY KEY, uploaded_by TEXT NOT NULL, uploader_name TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '', assignee_user_id TEXT, assignee_name TEXT NOT NULL DEFAULT '',
      case_number TEXT NOT NULL DEFAULT '', material_month TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL, file_type TEXT NOT NULL DEFAULT 'application/octet-stream', file_size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '', drive_status TEXT NOT NULL DEFAULT 'pending', drive_file_id TEXT NOT NULL DEFAULT '',
      drive_folder_path TEXT NOT NULL DEFAULT '', drive_backed_up_at TEXT, drive_attempt_count INTEGER NOT NULL DEFAULT 0,
      drive_error TEXT NOT NULL DEFAULT '', archived_at TEXT, source_admin_note_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    await ensureBriefingMaterialColumn(db, 'source_admin_note_id', 'TEXT');
    await db.batch([
      db.prepare('CREATE INDEX IF NOT EXISTS idx_briefing_materials_active ON briefing_materials(archived_at, created_at DESC)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_briefing_materials_drive ON briefing_materials(drive_status, drive_attempt_count, created_at)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_briefing_materials_scope ON briefing_materials(branch, assignee_user_id, created_at DESC)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_briefing_materials_source_note ON briefing_materials(source_admin_note_id)'),
      db.prepare(`CREATE TABLE IF NOT EXISTS briefing_material_drive_logs (
      id TEXT PRIMARY KEY, material_id TEXT NOT NULL, status TEXT NOT NULL,
      drive_file_id TEXT NOT NULL DEFAULT '', drive_folder_path TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '', triggered_by TEXT NOT NULL DEFAULT 'cron', run_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_briefing_material_drive_logs_material ON briefing_material_drive_logs(material_id, run_at DESC)'),
    ]);
  })();
  schemaPromises.set(key, promise);
  try { await promise; } catch (error) { schemaPromises.delete(key); throw error; }
}

async function ensureBriefingMaterialColumn(db: D1Database, name: string, definition: string): Promise<void> {
  const info = await db.prepare('PRAGMA table_info(briefing_materials)').all<{ name: string }>();
  const hasColumn = (info.results || []).some((column) => column.name === name);
  if (!hasColumn) await db.prepare(`ALTER TABLE briefing_materials ADD COLUMN ${name} ${definition}`).run();
}

export function safeBriefingFileName(value: string): string {
  return Array.from(
    String(value || 'briefing-material'),
    (character) => character.charCodeAt(0) <= 0x1f ? '_' : character,
  ).join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'briefing-material';
}

export function briefingFileExtension(fileName: string): string {
  const match = String(fileName || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] || '';
}

export function isAllowedBriefingFile(fileName: string): boolean {
  return BRIEFING_MATERIAL_EXTENSIONS.includes(briefingFileExtension(fileName) as typeof BRIEFING_MATERIAL_EXTENSIONS[number]);
}

export function briefingMaterialMonth(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}.${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function briefingMaterialObjectKey(month: string, id: string, fileName: string): string {
  return `briefing-materials/${month.replace('.', '-')}/${id}/${safeBriefingFileName(fileName)}`;
}

export async function sha256BriefingMaterial(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
