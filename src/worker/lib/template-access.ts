import type { JwtPayload } from '../types';

type TemplateViewer = Pick<JwtPayload, 'role' | 'login_type'>;
type FreelancerViewer = Pick<JwtPayload, 'login_type'> & Partial<Pick<JwtPayload, 'role'>>;

const TEMPLATE_ADMIN_ROLES = new Set(['master', 'ceo', 'cc_ref', 'admin']);
const templateAccessSchemaByDatabase = new WeakMap<object, Promise<void>>();

export function isFreelancerViewer(user: FreelancerViewer): boolean {
  return user.login_type === 'freelancer' && user.role !== 'master';
}

export function isEmployeeTemplateAdmin(user: TemplateViewer): boolean {
  return !isFreelancerViewer(user) && TEMPLATE_ADMIN_ROLES.has(user.role);
}

export async function ensureTemplateMyAuctionColumn(db: D1Database): Promise<void> {
  const columns = await db.prepare("PRAGMA table_info('templates')").all<{ name: string }>();
  if ((columns.results || []).some((column) => column.name === 'is_myauction')) return;

  try {
    await db.prepare(
      'ALTER TABLE templates ADD COLUMN is_myauction INTEGER NOT NULL DEFAULT 0 CHECK (is_myauction IN (0, 1))'
    ).run();
  } catch (error) {
    const message = String(error || '').toLowerCase();
    if (!message.includes('duplicate column') && !message.includes('already exists')) throw error;
  }
}

export async function ensureDocumentMyAuctionColumn(db: D1Database): Promise<void> {
  const columns = await db.prepare("PRAGMA table_info('documents')").all<{ name: string }>();
  if ((columns.results || []).some((column) => column.name === 'is_myauction')) return;

  try {
    await db.prepare(
      'ALTER TABLE documents ADD COLUMN is_myauction INTEGER NOT NULL DEFAULT 0 CHECK (is_myauction IN (0, 1))'
    ).run();
  } catch (error) {
    const message = String(error || '').toLowerCase();
    if (!message.includes('duplicate column') && !message.includes('already exists')) throw error;
  }
}

async function ensureTemplateAccessSchemaUncached(db: D1Database): Promise<void> {
  await ensureTemplateMyAuctionColumn(db);
  await ensureDocumentMyAuctionColumn(db);
}

export function ensureTemplateAccessSchema(db: D1Database): Promise<void> {
  const key = db as unknown as object;
  const existing = templateAccessSchemaByDatabase.get(key);
  if (existing) return existing;

  const pending = ensureTemplateAccessSchemaUncached(db).catch((error) => {
    templateAccessSchemaByDatabase.delete(key);
    throw error;
  });
  templateAccessSchemaByDatabase.set(key, pending);
  return pending;
}

export async function isMyAuctionTemplate(
  db: D1Database,
  templateId: string | null | undefined,
): Promise<boolean> {
  if (!templateId) return false;
  await ensureTemplateAccessSchema(db);
  const template = await db.prepare(
    'SELECT 1 AS allowed FROM templates WHERE id = ? AND is_active = 1 AND is_myauction = 1 LIMIT 1'
  ).bind(templateId).first<{ allowed: number }>();
  return !!template;
}

export function isMyAuctionDocument(doc: { is_myauction?: number | null }): boolean {
  return doc.is_myauction === 1;
}
