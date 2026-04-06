-- 승인 완료했지만 서명이 없는 건에 저장된 서명을 삽입
INSERT INTO signatures (id, document_id, user_id, signature_data, ip_address, user_agent)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
  s.document_id,
  s.approver_id,
  u.saved_signature,
  'backfill',
  'backfill'
FROM approval_steps s
JOIN users u ON s.approver_id = u.id
WHERE s.status = 'approved'
  AND u.saved_signature IS NOT NULL
  AND LENGTH(u.saved_signature) > 10
  AND NOT EXISTS (
    SELECT 1 FROM signatures sig
    WHERE sig.document_id = s.document_id AND sig.user_id = s.approver_id
  );
