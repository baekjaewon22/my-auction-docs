import { SignJWT, jwtVerify } from 'jose';

export const DRIVE_OAUTH_ADMIN_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'] as const;

async function stateSigningKey(clientSecret: string): Promise<Uint8Array> {
  if (!clientSecret) throw new Error('GOOGLE_CLIENT_SECRET is required for OAuth state signing');
  const material = new TextEncoder().encode(`drive-oauth-state-v2\0${clientSecret}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
}

export async function signDriveOAuthState(clientSecret: string, userId: string, nonce: string): Promise<string> {
  return new SignJWT({ sub: userId, nonce })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(await stateSigningKey(clientSecret));
}

export async function verifyDriveOAuthState(
  clientSecret: string,
  state: string,
): Promise<{ userId: string; nonce: string }> {
  const { payload } = await jwtVerify(state, await stateSigningKey(clientSecret), {
    algorithms: ['HS256'],
  });
  const userId = String(payload.sub || '').trim();
  const nonce = String(payload.nonce || '').trim();
  if (!userId || !nonce) throw new Error('OAuth state payload is incomplete');
  return { userId, nonce };
}

export async function ensureDriveOAuthStateTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS drive_oauth_states (
      nonce TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_drive_oauth_states_expiry ON drive_oauth_states(expires_at)').run();
}

export async function createDriveOAuthState(db: D1Database, userId: string, clientSecret: string): Promise<string> {
  await ensureDriveOAuthStateTable(db);
  const nonce = crypto.randomUUID();
  await db.prepare("DELETE FROM drive_oauth_states WHERE expires_at <= datetime('now') OR used_at IS NOT NULL").run();
  await db.prepare(`
    INSERT INTO drive_oauth_states (nonce, user_id, expires_at)
    VALUES (?, ?, datetime('now', '+10 minutes'))
  `).bind(nonce, userId).run();
  return signDriveOAuthState(clientSecret, userId, nonce);
}

export async function consumeDriveOAuthState(db: D1Database, userId: string, nonce: string): Promise<boolean> {
  await ensureDriveOAuthStateTable(db);
  const result = await db.prepare(`
    UPDATE drive_oauth_states
    SET used_at = datetime('now')
    WHERE nonce = ? AND user_id = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).bind(nonce, userId).run();
  return Number(result.meta?.changes || 0) === 1;
}
