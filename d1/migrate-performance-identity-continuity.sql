-- Preserve one performance timeline across employee/freelancer transitions.
-- Apply once to databases that already have bid_analysis_entries.
ALTER TABLE bid_analysis_entries ADD COLUMN assignee_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_bid_analysis_assignee_user
  ON bid_analysis_entries(assignee_user_id);

UPDATE bid_analysis_entries
SET assignee_user_id = (
  SELECT j.user_id
  FROM journal_entries j
  WHERE j.id = bid_analysis_entries.source_id
)
WHERE assignee_user_id IS NULL
  AND source_type = 'journal'
  AND source_id IS NOT NULL;

UPDATE bid_analysis_entries
SET assignee_user_id = uploaded_by
WHERE assignee_user_id IS NULL
  AND source_type = 'freelancer'
  AND uploaded_by IS NOT NULL;
