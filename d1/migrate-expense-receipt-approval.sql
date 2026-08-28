-- Immutable audit trail for delegated approval/rejection of the expense receipt form.
-- approval_step_id intentionally has no FK: rejected documents delete/recreate their
-- approval steps on resubmission, while the action audit must remain immutable.
CREATE TABLE IF NOT EXISTS alert_approval_pending (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  cycle_no INTEGER NOT NULL DEFAULT 1,
  step_order INTEGER NOT NULL,
  my_status TEXT NOT NULL,
  document_title TEXT,
  document_template_id TEXT,
  document_author_id TEXT,
  document_author_name TEXT,
  document_branch TEXT,
  document_department TEXT,
  document_submitted_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  acted_at TEXT,
  acted_action TEXT,
  notification_sent INTEGER NOT NULL DEFAULT 0,
  notification_sent_at TEXT,
  notification_error TEXT,
  metadata TEXT,
  UNIQUE(document_id, approver_id, cycle_no),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_aap_approver_status
  ON alert_approval_pending(approver_id, status);
CREATE INDEX IF NOT EXISTS idx_aap_doc_status
  ON alert_approval_pending(document_id, status);
CREATE INDEX IF NOT EXISTS idx_aap_status_detected
  ON alert_approval_pending(status, detected_at);
CREATE INDEX IF NOT EXISTS idx_aap_notify
  ON alert_approval_pending(notification_sent, status, my_status);

CREATE TABLE IF NOT EXISTS expense_receipt_approval_actions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  approval_step_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  actual_actor_id TEXT NOT NULL,
  actual_actor_name TEXT NOT NULL,
  actual_actor_role TEXT NOT NULL,
  representative_user_id TEXT,
  used_representative_stamp INTEGER NOT NULL DEFAULT 0
    CHECK (used_representative_stamp IN (0, 1)),
  comment TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (approval_step_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (actual_actor_id) REFERENCES users(id),
  FOREIGN KEY (representative_user_id) REFERENCES users(id)
);

-- Submission-time delegate snapshot. A later role change or newly-created
-- accounting account must not grant access to an already-submitted request.
CREATE TABLE IF NOT EXISTS expense_receipt_approval_delegates (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  approval_step_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_snapshot TEXT NOT NULL CHECK (role_snapshot IN ('accountant', 'accountant_asst')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (approval_step_id, user_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Short-lived atomic submission claim. Rows are inserted and deleted in one
-- D1 batch so concurrent submissions cannot interleave approval steps.
CREATE TABLE IF NOT EXISTS expense_receipt_submission_claims (
  document_id TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expense_receipt_document_revisions (
  document_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expense_receipt_signature_attestations (
  document_id TEXT PRIMARY KEY,
  signature_id TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (signature_id) REFERENCES signatures(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_actions_document
  ON expense_receipt_approval_actions(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_actions_actor
  ON expense_receipt_approval_actions(actual_actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_delegates_document
  ON expense_receipt_approval_delegates(document_id, approval_step_id);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_approval_delegates_user
  ON expense_receipt_approval_delegates(user_id, document_id);

-- Final DB invariant: even if attachment/signature state changes after the
-- route preflight, a receipt cannot transition to submitted without both.
DROP TRIGGER IF EXISTS trg_expense_receipt_submit_requirements;
DROP TRIGGER IF EXISTS trg_expense_receipt_submit_requirements_v2;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_submit_requirements_v2
BEFORE UPDATE OF status ON documents
WHEN OLD.status IN ('draft', 'rejected')
  AND NEW.status = 'submitted'
  AND NEW.template_id = 'tpl-exp-receipt-001'
  AND (
    NEW.content != OLD.content
    OR NOT EXISTS (
      SELECT 1 FROM signatures s
      JOIN expense_receipt_signature_attestations sa
        ON sa.signature_id = s.id AND sa.document_id = s.document_id
      JOIN expense_receipt_document_revisions r ON r.document_id = s.document_id
      WHERE s.document_id = NEW.id AND s.user_id = NEW.author_id
        AND s.signature_data != '/LNCstemp.png'
        AND sa.author_id = NEW.author_id AND sa.revision = r.revision
    )
    OR NOT EXISTS (
      SELECT 1 FROM expense_receipt_attachments a
      WHERE a.document_id = NEW.id
        AND a.deleted_at IS NULL AND a.purged_at IS NULL
        AND a.object_key IS NOT NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'expense receipt submission requirements missing');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_content_lock
BEFORE UPDATE OF title, content ON documents
WHEN OLD.template_id = 'tpl-exp-receipt-001'
  AND OLD.status NOT IN ('draft', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'submitted expense receipt content is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_delete_lock
BEFORE DELETE ON documents
WHEN OLD.template_id = 'tpl-exp-receipt-001'
  AND OLD.status NOT IN ('draft', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'submitted expense receipt cannot be deleted');
END;

DROP TRIGGER IF EXISTS trg_expense_receipt_approval_step_guard;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_approval_step_guard
BEFORE UPDATE OF status ON approval_steps
WHEN OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')
  AND EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = OLD.document_id AND d.template_id = 'tpl-exp-receipt-001'
      AND (d.status != 'submitted' OR COALESCE(d.cancelled, 0) != 0
        OR COALESCE(d.cancel_requested, 0) != 0)
  )
  AND NOT (
    NEW.status = 'rejected' AND COALESCE(NEW.comment, '') = 'cancelled'
    AND EXISTS (SELECT 1 FROM documents d
      WHERE d.id = OLD.document_id AND d.template_id = 'tpl-exp-receipt-001'
        AND COALESCE(d.cancelled, 0) = 1)
  )
BEGIN
  SELECT RAISE(ABORT, 'cancelled expense receipt cannot be acted on');
END;

DROP TRIGGER IF EXISTS trg_expense_receipt_approval_action_guard;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_approval_action_guard
BEFORE INSERT ON expense_receipt_approval_actions
WHEN NOT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = NEW.document_id AND d.template_id = 'tpl-exp-receipt-001'
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
BEGIN
  SELECT RAISE(ABORT, 'cancelled expense receipt cannot be acted on');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_document_revision
AFTER UPDATE OF title, content ON documents
WHEN NEW.template_id = 'tpl-exp-receipt-001'
  AND NEW.status IN ('draft', 'rejected')
BEGIN
  INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
  VALUES (NEW.id, 1, datetime('now'))
  ON CONFLICT(document_id) DO UPDATE SET
    revision = revision + 1, updated_at = datetime('now');
END;
