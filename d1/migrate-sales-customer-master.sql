-- 고객 마스터: 담당자별 고객을 이름+대표 전화번호로 구분하고 복수 연락처·주소·사건을 연결한다.
CREATE TABLE IF NOT EXISTS sales_customers (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  primary_phone TEXT NOT NULL DEFAULT '',
  primary_phone_digits TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (owner_user_id) REFERENCES users(id),
  UNIQUE (owner_user_id, normalized_name, primary_phone_digits)
);

CREATE TABLE IF NOT EXISTS sales_customer_contacts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_digits TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '본인',
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id) ON DELETE CASCADE,
  UNIQUE (customer_id, phone_digits)
);

CREATE TABLE IF NOT EXISTS sales_customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  address TEXT NOT NULL,
  address_detail TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '기본',
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sales_customer_cases (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  court TEXT NOT NULL DEFAULT '',
  case_number TEXT NOT NULL,
  item_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '진행',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id) ON DELETE CASCADE,
  UNIQUE (customer_id, court, case_number, item_number)
);

ALTER TABLE sales_records ADD COLUMN customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_customers_owner_name ON sales_customers(owner_user_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_sales_customer_contacts_phone ON sales_customer_contacts(phone_digits);
CREATE INDEX IF NOT EXISTS idx_sales_customer_addresses_customer ON sales_customer_addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer_cases_customer ON sales_customer_cases(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer_cases_number ON sales_customer_cases(case_number);
CREATE INDEX IF NOT EXISTS idx_sales_records_customer ON sales_records(customer_id);

-- 기존 계약·낙찰 중 전화번호가 있는 행을 고객 마스터로 안전하게 묶는다.
INSERT OR IGNORE INTO sales_customers (
  id, owner_user_id, name, normalized_name, primary_phone, primary_phone_digits, created_at, updated_at
)
SELECT
  'customer-legacy-' || MIN(id),
  user_id,
  MIN(client_name),
  LOWER(REPLACE(TRIM(client_name), ' ', '')),
  MIN(client_phone),
  REPLACE(REPLACE(REPLACE(REPLACE(MIN(client_phone), '-', ''), ' ', ''), '(', ''), ')', ''),
  MIN(created_at),
  MAX(updated_at)
FROM sales_records
WHERE type IN ('계약', '낙찰')
  AND COALESCE(TRIM(client_name), '') != ''
  AND LENGTH(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(client_phone, ''), '-', ''), ' ', ''), '(', ''), ')', '')) >= 10
GROUP BY
  user_id,
  LOWER(REPLACE(TRIM(client_name), ' ', '')),
  REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(client_phone, ''), '-', ''), ' ', ''), '(', ''), ')', '');

INSERT OR IGNORE INTO sales_customer_contacts (id, customer_id, phone, phone_digits, label, is_primary)
SELECT
  'contact-' || sc.id,
  sc.id,
  sc.primary_phone,
  sc.primary_phone_digits,
  '본인',
  1
FROM sales_customers sc
WHERE sc.primary_phone_digits != '';

UPDATE sales_records
SET customer_id = (
  SELECT sc.id
  FROM sales_customers sc
  WHERE sc.owner_user_id = sales_records.user_id
    AND sc.normalized_name = LOWER(REPLACE(TRIM(sales_records.client_name), ' ', ''))
    AND sc.primary_phone_digits = REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(sales_records.client_phone, ''), '-', ''), ' ', ''), '(', ''), ')', '')
  LIMIT 1
)
WHERE customer_id IS NULL
  AND type IN ('계약', '낙찰')
  AND COALESCE(client_phone, '') != '';
