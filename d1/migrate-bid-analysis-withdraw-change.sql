-- Normalize journal-synced bid cancellation values after adding the explicit
-- "취하/변경" bid-analysis result.
UPDATE bid_analysis_entries
SET bid_result = '취하/변경',
    updated_at = datetime('now', '+9 hours')
WHERE source_type = 'journal'
  AND bid_result IN ('취소', '취하', '변경');

UPDATE bid_analysis_entries
SET bid_result = '취하/변경',
    updated_at = datetime('now', '+9 hours')
WHERE bid_result IN ('취하', '변경');
