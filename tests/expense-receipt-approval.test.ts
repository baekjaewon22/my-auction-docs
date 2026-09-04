import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  EXPENSE_RECEIPT_REPRESENTATIVE_STAMP,
  EXPENSE_RECEIPT_TEMPLATE_ID,
  ExpenseReceiptContentError,
  canActOnExpenseReceipt,
  canonicalizeExpenseReceiptContent,
  evaluateExpenseReceiptEditPolicy,
  hasExpenseReceiptDraftChanged,
  isEligibleExpenseReceiptAlimtalkRecipient,
} from '../src/shared/expense-receipt.ts';
import {
  evaluateSignaturePolicy,
  standaloneExpenseReceiptApproverSignatureDecision,
  type PendingSignatureStep,
} from '../src/shared/signature-policy.ts';
import {
  ExpenseReceiptApprovalError,
  acquireExpenseReceiptMutationClaim,
  approveExpenseReceipt,
  getExpenseReceiptDocumentRevision,
  rejectExpenseReceipt,
  releaseExpenseReceiptMutationClaim,
  isValidExpenseReceiptAuthorSignatureDataUrl,
  signExpenseReceiptAuthorAtRevision,
  submitExpenseReceiptApproval,
} from '../src/worker/lib/expense-receipt-approval.ts';
import {
  canRunSignatureBackfill,
  SIGNATURE_BACKFILL_CANDIDATES_SQL,
} from '../src/worker/lib/signature-backfill.ts';
import { recreateAlertsForDoc } from '../src/worker/lib/approval-alerts.ts';
import { ALIMTALK_TEMPLATES } from '../src/worker/alimtalk.ts';

const VALID_SIGNATURE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

type D1Statement = D1PreparedStatement & { run(): Promise<D1Result> };

function d1FromSqlite(sqlite: Database.Database): D1Database {
  const prepare = (sql: string, params: unknown[] = []): D1Statement => {
    const statement = sqlite.prepare(sql);
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      all: async <T>() => ({ results: statement.all(...params) as T[] }),
      first: async <T>() => (statement.get(...params) as T | undefined) || null,
      run: async () => {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
      },
    } as D1Statement;
  };
  return {
    prepare: (sql: string) => prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await (statement as D1Statement).run());
      return results;
    },
  } as unknown as D1Database;
}

function setupApprovalDatabase() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '', approved INTEGER NOT NULL DEFAULT 1,
      login_type TEXT NOT NULL DEFAULT 'employee',
      alimtalk_branches TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, template_id TEXT, author_id TEXT NOT NULL,
      branch TEXT DEFAULT '', department TEXT DEFAULT '', content TEXT DEFAULT '{}',
      status TEXT NOT NULL, reject_reason TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0,
      cancelled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE approval_steps (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, step_order INTEGER NOT NULL,
      approver_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', comment TEXT, signed_at TEXT
    );
    CREATE TABLE signatures (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, user_id TEXT NOT NULL,
      signature_data TEXT NOT NULL, ip_address TEXT, user_agent TEXT,
      signed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE expense_receipt_attachments (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, object_key TEXT,
      deleted_at TEXT, purged_at TEXT
    );
    CREATE TABLE document_logs (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, user_id TEXT NOT NULL,
      action TEXT NOT NULL, details TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  sqlite.exec(readFileSync('d1/migrate-expense-receipt-approval.sql', 'utf8'));
  assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='alert_approval_pending'").get());
  const insertUser = sqlite.prepare(`
    INSERT INTO users (id, name, role, phone, approved, login_type, created_at)
    VALUES (?, ?, ?, ?, 1, 'employee', ?)
  `);
  insertUser.run('author', '신청자', 'member', '01011112222', '2026-01-01');
  insertUser.run('ceo', '대표이사', 'ceo', '', '2026-01-01');
  insertUser.run('accountant', '총무담당', 'accountant', '01022223333', '2026-01-01');
  insertUser.run('asst', '총무보조', 'accountant_asst', '01033334444', '2026-01-02');
  insertUser.run('master', '마스터', 'master', '', '2026-01-01');
  insertUser.run('admin', '관리자', 'admin', '', '2026-01-01');

  const insertDocument = sqlite.prepare(`
    INSERT INTO documents (id, title, template_id, author_id, branch, department, status)
    VALUES (?, '영수증 첨부 신청서', ?, 'author', '의정부지사', '총무팀', 'submitted')
  `);
  const insertStep = sqlite.prepare(`
    INSERT INTO approval_steps (id, document_id, step_order, approver_id, status)
    VALUES (?, ?, 1, 'ceo', 'pending')
  `);
  const insertDelegate = sqlite.prepare(`
    INSERT INTO expense_receipt_approval_delegates
      (id, document_id, approval_step_id, user_id, role_snapshot)
    VALUES (?, ?, ?, ?, ?)
  `);

  function addRequest(documentId: string, delegates = true) {
    const stepId = `${documentId}-step`;
    insertDocument.run(documentId, EXPENSE_RECEIPT_TEMPLATE_ID);
    insertStep.run(stepId, documentId);
    if (delegates) {
      insertDelegate.run(`${documentId}-accountant`, documentId, stepId, 'accountant', 'accountant');
      insertDelegate.run(`${documentId}-asst`, documentId, stepId, 'asst', 'accountant_asst');
    }
    return stepId;
  }

  return { sqlite, db: d1FromSqlite(sqlite), addRequest };
}

test('expense receipt content is validated and identity/total fields are server-canonicalized', () => {
  const result = canonicalizeExpenseReceiptContent(JSON.stringify({
    draft_date: '2026-08-24', author_name: '위조 이름', department: '위조 부서', position_title: '위조 직책',
    purpose: '고객 미팅 교통비', expense_date: '2026-08-23', payment_method: '법인카드',
    items: [
      { id: 'a', description: '택시', amount: 17000, note: '' },
      { id: 'b', description: '주차', amount: 3000, note: '' },
      { id: 'empty-1', description: '', amount: 0, note: '' },
      { id: 'empty-2', description: ' ', amount: '', note: ' ' },
    ],
    total_amount: 1,
  }), { name: '실제 신청자', department: '경매사업부', position_title: '컨설턴트' }, '2026-08-25');
  assert.equal(result.author_name, '실제 신청자');
  assert.equal(result.department, '경매사업부');
  assert.equal(result.position_title, '컨설턴트');
  assert.equal(result.total_amount, 20000);
  assert.equal(result.items.length, 2);
  assert.throws(() => canonicalizeExpenseReceiptContent('{}', {
    name: '신청자', department: '총무팀', position_title: '사원',
  }, '2026-08-25'), ExpenseReceiptContentError);
  assert.throws(() => canonicalizeExpenseReceiptContent(JSON.stringify({
    purpose: '테스트', expense_date: '2026-08-25', payment_method: '개인카드',
    items: [{ description: '교통비', amount: 1000, note: '' }],
  }), { name: '신청자', department: '총무팀', position_title: '사원' }, '2026-08-25'),
  /결제 수단은 계좌이체, 법인카드, 현금/);
});

test('receipt draft edit policy is human author/master only and submitted content is immutable', () => {
  const input = {
    authType: 'user', actorId: 'author', actorRole: 'member',
    authorId: 'author', documentStatus: 'draft',
  };
  assert.equal(evaluateExpenseReceiptEditPolicy(input).allowed, true);
  assert.equal(evaluateExpenseReceiptEditPolicy({ ...input, actorId: 'master', actorRole: 'master' }).allowed, true);
  assert.equal(evaluateExpenseReceiptEditPolicy({ ...input, actorId: 'admin', actorRole: 'admin' }).allowed, false);
  assert.equal(evaluateExpenseReceiptEditPolicy({ ...input, authType: 'service_token', actorId: 'master', actorRole: 'master' }).allowed, false);
  const submitted = evaluateExpenseReceiptEditPolicy({ ...input, documentStatus: 'submitted' });
  assert.equal(submitted.allowed, false);
  if (!submitted.allowed) assert.equal(submitted.status, 400);
  assert.equal(hasExpenseReceiptDraftChanged(
    { title: '신청서', content: '{"a":1}' },
    { title: '신청서', content: '{"a":1}' },
  ), false);
  assert.equal(hasExpenseReceiptDraftChanged(
    { title: '신청서', content: '{"a":1}' },
    { title: '신청서', content: '{"a":2}' },
  ), true);
});

test('receipt representative stamp policy allows accounting delegates, assigned CEO, and master', () => {
  const pendingSteps: PendingSignatureStep[] = [
    { id: 'step', approver_id: 'ceo-user', approver_role: 'ceo', step_order: 1 },
  ];
  const decide = (role: string, isCeoStamp = true, userId = role) => evaluateSignaturePolicy({
    userId,
    userRole: role,
    documentAuthorId: 'author',
    documentStatus: 'submitted',
    documentTemplateId: EXPENSE_RECEIPT_TEMPLATE_ID,
    signatureType: 'approver',
    isCeoStamp,
    stepId: 'step',
    pendingSteps,
    totalStepCount: 1,
  });
  assert.equal(decide('accountant').allowed, true);
  assert.equal(decide('accountant_asst').allowed, true);
  assert.equal(decide('master').allowed, true);
  assert.equal(decide('ceo').allowed, false);
  assert.equal(decide('ceo', true, 'ceo-user').allowed, true);
  assert.equal(decide('cc_ref').allowed, false);
  assert.equal(decide('admin').allowed, false);
  assert.equal(decide('accountant', false).allowed, false);
  assert.equal(canActOnExpenseReceipt('accountant'), true);
  assert.equal(canActOnExpenseReceipt('accountant_asst'), true);
  assert.equal(canActOnExpenseReceipt('ceo'), true);
  assert.equal(canActOnExpenseReceipt('master'), true);
  assert.equal(canActOnExpenseReceipt('admin'), false);
  const standalone = standaloneExpenseReceiptApproverSignatureDecision(EXPENSE_RECEIPT_TEMPLATE_ID);
  assert.equal(standalone?.allowed, false);
  if (standalone && !standalone.allowed) assert.equal(standalone.status, 409);
  assert.equal(standaloneExpenseReceiptApproverSignatureDecision('tpl-other'), null);
});

test('signature backfill is human-master only and excludes expense receipts from its candidates', () => {
  assert.equal(canRunSignatureBackfill({ role: 'master', auth_type: 'user' }, false), true);
  assert.equal(canRunSignatureBackfill({ role: 'master', auth_type: 'service_token' }, false), false);
  assert.equal(canRunSignatureBackfill({ role: 'master' }, false), false);
  assert.equal(canRunSignatureBackfill({ role: 'master', auth_type: 'user' }, true), false);
  assert.equal(canRunSignatureBackfill({ role: 'admin', auth_type: 'user' }, false), false);

  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE documents (id TEXT PRIMARY KEY, template_id TEXT);
    CREATE TABLE approval_steps (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, approver_id TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE signatures (document_id TEXT NOT NULL, user_id TEXT NOT NULL);
    INSERT INTO documents (id, template_id) VALUES
      ('receipt', '${EXPENSE_RECEIPT_TEMPLATE_ID}'),
      ('ordinary', 'tpl-ordinary');
    INSERT INTO approval_steps (id, document_id, approver_id, status) VALUES
      ('receipt-step', 'receipt', 'ceo', 'approved'),
      ('ordinary-step', 'ordinary', 'manager', 'approved');
  `);
  const candidates = sqlite.prepare(SIGNATURE_BACKFILL_CANDIDATES_SQL)
    .all(EXPENSE_RECEIPT_TEMPLATE_ID) as Array<{ document_id: string }>;
  assert.deepEqual(candidates.map((candidate) => candidate.document_id), ['ordinary']);
  sqlite.close();
});

test('submission alerts snapshot both delegates but send Alimtalk only to a branch-subscribed 총무', async () => {
  const { sqlite, db, addRequest } = setupApprovalDatabase();
  // 신청 문서 지사는 '의정부지사'. 담당(accountant)은 해당 지사를 구독, 보조(asst)는 미구독.
  sqlite.prepare("UPDATE users SET alimtalk_branches='의정부지사' WHERE id='accountant'").run();
  addRequest('alert-doc');
  const result = await recreateAlertsForDoc(db, 'alert-doc');
  assert.equal(result.created, 2);
  const alerts = sqlite.prepare(`
    SELECT approver_id, notification_sent FROM alert_approval_pending
    WHERE document_id = 'alert-doc' ORDER BY approver_id
  `).all() as Array<{ approver_id: string; notification_sent: number }>;
  assert.deepEqual(alerts, [
    { approver_id: 'accountant', notification_sent: 0 },
    { approver_id: 'asst', notification_sent: 1 },
  ]);
  assert.equal(isEligibleExpenseReceiptAlimtalkRecipient({
    id: 'accountant', phone: '01022223333', role: 'accountant', approved: 1, login_type: 'employee',
  }), true);
  assert.equal(isEligibleExpenseReceiptAlimtalkRecipient({
    id: 'accountant', phone: '01022223333', role: 'accountant', approved: 0, login_type: 'employee',
  }), false);
  assert.equal(isEligibleExpenseReceiptAlimtalkRecipient({
    id: 'accountant', phone: '01022223333', role: 'resigned', approved: 1, login_type: 'employee',
  }), false);
  assert.equal(isEligibleExpenseReceiptAlimtalkRecipient({
    id: 'accountant', phone: '01022223333', role: 'accountant', approved: 1, login_type: 'freelancer',
  }), false);
  // 총무 보조(accountant_asst)도 알림톡 수신 대상이다.
  assert.equal(isEligibleExpenseReceiptAlimtalkRecipient({
    id: 'asst', phone: '01033334444', role: 'accountant_asst', approved: 1, login_type: 'employee',
  }), true);
});

test('a branch-subscribed 총무 보조 also receives the submission Alimtalk', async () => {
  const { sqlite, db, addRequest } = setupApprovalDatabase();
  // 문서 지사 '의정부지사'를 보조(asst)가 구독하고 담당(accountant)은 미구독.
  sqlite.prepare("UPDATE users SET alimtalk_branches='의정부지사' WHERE id='asst'").run();
  addRequest('asst-branch-doc');
  await recreateAlertsForDoc(db, 'asst-branch-doc');
  const alerts = sqlite.prepare(`
    SELECT approver_id, notification_sent FROM alert_approval_pending
    WHERE document_id = 'asst-branch-doc' ORDER BY approver_id
  `).all() as Array<{ approver_id: string; notification_sent: number }>;
  assert.deepEqual(alerts, [
    { approver_id: 'accountant', notification_sent: 1 },
    { approver_id: 'asst', notification_sent: 0 },
  ]);
});

test('expense receipt author signatures require a decodable PNG container with image data', async () => {
  assert.equal(await isValidExpenseReceiptAuthorSignatureDataUrl(VALID_SIGNATURE_DATA_URL), true);
  assert.equal(await isValidExpenseReceiptAuthorSignatureDataUrl('data:image/png;base64,AAAA'), false);
  assert.equal(await isValidExpenseReceiptAuthorSignatureDataUrl(`${VALID_SIGNATURE_DATA_URL}AAAA`), false);
  assert.equal(await isValidExpenseReceiptAuthorSignatureDataUrl('/LNCstemp.png'), false);
});

test('expense receipt submission is an atomic single-claim transition with DB signature and attachment invariants', async () => {
  const { sqlite, db } = setupApprovalDatabase();
  sqlite.prepare(`INSERT INTO documents
    (id, title, template_id, author_id, branch, department, content, status)
    VALUES ('submit-doc', '영수증 첨부 신청서', ?, 'author', '의정부지사', '총무팀', '{"version":1}', 'draft')`)
    .run(EXPENSE_RECEIPT_TEMPLATE_ID);
  sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id, document_id, object_key) VALUES ('attachment', 'submit-doc', 'expense-receipts/submit-doc/image.png')`).run();
  const revision = await getExpenseReceiptDocumentRevision(db, 'submit-doc');
  await signExpenseReceiptAuthorAtRevision(db, {
    documentId: 'submit-doc', authorId: 'author', signatureData: VALID_SIGNATURE_DATA_URL,
    expectedRevision: revision, ipAddress: '127.0.0.1', userAgent: 'test',
  });
  const delegates = [
    { id: 'accountant', name: '총무담당', role: 'accountant' as const, phone: '01022223333' },
    { id: 'asst', name: '총무보조', role: 'accountant_asst' as const, phone: '01033334444' },
  ];
  await assert.rejects(() => submitExpenseReceiptApproval(db, {
    documentId: 'submit-doc', authorId: 'author', representativeId: 'ceo',
    canonicalContent: '{"version":2}', delegates, logDetails: 'must not rewrite signed content',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 409);
  assert.equal((sqlite.prepare("SELECT status FROM documents WHERE id='submit-doc'").get() as any).status, 'draft');
  await submitExpenseReceiptApproval(db, {
    documentId: 'submit-doc', authorId: 'author', representativeId: 'ceo',
    canonicalContent: JSON.stringify({ version: 1 }), delegates, logDetails: 'submitted',
  });
  assert.equal((sqlite.prepare("SELECT status FROM documents WHERE id='submit-doc'").get() as any).status, 'submitted');
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM approval_steps WHERE document_id='submit-doc'").get() as any).count, 1);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM expense_receipt_approval_delegates WHERE document_id='submit-doc'").get() as any).count, 2);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM expense_receipt_submission_claims").get() as any).count, 0);
  await assert.rejects(() => submitExpenseReceiptApproval(db, {
    documentId: 'submit-doc', authorId: 'author', representativeId: 'ceo',
    canonicalContent: '{}', delegates, logDetails: 'duplicate',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 409);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM approval_steps WHERE document_id='submit-doc'").get() as any).count, 1);
  assert.throws(() => sqlite.prepare("UPDATE documents SET content='changed' WHERE id='submit-doc'").run(), /content is immutable/);
  assert.throws(() => sqlite.prepare("DELETE FROM documents WHERE id='submit-doc'").run(), /cannot be deleted/);

  sqlite.prepare(`INSERT INTO documents
    (id, title, template_id, author_id, content, status)
    VALUES ('invalid-submit', '영수증 첨부 신청서', ?, 'author', '{}', 'draft')`).run(EXPENSE_RECEIPT_TEMPLATE_ID);
  assert.throws(() => sqlite.prepare("UPDATE documents SET status='submitted' WHERE id='invalid-submit'").run(), /submission requirements missing/);
  assert.equal((sqlite.prepare("SELECT status FROM documents WHERE id='invalid-submit'").get() as any).status, 'draft');
});

test('a receipt can be submitted and approved by its assigned CEO without accounting delegates', async () => {
  const { sqlite, db } = setupApprovalDatabase();
  sqlite.prepare(`INSERT INTO documents
    (id, title, template_id, author_id, content, status)
    VALUES ('ceo-direct-doc', '영수증 첨부 신청서', ?, 'author', '{}', 'draft')`)
    .run(EXPENSE_RECEIPT_TEMPLATE_ID);
  sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id, document_id, object_key)
    VALUES ('ceo-direct-file', 'ceo-direct-doc', 'expense-receipts/ceo-direct.png')`).run();
  const revision = await getExpenseReceiptDocumentRevision(db, 'ceo-direct-doc');
  await signExpenseReceiptAuthorAtRevision(db, {
    documentId: 'ceo-direct-doc', authorId: 'author', signatureData: VALID_SIGNATURE_DATA_URL,
    expectedRevision: revision, ipAddress: '127.0.0.1', userAgent: 'ceo-direct-submit',
  });
  const submission = await submitExpenseReceiptApproval(db, {
    documentId: 'ceo-direct-doc', authorId: 'author', representativeId: 'ceo',
    canonicalContent: '{}', delegates: [], logDetails: 'submitted without accounting delegate',
  });
  assert.equal(
    (sqlite.prepare("SELECT COUNT(*) AS count FROM expense_receipt_approval_delegates WHERE document_id='ceo-direct-doc'").get() as { count: number }).count,
    0,
  );
  const approval = await approveExpenseReceipt(db, {
    documentId: 'ceo-direct-doc', requestedStepId: submission.stepId,
    actorId: 'ceo', actorRole: 'ceo', ipAddress: '127.0.0.2', userAgent: 'ceo-direct-approve',
  });
  assert.equal(approval.actor.id, 'ceo');
  assert.equal(
    (sqlite.prepare("SELECT status FROM documents WHERE id='ceo-direct-doc'").get() as { status: string }).status,
    'approved',
  );
  const action = sqlite.prepare(`SELECT actual_actor_id, actual_actor_role, representative_user_id,
      used_representative_stamp FROM expense_receipt_approval_actions
    WHERE document_id='ceo-direct-doc'`).get() as Record<string, unknown>;
  assert.deepEqual(action, {
    actual_actor_id: 'ceo', actual_actor_role: 'ceo',
    representative_user_id: 'ceo', used_representative_stamp: 1,
  });
  const signature = sqlite.prepare(`SELECT user_id, signature_data, user_agent
    FROM signatures WHERE document_id='ceo-direct-doc' AND signature_data=?`)
    .get(EXPENSE_RECEIPT_REPRESENTATIVE_STAMP) as Record<string, unknown>;
  assert.equal(signature.user_id, 'ceo');
  assert.equal(signature.signature_data, EXPENSE_RECEIPT_REPRESENTATIVE_STAMP);
  assert.match(String(signature.user_agent), /expense-receipt-delegate:ceo:ceo/);
  const log = sqlite.prepare(`SELECT user_id, action, details FROM document_logs
    WHERE document_id='ceo-direct-doc' AND action='expense_receipt_approved'`).get() as {
      user_id: string; action: string; details: string;
  };
  assert.equal(log.user_id, 'ceo');
  assert.equal(log.action, 'expense_receipt_approved');
  const logDetails = JSON.parse(log.details) as Record<string, unknown>;
  assert.equal(logDetails.actual_actor_id, 'ceo');
  assert.equal(logDetails.actual_actor_role, 'ceo');
  assert.equal(logDetails.representative_user_id, 'ceo');
  assert.equal(logDetails.used_representative_stamp, true);
});

test('author signature is atomically bound to the current receipt revision and stale signing preserves a valid attestation', async () => {
  const { sqlite, db } = setupApprovalDatabase();
  sqlite.prepare(`INSERT INTO documents
    (id, title, template_id, author_id, content, status)
    VALUES ('sign-doc', '영수증 첨부 신청서', ?, 'author', '{}', 'draft')`).run(EXPENSE_RECEIPT_TEMPLATE_ID);
  const revision = await getExpenseReceiptDocumentRevision(db, 'sign-doc');
  await signExpenseReceiptAuthorAtRevision(db, {
    documentId: 'sign-doc', authorId: 'author', signatureData: VALID_SIGNATURE_DATA_URL,
    expectedRevision: revision, ipAddress: '127.0.0.1', userAgent: 'first',
  });
  await assert.rejects(() => signExpenseReceiptAuthorAtRevision(db, {
    documentId: 'sign-doc', authorId: 'author', signatureData: VALID_SIGNATURE_DATA_URL,
    expectedRevision: revision, ipAddress: '127.0.0.1', userAgent: 'duplicate',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 409);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM expense_receipt_signature_attestations WHERE document_id='sign-doc'").get() as any).count, 1);

  sqlite.prepare("DELETE FROM signatures WHERE document_id='sign-doc'").run();
  sqlite.prepare("UPDATE documents SET content='new content' WHERE id='sign-doc'").run();
  await assert.rejects(() => signExpenseReceiptAuthorAtRevision(db, {
    documentId: 'sign-doc', authorId: 'author', signatureData: VALID_SIGNATURE_DATA_URL,
    expectedRevision: revision, ipAddress: '127.0.0.1', userAgent: 'stale',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 409);
});

test('concurrent receipt submissions create exactly one CEO step and one successful claim owner', async () => {
  const { sqlite, db } = setupApprovalDatabase();
  sqlite.prepare(`INSERT INTO documents
    (id, title, template_id, author_id, content, status)
    VALUES ('concurrent-submit', '영수증 첨부 신청서', ?, 'author', '{}', 'draft')`).run(EXPENSE_RECEIPT_TEMPLATE_ID);
  sqlite.prepare(`INSERT INTO expense_receipt_attachments
    (id, document_id, object_key) VALUES ('concurrent-file', 'concurrent-submit', 'expense-receipts/concurrent.png')`).run();
  const revision = await getExpenseReceiptDocumentRevision(db, 'concurrent-submit');
  await signExpenseReceiptAuthorAtRevision(db, {
    documentId: 'concurrent-submit', authorId: 'author', signatureData: VALID_SIGNATURE_DATA_URL,
    expectedRevision: revision, ipAddress: '127.0.0.1', userAgent: 'test',
  });
  const input = {
    documentId: 'concurrent-submit', authorId: 'author', representativeId: 'ceo',
    canonicalContent: '{}', logDetails: 'submitted',
    delegates: [{ id: 'accountant', name: '총무담당', role: 'accountant' as const, phone: '01022223333' }],
  };
  const results = await Promise.allSettled([
    submitExpenseReceiptApproval(db, input),
    submitExpenseReceiptApproval(db, input),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM approval_steps WHERE document_id='concurrent-submit'").get() as any).count, 1);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM expense_receipt_submission_claims WHERE document_id='concurrent-submit'").get() as any).count, 0);
});

test('a receipt delete claim excludes submission and can be released for retry', async () => {
  const { sqlite, db } = setupApprovalDatabase();
  sqlite.prepare(`INSERT INTO documents
    (id, title, template_id, author_id, content, status)
    VALUES ('delete-claim', '영수증 첨부 신청서', ?, 'author', '{}', 'draft')`).run(EXPENSE_RECEIPT_TEMPLATE_ID);
  const claim = await acquireExpenseReceiptMutationClaim(db, 'delete-claim');
  assert.match(claim, /^delete:/);
  await assert.rejects(() => submitExpenseReceiptApproval(db, {
    documentId: 'delete-claim', authorId: 'author', representativeId: 'ceo', canonicalContent: '{}',
    delegates: [], logDetails: 'must not submit',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 409);
  await releaseExpenseReceiptMutationClaim(db, 'delete-claim', claim);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM expense_receipt_submission_claims WHERE document_id='delete-claim'").get() as any).count, 0);
  sqlite.prepare(`INSERT INTO expense_receipt_submission_claims (document_id, claim_token, created_at)
    VALUES ('delete-claim', 'attachment:stale', '2020-01-01 00:00:00')`).run();
  const recoveredClaim = await acquireExpenseReceiptMutationClaim(db, 'delete-claim');
  assert.match(recoveredClaim, /^delete:/);
  await releaseExpenseReceiptMutationClaim(db, 'delete-claim', recoveredClaim);
});

test('assistant approval stamps the CEO slot, records the immutable actual actor, and closes all delegate alerts', async () => {
  const { sqlite, db, addRequest } = setupApprovalDatabase();
  const stepId = addRequest('approve-doc');
  await recreateAlertsForDoc(db, 'approve-doc');
  const result = await approveExpenseReceipt(db, {
    documentId: 'approve-doc', requestedStepId: stepId,
    actorId: 'asst', actorRole: 'accountant_asst', comment: '확인 완료',
    ipAddress: '203.0.113.10', userAgent: 'test-agent',
  });
  assert.equal(result.actor.id, 'asst');
  assert.equal((sqlite.prepare("SELECT status FROM documents WHERE id='approve-doc'").get() as any).status, 'approved');
  const signature = sqlite.prepare("SELECT * FROM signatures WHERE document_id='approve-doc'").get() as any;
  assert.equal(signature.user_id, 'ceo');
  assert.equal(signature.signature_data, EXPENSE_RECEIPT_REPRESENTATIVE_STAMP);
  assert.equal(signature.ip_address, '203.0.113.10');
  assert.match(signature.user_agent, /expense-receipt-delegate:asst:accountant_asst/);
  const action = sqlite.prepare("SELECT * FROM expense_receipt_approval_actions WHERE document_id='approve-doc'").get() as any;
  assert.equal(action.actual_actor_id, 'asst');
  assert.equal(action.actual_actor_name, '총무보조');
  assert.equal(action.actual_actor_role, 'accountant_asst');
  assert.equal(action.representative_user_id, 'ceo');
  assert.equal(action.used_representative_stamp, 1);
  assert.equal(action.ip_address, '203.0.113.10');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM alert_approval_pending WHERE document_id='approve-doc' AND status='open'").get().count, 0);
  await assert.rejects(() => approveExpenseReceipt(db, {
    documentId: 'approve-doc', actorId: 'accountant', actorRole: 'accountant',
    ipAddress: '203.0.113.11', userAgent: 'second',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 409);
  await assert.rejects(() => rejectExpenseReceipt(db, {
    documentId: 'approve-doc', actorId: 'accountant', actorRole: 'accountant', comment: '동시 반려',
    ipAddress: '203.0.113.12', userAgent: 'concurrent-reject',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 409);
});

test('an inactive or role-changed representative is replaced by the current active CEO before stamping', async () => {
  for (const invalidate of [
    "UPDATE users SET role='member' WHERE id='ceo'",
    "UPDATE users SET approved=0 WHERE id='ceo'",
  ]) {
    const { sqlite, db, addRequest } = setupApprovalDatabase();
    sqlite.prepare(`INSERT INTO users (id, name, role, phone, approved, login_type, created_at)
      VALUES ('ceo-current', '현재 대표', 'ceo', '', 1, 'employee', '2026-01-03')`).run();
    const stepId = addRequest(`representative-${invalidate.includes('role') ? 'role' : 'inactive'}`);
    sqlite.prepare(invalidate).run();

    const result = await approveExpenseReceipt(db, {
      documentId: `representative-${invalidate.includes('role') ? 'role' : 'inactive'}`,
      requestedStepId: stepId,
      actorId: 'accountant', actorRole: 'accountant',
      ipAddress: '198.51.100.10', userAgent: 'representative-rotation',
    });
    assert.equal(result.representativeUserId, 'ceo-current');
    assert.equal(
      (sqlite.prepare('SELECT approver_id FROM approval_steps WHERE id=?').get(stepId) as { approver_id: string }).approver_id,
      'ceo-current',
    );
    assert.equal(
      (sqlite.prepare('SELECT user_id FROM signatures WHERE document_id=?').get(
        `representative-${invalidate.includes('role') ? 'role' : 'inactive'}`,
      ) as { user_id: string }).user_id,
      'ceo-current',
    );
  }
});

test('a cancelled or cancellation-requested receipt cannot be acted on or receive the representative stamp', async () => {
  const { sqlite, db, addRequest } = setupApprovalDatabase();
  const stepId = addRequest('cancelled-doc');
  sqlite.prepare("UPDATE documents SET cancelled=1 WHERE id='cancelled-doc'").run();
  await assert.rejects(() => approveExpenseReceipt(db, {
    documentId: 'cancelled-doc', requestedStepId: stepId,
    actorId: 'accountant', actorRole: 'accountant', ipAddress: '127.0.0.1', userAgent: 'cancel-race',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 409);
  await assert.rejects(() => rejectExpenseReceipt(db, {
    documentId: 'cancelled-doc', requestedStepId: stepId,
    actorId: 'accountant', actorRole: 'accountant', comment: 'cancelled',
    ipAddress: '127.0.0.1', userAgent: 'cancel-race',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM signatures WHERE document_id='cancelled-doc'").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM expense_receipt_approval_actions WHERE document_id='cancelled-doc'").get().count, 0);

  const requestedStepId = addRequest('cancel-requested-doc');
  sqlite.prepare("UPDATE documents SET cancel_requested=1 WHERE id='cancel-requested-doc'").run();
  await assert.rejects(() => approveExpenseReceipt(db, {
    documentId: 'cancel-requested-doc', requestedStepId,
    actorId: 'accountant', actorRole: 'accountant', ipAddress: '127.0.0.1', userAgent: 'cancel-request-race',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 409);
  await assert.rejects(() => rejectExpenseReceipt(db, {
    documentId: 'cancel-requested-doc', requestedStepId,
    actorId: 'accountant', actorRole: 'accountant', comment: 'cancel requested',
    ipAddress: '127.0.0.1', userAgent: 'cancel-request-race',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM signatures WHERE document_id='cancel-requested-doc'").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM expense_receipt_approval_actions WHERE document_id='cancel-requested-doc'").get().count, 0);

  const cancelApprovedStepId = addRequest('cancel-approved-doc');
  sqlite.prepare("UPDATE documents SET cancel_requested=1 WHERE id='cancel-approved-doc'").run();
  const cancelResults = await db.batch([
    db.prepare(`UPDATE documents SET cancelled=1, cancel_requested=0
      WHERE id=? AND cancel_requested=1 AND COALESCE(cancelled,0)=0`).bind('cancel-approved-doc'),
    db.prepare(`UPDATE approval_steps SET status='rejected', comment='cancelled'
      WHERE id=? AND status='pending'
        AND EXISTS (SELECT 1 FROM documents d WHERE d.id=? AND COALESCE(d.cancelled,0)=1)`)
      .bind(cancelApprovedStepId, 'cancel-approved-doc'),
  ]);
  assert.equal(Number(cancelResults[0]?.meta?.changes || 0), 1);
  assert.equal((sqlite.prepare("SELECT cancelled FROM documents WHERE id='cancel-approved-doc'").get() as { cancelled: number }).cancelled, 1);
  assert.equal((sqlite.prepare('SELECT status FROM approval_steps WHERE id=?').get(cancelApprovedStepId) as { status: string }).status, 'rejected');
});

test('delegate snapshot blocks admin, unassigned CEO, and role-changed users while master remains emergency delegate', async () => {
  const { sqlite, db, addRequest } = setupApprovalDatabase();
  sqlite.prepare(`INSERT INTO users (id, name, role, phone, approved, login_type, created_at)
    VALUES ('ceo-other', '다른 대표', 'ceo', '', 1, 'employee', '2026-01-03')`).run();
  addRequest('blocked-doc');
  for (const [actorId, actorRole] of [['ceo-other', 'ceo'], ['admin', 'admin']] as const) {
    await assert.rejects(() => approveExpenseReceipt(db, {
      documentId: 'blocked-doc', actorId, actorRole, ipAddress: '127.0.0.1', userAgent: 'test',
    }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 403);
  }
  sqlite.prepare("UPDATE users SET role='admin' WHERE id='asst'").run();
  await assert.rejects(() => approveExpenseReceipt(db, {
    documentId: 'blocked-doc', actorId: 'asst', actorRole: 'accountant_asst',
    ipAddress: '127.0.0.1', userAgent: 'stale-token',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 403);

  addRequest('master-doc', false);
  const masterResult = await approveExpenseReceipt(db, {
    documentId: 'master-doc', actorId: 'master', actorRole: 'master',
    ipAddress: '127.0.0.2', userAgent: 'emergency',
  });
  assert.equal(masterResult.actor.role, 'master');

  sqlite.prepare("UPDATE users SET login_type='freelancer' WHERE id='master'").run();
  addRequest('freelancer-master-doc', false);
  await assert.rejects(() => approveExpenseReceipt(db, {
    documentId: 'freelancer-master-doc', actorId: 'master', actorRole: 'master',
    ipAddress: '127.0.0.3', userAgent: 'freelancer-session',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 403);
});

test('approval action trigger rechecks actor role, delegate snapshot, and self-approval at commit time', () => {
  const { sqlite, addRequest } = setupApprovalDatabase();
  sqlite.prepare(`INSERT INTO users (id, name, role, phone, approved, login_type, created_at)
    VALUES ('ceo-other', '다른 대표', 'ceo', '', 1, 'employee', '2026-01-03')`).run();
  const stepId = addRequest('actor-trigger-doc');
  sqlite.prepare("UPDATE approval_steps SET status='approved' WHERE id=?").run(stepId);
  sqlite.prepare("UPDATE users SET role='admin' WHERE id='accountant'").run();
  const insertAction = sqlite.prepare(`INSERT INTO expense_receipt_approval_actions
    (id, document_id, approval_step_id, action, actual_actor_id, actual_actor_name,
     actual_actor_role, representative_user_id, used_representative_stamp)
    VALUES (?, ?, ?, 'approved', ?, 'actor', ?, 'ceo', 1)`);
  assert.throws(
    () => insertAction.run('invalid-role', 'actor-trigger-doc', stepId, 'accountant', 'accountant'),
    /cannot be acted on/,
  );
  assert.throws(
    () => insertAction.run('wrong-ceo', 'actor-trigger-doc', stepId, 'ceo-other', 'ceo'),
    /cannot be acted on/,
  );

  const selfStepId = addRequest('self-trigger-doc');
  sqlite.prepare("UPDATE approval_steps SET status='approved' WHERE id=?").run(selfStepId);
  sqlite.prepare("UPDATE users SET role='master' WHERE id='author'").run();
  assert.throws(
    () => insertAction.run('self-approval', 'self-trigger-doc', selfStepId, 'author', 'master'),
    /cannot be acted on/,
  );

  const cancelRequestedStepId = addRequest('cancel-request-trigger-doc');
  sqlite.prepare("UPDATE approval_steps SET status='approved' WHERE id=?").run(cancelRequestedStepId);
  sqlite.prepare("UPDATE documents SET cancel_requested=1 WHERE id='cancel-request-trigger-doc'").run();
  assert.throws(
    () => insertAction.run('cancel-request-action', 'cancel-request-trigger-doc', cancelRequestedStepId, 'asst', 'accountant_asst'),
    /cannot be acted on/,
  );
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM expense_receipt_approval_actions').get().count, 0);
});

test('receipt rejection requires a reason and stores rejected actor without a representative stamp', async () => {
  const { sqlite, db, addRequest } = setupApprovalDatabase();
  const stepId = addRequest('reject-doc');
  await recreateAlertsForDoc(db, 'reject-doc');
  await assert.rejects(() => rejectExpenseReceipt(db, {
    documentId: 'reject-doc', requestedStepId: stepId, actorId: 'accountant', actorRole: 'accountant',
    comment: ' ', ipAddress: '192.0.2.2', userAgent: 'test',
  }), (error: unknown) => error instanceof ExpenseReceiptApprovalError && error.status === 400);
  await rejectExpenseReceipt(db, {
    documentId: 'reject-doc', requestedStepId: stepId, actorId: 'accountant', actorRole: 'accountant',
    comment: '금액 증빙 확인 필요', ipAddress: '192.0.2.2', userAgent: 'test',
  });
  const action = sqlite.prepare("SELECT * FROM expense_receipt_approval_actions WHERE document_id='reject-doc'").get() as any;
  assert.equal(action.action, 'rejected');
  assert.equal(action.actual_actor_id, 'accountant');
  assert.equal(action.used_representative_stamp, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM signatures WHERE document_id='reject-doc'").get().count, 0);
  assert.equal((sqlite.prepare("SELECT status FROM alert_approval_pending WHERE document_id='reject-doc' LIMIT 1").get() as any).status, 'acted');
});

test('the assigned CEO can reject directly without an accounting delegate', async () => {
  const { sqlite, db, addRequest } = setupApprovalDatabase();
  const stepId = addRequest('ceo-reject-doc', false);
  const result = await rejectExpenseReceipt(db, {
    documentId: 'ceo-reject-doc', requestedStepId: stepId,
    actorId: 'ceo', actorRole: 'ceo', comment: '증빙 내용을 다시 확인해주세요.',
    ipAddress: '192.0.2.10', userAgent: 'ceo-direct-reject',
  });
  assert.equal(result.actor.role, 'ceo');
  const action = sqlite.prepare(`SELECT action, actual_actor_id, actual_actor_role,
      representative_user_id, used_representative_stamp
    FROM expense_receipt_approval_actions WHERE document_id='ceo-reject-doc'`).get() as Record<string, unknown>;
  assert.deepEqual(action, {
    action: 'rejected', actual_actor_id: 'ceo', actual_actor_role: 'ceo',
    representative_user_id: null, used_representative_stamp: 0,
  });
  assert.equal(
    (sqlite.prepare("SELECT status FROM documents WHERE id='ceo-reject-doc'").get() as { status: string }).status,
    'rejected',
  );
});

test('route and notification wiring enforce server guards, human users, custom links, and NCP fallback', () => {
  const documentsSource = readFileSync('src/worker/routes/documents.ts', 'utf8');
  const receiptLibSource = readFileSync('src/worker/lib/expense-receipts.ts', 'utf8');
  const dispatcherSource = readFileSync('src/worker/lib/approval-alerts-dispatcher.ts', 'utf8');
  const signaturesSource = readFileSync('src/worker/routes/signatures.ts', 'utf8');
  assert.match(documentsSource, /countActiveExpenseReceiptAttachments\(db, id\)/);
  assert.match(documentsSource, /signature_data != \?/);
  assert.match(documentsSource, /user\.auth_type !== 'user'/);
  assert.match(documentsSource, /submitExpenseReceiptApproval/);
  assert.match(documentsSource, /deleteExpenseReceiptDocumentAndQueueArtifacts\(c\.env, id, expenseReceiptDeleteClaim\)/);
  assert.match(documentsSource, /acquireExpenseReceiptMutationClaim/);
  assert.match(receiptLibSource, /status IN \('draft','rejected'\)[\s\S]*?expense_receipt_submission_claims/);
  assert.match(documentsSource, /COALESCE\(d\.template_id, ''\) != \?/);
  assert.match(documentsSource, /appendExpenseReceiptListScope/);
  assert.match(documentsSource, /user\.login_type !== 'freelancer'[\s\S]*?EXPENSE_RECEIPT_NON_DRAFT_READ_ROLES\.has\(user\.role\)/);
  assert.match(documentsSource, /canReadExpenseReceipt/);
  assert.match(documentsSource, /documents\.post\('\/:id\/approve'[\s\S]*?const canRead = isExpenseReceiptTemplate\(doc\.template_id\)[\s\S]*?approveExpenseReceipt/);
  assert.match(documentsSource, /documents\.post\('\/:id\/reject'[\s\S]*?const canRead = isExpenseReceiptTemplate\(doc\.template_id\)[\s\S]*?rejectExpenseReceipt/);
  assert.match(documentsSource, /evaluateExpenseReceiptEditPolicy/);
  assert.match(documentsSource, /hasExpenseReceiptDraftChanged[\s\S]*?DELETE FROM signatures/);
  assert.match(documentsSource, /제출된 영수증 첨부 신청서는 직접 삭제할 수 없습니다/);
  assert.match(dispatcherSource, /EXPENSE_RECEIPT_SUBMITTED/);
  assert.match(dispatcherSource, /isEligibleExpenseReceiptAlimtalkRecipient/);
  assert.match(dispatcherSource, /recipient_inactive/);
  assert.match(dispatcherSource, /for \(const alert of alerts\)[\s\S]*?FROM users WHERE id = \?[\s\S]*?isEligibleExpenseReceiptAlimtalkRecipient\(recipient\)/);
  assert.match(dispatcherSource, /falling back to DOC_SUBMITTED/);
  assert.match(dispatcherSource, /if \(!dedicatedResult\)[\s\S]*?throw new Error/);
  assert.match(dispatcherSource, /if \(!fallbackResult\)[\s\S]*?throw new Error/);
  assert.match(dispatcherSource, /SET notification_sent = 2[\s\S]*?notification_error = \?/);
  assert.match(dispatcherSource, /\/expense-receipts\/\$\{alert\.document_id\}/);
  assert.match(signaturesSource, /standaloneExpenseReceiptApproverSignatureDecision/);
  assert.match(signaturesSource, /canReadExpenseReceipt/);
  assert.match(signaturesSource, /const canRead = isExpenseReceiptTemplate\(doc\.template_id\)[\s\S]*?standaloneExpenseReceiptApproverSignatureDecision/);
  assert.match(signaturesSource, /canRunSignatureBackfill\(user, isFreelancerViewer\(user\)\)/);
  assert.match(signaturesSource, /SIGNATURE_BACKFILL_CANDIDATES_SQL/);
  assert.equal(ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_SUBMITTED.code, 'expense1');
  assert.deepEqual(ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_SUBMITTED.variables, [
    'applicant_name', 'doc_title', 'branch', 'department', 'receipt_count', 'submit_date', 'link',
  ]);
  assert.match(ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_SUBMITTED.content, /총무담당자님/);
  assert.match(ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_SUBMITTED.content, /영수증: #\{receipt_count\}건/);
  assert.match(ALIMTALK_TEMPLATES.EXPENSE_RECEIPT_SUBMITTED.content, /확인한 후 승인해주세요/);
  const migration = readFileSync('d1/migrate-expense-receipt-approval.sql', 'utf8');
  assert.match(migration, /UNIQUE \(approval_step_id\)/);
  assert.match(migration, /expense_receipt_submission_claims/);
  assert.match(migration, /trg_expense_receipt_submit_requirements/);
});
