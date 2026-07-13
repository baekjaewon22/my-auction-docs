-- Keep only the latest 2 months of document archive rows in D1.
-- Google Drive backup files are not touched by this cleanup.

DELETE FROM document_journal_link_backfill_log
WHERE document_id IN (
  SELECT id FROM documents WHERE updated_at < datetime('now', '-2 months')
);

DELETE FROM document_journal_link_candidates
WHERE document_id IN (
  SELECT id FROM documents WHERE updated_at < datetime('now', '-2 months')
);

DELETE FROM document_journal_links
WHERE document_id IN (
  SELECT id FROM documents WHERE updated_at < datetime('now', '-2 months')
);

DELETE FROM alert_approval_pending
WHERE document_id IN (
  SELECT id FROM documents WHERE updated_at < datetime('now', '-2 months')
);

DELETE FROM drive_backup_logs
WHERE document_id IN (
  SELECT id FROM documents WHERE updated_at < datetime('now', '-2 months')
);

DELETE FROM approval_steps
WHERE document_id IN (
  SELECT id FROM documents WHERE updated_at < datetime('now', '-2 months')
);

DELETE FROM signatures
WHERE document_id IN (
  SELECT id FROM documents WHERE updated_at < datetime('now', '-2 months')
);

DELETE FROM document_logs
WHERE document_id IN (
  SELECT id FROM documents WHERE updated_at < datetime('now', '-2 months')
);

DELETE FROM documents
WHERE updated_at < datetime('now', '-2 months');

DELETE FROM drive_backup_logs
WHERE document_id NOT IN (SELECT id FROM documents);
