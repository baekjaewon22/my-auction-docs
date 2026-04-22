-- 세금계산서/현금영수증 발행 기록 (총무 메모용)
ALTER TABLE sales_records ADD COLUMN tax_invoice_date TEXT;
ALTER TABLE sales_records ADD COLUMN tax_invoice_type TEXT; -- '영수' | '계산'
