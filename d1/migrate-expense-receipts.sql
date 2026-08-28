-- 영수증 첨부 지출결의서: R2 원본/합본 PDF 메타와 1회용 인쇄 세션
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

CREATE TABLE IF NOT EXISTS expense_receipt_attachments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  object_key TEXT UNIQUE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  image_width INTEGER NOT NULL DEFAULT 0,
  image_height INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  purged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_expense_receipt_attachments_document
ON expense_receipt_attachments(document_id, deleted_at, sort_order);

CREATE INDEX IF NOT EXISTS idx_expense_receipt_attachments_sha
ON expense_receipt_attachments(document_id, sha256, deleted_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_receipt_attachments_active_sha
ON expense_receipt_attachments(document_id, sha256)
WHERE deleted_at IS NULL AND purged_at IS NULL AND sha256 != '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_receipt_attachments_active_order
ON expense_receipt_attachments(document_id, sort_order)
WHERE deleted_at IS NULL AND purged_at IS NULL;

-- Attachment mutations must remain editable even when a concurrent submit races
-- the request.  These database guards are the final authority; route-level
-- status checks are intentionally only an early, user-friendly rejection.
DROP TRIGGER IF EXISTS trg_expense_receipt_attachment_insert_editable;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_insert_editable
BEFORE INSERT ON expense_receipt_attachments
WHEN NOT EXISTS (
    SELECT 1 FROM documents
    WHERE id = NEW.document_id
      AND template_id = 'tpl-exp-receipt-001'
      AND status IN ('draft', 'rejected')
  )
  OR EXISTS (
    SELECT 1 FROM expense_receipt_submission_claims
    WHERE document_id = NEW.document_id
      AND claim_token NOT LIKE 'attachment:%'
  )
BEGIN
  SELECT RAISE(ABORT, 'expense receipt document is not editable');
END;

DROP TRIGGER IF EXISTS trg_expense_receipt_attachment_order_editable;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_order_editable
BEFORE UPDATE OF sort_order ON expense_receipt_attachments
WHEN NOT EXISTS (
    SELECT 1 FROM documents
    WHERE id = NEW.document_id
      AND template_id = 'tpl-exp-receipt-001'
      AND status IN ('draft', 'rejected')
  )
  OR EXISTS (
    SELECT 1 FROM expense_receipt_submission_claims
    WHERE document_id = NEW.document_id
      AND claim_token NOT LIKE 'attachment:%'
  )
BEGIN
  SELECT RAISE(ABORT, 'expense receipt document is not editable');
END;

DROP TRIGGER IF EXISTS trg_expense_receipt_attachment_delete_editable;
CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_delete_editable
BEFORE UPDATE OF deleted_at ON expense_receipt_attachments
WHEN NOT EXISTS (
    SELECT 1 FROM documents
    WHERE id = NEW.document_id
      AND template_id = 'tpl-exp-receipt-001'
      AND status IN ('draft', 'rejected')
  )
  OR EXISTS (
    SELECT 1 FROM expense_receipt_submission_claims
    WHERE document_id = NEW.document_id
      AND claim_token NOT LIKE 'attachment:%'
  )
BEGIN
  SELECT RAISE(ABORT, 'expense receipt document is not editable');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_revision_insert
AFTER INSERT ON expense_receipt_attachments
BEGIN
  INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
  VALUES (NEW.document_id, 1, datetime('now'))
  ON CONFLICT(document_id) DO UPDATE SET revision=revision+1, updated_at=datetime('now');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_revision_update
AFTER UPDATE OF object_key, file_name, file_type, file_size, sha256, sort_order, deleted_at, purged_at
ON expense_receipt_attachments
BEGIN
  INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
  VALUES (NEW.document_id, 1, datetime('now'))
  ON CONFLICT(document_id) DO UPDATE SET revision=revision+1, updated_at=datetime('now');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_revision_delete
AFTER DELETE ON expense_receipt_attachments
BEGIN
  INSERT INTO expense_receipt_document_revisions (document_id, revision, updated_at)
  VALUES (OLD.document_id, 1, datetime('now'))
  ON CONFLICT(document_id) DO UPDATE SET revision=revision+1, updated_at=datetime('now');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_limit
BEFORE INSERT ON expense_receipt_attachments
WHEN (SELECT COUNT(*) FROM expense_receipt_attachments
      WHERE document_id=NEW.document_id AND deleted_at IS NULL AND purged_at IS NULL) >= 10
BEGIN
  SELECT RAISE(ABORT, 'expense receipt attachment count limit exceeded');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_total_bytes
BEFORE INSERT ON expense_receipt_attachments
WHEN COALESCE((SELECT SUM(file_size) FROM expense_receipt_attachments
      WHERE document_id=NEW.document_id AND deleted_at IS NULL AND purged_at IS NULL), 0) + NEW.file_size > 41943040
BEGIN
  SELECT RAISE(ABORT, 'expense receipt attachment byte limit exceeded');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_total_pixels
BEFORE INSERT ON expense_receipt_attachments
WHEN COALESCE((SELECT SUM(image_width * image_height) FROM expense_receipt_attachments
      WHERE document_id=NEW.document_id AND deleted_at IS NULL AND purged_at IS NULL), 0)
      + (NEW.image_width * NEW.image_height) > 60000000
BEGIN
  SELECT RAISE(ABORT, 'expense receipt attachment pixel limit exceeded');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_reactivate_limit
BEFORE UPDATE OF deleted_at, purged_at ON expense_receipt_attachments
WHEN NEW.deleted_at IS NULL AND NEW.purged_at IS NULL
  AND (OLD.deleted_at IS NOT NULL OR OLD.purged_at IS NOT NULL)
  AND (SELECT COUNT(*) FROM expense_receipt_attachments
    WHERE document_id=NEW.document_id AND id!=NEW.id
      AND deleted_at IS NULL AND purged_at IS NULL) >= 10
BEGIN
  SELECT RAISE(ABORT, 'expense receipt attachment count limit exceeded');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_update_total_bytes
BEFORE UPDATE OF deleted_at, purged_at, file_size ON expense_receipt_attachments
WHEN NEW.deleted_at IS NULL AND NEW.purged_at IS NULL
  AND (OLD.deleted_at IS NOT NULL OR OLD.purged_at IS NOT NULL OR NEW.file_size != OLD.file_size)
  AND COALESCE((SELECT SUM(file_size) FROM expense_receipt_attachments
    WHERE document_id=NEW.document_id AND id!=NEW.id
      AND deleted_at IS NULL AND purged_at IS NULL), 0) + NEW.file_size > 41943040
BEGIN
  SELECT RAISE(ABORT, 'expense receipt attachment byte limit exceeded');
END;

CREATE TRIGGER IF NOT EXISTS trg_expense_receipt_attachment_update_total_pixels
BEFORE UPDATE OF deleted_at, purged_at, image_width, image_height ON expense_receipt_attachments
WHEN NEW.deleted_at IS NULL AND NEW.purged_at IS NULL
  AND (OLD.deleted_at IS NOT NULL OR OLD.purged_at IS NOT NULL
    OR NEW.image_width != OLD.image_width OR NEW.image_height != OLD.image_height)
  AND COALESCE((SELECT SUM(image_width * image_height) FROM expense_receipt_attachments
    WHERE document_id=NEW.document_id AND id!=NEW.id
      AND deleted_at IS NULL AND purged_at IS NULL), 0)
    + (NEW.image_width * NEW.image_height) > 60000000
BEGIN
  SELECT RAISE(ABORT, 'expense receipt attachment pixel limit exceeded');
END;

CREATE TABLE IF NOT EXISTS expense_receipt_pdf_artifacts (
  document_id TEXT PRIMARY KEY,
  object_key TEXT UNIQUE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  drive_file_id TEXT NOT NULL DEFAULT '',
  drive_md5_checksum TEXT NOT NULL DEFAULT '',
  drive_folder_path TEXT NOT NULL DEFAULT '',
  drive_backed_up_at TEXT,
  purged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_expense_receipt_pdf_artifacts_retention
ON expense_receipt_pdf_artifacts(drive_backed_up_at, purged_at);

CREATE TABLE IF NOT EXISTS expense_receipt_retention_attempts (
  document_id TEXT PRIMARY KEY,
  last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_result TEXT NOT NULL DEFAULT 'checking',
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_retention_attempts_time
ON expense_receipt_retention_attempts(last_attempt_at, document_id);

CREATE TABLE IF NOT EXISTS expense_receipt_r2_cleanup_queue (
  object_key TEXT PRIMARY KEY,
  document_id TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_r2_cleanup_queue_attempt
ON expense_receipt_r2_cleanup_queue(last_attempt_at, created_at, object_key);

CREATE TABLE IF NOT EXISTS print_render_sessions (
  jti TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_print_render_sessions_expiry
ON print_render_sessions(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS expense_receipt_drive_claims (
  document_id TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_expense_receipt_drive_claims_expiry
ON expense_receipt_drive_claims(expires_at);

-- 기존 지출결의서의 본문/생성자를 복제하되, 별도 템플릿으로 분리하여
-- 영수증 전용 승인·보존 정책이 과거 문서에 소급되지 않게 한다.
INSERT INTO templates (
  id, title, description, content, category, is_myauction, created_by, is_active
)
SELECT
  'tpl-exp-receipt-001',
  '영수증 첨부 지출결의서',
  '지출결의서와 영수증 이미지를 합본 PDF로 보관하는 비용 승인 문서',
  COALESCE((SELECT content FROM templates WHERE id = 'tpl-exp-001'), '{}'),
  '경비/비용',
  1,
  creator_id,
  1
FROM (
  SELECT COALESCE(
    (SELECT created_by FROM templates WHERE id = 'tpl-exp-001'),
    (SELECT id FROM users WHERE role = 'master' AND approved = 1 ORDER BY created_at ASC LIMIT 1)
  ) AS creator_id
)
WHERE creator_id IS NOT NULL
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  category = excluded.category,
  is_myauction = 1,
  is_active = 1,
  updated_at = datetime('now');
