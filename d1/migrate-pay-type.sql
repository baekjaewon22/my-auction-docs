-- 급여제/비율제 구분
ALTER TABLE user_accounting ADD COLUMN pay_type TEXT NOT NULL DEFAULT 'salary' CHECK (pay_type IN ('salary', 'commission'));
ALTER TABLE user_accounting ADD COLUMN commission_rate REAL NOT NULL DEFAULT 0;
