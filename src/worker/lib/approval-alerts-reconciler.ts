// alert_approval_pending 정합성 보강기
// - submitted 상태인데 alert 행이 없는 문서를 발견 → recreateAlertsForDoc 재호출
// - 즉시 발송 경로에서 INSERT가 silently 실패한 케이스를 30분 이내 복구
// - INSERT OR IGNORE 라서 정상 케이스엔 무해

import { recreateAlertsForDoc } from './approval-alerts';

const RECONCILE_BATCH = 50;

export async function reconcileSubmittedDocs(env: { DB: D1Database } & Record<string, unknown>): Promise<{
  scanned: number;
  recreated: number;
  failed: number;
}> {
  const db = env.DB;

  // submitted + 미취소 + 'open' alert가 없는 문서 = 누락 의심
  // 결재선이 있어야 의미 있으므로 approval_steps 존재도 함께 확인
  const orphansRes = await db.prepare(`
    SELECT d.id
    FROM documents d
    WHERE d.status = 'submitted'
      AND COALESCE(d.cancelled, 0) = 0
      AND EXISTS (SELECT 1 FROM approval_steps s WHERE s.document_id = d.id)
      AND NOT EXISTS (
        SELECT 1 FROM alert_approval_pending a
        WHERE a.document_id = d.id AND a.status = 'open'
      )
    ORDER BY d.created_at DESC
    LIMIT ?
  `).bind(RECONCILE_BATCH).all<{ id: string }>();

  const orphans = orphansRes.results || [];
  if (orphans.length === 0) {
    return { scanned: 0, recreated: 0, failed: 0 };
  }

  let recreated = 0;
  let failed = 0;
  for (const o of orphans) {
    try {
      const r = await recreateAlertsForDoc(db, o.id, { isResubmit: false });
      if (r.created > 0) recreated++;
    } catch (err) {
      console.error(`[reconcile] recreateAlertsForDoc failed for doc=${o.id}:`, err);
      failed++;
    }
  }

  return { scanned: orphans.length, recreated, failed };
}
