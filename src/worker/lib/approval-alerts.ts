// 승인 대기 알림 (alert_approval_pending) 영속화 헬퍼
// - 문서 제출/승인/반려/취소 시 alert 행 동기화
// - cycle_no: 반려 재제출 시 +1 (이력 보존)
// - notification_sent=0 으로 신규 생성 → cron이 알림톡 순차 발송

type DB = D1Database;

interface ApprovalStep {
  id: string;
  document_id: string;
  step_order: number;
  approver_id: string;
  status: string;
  approved_at?: string | null;
}

interface DocMeta {
  id: string;
  title: string;
  template_id: string | null;
  author_id: string;
  branch: string | null;
  department: string | null;
  submitted_at?: string | null;
}

/**
 * 문서 제출/재제출 시 호출 — alert 행 재구성
 * @param skipNotification true: backfill 시 사용 (notification_sent=1로 생성, 알림 발송 X)
 */
export async function recreateAlertsForDoc(
  db: DB,
  documentId: string,
  opts: { skipNotification?: boolean; isResubmit?: boolean } = {},
): Promise<{ created: number; cycle_no: number }> {
  // 1. 문서 메타 조회
  const doc = await db.prepare(`
    SELECT d.id, d.title, d.template_id, d.author_id, d.branch, d.department,
           u.name as author_name
    FROM documents d
    LEFT JOIN users u ON u.id = d.author_id
    WHERE d.id = ? AND d.status = 'submitted' AND COALESCE(d.cancelled, 0) = 0
  `).bind(documentId).first<DocMeta & { author_name: string }>();
  if (!doc) return { created: 0, cycle_no: 0 };

  // 2. 현재 cycle_no 결정
  // - 반려 재제출이면 max(cycle_no) + 1
  // - 그 외는 max(cycle_no) (없으면 1)
  const maxCycle = await db.prepare(
    'SELECT COALESCE(MAX(cycle_no), 0) as max_cycle FROM alert_approval_pending WHERE document_id = ?'
  ).bind(documentId).first<{ max_cycle: number }>();
  let currentCycle = maxCycle?.max_cycle || 0;
  if (opts.isResubmit) {
    currentCycle = currentCycle + 1;
  } else if (currentCycle === 0) {
    currentCycle = 1;
  }
  // 정상 흐름(처음 제출): currentCycle === 1

  // 3. 결재선 조회
  const stepsRes = await db.prepare(
    'SELECT id, document_id, step_order, approver_id, status, signed_at AS approved_at FROM approval_steps WHERE document_id = ? ORDER BY step_order ASC'
  ).bind(documentId).all<ApprovalStep>();
  const steps = stepsRes.results || [];
  if (steps.length === 0) return { created: 0, cycle_no: currentCycle };

  // 4. 첫 pending step 찾기 + 이전 모두 approved 검증
  const firstPending = steps.find((s) => s.status === 'pending');
  const prevAllApproved = firstPending
    ? steps.filter((s) => s.step_order < firstPending.step_order).every((s) => s.status === 'approved')
    : false;

  // 5. 비정규화 메타
  const submittedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const docMeta = {
    title: doc.title || '',
    template_id: doc.template_id || '',
    author_id: doc.author_id || '',
    author_name: doc.author_name || '',
    branch: doc.branch || '',
    department: doc.department || '',
    submitted_at: submittedAt,
  };

  const stmts: any[] = [];
  let created = 0;

  // 6. 'need_approve' alert (현재 차례 approver)
  if (firstPending && prevAllApproved) {
    stmts.push(
      db.prepare(`
        INSERT OR IGNORE INTO alert_approval_pending
          (id, document_id, approver_id, cycle_no, step_order, my_status,
           document_title, document_template_id, document_author_id, document_author_name,
           document_branch, document_department, document_submitted_at,
           notification_sent)
        VALUES (?, ?, ?, ?, ?, 'need_approve', ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), documentId, firstPending.approver_id, currentCycle, firstPending.step_order,
        docMeta.title, docMeta.template_id, docMeta.author_id, docMeta.author_name,
        docMeta.branch, docMeta.department, docMeta.submitted_at,
        opts.skipNotification ? 1 : 0,
      )
    );
    created++;
  }

  // 7. 'waiting_final' alert (이미 승인했지만 후속 단계 진행 중)
  // - 결재선 중간에 있는 사람들이 본인 단계 끝낸 뒤 정보성 알림
  for (const s of steps) {
    if (s.status !== 'approved') continue;
    // 마지막 단계는 waiting_final 의미 없음 (모두 끝남)
    const hasLater = steps.some((t) => t.step_order > s.step_order);
    if (!hasLater) continue;
    stmts.push(
      db.prepare(`
        INSERT OR IGNORE INTO alert_approval_pending
          (id, document_id, approver_id, cycle_no, step_order, my_status,
           document_title, document_template_id, document_author_id, document_author_name,
           document_branch, document_department, document_submitted_at,
           notification_sent)
        VALUES (?, ?, ?, ?, ?, 'waiting_final', ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(), documentId, s.approver_id, currentCycle, s.step_order,
        docMeta.title, docMeta.template_id, docMeta.author_id, docMeta.author_name,
        docMeta.branch, docMeta.department, docMeta.submitted_at,
        opts.skipNotification ? 1 : 1,  // waiting_final은 정보성 → 알림 발송 X (이미 본인이 승인한 건)
      )
    );
    created++;
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  return { created, cycle_no: currentCycle };
}

/**
 * 결재 단계 승인 시 호출
 * - 현재 approver의 alert: acted (approved)
 * - 다음 pending step의 approver: 새 'need_approve' alert
 * - 마지막 단계 승인 시: 모든 미종결 alert 종결
 */
export async function markAlertActedApproved(
  db: DB,
  documentId: string,
  approverId: string,
): Promise<void> {
  // 1. 현재 cycle_no 조회 (가장 최신 사이클)
  const maxCycle = await db.prepare(
    'SELECT COALESCE(MAX(cycle_no), 0) as cycle_no FROM alert_approval_pending WHERE document_id = ?'
  ).bind(documentId).first<{ cycle_no: number }>();
  const currentCycle = maxCycle?.cycle_no || 0;
  if (currentCycle === 0) return;  // alert 자체가 없음

  // 2. 현재 approver의 alert를 acted 처리
  await db.prepare(`
    UPDATE alert_approval_pending
    SET status = 'acted', acted_at = datetime('now'), acted_action = 'approved',
        last_checked_at = datetime('now')
    WHERE document_id = ? AND approver_id = ? AND cycle_no = ? AND status = 'open'
  `).bind(documentId, approverId, currentCycle).run();

  // 3. 결재선 다시 조회 → 다음 pending step 찾기
  const stepsRes = await db.prepare(
    'SELECT step_order, approver_id, status FROM approval_steps WHERE document_id = ? ORDER BY step_order ASC'
  ).bind(documentId).all<{ step_order: number; approver_id: string; status: string }>();
  const steps = stepsRes.results || [];

  const nextPending = steps.find((s) => s.status === 'pending');
  if (nextPending) {
    // 이전 모두 approved 인지 검증
    const prevAllApproved = steps
      .filter((s) => s.step_order < nextPending.step_order)
      .every((s) => s.status === 'approved');
    if (prevAllApproved) {
      // 다음 사람을 위한 need_approve alert 생성
      // + 방금 승인한 사람을 위한 waiting_final alert 생성
      const doc = await db.prepare(`
        SELECT d.id, d.title, d.template_id, d.author_id, d.branch, d.department,
               u.name as author_name
        FROM documents d LEFT JOIN users u ON u.id = d.author_id
        WHERE d.id = ?
      `).bind(documentId).first<DocMeta & { author_name: string }>();
      if (doc) {
        const submittedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
        await db.batch([
          db.prepare(`
            INSERT OR IGNORE INTO alert_approval_pending
              (id, document_id, approver_id, cycle_no, step_order, my_status,
               document_title, document_template_id, document_author_id, document_author_name,
               document_branch, document_department, document_submitted_at, notification_sent)
            VALUES (?, ?, ?, ?, ?, 'need_approve', ?, ?, ?, ?, ?, ?, ?, 0)
          `).bind(
            crypto.randomUUID(), documentId, nextPending.approver_id, currentCycle, nextPending.step_order,
            doc.title || '', doc.template_id || '', doc.author_id || '', doc.author_name || '',
            doc.branch || '', doc.department || '', submittedAt,
          ),
          db.prepare(`
            INSERT OR IGNORE INTO alert_approval_pending
              (id, document_id, approver_id, cycle_no, step_order, my_status,
               document_title, document_template_id, document_author_id, document_author_name,
               document_branch, document_department, document_submitted_at, notification_sent)
            VALUES (?, ?, ?, ?, ?, 'waiting_final', ?, ?, ?, ?, ?, ?, ?, 1)
          `).bind(
            crypto.randomUUID(), documentId, approverId, currentCycle,
            steps.find((s) => s.approver_id === approverId)?.step_order || 0,
            doc.title || '', doc.template_id || '', doc.author_id || '', doc.author_name || '',
            doc.branch || '', doc.department || '', submittedAt,
          ),
        ]);
      }
    }
  } else {
    // 4. 모든 step 완료 (마지막 승인) → 모든 미종결 alert 종결
    await db.prepare(`
      UPDATE alert_approval_pending
      SET status = 'acted', acted_at = datetime('now'), acted_action = 'approved',
          last_checked_at = datetime('now')
      WHERE document_id = ? AND cycle_no = ? AND status = 'open'
    `).bind(documentId, currentCycle).run();
  }
}

/**
 * 결재 단계 반려 시 호출 — 모든 미종결 alert acted/rejected 처리
 */
export async function markAlertActedRejected(
  db: DB,
  documentId: string,
): Promise<void> {
  await db.prepare(`
    UPDATE alert_approval_pending
    SET status = 'acted', acted_at = datetime('now'), acted_action = 'rejected',
        last_checked_at = datetime('now')
    WHERE document_id = ? AND status = 'open'
  `).bind(documentId).run();
}

/**
 * 문서 취소 시 호출 — 모든 미종결 alert cancelled 처리
 */
export async function cancelAllAlertsForDoc(
  db: DB,
  documentId: string,
): Promise<void> {
  await db.prepare(`
    UPDATE alert_approval_pending
    SET status = 'cancelled', acted_at = datetime('now'), acted_action = 'cancelled',
        last_checked_at = datetime('now')
    WHERE document_id = ? AND status = 'open'
  `).bind(documentId).run();
}
