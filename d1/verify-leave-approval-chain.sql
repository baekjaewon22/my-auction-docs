-- Read-only verification for leave approval chain parity with document approval.
-- Expected production case:
--   김영훈 PD -> 지원팀(no user_id) -> 의정부(user_id=정민호 admin)
--   정민호 should appear as an eligible approver for 김영훈's pending leave.

WITH RECURSIVE
target_request AS (
  SELECT lr.id, lr.user_id, lr.leave_type, lr.start_date, lr.status, u.name AS requester_name
  FROM leave_requests lr
  JOIN users u ON u.id = lr.user_id
  WHERE u.name = '김영훈'
    AND lr.start_date = '2026-07-06'
    AND lr.status = 'pending'
  LIMIT 1
),
ancestor_nodes(depth, node_id, user_id, parent_id, label) AS (
  SELECT 1, parent.id, parent.user_id, parent.parent_id, parent.label
  FROM target_request tr
  JOIN org_nodes child ON child.user_id = tr.user_id
  JOIN org_nodes parent ON parent.id = child.parent_id

  UNION ALL

  SELECT depth + 1, parent.id, parent.user_id, parent.parent_id, parent.label
  FROM ancestor_nodes an
  JOIN org_nodes parent ON parent.id = an.parent_id
  WHERE depth < 20
),
eligible_chain AS (
  SELECT
    an.depth,
    an.label AS org_label,
    u.id AS approver_id,
    u.name AS approver_name,
    u.role AS approver_role
  FROM ancestor_nodes an
  JOIN users u ON u.id = an.user_id
  WHERE u.approved = 1
    AND COALESCE(u.login_type, '') != 'freelancer'
    AND u.role NOT IN ('support', 'freelancer', 'resigned')
)
SELECT
  tr.id AS leave_request_id,
  tr.requester_name,
  tr.leave_type,
  tr.start_date,
  tr.status,
  ec.depth,
  ec.org_label,
  ec.approver_name,
  ec.approver_role,
  CASE WHEN ec.approver_name = '정민호' AND ec.approver_role = 'admin' THEN 1 ELSE 0 END AS expected_admin_can_approve
FROM target_request tr
LEFT JOIN eligible_chain ec ON 1 = 1
ORDER BY ec.depth;
