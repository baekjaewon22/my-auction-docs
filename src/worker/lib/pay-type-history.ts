export type PayType = 'salary' | 'commission';

export type PayTypeHistorySnapshot = {
  pay_type: PayType;
  commission_rate: number;
  salary: number;
  standard_sales: number;
  grade: string;
  position_allowance: number;
  effective_month?: string;
};

export async function ensurePayTypeHistoryTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_pay_type_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      effective_month TEXT NOT NULL,
      pay_type TEXT NOT NULL CHECK (pay_type IN ('salary', 'commission')),
      commission_rate REAL NOT NULL DEFAULT 0,
      salary INTEGER NOT NULL DEFAULT 0,
      standard_sales INTEGER NOT NULL DEFAULT 0,
      grade TEXT NOT NULL DEFAULT '',
      position_allowance INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT '',
      changed_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, effective_month, source)
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_user_pay_type_history_user_month
    ON user_pay_type_history(user_id, effective_month)
  `).run();
}

export function normalizeYearMonth(value: unknown): string {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})$/);
  return match ? text : '';
}

export function currentKstMonth(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function previousMonth(month: string): string {
  const normalized = normalizeYearMonth(month);
  if (!normalized) return '';
  const [yearText, monthText] = normalized.split('-');
  let year = Number(yearText);
  let m = Number(monthText) - 1;
  if (m === 0) {
    year -= 1;
    m = 12;
  }
  return `${year}-${String(m).padStart(2, '0')}`;
}

export async function getPayTypeSnapshotForMonth(
  db: D1Database,
  userId: string,
  month: string,
  fallback: Partial<PayTypeHistorySnapshot> = {},
): Promise<PayTypeHistorySnapshot> {
  await ensurePayTypeHistoryTable(db);
  const row = await db.prepare(`
    SELECT pay_type, commission_rate, salary, standard_sales, grade, position_allowance, effective_month
    FROM user_pay_type_history
    WHERE user_id = ? AND effective_month <= ?
    ORDER BY effective_month DESC, created_at DESC
    LIMIT 1
  `).bind(userId, month).first<any>();

  return {
    pay_type: (row?.pay_type || fallback.pay_type || 'salary') as PayType,
    commission_rate: Number(row?.commission_rate ?? fallback.commission_rate ?? 0),
    salary: Number(row?.salary ?? fallback.salary ?? 0),
    standard_sales: Number(row?.standard_sales ?? fallback.standard_sales ?? 0),
    grade: String(row?.grade ?? fallback.grade ?? ''),
    position_allowance: Number(row?.position_allowance ?? fallback.position_allowance ?? 0),
    effective_month: row?.effective_month,
  };
}

export async function getPayTypeHistoryRows(db: D1Database, userId: string): Promise<PayTypeHistorySnapshot[]> {
  await ensurePayTypeHistoryTable(db);
  const result = await db.prepare(`
    SELECT pay_type, commission_rate, salary, standard_sales, grade, position_allowance, effective_month
    FROM user_pay_type_history
    WHERE user_id = ?
    ORDER BY effective_month ASC, created_at ASC
  `).bind(userId).all<any>();
  return (result.results || []).map((row: any) => ({
    pay_type: (row.pay_type || 'salary') as PayType,
    commission_rate: Number(row.commission_rate || 0),
    salary: Number(row.salary || 0),
    standard_sales: Number(row.standard_sales || 0),
    grade: String(row.grade || ''),
    position_allowance: Number(row.position_allowance || 0),
    effective_month: String(row.effective_month || ''),
  }));
}

export function resolvePayTypeFromHistory(
  rows: PayTypeHistorySnapshot[],
  month: string,
  fallback: PayType,
): PayType {
  let resolved = fallback;
  for (const row of rows) {
    if ((row.effective_month || '') <= month) resolved = row.pay_type;
    else break;
  }
  return resolved;
}

export function payTypeAtMonthSql(userIdExpr: string, monthExpr: string, fallbackExpr: string): string {
  return `COALESCE((
    SELECT h.pay_type
    FROM user_pay_type_history h
    WHERE h.user_id = ${userIdExpr}
      AND h.effective_month <= ${monthExpr}
    ORDER BY h.effective_month DESC, h.created_at DESC
    LIMIT 1
  ), ${fallbackExpr}, 'salary')`;
}
