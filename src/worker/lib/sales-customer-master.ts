import { isValidCustomerPhone, normalizeCustomerName, normalizeCustomerPhone } from '../../shared/sales-customer-identity.ts';

const schemaPromises = new WeakMap<object, Promise<void>>();

export async function ensureSalesCustomerSchema(db: D1Database): Promise<void> {
  const key = db as object;
  const current = schemaPromises.get(key);
  if (current) return current;
  const promise = (async () => {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS sales_customers (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL,
        normalized_name TEXT NOT NULL, primary_phone TEXT NOT NULL DEFAULT '',
        primary_phone_digits TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
        UNIQUE (owner_user_id, normalized_name, primary_phone_digits)
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS sales_customer_contacts (
        id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, phone TEXT NOT NULL,
        phone_digits TEXT NOT NULL, label TEXT NOT NULL DEFAULT '본인',
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
        UNIQUE (customer_id, phone_digits)
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS sales_customer_addresses (
        id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, address TEXT NOT NULL,
        address_detail TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '기본',
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS sales_customer_cases (
        id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, court TEXT NOT NULL DEFAULT '',
        case_number TEXT NOT NULL, item_number TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '진행',
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
        UNIQUE (customer_id, court, case_number, item_number)
      )`),
    ]);
    const columns = await db.prepare('PRAGMA table_info(sales_records)').all<{ name: string }>();
    if (!(columns.results || []).some(column => column.name === 'customer_id')) {
      await db.prepare('ALTER TABLE sales_records ADD COLUMN customer_id TEXT').run();
    }
    await db.batch([
      db.prepare('CREATE INDEX IF NOT EXISTS idx_sales_customers_owner_name ON sales_customers(owner_user_id, normalized_name)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_sales_customer_contacts_phone ON sales_customer_contacts(phone_digits)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_sales_customer_addresses_customer ON sales_customer_addresses(customer_id)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_sales_customer_cases_customer ON sales_customer_cases(customer_id)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_sales_customer_cases_number ON sales_customer_cases(case_number)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_sales_records_customer ON sales_records(customer_id)'),
    ]);
  })();
  schemaPromises.set(key, promise);
  try { await promise; } catch (error) { schemaPromises.delete(key); throw error; }
}

export type SalesCustomerCandidate = {
  id: string;
  owner_user_id: string;
  name: string;
  primary_phone: string;
  phones: string[];
  addresses: string[];
  cases: Array<{ court: string; case_number: string; item_number: string; status: string }>;
};

export async function searchSalesCustomers(db: D1Database, ownerId: string, query: string, limit = 10): Promise<SalesCustomerCandidate[]> {
  await ensureSalesCustomerSchema(db);
  const normalizedQuery = normalizeCustomerName(query);
  if (!normalizedQuery) return [];
  const customers = await db.prepare(`
    SELECT id, owner_user_id, name, primary_phone
    FROM sales_customers
    WHERE owner_user_id = ? AND normalized_name LIKE ?
    ORDER BY CASE WHEN normalized_name = ? THEN 0 ELSE 1 END, updated_at DESC
    LIMIT ?
  `).bind(ownerId, `${normalizedQuery}%`, normalizedQuery, Math.min(Math.max(limit, 1), 20)).all<{
    id: string; owner_user_id: string; name: string; primary_phone: string;
  }>();
  const rows = customers.results || [];
  if (rows.length === 0) return [];
  const ids = rows.map(customer => customer.id);
  const placeholders = ids.map(() => '?').join(',');
  const [contacts, addresses, cases] = await Promise.all([
    db.prepare(`SELECT customer_id, phone FROM sales_customer_contacts WHERE customer_id IN (${placeholders}) ORDER BY is_primary DESC, created_at`).bind(...ids).all<{ customer_id: string; phone: string }>(),
    db.prepare(`SELECT customer_id, TRIM(address || ' ' || address_detail) AS address FROM sales_customer_addresses WHERE customer_id IN (${placeholders}) ORDER BY is_primary DESC, created_at DESC`).bind(...ids).all<{ customer_id: string; address: string }>(),
    db.prepare(`SELECT customer_id, court, case_number, item_number, status FROM sales_customer_cases WHERE customer_id IN (${placeholders}) ORDER BY updated_at DESC`).bind(...ids).all<{ customer_id: string; court: string; case_number: string; item_number: string; status: string }>(),
  ]);
  return rows.map(customer => ({
    ...customer,
    phones: (contacts.results || []).filter(row => row.customer_id === customer.id).map(row => row.phone),
    addresses: (addresses.results || []).filter(row => row.customer_id === customer.id).slice(0, 3).map(row => row.address).filter(Boolean),
    cases: (cases.results || []).filter(row => row.customer_id === customer.id).slice(0, 5).map(row => ({
      court: row.court,
      case_number: row.case_number,
      item_number: row.item_number,
      status: row.status,
    })),
  }));
}

export async function resolveSalesCustomer(
  db: D1Database,
  input: { ownerId: string; name: string; phone: string; customerId?: string | null },
): Promise<{ id: string; name: string; phone: string }> {
  await ensureSalesCustomerSchema(db);
  const normalizedName = normalizeCustomerName(input.name);
  const phoneDigits = normalizeCustomerPhone(input.phone);
  if (!normalizedName || !isValidCustomerPhone(phoneDigits)) throw new Error('고객 이름과 전화번호를 확인해 주세요.');

  if (input.customerId) {
    const selected = await db.prepare(`
      SELECT sc.id, sc.name, sc.primary_phone
      FROM sales_customers sc
      WHERE sc.id = ? AND sc.owner_user_id = ?
    `).bind(input.customerId, input.ownerId).first<{ id: string; name: string; primary_phone: string }>();
    if (!selected) throw new Error('선택한 고객을 찾을 수 없습니다.');
    const contact = await db.prepare('SELECT phone FROM sales_customer_contacts WHERE customer_id = ? AND phone_digits = ?')
      .bind(selected.id, phoneDigits).first<{ phone: string }>();
    if (normalizeCustomerName(selected.name) !== normalizedName || !contact) {
      throw new Error('선택한 고객 정보가 변경되었습니다. 고객을 다시 선택하거나 새 고객으로 작성해 주세요.');
    }
    return { id: selected.id, name: selected.name, phone: contact.phone };
  }

  const existing = await db.prepare(`
    SELECT id, name, primary_phone FROM sales_customers
    WHERE owner_user_id = ? AND normalized_name = ? AND primary_phone_digits = ?
  `).bind(input.ownerId, normalizedName, phoneDigits).first<{ id: string; name: string; primary_phone: string }>();
  if (existing) return { id: existing.id, name: existing.name, phone: existing.primary_phone };

  const id = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO sales_customers
      (id, owner_user_id, name, normalized_name, primary_phone, primary_phone_digits)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, input.ownerId, input.name.trim(), normalizedName, input.phone.trim(), phoneDigits),
    db.prepare(`INSERT OR IGNORE INTO sales_customer_contacts
      (id, customer_id, phone, phone_digits, label, is_primary)
      SELECT ?, id, ?, ?, '본인', 1 FROM sales_customers
      WHERE owner_user_id = ? AND normalized_name = ? AND primary_phone_digits = ?`)
      .bind(contactId, input.phone.trim(), phoneDigits, input.ownerId, normalizedName, phoneDigits),
  ]);
  const created = await db.prepare(`SELECT id, name, primary_phone FROM sales_customers
    WHERE owner_user_id = ? AND normalized_name = ? AND primary_phone_digits = ?`)
    .bind(input.ownerId, normalizedName, phoneDigits).first<{ id: string; name: string; primary_phone: string }>();
  if (!created) throw new Error('고객 마스터를 생성하지 못했습니다.');
  return { id: created.id, name: created.name, phone: created.primary_phone };
}

export async function linkSalesCustomerCase(
  db: D1Database,
  customerId: string,
  input: { court?: string; caseNumber?: string; itemNumber?: string; status?: string },
): Promise<void> {
  const caseNumber = String(input.caseNumber || '').trim();
  if (!caseNumber) return;
  await ensureSalesCustomerSchema(db);
  await db.prepare(`INSERT OR IGNORE INTO sales_customer_cases
    (id, customer_id, court, case_number, item_number, status)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), customerId, String(input.court || '').trim(), caseNumber, String(input.itemNumber || '').trim(), String(input.status || '진행')).run();
}
