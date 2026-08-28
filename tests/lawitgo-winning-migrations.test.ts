import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';

const baseSchema = readFileSync(new URL('../d1/schema.sql', import.meta.url), 'utf8');
const salesMigration = readFileSync(new URL('../d1/migrate-sales.sql', import.meta.url), 'utf8');
const outboxMigration = readFileSync(new URL('../d1/migrate-lawitgo-winning-outbox.sql', import.meta.url), 'utf8');
const overrideMigration = readFileSync(new URL('../d1/migrate-lawitgo-winning-overrides.sql', import.meta.url), 'utf8');
const auditGuardMigration = readFileSync(new URL('../d1/migrate-lawitgo-winning-audit-delete-guard.sql', import.meta.url), 'utf8');

test('base schema bootstraps before the separate sales migration exists', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  assert.doesNotThrow(() => db.exec(baseSchema));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lawitgo_winning_outbox'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lawitgo_winning_overrides'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='alert_approval_pending'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drive_settings'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drive_backup_logs'").get());
  assert.ok(db.prepare("SELECT id FROM drive_settings WHERE id='default'").get());
  const documentColumns = new Set(
    (db.prepare("PRAGMA table_info('documents')").all() as Array<{ name: string }>).map((column) => column.name),
  );
  assert.ok(documentColumns.has('cancel_requested'));
  assert.ok(documentColumns.has('cancel_reason'));
  assert.ok(documentColumns.has('cancelled'));
  const driveSettingColumns = new Set(
    (db.prepare("PRAGMA table_info('drive_settings')").all() as Array<{ name: string }>).map((column) => column.name),
  );
  for (const required of [
    'refresh_token_encrypted', 'token_iv', 'auto_enabled',
    'last_cron_run_at', 'last_cron_status', 'last_cron_summary',
  ]) {
    assert.ok(driveSettingColumns.has(required));
  }
  const userColumns = new Set(
    (db.prepare("PRAGMA table_info('users')").all() as Array<{ name: string }>).map((column) => column.name),
  );
  assert.ok(userColumns.has('login_type'));
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_sales_records_preserve_lawitgo_audit'").get(),
    undefined,
  );

  db.close();
});

test('Lawitgo winning migrations are idempotent and install the delete guard after sales', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(baseSchema);
  db.exec(salesMigration);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    db.exec(outboxMigration);
    db.exec(overrideMigration);
    db.exec(auditGuardMigration);
  }

  assert.ok(
    db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_sales_records_preserve_lawitgo_audit'").get(),
  );

  db.prepare(`INSERT INTO users (id, email, password_hash, name, approved)
    VALUES ('master-1', 'master@example.com', 'hash', 'Master', 1)`).run();
  db.prepare(`INSERT INTO sales_records (id, user_id, type, status)
    VALUES ('pending-sale', 'master-1', '기타', 'pending'),
           ('sent-sale', 'master-1', '기타', 'pending')`).run();
  db.prepare(`INSERT INTO lawitgo_winning_outbox (id, sales_record_id, status)
    VALUES ('pending-outbox', 'pending-sale', 'pending'),
           ('sent-outbox', 'sent-sale', 'sent')`).run();
  db.prepare(`INSERT INTO lawitgo_winning_overrides (
      sales_record_id, customer_name, customer_phone, court, case_number,
      property_type, winning_date, assignee_user_id, updated_by
    ) VALUES ('pending-sale', 'Customer', '01012345678', 'Court', '2026case1',
      'Apartment', '2026-08-24', 'master-1', 'master-1')`).run();

  db.prepare("DELETE FROM sales_records WHERE id='pending-sale'").run();
  assert.equal(db.prepare("SELECT id FROM lawitgo_winning_outbox WHERE sales_record_id='pending-sale'").get(), undefined);
  assert.equal(db.prepare("SELECT sales_record_id FROM lawitgo_winning_overrides WHERE sales_record_id='pending-sale'").get(), undefined);

  assert.throws(
    () => db.prepare("DELETE FROM sales_records WHERE id='sent-sale'").run(),
    /LAWITGO_WINNING_AUDIT_LOCKED/,
  );
  assert.ok(db.prepare("SELECT id FROM sales_records WHERE id='sent-sale'").get());
  assert.ok(db.prepare("SELECT id FROM lawitgo_winning_outbox WHERE sales_record_id='sent-sale'").get());

  db.close();
});
