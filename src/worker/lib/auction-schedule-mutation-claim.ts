export interface AuctionScheduleMutationSnapshot {
  id: string;
  user_id: string;
  target_date: string;
  activity_type: string;
  activity_subtype: string;
  data: string;
  branch: string;
  department: string;
  created_at: string;
  updated_at: string;
}

const ensurePromises = new WeakMap<object, Promise<void>>();

export async function ensureAuctionScheduleMutationClaimTable(db: D1Database): Promise<void> {
  const key = db as unknown as object;
  const existing = ensurePromises.get(key);
  if (existing) return existing;
  const promise = db.prepare(`
    CREATE TABLE IF NOT EXISTS auction_schedule_mutation_claims (
      schedule_id TEXT PRIMARY KEY,
      claim_token TEXT NOT NULL UNIQUE,
      operation TEXT NOT NULL,
      actor_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `).run().then(() => undefined);
  ensurePromises.set(key, promise);
  try {
    await promise;
  } catch (error) {
    ensurePromises.delete(key);
    throw error;
  }
}

export async function purgeStaleAuctionScheduleMutationClaims(db: D1Database): Promise<void> {
  await ensureAuctionScheduleMutationClaimTable(db);
  await db.prepare("DELETE FROM auction_schedule_mutation_claims WHERE created_at < datetime('now', '+9 hours', '-15 minutes')").run();
}

export async function acquireAuctionScheduleMutationClaim(
  db: D1Database,
  snapshot: AuctionScheduleMutationSnapshot,
  operation: string,
  actorId: string,
): Promise<string | null> {
  await ensureAuctionScheduleMutationClaimTable(db);
  // Worker 중단으로 남은 claim만 회수한다. 정상 요청은 finally에서 즉시 해제한다.
  await purgeStaleAuctionScheduleMutationClaims(db);
  const token = crypto.randomUUID();
  const result = await db.prepare(`
    INSERT OR IGNORE INTO auction_schedule_mutation_claims
      (schedule_id, claim_token, operation, actor_id)
    SELECT s.id, ?, ?, ?
    FROM freelancer_auction_schedules s
    WHERE s.id = ? AND s.user_id = ? AND s.target_date = ? AND s.activity_type = ?
      AND s.activity_subtype = ? AND s.data = ? AND s.branch = ? AND s.department = ?
      AND s.created_at = ? AND s.updated_at = ?
  `).bind(
    token,
    String(operation || '').slice(0, 100),
    actorId,
    snapshot.id,
    snapshot.user_id,
    snapshot.target_date,
    snapshot.activity_type,
    snapshot.activity_subtype,
    snapshot.data,
    snapshot.branch,
    snapshot.department,
    snapshot.created_at,
    snapshot.updated_at,
  ).run();
  return Number(result.meta?.changes || 0) === 1 ? token : null;
}

export async function releaseAuctionScheduleMutationClaim(
  db: D1Database,
  token: string | null | undefined,
): Promise<void> {
  if (!token) return;
  try {
    await db.prepare('DELETE FROM auction_schedule_mutation_claims WHERE claim_token = ?').bind(token).run();
  } catch (error) {
    // 본 처리 커밋 뒤 claim 정리 실패로 성공 응답을 500으로 바꾸면 사용자가
    // 재시도해 중복 side effect를 만들 수 있다. 잔류 claim은 acquire의 TTL로 회수한다.
    console.error('Failed to release auction schedule mutation claim', error);
  }
}
