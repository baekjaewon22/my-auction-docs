import { SignJWT, jwtVerify } from 'jose';
import { ensureExpenseReceiptSchema } from './expense-receipts.ts';

async function printSigningKey(env: any): Promise<Uint8Array> {
  const dedicated = String(env.PRINT_JWT_SECRET || '').trim();
  if (dedicated.length >= 32) return new TextEncoder().encode(dedicated);
  const general = String(env.JWT_SIGNING_SECRET || '').trim();
  if (general.length < 32) {
    throw new Error('PRINT_JWT_SECRET 또는 32자 이상의 JWT_SIGNING_SECRET이 필요합니다.');
  }
  const separated = new TextEncoder().encode(`print-render-session:${general}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', separated));
}

export async function issuePrintToken(env: any, docId: string): Promise<{ token: string; jti: string }> {
  const db = env.DB as D1Database;
  await ensureExpenseReceiptSchema(db);
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await db.batch([
    db.prepare(`DELETE FROM print_render_sessions
      WHERE datetime(expires_at) < datetime('now') OR datetime(consumed_at) < datetime('now', '-1 day')`),
    db.prepare('INSERT INTO print_render_sessions (jti, document_id, expires_at) VALUES (?, ?, ?)')
      .bind(jti, docId, expiresAt),
  ]);
  const token = await new SignJWT({ sub: 'print-bot', docId })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('print-render-session')
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(await printSigningKey(env));
  return { token, jti };
}

export async function verifyPrintToken(token: string, env: any): Promise<{ docId: string; jti: string } | null> {
  try {
    const { payload } = await jwtVerify(token, await printSigningKey(env), { audience: 'print-render-session' });
    if (payload.sub !== 'print-bot' || typeof payload.docId !== 'string' || typeof payload.jti !== 'string') return null;
    const db = env.DB as D1Database;
    await ensureExpenseReceiptSchema(db);
    const session = await db.prepare(`SELECT document_id FROM print_render_sessions
      WHERE jti=? AND consumed_at IS NULL AND datetime(expires_at) > datetime('now') LIMIT 1`)
      .bind(payload.jti).first<{ document_id: string }>();
    if (!session || session.document_id !== payload.docId) return null;
    return { docId: payload.docId, jti: payload.jti };
  } catch {
    return null;
  }
}

export async function consumePrintRenderSession(db: D1Database, jti: string): Promise<void> {
  await db.prepare(`UPDATE print_render_sessions SET consumed_at=datetime('now')
    WHERE jti=? AND consumed_at IS NULL`).bind(jti).run();
}

export async function cleanupExpiredPrintRenderSessions(db: D1Database): Promise<number> {
  await ensureExpenseReceiptSchema(db);
  const result = await db.prepare(`DELETE FROM print_render_sessions
    WHERE datetime(expires_at) < datetime('now') OR datetime(consumed_at) < datetime('now', '-1 day')`).run();
  return Number(result.meta?.changes || 0);
}
