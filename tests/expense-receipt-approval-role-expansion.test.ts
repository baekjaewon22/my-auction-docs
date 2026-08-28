import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';

const TRIGGER_SOURCES = [
  'src/worker/lib/expense-receipt-approval.ts',
  'd1/schema.sql',
  'd1/migrate-expense-receipt-approval.sql',
  'd1/migrate-expense-receipt-approval-roles.sql',
] as const;

test('runtime, base schema, original migration, and forward migration keep the same actor guard', () => {
  for (const file of TRIGGER_SOURCES) {
    const source = readFileSync(file, 'utf8');
    const guardStart = source.indexOf('trg_expense_receipt_approval_action_guard');
    assert.notEqual(guardStart, -1, `${file}: action guard is missing`);
    const guard = source.slice(guardStart, guardStart + 5_500);
    assert.match(guard, /d\.author_id != NEW\.actual_actor_id/, file);
    assert.match(guard, /actor\.approved = 1/, file);
    assert.match(guard, /COALESCE\(actor\.login_type, 'employee'\) != 'freelancer'/, file);
    assert.match(guard, /actor\.role = 'master'/, file);
    assert.match(
      guard,
      /actor\.role = 'ceo'[\s\S]*?representative_step\.id = NEW\.approval_step_id[\s\S]*?representative_step\.document_id = NEW\.document_id[\s\S]*?representative_step\.approver_id = actor\.id/,
      file,
    );
    assert.match(
      guard,
      /expense_receipt_approval_delegates delegate[\s\S]*?delegate\.role_snapshot = actor\.role/,
      file,
    );
  }
});

test('the forward migration permits only assigned CEO, master, or snapshotted accounting actors', () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 1,
      login_type TEXT NOT NULL DEFAULT 'employee'
    );
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, template_id TEXT NOT NULL, author_id TEXT NOT NULL,
      status TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE approval_steps (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, approver_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE expense_receipt_approval_delegates (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, approval_step_id TEXT NOT NULL,
      user_id TEXT NOT NULL, role_snapshot TEXT NOT NULL
    );
    CREATE TABLE expense_receipt_approval_actions (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, approval_step_id TEXT NOT NULL,
      action TEXT NOT NULL, actual_actor_id TEXT NOT NULL,
      actual_actor_name TEXT NOT NULL, actual_actor_role TEXT NOT NULL,
      representative_user_id TEXT, used_representative_stamp INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '', ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO users (id, name, role) VALUES
      ('author', '작성자', 'member'),
      ('ceo', '대표', 'ceo'),
      ('ceo-other', '다른 대표', 'ceo'),
      ('master', '마스터', 'master'),
      ('accountant', '총무담당', 'accountant');
    INSERT INTO users (id, name, role, login_type)
      VALUES ('freelancer-master', '프리랜서 마스터', 'master', 'freelancer');
  `);
  sqlite.exec(readFileSync('d1/migrate-expense-receipt-approval-roles.sql', 'utf8'));

  const addReadyDocument = (id: string, authorId = 'author') => {
    sqlite.prepare(`INSERT INTO documents
      (id, template_id, author_id, status) VALUES (?, 'tpl-exp-receipt-001', ?, 'submitted')`)
      .run(id, authorId);
    sqlite.prepare(`INSERT INTO approval_steps
      (id, document_id, approver_id, status) VALUES (?, ?, 'ceo', 'approved')`)
      .run(`${id}-step`, id);
  };
  const insertAction = sqlite.prepare(`INSERT INTO expense_receipt_approval_actions
    (id, document_id, approval_step_id, action, actual_actor_id, actual_actor_name,
     actual_actor_role, representative_user_id, used_representative_stamp)
    VALUES (?, ?, ?, 'approved', ?, 'actor', ?, 'ceo', 1)`);

  addReadyDocument('ceo-ok');
  assert.doesNotThrow(() => insertAction.run(
    'ceo-ok-action', 'ceo-ok', 'ceo-ok-step', 'ceo', 'ceo',
  ));

  addReadyDocument('wrong-ceo');
  assert.throws(() => insertAction.run(
    'wrong-ceo-action', 'wrong-ceo', 'wrong-ceo-step', 'ceo-other', 'ceo',
  ), /cannot be acted on/);

  addReadyDocument('master-ok');
  assert.doesNotThrow(() => insertAction.run(
    'master-ok-action', 'master-ok', 'master-ok-step', 'master', 'master',
  ));

  addReadyDocument('accountant-ok');
  sqlite.prepare(`INSERT INTO expense_receipt_approval_delegates
    (id, document_id, approval_step_id, user_id, role_snapshot)
    VALUES ('accountant-snapshot', 'accountant-ok', 'accountant-ok-step', 'accountant', 'accountant')`).run();
  assert.doesNotThrow(() => insertAction.run(
    'accountant-ok-action', 'accountant-ok', 'accountant-ok-step', 'accountant', 'accountant',
  ));

  addReadyDocument('freelancer-blocked');
  assert.throws(() => insertAction.run(
    'freelancer-action', 'freelancer-blocked', 'freelancer-blocked-step',
    'freelancer-master', 'master',
  ), /cannot be acted on/);

  addReadyDocument('self-blocked', 'master');
  assert.throws(() => insertAction.run(
    'self-action', 'self-blocked', 'self-blocked-step', 'master', 'master',
  ), /cannot be acted on/);
  sqlite.close();
});

test('receipt approve and reject routes retain the human-login gate', () => {
  const route = readFileSync('src/worker/routes/documents.ts', 'utf8');
  for (const endpoint of ["documents.post('/:id/approve'", "documents.post('/:id/reject'"]) {
    const start = route.indexOf(endpoint);
    assert.notEqual(start, -1);
    const receiptBranch = route.slice(start, start + 4_500);
    assert.match(receiptBranch, /isExpenseReceiptTemplate\(doc\.template_id\)[\s\S]*?user\.auth_type !== 'user'/);
  }
});
