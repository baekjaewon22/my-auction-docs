-- 경매 일정의 결과처리·수정·삭제·배치 작업을 상호 배제하는 단기 claim.
-- runtime ensure와 동일한 idempotent DDL이며, 중단된 claim은 애플리케이션 TTL로 회수한다.
CREATE TABLE IF NOT EXISTS auction_schedule_mutation_claims (
  schedule_id TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL,
  actor_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);
