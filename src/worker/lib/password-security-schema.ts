const CREATE_PASSWORD_RESET_CHALLENGES_SQL = `
  CREATE TABLE IF NOT EXISTS password_reset_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    verified_at INTEGER,
    reset_token_hash TEXT UNIQUE,
    reset_expires_at INTEGER,
    consumed_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`;

export function passwordSecuritySchemaStatements(hasAuthVersion: boolean): string[] {
  return [
    ...(!hasAuthVersion
      ? ['ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0']
      : []),
    CREATE_PASSWORD_RESET_CHALLENGES_SQL,
    'CREATE INDEX IF NOT EXISTS idx_password_reset_user_created ON password_reset_challenges(user_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_challenges(reset_token_hash)',
  ];
}

export async function ensurePasswordSecuritySchema(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
  let hasAuthVersion = (columns.results || []).some((column) => column.name === 'auth_version');

  for (const statement of passwordSecuritySchemaStatements(hasAuthVersion)) {
    try {
      await db.prepare(statement).run();
    } catch (error) {
      if (!statement.startsWith('ALTER TABLE users ADD COLUMN auth_version')) throw error;

      // 동시에 시작한 다른 Worker가 먼저 열을 추가했는지 확인한다.
      const refreshed = await db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
      hasAuthVersion = (refreshed.results || []).some((column) => column.name === 'auth_version');
      if (!hasAuthVersion) throw error;
    }
  }
}
