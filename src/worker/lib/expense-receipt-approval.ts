import {
  EXPENSE_RECEIPT_REPRESENTATIVE_STAMP,
  EXPENSE_RECEIPT_TEMPLATE_ID,
  canActOnExpenseReceipt,
} from '../../shared/expense-receipt.ts';

const approvalSchemaPromises = new WeakMap<object, Promise<void>>();

const PNG_DATA_URL_PATTERN = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

function pngChunkCrc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function isValidExpenseReceiptAuthorSignatureDataUrl(value: string): Promise<boolean> {
  if (!value || value.length > 1_500_000) return false;
  const match = PNG_DATA_URL_PATTERN.exec(value);
  if (!match || match[1].length % 4 !== 0) return false;

  let bytes: Uint8Array;
  try {
    const binary = atob(match[1]);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return false;
  }

  if (bytes.length < 57
    || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47
    || bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a) {
    return false;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let chunkIndex = 0;
  let sawImageData = false;
  let imageDataEnded = false;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const imageDataChunks: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const nextOffset = offset + 12 + length;
    if (nextOffset > bytes.length) return false;
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const storedCrc = view.getUint32(offset + 8 + length, false);
    if (pngChunkCrc32(bytes, offset + 4, offset + 8 + length) !== storedCrc) return false;

    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) return false;
      width = view.getUint32(offset + 8, false);
      height = view.getUint32(offset + 12, false);
      bitDepth = bytes[offset + 16];
      colorType = bytes[offset + 17];
      const compression = bytes[offset + 18];
      const filter = bytes[offset + 19];
      const interlace = bytes[offset + 20];
      const allowedDepths = colorType === 0 ? [1, 2, 4, 8, 16]
        : colorType === 2 ? [8, 16]
          : colorType === 4 || colorType === 6 ? [8, 16]
            : [];
      if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 4_000_000
        || !allowedDepths.includes(bitDepth) || compression !== 0 || filter !== 0 || interlace !== 0) {
        return false;
      }
    } else if (type === 'IHDR') {
      return false;
    }

    if (type === 'IDAT') {
      if (imageDataEnded || length === 0) return false;
      sawImageData = true;
      imageDataChunks.push(bytes.slice(offset + 8, offset + 8 + length));
    } else if (sawImageData && type !== 'IEND') {
      imageDataEnded = true;
    }
    if (type === 'IEND') {
      if (length !== 0 || !sawImageData || nextOffset !== bytes.length) return false;
      break;
    }
    offset = nextOffset;
    chunkIndex += 1;
  }

  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels || imageDataChunks.length === 0) return false;
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const expectedBytes = height * (rowBytes + 1);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 20_000_000) return false;

  const compressedLength = imageDataChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const chunk of imageDataChunks) {
    compressed.set(chunk, compressedOffset);
    compressedOffset += chunk.length;
  }

  try {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
    const reader = stream.getReader();
    const decoded = new Uint8Array(expectedBytes);
    let decodedOffset = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      if (decodedOffset + chunk.length > expectedBytes) {
        await reader.cancel();
        return false;
      }
      decoded.set(chunk, decodedOffset);
      decodedOffset += chunk.length;
    }
    if (decodedOffset !== expectedBytes) return false;
    for (let row = 0; row < height; row += 1) {
      if (decoded[row * (rowBytes + 1)] > 4) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function ensureExpenseReceiptApprovalSchema(db: D1Database): Promise<void> {
  const key = db as unknown as object;
  const existing = approvalSchemaPromises.get(key);
  if (existing) return existing;
  const pending = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS alert_approval_pending (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, approver_id TEXT NOT NULL,
      cycle_no INTEGER NOT NULL DEFAULT 1, step_order INTEGER NOT NULL, my_status TEXT NOT NULL,
      document_title TEXT, document_template_id TEXT, document_author_id TEXT,
      document_author_name TEXT, document_branch TEXT, document_department TEXT,
      document_submitted_at TEXT, status TEXT NOT NULL DEFAULT 'open',
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      acted_at TEXT, acted_action TEXT, notification_sent INTEGER NOT NULL DEFAULT 0,
      notification_sent_at TEXT, notification_error TEXT, metadata TEXT,
      UNIQUE(document_id, approver_id, cycle_no),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_aap_approver_status ON alert_approval_pending(approver_id, status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_aap_doc_status ON alert_approval_pending(document_id, status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_aap_status_detected ON alert_approval_pending(status, detected_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_aap_notify ON alert_approval_pending(notification_sent, status, my_status)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_approval_actions (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, approval_step_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
      actual_actor_id TEXT NOT NULL, actual_actor_name TEXT NOT NULL, actual_actor_role TEXT NOT NULL,
      representative_user_id TEXT, used_representative_stamp INTEGER NOT NULL DEFAULT 0
        CHECK (used_representative_stamp IN (0, 1)),
      comment TEXT NOT NULL DEFAULT '', ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (approval_step_id), FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (actual_actor_id) REFERENCES users(id),
      FOREIGN KEY (representative_user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_approval_delegates (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, approval_step_id TEXT NOT NULL,
      user_id TEXT NOT NULL, role_snapshot TEXT NOT NULL
        CHECK (role_snapshot IN ('accountant', 'accountant_asst')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (approval_step_id, user_id),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_submission_claims (
      document_id TEXT PRIMARY KEY, claim_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_document_revisions (
      document_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS expense_receipt_signature_attestations (
      document_id TEXT PRIMARY KEY, signature_id TEXT NOT NULL UNIQUE,
      author_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision >= 1),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (signature_id) REFERENCES signatures(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_actions_document ON expense_receipt_approval_actions(document_id, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_actions_actor ON expense_receipt_approval_actions(actual_actor_id, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_delegates_document ON expense_receipt_approval_delegates(document_id, approval_step_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_delegates_user ON expense_receipt_approval_delegates(user_id, document_id)'),
    db.prepare('DROP TRIGGER IF EXISTS trg_expense_receipt_submit_requirements'),
    db.prepare('DROP TRIGGER IF EXISTS trg_expense_receipt_submit_requirements_v2'),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_submit_requirements_v2
      BEFORE UPDATE OF status ON documents
      WHEN OLD.status IN ('draft', 'rejected') AND NEW.status = 'submitted'
        AND NEW.template_id = '${EXPENSE_RECEIPT_TEMPLATE_ID}'
        AND (
          NEW.content != OLD.content
          OR NOT EXISTS (SELECT 1
            FROM signatures s
            JOIN expense_receipt_signature_attestations sa
              ON sa.signature_id = s.id AND sa.document_id = s.document_id
            JOIN expense_receipt_document_revisions r ON r.document_id = s.document_id
            WHERE s.document_id = NEW.id AND s.user_id = NEW.author_id
              AND s.signature_data != '${EXPENSE_RECEIPT_REPRESENTATIVE_STAMP}'
              AND sa.author_id = NEW.author_id AND sa.revision = r.revision)
          OR NOT EXISTS (SELECT 1 FROM expense_receipt_attachments a
            WHERE a.document_id = NEW.id AND a.deleted_at IS NULL AND a.purged_at IS NULL
              AND a.object_key IS NOT NULL)
        )
      BEGIN SELECT RAISE(ABORT, 'expense receipt submission requirements missing'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_content_lock
      BEFORE UPDATE OF title, content ON documents
      WHEN OLD.template_id = '${EXPENSE_RECEIPT_TEMPLATE_ID}'
        AND OLD.status NOT IN ('draft', 'rejected')
      BEGIN SELECT RAISE(ABORT, 'submitted expense receipt content is immutable'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_delete_lock
      BEFORE DELETE ON documents
      WHEN OLD.template_id = '${EXPENSE_RECEIPT_TEMPLATE_ID}'
        AND OLD.status NOT IN ('draft', 'rejected')
      BEGIN SELECT RAISE(ABORT, 'submitted expense receipt cannot be deleted'); END`),
    db.prepare('DROP TRIGGER IF EXISTS trg_expense_receipt_approval_step_guard'),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_approval_step_guard
      BEFORE UPDATE OF status ON approval_steps
      WHEN OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')
        AND EXISTS (
          SELECT 1 FROM documents d
          WHERE d.id = OLD.document_id AND d.template_id = '${EXPENSE_RECEIPT_TEMPLATE_ID}'
            AND (d.status != 'submitted' OR COALESCE(d.cancelled, 0) != 0
              OR COALESCE(d.cancel_requested, 0) != 0)
        )
        AND NOT (
          NEW.status = 'rejected' AND COALESCE(NEW.comment, '') = 'cancelled'
          AND EXISTS (SELECT 1 FROM documents d
            WHERE d.id = OLD.document_id AND d.template_id = '${EXPENSE_RECEIPT_TEMPLATE_ID}'
              AND COALESCE(d.cancelled, 0) = 1)
        )
      BEGIN SELECT RAISE(ABORT, 'cancelled expense receipt cannot be acted on'); END`),
    db.prepare('DROP TRIGGER IF EXISTS trg_expense_receipt_approval_action_guard'),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_approval_action_guard
      BEFORE INSERT ON expense_receipt_approval_actions
      WHEN NOT EXISTS (
          SELECT 1 FROM documents d
          WHERE d.id = NEW.document_id AND d.template_id = '${EXPENSE_RECEIPT_TEMPLATE_ID}'
            AND d.status = 'submitted' AND COALESCE(d.cancelled, 0) = 0
            AND COALESCE(d.cancel_requested, 0) = 0
            AND d.author_id != NEW.actual_actor_id
        )
        OR NOT EXISTS (
          SELECT 1 FROM approval_steps s
          JOIN users u ON u.id = s.approver_id
          WHERE s.id = NEW.approval_step_id AND s.document_id = NEW.document_id
            AND ((NEW.action = 'approved' AND s.status = 'approved')
              OR (NEW.action = 'rejected' AND s.status = 'rejected'))
            AND u.role = 'ceo' AND u.approved = 1
            AND COALESCE(u.login_type, 'employee') != 'freelancer'
            AND (NEW.used_representative_stamp = 0 OR NEW.representative_user_id = s.approver_id)
        )
        OR NOT EXISTS (
          SELECT 1 FROM users actor
          WHERE actor.id = NEW.actual_actor_id
            AND actor.role = NEW.actual_actor_role
            AND actor.approved = 1
            AND COALESCE(actor.login_type, 'employee') != 'freelancer'
            AND (
              actor.role = 'master'
              OR (
                actor.role = 'ceo'
                AND EXISTS (
                  SELECT 1 FROM approval_steps representative_step
                  WHERE representative_step.id = NEW.approval_step_id
                    AND representative_step.document_id = NEW.document_id
                    AND representative_step.approver_id = actor.id
                )
              )
              OR EXISTS (
                SELECT 1 FROM expense_receipt_approval_delegates delegate
                WHERE delegate.document_id = NEW.document_id
                  AND delegate.approval_step_id = NEW.approval_step_id
                  AND delegate.user_id = actor.id
                  AND delegate.role_snapshot = actor.role
              )
            )
        )
      BEGIN SELECT RAISE(ABORT, 'cancelled expense receipt cannot be acted on'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_document_revision
      AFTER UPDATE OF title, content ON documents
      WHEN NEW.template_id = '${EXPENSE_RECEIPT_TEMPLATE_ID}'
        AND NEW.status IN ('draft', 'rejected')
      BEGIN
        INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
        VALUES (NEW.id, 1, datetime('now'))
        ON CONFLICT(document_id) DO UPDATE SET
          revision = revision + 1, updated_at = datetime('now');
      END`),
  ]).then(() => undefined).catch((error) => {
    approvalSchemaPromises.delete(key);
    throw error;
  });
  approvalSchemaPromises.set(key, pending);
  return pending;
}

export interface ExpenseReceiptRepresentative {
  id: string;
  name: string;
  role: 'ceo';
}

export interface ExpenseReceiptDelegate {
  id: string;
  name: string;
  role: 'accountant' | 'accountant_asst';
  phone: string;
}

export interface ExpenseReceiptApprovalAction {
  action: 'approved' | 'rejected';
  actor_id: string;
  actor_name: string;
  actor_role: string;
  comment: string;
  created_at: string;
}

export interface ExpenseReceiptActor {
  id: string;
  name: string;
  role: string;
}

export class ExpenseReceiptApprovalError extends Error {
  readonly status: 400 | 403 | 404 | 409;

  constructor(
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'ExpenseReceiptApprovalError';
    this.status = status;
  }
}

export { canActOnExpenseReceipt };

export async function findExpenseReceiptRepresentative(
  db: D1Database,
): Promise<ExpenseReceiptRepresentative | null> {
  return await db.prepare(`
    SELECT id, name, role
    FROM users
    WHERE role = 'ceo'
      AND approved = 1
      AND COALESCE(login_type, 'employee') != 'freelancer'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).first<ExpenseReceiptRepresentative>() || null;
}

export async function listExpenseReceiptDelegates(
  db: D1Database,
  excludeUserId = '',
): Promise<ExpenseReceiptDelegate[]> {
  const result = await db.prepare(`
    SELECT id, name, role, COALESCE(phone, '') AS phone
    FROM users
    WHERE role IN ('accountant', 'accountant_asst')
      AND approved = 1
      AND COALESCE(login_type, 'employee') != 'freelancer'
      AND (? = '' OR id != ?)
    ORDER BY CASE role WHEN 'accountant' THEN 0 ELSE 1 END, created_at ASC, id ASC
  `).bind(excludeUserId, excludeUserId).all<ExpenseReceiptDelegate>();
  return result.results || [];
}

export async function snapshotExpenseReceiptDelegates(
  db: D1Database,
  documentId: string,
  approvalStepId: string,
  delegates: ExpenseReceiptDelegate[],
): Promise<void> {
  await ensureExpenseReceiptApprovalSchema(db);
  if (delegates.length === 0) return;
  await db.batch(delegates.map((delegate) => db.prepare(`
    INSERT INTO expense_receipt_approval_delegates
      (id, document_id, approval_step_id, user_id, role_snapshot)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    documentId,
    approvalStepId,
    delegate.id,
    delegate.role,
  )));
}

export async function isActiveExpenseReceiptDelegate(
  db: D1Database,
  documentId: string,
  approvalStepId: string,
  userId: string,
  assertedRole: string,
): Promise<boolean> {
  await ensureExpenseReceiptApprovalSchema(db);
  if (!canActOnExpenseReceipt(assertedRole)) return false;
  if (assertedRole === 'master') {
    const master = await db.prepare(`
      SELECT actor.id
      FROM users actor
      JOIN documents document ON document.id = ?
      JOIN approval_steps step ON step.id = ? AND step.document_id = document.id
      WHERE actor.id = ? AND actor.role = 'master' AND actor.approved = 1
        AND COALESCE(actor.login_type, 'employee') != 'freelancer'
        AND step.status = 'pending'
        AND document.template_id = ? AND document.author_id != actor.id
      LIMIT 1
    `).bind(
      documentId,
      approvalStepId,
      userId,
      EXPENSE_RECEIPT_TEMPLATE_ID,
    ).first<{ id: string }>();
    return !!master;
  }

  if (assertedRole === 'ceo') {
    const representative = await db.prepare(`
      SELECT actor.id
      FROM users actor
      JOIN approval_steps step ON step.approver_id = actor.id
      JOIN documents document ON document.id = step.document_id
      WHERE step.id = ? AND step.document_id = ? AND step.status = 'pending'
        AND actor.id = ? AND actor.role = 'ceo' AND actor.approved = 1
        AND COALESCE(actor.login_type, 'employee') != 'freelancer'
        AND document.template_id = ? AND document.author_id != actor.id
      LIMIT 1
    `).bind(
      approvalStepId,
      documentId,
      userId,
      EXPENSE_RECEIPT_TEMPLATE_ID,
    ).first<{ id: string }>();
    return !!representative;
  }

  const delegate = await db.prepare(`
    SELECT d.user_id
    FROM expense_receipt_approval_delegates d
    JOIN users u ON u.id = d.user_id
    JOIN documents document ON document.id = d.document_id
    WHERE d.document_id = ?
      AND d.approval_step_id = ?
      AND d.user_id = ?
      AND d.role_snapshot = ?
      AND u.role = d.role_snapshot
      AND u.approved = 1
      AND COALESCE(u.login_type, 'employee') != 'freelancer'
      AND document.template_id = ? AND document.author_id != u.id
    LIMIT 1
  `).bind(
    documentId,
    approvalStepId,
    userId,
    assertedRole,
    EXPENSE_RECEIPT_TEMPLATE_ID,
  ).first<{ user_id: string }>();
  return !!delegate;
}

export async function getActiveExpenseReceiptActor(
  db: D1Database,
  documentId: string,
  approvalStepId: string,
  userId: string,
  assertedRole: string,
): Promise<ExpenseReceiptActor | null> {
  if (!(await isActiveExpenseReceiptDelegate(db, documentId, approvalStepId, userId, assertedRole))) {
    return null;
  }
  return await db.prepare(`
    SELECT id, name, role
    FROM users
    WHERE id = ? AND approved = 1 AND role = ?
      AND COALESCE(login_type, 'employee') != 'freelancer'
    LIMIT 1
  `).bind(userId, assertedRole).first<ExpenseReceiptActor>() || null;
}

interface ExpenseReceiptActionInput {
  documentId: string;
  requestedStepId?: string;
  actorId: string;
  actorRole: string;
  comment?: string;
  ipAddress: string;
  userAgent: string;
}

interface ExpenseReceiptActionResult {
  stepId: string;
  representativeUserId: string;
  actor: ExpenseReceiptActor;
}

async function clearStaleExpenseReceiptClaims(db: D1Database, documentId: string): Promise<void> {
  await db.prepare(`DELETE FROM expense_receipt_submission_claims
    WHERE document_id = ? AND created_at < datetime('now', '-30 minutes')`)
    .bind(documentId).run();
}

export async function submitExpenseReceiptApproval(
  db: D1Database,
  input: {
    documentId: string;
    authorId: string;
    representativeId: string;
    canonicalContent: string;
    delegates: ExpenseReceiptDelegate[];
    logDetails: string;
  },
): Promise<{ stepId: string }> {
  await ensureExpenseReceiptApprovalSchema(db);
  await clearStaleExpenseReceiptClaims(db, input.documentId);
  const claimToken = crypto.randomUUID();
  const stepId = crypto.randomUUID();
  const claimExists = `EXISTS (SELECT 1 FROM expense_receipt_submission_claims
    WHERE document_id = ? AND claim_token = ?)`;
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO expense_receipt_submission_claims (document_id, claim_token)
      SELECT id, ? FROM documents
      WHERE id = ? AND template_id = ? AND author_id = ?
        AND status IN ('draft', 'rejected') AND content = ?`)
      .bind(
        claimToken,
        input.documentId,
        EXPENSE_RECEIPT_TEMPLATE_ID,
        input.authorId,
        input.canonicalContent,
      ),
    db.prepare(`DELETE FROM expense_receipt_approval_delegates
      WHERE document_id = ? AND ${claimExists}`)
      .bind(input.documentId, input.documentId, claimToken),
    db.prepare(`DELETE FROM approval_steps WHERE document_id = ? AND ${claimExists}`)
      .bind(input.documentId, input.documentId, claimToken),
    db.prepare(`DELETE FROM signatures
      WHERE document_id = ? AND user_id != ? AND ${claimExists}`)
      .bind(input.documentId, input.authorId, input.documentId, claimToken),
    db.prepare(`INSERT INTO approval_steps
        (id, document_id, step_order, approver_id, status, comment, signed_at)
      SELECT ?, ?, 1, ?, 'pending', NULL, NULL
      WHERE ${claimExists}`)
      .bind(stepId, input.documentId, input.representativeId, input.documentId, claimToken),
    ...input.delegates.map((delegate) => db.prepare(`
      INSERT INTO expense_receipt_approval_delegates
        (id, document_id, approval_step_id, user_id, role_snapshot)
      SELECT ?, ?, ?, ?, ? WHERE ${claimExists}
    `).bind(
      crypto.randomUUID(), input.documentId, stepId, delegate.id, delegate.role,
      input.documentId, claimToken,
    )),
    db.prepare(`UPDATE documents
      SET status = 'submitted', reject_reason = NULL, updated_at = datetime('now')
      WHERE id = ? AND status IN ('draft', 'rejected') AND content = ? AND ${claimExists}`)
      .bind(input.documentId, input.canonicalContent, input.documentId, claimToken),
    db.prepare(`INSERT INTO document_logs (id, document_id, user_id, action, details)
      SELECT ?, ?, ?, 'submitted', ? WHERE ${claimExists}`)
      .bind(crypto.randomUUID(), input.documentId, input.authorId, input.logDetails, input.documentId, claimToken),
    db.prepare('DELETE FROM expense_receipt_submission_claims WHERE document_id = ? AND claim_token = ?')
      .bind(input.documentId, claimToken),
  ];
  try {
    const results = await db.batch(statements);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      throw new ExpenseReceiptApprovalError('이미 제출 처리 중이거나 제출된 영수증 첨부 신청서입니다.', 409);
    }
  } catch (error) {
    if (error instanceof ExpenseReceiptApprovalError) throw error;
    if (/submission requirements|UNIQUE|constraint|submitted|claim/i.test(String(error))) {
      throw new ExpenseReceiptApprovalError('서명과 첨부 상태가 변경되었거나 이미 제출된 신청서입니다. 다시 확인해 주세요.', 409);
    }
    throw error;
  }
  return { stepId };
}

export async function acquireExpenseReceiptMutationClaim(
  db: D1Database,
  documentId: string,
): Promise<string> {
  await ensureExpenseReceiptApprovalSchema(db);
  const claimToken = `delete:${crypto.randomUUID()}`;
  const results = await db.batch([
    db.prepare(`DELETE FROM expense_receipt_submission_claims
      WHERE document_id = ? AND created_at < datetime('now', '-30 minutes')`).bind(documentId),
    db.prepare(`INSERT OR IGNORE INTO expense_receipt_submission_claims
        (document_id, claim_token)
      SELECT id, ? FROM documents
      WHERE id = ? AND template_id = ? AND status IN ('draft', 'rejected')`)
      .bind(claimToken, documentId, EXPENSE_RECEIPT_TEMPLATE_ID),
  ]);
  if (Number(results[1]?.meta?.changes || 0) !== 1) {
    throw new ExpenseReceiptApprovalError('이미 제출 처리 중이거나 삭제할 수 없는 영수증 첨부 신청서입니다.', 409);
  }
  return claimToken;
}

export async function releaseExpenseReceiptMutationClaim(
  db: D1Database,
  documentId: string,
  claimToken: string,
): Promise<void> {
  await db.prepare(`DELETE FROM expense_receipt_submission_claims
    WHERE document_id = ? AND claim_token = ?`).bind(documentId, claimToken).run();
}

export async function getExpenseReceiptDocumentRevision(
  db: D1Database,
  documentId: string,
): Promise<number> {
  await ensureExpenseReceiptApprovalSchema(db);
  await db.prepare(`INSERT OR IGNORE INTO expense_receipt_document_revisions (document_id, revision)
    SELECT id, 1 FROM documents WHERE id = ? AND template_id = ?`)
    .bind(documentId, EXPENSE_RECEIPT_TEMPLATE_ID).run();
  const row = await db.prepare(`SELECT revision FROM expense_receipt_document_revisions
    WHERE document_id = ?`).bind(documentId).first<{ revision: number }>();
  if (!row) throw new ExpenseReceiptApprovalError('영수증 첨부 신청서 버전을 확인할 수 없습니다.', 404);
  return Number(row.revision);
}

export async function signExpenseReceiptAuthorAtRevision(
  db: D1Database,
  input: {
    documentId: string;
    authorId: string;
    signatureData: string;
    expectedRevision: number;
    ipAddress: string;
    userAgent: string;
  },
): Promise<{ signatureId: string; revision: number }> {
  await ensureExpenseReceiptApprovalSchema(db);
  await clearStaleExpenseReceiptClaims(db, input.documentId);
  if (!await isValidExpenseReceiptAuthorSignatureDataUrl(input.signatureData)) {
    throw new ExpenseReceiptApprovalError('유효한 PNG 서명 이미지만 저장할 수 있습니다.', 400);
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new ExpenseReceiptApprovalError('서명할 문서 버전이 올바르지 않습니다.', 400);
  }
  const signatureId = crypto.randomUUID();
  const claimToken = `sign:${crypto.randomUUID()}`;
  const claimExists = `EXISTS (SELECT 1 FROM expense_receipt_submission_claims
    WHERE document_id = ? AND claim_token = ?)`;
  try {
    const results = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO expense_receipt_document_revisions (document_id, revision)
        SELECT id, 1 FROM documents WHERE id = ? AND template_id = ?`)
        .bind(input.documentId, EXPENSE_RECEIPT_TEMPLATE_ID),
      db.prepare(`INSERT OR IGNORE INTO expense_receipt_submission_claims (document_id, claim_token)
        SELECT d.id, ? FROM documents d
        JOIN expense_receipt_document_revisions r ON r.document_id = d.id
        WHERE d.id = ? AND d.template_id = ? AND d.author_id = ?
          AND d.status IN ('draft', 'rejected') AND r.revision = ?`)
        .bind(
          claimToken, input.documentId, EXPENSE_RECEIPT_TEMPLATE_ID,
          input.authorId, input.expectedRevision,
        ),
      db.prepare(`DELETE FROM expense_receipt_signature_attestations
        WHERE document_id = ? AND ${claimExists}
          AND NOT EXISTS (SELECT 1 FROM signatures s
            WHERE s.id = expense_receipt_signature_attestations.signature_id
              AND s.document_id = expense_receipt_signature_attestations.document_id)`)
        .bind(input.documentId, input.documentId, claimToken),
      db.prepare(`INSERT INTO signatures
          (id, document_id, user_id, signature_data, ip_address, user_agent)
        SELECT ?, d.id, d.author_id, ?, ?, ?
        FROM documents d
        JOIN expense_receipt_document_revisions r ON r.document_id = d.id
        WHERE d.id = ? AND d.template_id = ? AND d.author_id = ?
          AND d.status IN ('draft', 'rejected') AND r.revision = ?
          AND ${claimExists}
          AND NOT EXISTS (SELECT 1 FROM signatures existing
            WHERE existing.document_id = d.id AND existing.user_id = d.author_id
              AND existing.signature_data != ?)`)
        .bind(
          signatureId, input.signatureData, input.ipAddress, input.userAgent,
          input.documentId, EXPENSE_RECEIPT_TEMPLATE_ID, input.authorId, input.expectedRevision,
          input.documentId, claimToken, EXPENSE_RECEIPT_REPRESENTATIVE_STAMP,
        ),
      db.prepare(`INSERT INTO expense_receipt_signature_attestations
          (document_id, signature_id, author_id, revision)
        SELECT ?, ?, ?, r.revision
        FROM expense_receipt_document_revisions r
        JOIN signatures s ON s.id = ? AND s.document_id = r.document_id
        WHERE r.document_id = ? AND r.revision = ? AND ${claimExists}`)
        .bind(
          input.documentId, signatureId, input.authorId, signatureId,
          input.documentId, input.expectedRevision, input.documentId, claimToken,
        ),
      db.prepare('DELETE FROM expense_receipt_submission_claims WHERE document_id = ? AND claim_token = ?')
        .bind(input.documentId, claimToken),
    ]);
    if (Number(results[1]?.meta?.changes || 0) !== 1 || Number(results[3]?.meta?.changes || 0) !== 1) {
      throw new ExpenseReceiptApprovalError('문서 또는 첨부가 변경되었습니다. 새로고침 후 다시 서명해 주세요.', 409);
    }
  } catch (error) {
    if (error instanceof ExpenseReceiptApprovalError) throw error;
    if (/UNIQUE|constraint|revision|immutable/i.test(String(error))) {
      throw new ExpenseReceiptApprovalError('문서 또는 첨부가 변경되었습니다. 새로고침 후 다시 서명해 주세요.', 409);
    }
    throw error;
  }
  return { signatureId, revision: input.expectedRevision };
}

async function loadPendingRepresentativeStep(
  db: D1Database,
  documentId: string,
  requestedStepId?: string,
): Promise<{ id: string; approver_id: string; approver_role: string }> {
  const step = await db.prepare(`
    SELECT s.id, s.approver_id, u.role AS approver_role,
      COALESCE(u.approved, 0) AS approver_approved,
      COALESCE(u.login_type, 'employee') AS approver_login_type
    FROM approval_steps s
    LEFT JOIN users u ON u.id = s.approver_id
    JOIN documents d ON d.id = s.document_id
    WHERE s.document_id = ? AND s.status = 'pending'
      AND d.template_id = ? AND d.status = 'submitted' AND COALESCE(d.cancelled, 0) = 0
      AND COALESCE(d.cancel_requested, 0) = 0
    ORDER BY s.step_order ASC
    LIMIT 1
  `).bind(documentId, EXPENSE_RECEIPT_TEMPLATE_ID)
    .first<{
      id: string;
      approver_id: string;
      approver_role: string | null;
      approver_approved: number;
      approver_login_type: string;
    }>();
  if (!step) throw new ExpenseReceiptApprovalError('승인 대기 중인 대표이사 결재 단계를 찾을 수 없습니다.', 409);
  if (requestedStepId && requestedStepId !== step.id) {
    throw new ExpenseReceiptApprovalError('현재 승인 대기 중인 결재 단계가 아닙니다.', 409);
  }
  const representativeIsActive = step.approver_role === 'ceo'
    && Number(step.approver_approved) === 1
    && step.approver_login_type !== 'freelancer';
  if (representativeIsActive) {
    return { id: step.id, approver_id: step.approver_id, approver_role: 'ceo' };
  }

  const replacement = await findExpenseReceiptRepresentative(db);
  if (!replacement) {
    throw new ExpenseReceiptApprovalError('활성 대표이사 계정이 없어 결재를 진행할 수 없습니다.', 409);
  }
  const reassigned = await db.prepare(`UPDATE approval_steps
    SET approver_id = ?
    WHERE id = ? AND document_id = ? AND status = 'pending' AND approver_id = ?`)
    .bind(replacement.id, step.id, documentId, step.approver_id).run();
  if (Number(reassigned.meta?.changes || 0) !== 1) {
    throw new ExpenseReceiptApprovalError('결재선이 변경되었습니다. 새로고침 후 다시 처리해 주세요.', 409);
  }
  return { id: step.id, approver_id: replacement.id, approver_role: replacement.role };
}

async function requireActiveActor(
  db: D1Database,
  step: { id: string },
  input: ExpenseReceiptActionInput,
): Promise<ExpenseReceiptActor> {
  const document = await db.prepare(`SELECT author_id FROM documents
    WHERE id = ? AND template_id = ? LIMIT 1`)
    .bind(input.documentId, EXPENSE_RECEIPT_TEMPLATE_ID)
    .first<{ author_id: string }>();
  if (!document || document.author_id === input.actorId) {
    throw new ExpenseReceiptApprovalError('신청자는 본인의 영수증 지출결의서를 승인하거나 반려할 수 없습니다.', 403);
  }
  const actor = await getActiveExpenseReceiptActor(
    db,
    input.documentId,
    step.id,
    input.actorId,
    input.actorRole,
  );
  if (!actor) {
    throw new ExpenseReceiptApprovalError('제출 시 지정된 활성 총무 결재자만 처리할 수 있습니다.', 403);
  }
  return actor;
}

export async function approveExpenseReceipt(
  db: D1Database,
  input: ExpenseReceiptActionInput,
): Promise<ExpenseReceiptActionResult> {
  await ensureExpenseReceiptApprovalSchema(db);
  const step = await loadPendingRepresentativeStep(db, input.documentId, input.requestedStepId);
  const actor = await requireActiveActor(db, step, input);
  const auditAgent = `${buildExpenseReceiptSignatureAgent(actor.id, actor.role)};${input.userAgent}`;
  const comment = String(input.comment || '').trim().slice(0, 1000);

  try {
    await db.batch([
    db.prepare(`
      UPDATE approval_steps
      SET status = 'approved', signed_at = datetime('now'), comment = ?
      WHERE id = ? AND document_id = ? AND status = 'pending'
    `).bind(`delegate:${actor.id}${comment ? `;${comment}` : ''}`, step.id, input.documentId),
    db.prepare(`
      INSERT INTO signatures (id, document_id, user_id, signature_data, ip_address, user_agent)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM signatures
        WHERE document_id = ? AND user_id = ? AND signature_data = ?
      )
    `).bind(
      `expense-receipt-stamp-${step.id}`,
      input.documentId,
      step.approver_id,
      EXPENSE_RECEIPT_REPRESENTATIVE_STAMP,
      input.ipAddress,
      auditAgent,
      input.documentId,
      step.approver_id,
      EXPENSE_RECEIPT_REPRESENTATIVE_STAMP,
    ),
    db.prepare(`
      INSERT INTO expense_receipt_approval_actions
        (id, document_id, approval_step_id, action,
         actual_actor_id, actual_actor_name, actual_actor_role,
         representative_user_id, used_representative_stamp,
         comment, ip_address, user_agent)
      VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, 1, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), input.documentId, step.id,
      actor.id, actor.name, actor.role, step.approver_id,
      comment, input.ipAddress, input.userAgent,
    ),
    db.prepare(`
      UPDATE documents
      SET status = 'approved', reject_reason = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'submitted' AND COALESCE(cancelled, 0) = 0
        AND COALESCE(cancel_requested, 0) = 0
    `).bind(input.documentId),
    db.prepare(`
      UPDATE alert_approval_pending
      SET status = 'acted', acted_at = datetime('now'), acted_action = 'approved',
          last_checked_at = datetime('now')
      WHERE document_id = ? AND status = 'open'
        AND cycle_no = (
          SELECT COALESCE(MAX(cycle_no), 0)
          FROM alert_approval_pending WHERE document_id = ?
        )
    `).bind(input.documentId, input.documentId),
    db.prepare(`
      INSERT INTO document_logs (id, document_id, user_id, action, details)
      VALUES (?, ?, ?, 'expense_receipt_approved', ?)
    `).bind(
      crypto.randomUUID(), input.documentId, actor.id,
      JSON.stringify({
        actual_actor_id: actor.id,
        actual_actor_name: actor.name,
        actual_actor_role: actor.role,
        representative_user_id: step.approver_id,
        used_representative_stamp: true,
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
        comment,
      }),
    ),
    ]);
  } catch (error) {
    if (/UNIQUE|constraint|approved|submitted|cancelled/i.test(String(error))) {
      throw new ExpenseReceiptApprovalError('이미 다른 결재자가 처리한 신청서입니다.', 409);
    }
    throw error;
  }

  return { stepId: step.id, representativeUserId: step.approver_id, actor };
}

// 최종승인 되돌리기 — approveExpenseReceipt를 역으로 되돌려 '제출(결재대기)' 상태로 복귀시킨다.
export async function revertExpenseReceiptApproval(
  db: D1Database,
  input: { documentId: string; actorId: string; actorName: string; actorRole: string; ipAddress?: string; userAgent?: string },
): Promise<{ reverted: boolean }> {
  await ensureExpenseReceiptApprovalSchema(db);
  const doc = await db.prepare('SELECT status, cancelled, cancel_requested FROM documents WHERE id = ?')
    .bind(input.documentId).first<{ status: string; cancelled: number; cancel_requested: number }>();
  if (!doc) throw new ExpenseReceiptApprovalError('문서를 찾을 수 없습니다.', 404);
  if (doc.status !== 'approved') throw new ExpenseReceiptApprovalError('승인 완료된 신청서만 되돌릴 수 있습니다.', 400);
  if (doc.cancelled) throw new ExpenseReceiptApprovalError('취소된 신청서는 되돌릴 수 없습니다.', 409);
  if (doc.cancel_requested) throw new ExpenseReceiptApprovalError('취소 신청 중인 신청서는 되돌릴 수 없습니다.', 409);

  await db.batch([
    // 결재 단계: approved → pending
    db.prepare(`UPDATE approval_steps SET status = 'pending', signed_at = NULL, comment = NULL
      WHERE document_id = ? AND status = 'approved'`).bind(input.documentId),
    // 대표 직인 서명 제거
    db.prepare('DELETE FROM signatures WHERE document_id = ? AND signature_data = ?')
      .bind(input.documentId, EXPENSE_RECEIPT_REPRESENTATIVE_STAMP),
    // 승인 액션 기록 제거
    db.prepare("DELETE FROM expense_receipt_approval_actions WHERE document_id = ? AND action = 'approved'")
      .bind(input.documentId),
    // 문서: approved → submitted (결재대기로 복귀)
    db.prepare(`UPDATE documents SET status = 'submitted', reject_reason = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'approved' AND COALESCE(cancelled, 0) = 0 AND COALESCE(cancel_requested, 0) = 0`)
      .bind(input.documentId),
    // 결재 대기 알림 재오픈
    db.prepare(`UPDATE alert_approval_pending SET status = 'open', acted_at = NULL, acted_action = NULL, last_checked_at = datetime('now')
      WHERE document_id = ? AND status = 'acted' AND acted_action = 'approved'
        AND cycle_no = (SELECT COALESCE(MAX(cycle_no), 0) FROM alert_approval_pending WHERE document_id = ?)`)
      .bind(input.documentId, input.documentId),
    // 로그
    db.prepare(`INSERT INTO document_logs (id, document_id, user_id, action, details)
      VALUES (?, ?, ?, 'expense_receipt_approval_reverted', ?)`)
      .bind(crypto.randomUUID(), input.documentId, input.actorId, JSON.stringify({
        actual_actor_id: input.actorId,
        actual_actor_name: input.actorName,
        actual_actor_role: input.actorRole,
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
      })),
  ]);
  return { reverted: true };
}

export async function rejectExpenseReceipt(
  db: D1Database,
  input: ExpenseReceiptActionInput,
): Promise<ExpenseReceiptActionResult> {
  await ensureExpenseReceiptApprovalSchema(db);
  if (!String(input.comment || '').trim()) {
    throw new ExpenseReceiptApprovalError('반려 사유를 입력해주세요.', 400);
  }
  const step = await loadPendingRepresentativeStep(db, input.documentId, input.requestedStepId);
  const actor = await requireActiveActor(db, step, input);
  const reason = String(input.comment || '').trim().slice(0, 1000);

  try {
    await db.batch([
    db.prepare(`
      UPDATE approval_steps
      SET status = 'rejected', signed_at = NULL, comment = ?
      WHERE id = ? AND document_id = ? AND status = 'pending'
    `).bind(`delegate:${actor.id}${reason ? `;${reason}` : ''}`, step.id, input.documentId),
    db.prepare(`
      DELETE FROM signatures
      WHERE document_id = ? AND user_id = ? AND signature_data = ?
    `).bind(input.documentId, step.approver_id, EXPENSE_RECEIPT_REPRESENTATIVE_STAMP),
    db.prepare(`
      INSERT INTO expense_receipt_approval_actions
        (id, document_id, approval_step_id, action,
         actual_actor_id, actual_actor_name, actual_actor_role,
         representative_user_id, used_representative_stamp,
         comment, ip_address, user_agent)
      VALUES (?, ?, ?, 'rejected', ?, ?, ?, NULL, 0, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), input.documentId, step.id,
      actor.id, actor.name, actor.role,
      reason, input.ipAddress, input.userAgent,
    ),
    db.prepare(`
      UPDATE documents
      SET status = 'rejected', reject_reason = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'submitted' AND COALESCE(cancelled, 0) = 0
        AND COALESCE(cancel_requested, 0) = 0
    `).bind(reason, input.documentId),
    db.prepare(`
      UPDATE alert_approval_pending
      SET status = 'acted', acted_at = datetime('now'), acted_action = 'rejected',
          last_checked_at = datetime('now')
      WHERE document_id = ? AND status = 'open'
        AND cycle_no = (
          SELECT COALESCE(MAX(cycle_no), 0)
          FROM alert_approval_pending WHERE document_id = ?
        )
    `).bind(input.documentId, input.documentId),
    db.prepare(`
      INSERT INTO document_logs (id, document_id, user_id, action, details)
      VALUES (?, ?, ?, 'expense_receipt_rejected', ?)
    `).bind(
      crypto.randomUUID(), input.documentId, actor.id,
      JSON.stringify({
        actual_actor_id: actor.id,
        actual_actor_name: actor.name,
        actual_actor_role: actor.role,
        representative_user_id: step.approver_id,
        used_representative_stamp: false,
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
        reason,
      }),
    ),
    ]);
  } catch (error) {
    if (/UNIQUE|constraint|rejected|submitted|cancelled/i.test(String(error))) {
      throw new ExpenseReceiptApprovalError('이미 다른 결재자가 처리한 신청서입니다.', 409);
    }
    throw error;
  }

  return { stepId: step.id, representativeUserId: step.approver_id, actor };
}

export function getRequestAudit(c: {
  req: { header(name: string): string | undefined };
}): { ipAddress: string; userAgent: string } {
  const ipAddress = (c.req.header('CF-Connecting-IP')
    || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown').slice(0, 200);
  const userAgent = (c.req.header('User-Agent') || 'unknown').slice(0, 1000);
  return { ipAddress, userAgent };
}

export function buildExpenseReceiptSignatureAgent(actorId: string, actorRole: string): string {
  return `expense-receipt-delegate:${actorId}:${actorRole}`;
}

export function isExpenseReceiptRepresentativeStamp(signatureData: string): boolean {
  return signatureData === EXPENSE_RECEIPT_REPRESENTATIVE_STAMP;
}

export async function getLatestExpenseReceiptApprovalAction(
  db: D1Database,
  documentId: string,
): Promise<ExpenseReceiptApprovalAction | null> {
  await ensureExpenseReceiptApprovalSchema(db);
  return await db.prepare(`
    SELECT action,
           actual_actor_id AS actor_id,
           actual_actor_name AS actor_name,
           actual_actor_role AS actor_role,
           COALESCE(comment, '') AS comment,
           created_at
    FROM expense_receipt_approval_actions
    WHERE document_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).bind(documentId).first<ExpenseReceiptApprovalAction>() || null;
}
