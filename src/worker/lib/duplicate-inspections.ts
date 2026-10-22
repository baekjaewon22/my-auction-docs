// 동일 담당자의 반복 등록은 한 사람으로 계산하고, 법원·사건번호·물건번호가
// 모두 같은 임장을 서로 다른 담당자가 등록했을 때만 중복으로 본다.
export const DUPLICATE_INSPECTIONS_QUERY = `
  WITH normalized_inspections AS (
    SELECT
      j.activity_subtype AS case_no,
      COALESCE(json_extract(j.data, '$.court'), '') AS court,
      REPLACE(REPLACE(TRIM(COALESCE(json_extract(j.data, '$.itemNo'), '')), ' ', ''), '번', '') AS item_no,
      j.branch,
      j.user_id,
      COALESCE(NULLIF(TRIM(u.name), ''), '삭제된 사용자') AS user_name,
      u.department AS user_department,
      j.target_date,
      CASE
        WHEN u.id IS NULL THEN 'orphan:' || j.user_id
        WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(u.phone, '')), '-', ''), ' ', ''), '(', ''), ')', ''), '+', '') != ''
          THEN 'phone:' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(u.phone), '-', ''), ' ', ''), '(', ''), ')', ''), '+', '')
        ELSE 'profile:' || LOWER(TRIM(COALESCE(u.name, ''))) || '|'
          || TRIM(COALESCE(NULLIF(u.branch, ''), j.branch, '')) || '|'
          || TRIM(COALESCE(NULLIF(u.department, ''), j.department, ''))
      END AS assignee_key
    FROM journal_entries j
    LEFT JOIN users u ON j.user_id = u.id
    WHERE j.activity_type = '임장'
      AND j.activity_subtype != ''
      AND COALESCE(json_extract(j.data, '$.companion'), 0) != 1
  )
  SELECT case_no,
         court,
         item_no,
         GROUP_CONCAT(DISTINCT branch) AS branch,
         GROUP_CONCAT(DISTINCT user_name) AS user_names,
         GROUP_CONCAT(DISTINCT user_id) AS user_ids,
         GROUP_CONCAT(DISTINCT user_department) AS user_departments,
         COUNT(DISTINCT assignee_key) AS user_count,
         MIN(target_date) AS first_date,
         MAX(target_date) AS last_date
  FROM normalized_inspections
  GROUP BY case_no, court, item_no
  HAVING COUNT(DISTINCT assignee_key) > 1
     AND MIN(target_date) >= date('now', '-30 days')
  ORDER BY MAX(target_date) DESC
`;
