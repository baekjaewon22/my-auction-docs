-- Expand receipt approval/rejection to the assigned CEO while preserving the
-- existing submission-time accounting snapshot and master emergency proxy.
-- This forward migration is required for databases where the original receipt
-- approval migration has already been applied.

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
