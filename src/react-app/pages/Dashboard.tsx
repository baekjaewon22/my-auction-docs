import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store';
import { api } from '../api';
import type { Document } from '../types';
import type { JournalEntry } from '../journal/types';
import { FileText, FilePlus, FileCheck, FileX, Files, AlertTriangle, ExternalLink, Bell, DollarSign, TrendingDown, ArrowDownCircle, Clock, RotateCcw, X, MapPin } from 'lucide-react';
import type { SalesEvaluation, SalesRecord, DepositNotice } from '../types';
import type { ApprovalStep } from '../types';

const statusConfig: Record<string, { label: string; className: string; icon: typeof FileText }> = {
  draft: { label: '작성중', className: 'status-draft', icon: FilePlus },
  submitted: { label: '제출', className: 'status-submitted', icon: FileText },
  approved: { label: '승인', className: 'status-approved', icon: FileCheck },
  rejected: { label: '반려', className: 'status-rejected', icon: FileX },
};

interface MissingAlert {
  userName: string;
  userId: string;
  date: string;
  activity: string;
  missingDoc: string;
  dDay: number; // 경과일
}

interface ScheduleGapAlert {
  userName: string;
  date: string;
  gaps: string[]; // ["09:00~10:00", "14:00~15:30"]
}

function FreelancerDashboard() {
  const { user } = useAuthStore();
  const [mySales, setMySales] = useState<SalesRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.sales.list({}).then(res => {
      setMySales((res.records || []).filter((r: SalesRecord) => r.user_id === user?.id));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">로딩중...</div>;

  const totalAmount = mySales.filter(r => r.status === 'confirmed').reduce((s, r) => s + r.amount, 0);
  const pendingCount = mySales.filter(r => r.status === 'pending').length;
  const cardPendingCount = mySales.filter(r => r.status === 'card_pending').length;
  const confirmedCount = mySales.filter(r => r.status === 'confirmed').length;

  return (
    <div className="page dashboard-page">
      <div className="page-header">
        <h2>대시보드</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <p className="greeting">안녕하세요, <strong>{user?.name}</strong>님!</p>
          <a href="http://crm.my-auction.co.kr/login.php" target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            마이옥션CRM+ <ExternalLink size={12} />
          </a>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><DollarSign size={28} className="stat-icon" /><div className="stat-number">{mySales.length}</div><div className="stat-label">전체 매출</div></div>
        <div className="stat-card stat-submitted"><Clock size={28} className="stat-icon" /><div className="stat-number">{pendingCount}</div><div className="stat-label">입금신청</div></div>
        {cardPendingCount > 0 && <div className="stat-card" style={{ borderTop: '3px solid #7b1fa2' }}><Clock size={28} className="stat-icon" style={{ color: '#7b1fa2' }} /><div className="stat-number" style={{ color: '#7b1fa2' }}>{cardPendingCount}</div><div className="stat-label">카드대기</div></div>}
        <div className="stat-card stat-approved"><FileCheck size={28} className="stat-icon" /><div className="stat-number">{confirmedCount}</div><div className="stat-label">확정</div></div>
        <div className="stat-card" style={{ borderTop: '3px solid #7b1fa2' }}><TrendingDown size={28} className="stat-icon" style={{ color: '#7b1fa2' }} /><div className="stat-number" style={{ color: '#7b1fa2' }}>{totalAmount.toLocaleString()}</div><div className="stat-label">확정 매출액</div></div>
      </div>

      {mySales.length > 0 && (
        <section className="section">
          <h3 className="section-title"><DollarSign size={18} /> 최근 매출</h3>
          <div className="doc-list">
            {mySales.slice(0, 10).map(r => (
              <Link key={r.id} to="/sales" className="doc-item">
                <div className="doc-item-header">
                  <span className={`doc-status status-${r.status === 'confirmed' ? 'approved' : r.status === 'pending' ? 'submitted' : r.status === 'card_pending' ? 'submitted' : 'draft'}`}>
                    {r.status === 'confirmed' ? '확정' : r.status === 'pending' ? '입금신청' : r.status === 'card_pending' ? '카드대기' : r.status}
                  </span>
                  <span className="doc-date">{r.contract_date}</span>
                </div>
                <div className="doc-title">{r.type} · {r.client_name} · {r.amount.toLocaleString()}원</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const isFreelancer = (user as any)?.login_type === 'freelancer';
  if (isFreelancer) return <FreelancerDashboard />;

  const [documents, setDocuments] = useState<Document[]>([]);
  const [alerts, setAlerts] = useState<MissingAlert[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<(Document & { steps?: ApprovalStep[] })[]>([]);
  const [cancelRequests, setCancelRequests] = useState<Document[]>([]);
  const [salesAlerts, setSalesAlerts] = useState<SalesEvaluation[]>([]);
  const [demotionCandidates, setDemotionCandidates] = useState<SalesEvaluation[]>([]);
  const [pendingSales, setPendingSales] = useState<SalesRecord[]>([]);
  const [refundRequests, setRefundRequests] = useState<SalesRecord[]>([]);
  const [depositNotices, setDepositNotices] = useState<DepositNotice[]>([]);
  const [refundImpacts, setRefundImpacts] = useState<any[]>([]);
  const [scheduleGaps, setScheduleGaps] = useState<ScheduleGapAlert[]>([]);
  const [contractAlerts, setContractAlerts] = useState<SalesRecord[]>([]);
  const [myMissingDocs, setMyMissingDocs] = useState<SalesRecord[]>([]);
  const [dupInspections, setDupInspections] = useState<{ case_no: string; court: string; user_names: string; user_count: number; first_date: string; last_date: string; branch?: string }[]>([]);
  const [dupAllBranches, setDupAllBranches] = useState(false);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [pendingSalesBranch, setPendingSalesBranch] = useState('');
  const [accountantLeaves, setAccountantLeaves] = useState<any[]>([]);
  const [coopAlerts, setCoopAlerts] = useState<any[]>([]);
  const [driveStatus, setDriveStatus] = useState<{ last_backup_at: string | null; pending_count: number; connected: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const canApprove = ['master', 'ceo', 'cc_ref', 'admin', 'manager'].includes(user?.role || '');
  const isAdmin = ['master', 'ceo', 'cc_ref', 'admin'].includes(user?.role || '');
  const canSeeAccountingAlerts = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(user?.role || '');
  const isMaster = user?.role === 'master';

  // 마스터 전용 섹션 전체 삭제 버튼 — 실수 방지를 위해 명확한 라벨 표시
  const MasterCloseBtn = ({ alertType, keys, onClose }: { alertType: string; keys: string[]; onClose: () => void }) => isMaster ? (
    <button
      title={`섹션 전체 ${keys.length}건 삭제 (마스터 전용 — 영구 삭제)`}
      onClick={async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!confirm(`⚠ 섹션 전체 ${keys.length}건을 모두 삭제합니다.\n\n개별 삭제를 원하시면 각 항목의 X 버튼을 이용하세요.\n\n정말 전체 삭제하시겠습니까? (영구 삭제)`)) return;
        try {
          const bulkKeys = keys.map(k => ({ alert_type: alertType, alert_key: k }));
          if (bulkKeys.length > 0) await api.journal.dismissAlertsBulk(bulkKeys);
          setDismissedKeys(prev => { const n = new Set(prev); keys.forEach(k => n.add(k)); return n; });
          onClose();
        } catch (err: any) { alert(err.message); }
      }}
      style={{ marginLeft: 'auto', fontSize: '0.65rem', color: '#d93025', padding: '2px 6px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
      전체 삭제
    </button>
  ) : null;

  // 마스터 전용 개별 항목 삭제 버튼
  const MasterItemCloseBtn = ({ alertType, alertKey }: { alertType: string; alertKey: string }) => isMaster ? (
    <button className="btn-icon"
      title="이 항목 삭제 (마스터 전용 — 영구 삭제)"
      onClick={async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!confirm('이 알림 항목을 삭제하시겠습니까?\n(영구 삭제 — 새로고침해도 복구되지 않음)')) return;
        try {
          await api.journal.dismissAlert(alertType, alertKey);
          setDismissedKeys(prev => new Set(prev).add(alertKey));
        } catch (err: any) { alert(err.message); }
      }}
      style={{ color: '#bdc1c6', padding: '2px 4px', background: 'transparent', border: 'none', cursor: 'pointer', marginLeft: 4 }}>
      <X size={13} />
    </button>
  ) : null;

  // dismissedKeys가 업데이트되면 각 state에서 해당 항목 제거
  // Drive 백업 상태 로드 (총무·관리자급만)
  useEffect(() => {
    if (!canSeeAccountingAlerts) return;
    api.drive.settings()
      .then(s => setDriveStatus({
        last_backup_at: s.last_backup_at,
        pending_count: s.pending_count,
        connected: !!s.settings?.connected_email,
      }))
      .catch(() => { /* ignore */ });
  }, [canSeeAccountingAlerts]);

  useEffect(() => {
    if (dismissedKeys.size === 0) return;
    setCoopAlerts(prev => prev.filter((a: any) => !dismissedKeys.has(`coop_${a.id}`)));
    setMyMissingDocs(prev => prev.filter(r => !dismissedKeys.has(`my_doc_missing_${r.id}`)));
    setAlerts(prev => prev.filter(a => !dismissedKeys.has(`missing_${a.userId}_${a.date}_${a.activity || ''}`) && !dismissedKeys.has(`my_missing_${a.userId}_${a.date}_${a.activity || ''}`)));
    setDupInspections(prev => prev.filter((d: any) => !dismissedKeys.has(`dup_${d.case_no}_${d.court}_${d.branch || ''}`)));
    setContractAlerts(prev => prev.filter(r => !dismissedKeys.has(`contract_${r.id}`)));
    setPendingApprovals(prev => prev.filter((d: any) => !dismissedKeys.has(`approval_${d.id}`)));
    setPendingSales(prev => prev.filter((r: any) => !dismissedKeys.has(`pending_sales_${r.id}`)));
    setRefundRequests(prev => prev.filter((r: any) => !dismissedKeys.has(`refund_request_${r.id}`)));
    setRefundImpacts(prev => prev.filter((imp: any) => !dismissedKeys.has(`refund_impact_${imp.id}`)));
    setDepositNotices(prev => prev.filter((d: any) => !dismissedKeys.has(`deposit_${d.id}`)));
    setSalesAlerts(prev => prev.filter((a: any) => !dismissedKeys.has(`shortfall_${a.id}`)));
    setDemotionCandidates(prev => prev.filter((a: any) => !dismissedKeys.has(`demotion_${a.id}`)));
    setCancelRequests(prev => prev.filter((d: any) => !dismissedKeys.has(`cancel_${d.id}`)));
    setAccountantLeaves(prev => prev.filter((lv: any) => !dismissedKeys.has(`acc_leave_${lv.id}`)));
  }, [dismissedKeys]);

  useEffect(() => {
    (async () => {
    // 삭제된 알림 목록을 먼저 완전히 받아온 후 데이터 로딩 시작
    let localDismissed = new Set<string>();
    try {
      const dRes = await api.journal.dismissedAlerts();
      localDismissed = new Set(dRes.keys);
      setDismissedKeys(localDismissed);
    } catch { /* */ }

    // 본인 문서 (stats + 최근 5개) — 빠른 작은 응답 (limit 50, content 제외)
    // 알림 검사용 문서 (개인 신청서/출장 매칭) — 60일 이내, content 제외
    const sinceDate = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const promises: Promise<any>[] = [
      api.documents.list({ author_id: 'me', fields: 'meta_only', limit: 50 }),
      api.documents.list({ since: sinceDate, exclude_drafts: true, fields: 'meta_only', limit: 1000 }),
      api.journal.list({ range: 'month' }),
    ];
    // 승인 권한자면 submitted 문서도 조회 (top role 분기에서 사용)
    if (canApprove) {
      promises.push(api.documents.list({ status: 'submitted', fields: 'meta_only', limit: 200 }));
    }
    // 관리자면 취소신청 목록도 조회
    if (isAdmin) {
      promises.push(api.documents.cancelRequests());
    }

    Promise.all(promises)
      .then(async ([myDocsRes, alertDocsRes, journalRes, submittedRes, cancelRes]) => {
        const myDocs = (myDocsRes.documents as Document[]) || [];
        setDocuments(myDocs);
        // 알림 매칭용 문서 (60일치, draft 제외)
        const allDocs = (alertDocsRes.documents as Document[]) || [];

        if (journalRes) {
          const entries = (journalRes as { entries: JournalEntry[] }).entries;
          // 미제출 감지 범위 — 사용자가 볼 수 있는 문서 범위와 일치시켜야 함
          // - member: 본인만 (팀 일지가 들어와도 본인 문서만 매칭 가능)
          // - manager: 본인 팀(department)만 — 일지는 지사 전체로 들어오나 문서는 팀 단위라 비대칭
          // - admin/director/master 등: 그대로 (일지·문서 권한 동일 범위)
          let entriesForDetect: JournalEntry[];
          if (!canApprove) {
            entriesForDetect = entries.filter(e => e.user_id === user?.id);
          } else if (user?.role === 'manager') {
            entriesForDetect = entries.filter(e =>
              e.branch === user.branch && e.department === user.department,
            );
          } else {
            entriesForDetect = entries;
          }
          // 미제출 감지 시 draft 문서는 제외 (작성 중인 보고서는 제출 완료가 아니므로)
          const docsForDetect = allDocs.filter(d => d.status !== 'draft');
          // 외근 link 활성 entry IDs 조회 (cutoff 이후)
          let linkedEntryIds = new Set<string>();
          try {
            const linkRes = await api.links.effectiveEntryIds(OUTDOOR_LINK_ENFORCE_FROM, 'outdoor');
            linkedEntryIds = new Set(linkRes.entry_ids);
          } catch { /* */ }
          setAlerts(detectMissing(entriesForDetect, docsForDetect, linkedEntryIds));
          setScheduleGaps(detectScheduleGaps(entriesForDetect));
        }

        // 취소 신청 목록 (Phase 1 결과 — 즉시 처리 가능)
        if (cancelRes && isAdmin) {
          setCancelRequests(cancelRes.documents || []);
        }

        // ─── Phase 2: 의존성 없는 API들을 모두 병렬 실행 ───
        // sales.list({})는 한 번만 호출하고 두 곳(contractAlerts + myMissingDocs)에 재사용
        const needSalesList = canApprove || isAdmin || canSeeAccountingAlerts || true; // myMissingDocs는 모든 사용자 필요

        // 승인 대기 알림: top role(master/ceo/cc_ref)은 documents.list('submitted') + stepsBatch (감독 view)
        // 그 외 권한자는 alert_approval_pending 영속 테이블 단일 조회
        const isTopRoleForApproval = ['master', 'ceo', 'cc_ref'].includes(user?.role || '');
        const needSubmittedSteps = !!(submittedRes && canApprove && isTopRoleForApproval);
        const submittedDocsForSteps = needSubmittedSteps
          ? (submittedRes!.documents as Document[]).filter((d: any) => d.author_id !== user?.id).slice(0, 20)
          : [];

        const [
          salesListRes,
          stepsBatchRes,
          approvalPendingRes,
          accountingAlertsRes,
          dashPendingRes,
          dashRefundReqRes,
          refundImpactsRes,
          depositsRes,
          accountantLeavesRes,
          coopRes,
          dupRes,
          alimtalkRes,
        ] = await Promise.all([
          needSalesList ? api.sales.list({}).catch(() => null) : Promise.resolve(null),
          submittedDocsForSteps.length > 0
            ? api.documents.stepsBatch(submittedDocsForSteps.map(d => d.id)).catch(() => null)
            : Promise.resolve(null),
          // 일반 결재자: 본인의 결재 대기 alert만 조회 (인덱스 hit, 매우 빠름)
          (!isTopRoleForApproval && canApprove) ? api.approvalAlerts.list().catch(() => null) : Promise.resolve(null),
          canSeeAccountingAlerts ? api.accounting.alerts().catch(() => null) : Promise.resolve(null),
          canSeeAccountingAlerts ? api.sales.dashboardPending().catch(() => null) : Promise.resolve(null),
          canSeeAccountingAlerts ? api.sales.dashboardRefundRequests().catch(() => null) : Promise.resolve(null),
          canSeeAccountingAlerts ? api.sales.dashboardRefundImpacts().catch(() => null) : Promise.resolve(null),
          api.sales.deposits().catch(() => null),
          api.leave.accountantLeaves().catch(() => null),
          (user as any)?.login_type !== 'freelancer'
            ? api.cooperation.dashboard().catch(() => null)
            : Promise.resolve(null),
          api.journal.duplicateInspections(dupAllBranches).catch(() => null),
          (canSeeAccountingAlerts && ['accountant', 'accountant_asst'].includes(user?.role || '') && user?.id)
            ? api.users.getAlimtalkSettings(user.id).catch(() => null)
            : Promise.resolve(null),
        ]);

        // ─── 결과 처리 ───

        // 1. 계약서 확인 대기 + 본인 매출 미작성 (sales.list 재사용)
        if (salesListRes) {
          const records = salesListRes.records as SalesRecord[];

          if (canApprove || isAdmin || canSeeAccountingAlerts) {
            const pending = records.filter(r =>
              (r.type === '계약' || r.type === '낙찰') &&
              ((r.contract_submitted && !r.contract_not_approved) || (r.contract_not_submitted && !r.contract_not_approved))
            );
            setContractAlerts(pending);
          }

          const role = user?.role || '';
          const scopedRoles = ['manager', 'admin', 'director', 'master', 'ceo', 'cc_ref', 'accountant', 'accountant_asst'];
          const myMissing = records.filter(r => {
            if (r.status === 'refunded') return false;
            if (r.type !== '계약' && r.type !== '낙찰') return false;
            if (r.contract_submitted || r.contract_not_submitted) return false;
            if (scopedRoles.includes(role)) return true;
            return r.user_id === user?.id;
          });
          setMyMissingDocs(myMissing);
        }

        // 2. 승인 대기 문서
        if (isTopRoleForApproval) {
          // Top role: 모든 submitted 문서 감독 view (기존 stepsBatch 방식)
          if (needSubmittedSteps && stepsBatchRes) {
            const stepsByDoc = stepsBatchRes.steps;
            const pending: (Document & { steps?: ApprovalStep[]; myStatus?: string })[] = [];
            for (const doc of submittedDocsForSteps) {
              const steps = stepsByDoc[doc.id] || [];
              pending.push({ ...doc, steps, myStatus: 'need_approve' });
            }
            setPendingApprovals(pending);
          }
        } else if (approvalPendingRes) {
          // 일반 결재자: alert_approval_pending 테이블 단일 조회 결과 사용
          const alerts = approvalPendingRes.alerts || [];
          const pending: (Document & { steps?: ApprovalStep[]; myStatus?: string })[] = alerts.map((a) => ({
            id: a.document_id,
            title: a.document_title,
            template_id: a.document_template_id,
            author_id: a.document_author_id,
            author_name: a.document_author_name,
            branch: a.document_branch,
            department: a.document_department,
            status: 'submitted',
            content: '',
            created_at: a.document_submitted_at,
            updated_at: a.document_submitted_at,
            myStatus: a.my_status,
          } as any));
          setPendingApprovals(pending);
        }

        // 3. 매출 미달/강등
        if (accountingAlertsRes) {
          setSalesAlerts(accountingAlertsRes.current_period_alerts || []);
          setDemotionCandidates(accountingAlertsRes.demotion_candidates || []);
        }

        // 4. 매출 입금대기 / 환불신청
        if (dashPendingRes) setPendingSales(dashPendingRes.records || []);
        if (dashRefundReqRes) setRefundRequests(dashRefundReqRes.records || []);

        // 5. 알림톡 기본 지사 (총무)
        if (alimtalkRes) {
          const branches = alimtalkRes.branches ? alimtalkRes.branches.split(',') : [];
          if (branches.length > 0) setPendingSalesBranch(branches[0]);
        }

        // 6. 환불 영향
        if (refundImpactsRes) {
          setRefundImpacts((refundImpactsRes.impacts || []).filter((i: any) => i.is_previous_period && !localDismissed.has(`refund_impact_${i.id}`)));
        }

        // 7. 입금등록
        if (depositsRes) {
          setDepositNotices((depositsRes.deposits || []).filter((d: DepositNotice) => d.status === 'pending'));
        }

        // 8. 총무 휴가
        if (accountantLeavesRes) {
          setAccountantLeaves(accountantLeavesRes.leaves || []);
        }

        // 9. 업무협조요청
        if (coopRes) {
          setCoopAlerts(coopRes.alerts || []);
        }

        // 10. 중복 임장
        if (dupRes) {
          setDupInspections((dupRes.duplicates || []).filter((d: any) => !localDismissed.has(`dup_${d.case_no}_${d.court}_${d.branch || ''}`)));
        }
      })
      .finally(() => setLoading(false));
    })();
  }, []);

  // 중복 임장: 전 지사 토글 시 재조회
  useEffect(() => {
    api.journal.duplicateInspections(dupAllBranches)
      .then(res => setDupInspections(res.duplicates || []))
      .catch(() => {});
  }, [dupAllBranches]);

  const stats = {
    total: documents.length,
    draft: documents.filter((d) => d.status === 'draft').length,
    submitted: documents.filter((d) => d.status === 'submitted').length,
    approved: documents.filter((d) => d.status === 'approved').length,
    rejected: documents.filter((d) => d.status === 'rejected').length,
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page dashboard-page">
      <div className="page-header">
        <h2>대시보드</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <p className="greeting">안녕하세요, <strong>{user?.name}</strong>님!</p>
          <a href="http://crm.my-auction.co.kr/login.php" target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            마이옥션CRM+ <ExternalLink size={12} />
          </a>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><Files size={28} className="stat-icon" /><div className="stat-number">{stats.total}</div><div className="stat-label">전체 문서</div></div>
        <div className="stat-card stat-draft"><FilePlus size={28} className="stat-icon" /><div className="stat-number">{stats.draft}</div><div className="stat-label">작성중</div></div>
        <div className="stat-card stat-submitted"><FileText size={28} className="stat-icon" /><div className="stat-number">{stats.submitted}</div><div className="stat-label">제출</div></div>
        <div className="stat-card stat-approved"><FileCheck size={28} className="stat-icon" /><div className="stat-number">{stats.approved}</div><div className="stat-label">승인</div></div>
        <div className="stat-card stat-rejected"><FileX size={28} className="stat-icon" /><div className="stat-number">{stats.rejected}</div><div className="stat-label">반려</div></div>
      </div>

      {/* Drive 백업 지연 경고 (7일 이상) — 총무·관리자급만 */}
      {canSeeAccountingAlerts && driveStatus && (() => {
        const pending = driveStatus.pending_count;
        const last = driveStatus.last_backup_at ? new Date(driveStatus.last_backup_at) : null;
        const daysSince = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : Infinity;
        const overdue = !last || daysSince >= 7;
        if (!overdue || pending === 0) return null;
        return (
          <Link to="/archive?drive=1" className="drive-alert-strip">
            <span className="drive-alert-icon">☁️</span>
            <span className="drive-alert-text">
              <strong>문서보관함 Drive 백업이 {last ? `${daysSince}일째 미실행` : '아직 한 번도 실행되지 않았습니다'}</strong>
              <span className="drive-alert-sub"> · 대기 문서 <strong>{pending}건</strong>{last && <> · 마지막 {driveStatus.last_backup_at!.slice(0, 10)}</>}</span>
            </span>
            <span className="drive-alert-cta">지금 백업 →</span>
          </Link>
        );
      })()}

      {/* 총무 휴가 알림 (전체 직원에게 노출) */}
      {accountantLeaves.length > 0 && (
        <section className="section">
          <div style={{ padding: '14px 18px', background: 'linear-gradient(135deg, #fff8e1 0%, #fff3cd 100%)', borderRadius: 10, border: '1px solid #ffd54f' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Clock size={16} color="#f9a825" />
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e65100' }}>총무 휴무 안내</span>
              <MasterCloseBtn alertType="accountant_leave" keys={accountantLeaves.map((lv: any) => `acc_leave_${lv.id}`)} onClose={() => setAccountantLeaves([])} />
            </div>
            {accountantLeaves.map((lv: any) => {
              const isSameDay = lv.start_date === lv.end_date;
              const formatDate = (d: string) => d?.replace(/-/g, '.') || '';
              const periodStr = isSameDay ? `(${formatDate(lv.start_date)})` : `(${formatDate(lv.start_date)}~${formatDate(lv.end_date).slice(5)})`;
              const leaveLabel = lv.leave_type === '반차' ? '반차휴무' : lv.leave_type === '연차' ? '연차휴무' : lv.leave_type === '월차' ? '월차휴무' : `${lv.leave_type} 휴무`;
              const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
              const tomorrowStr = new Date(Date.now() + 9 * 60 * 60 * 1000 + 86400000).toISOString().slice(0, 10);
              const isToday = lv.start_date <= todayStr && lv.end_date >= todayStr;
              const isTomorrow = lv.start_date === tomorrowStr;
              return (
                <div key={lv.id} style={{ padding: '8px 12px', background: '#fff', borderRadius: 8, marginBottom: 6, border: '1px solid #ffe082', position: 'relative' }}>
                  {isMaster && <div style={{ position: 'absolute', top: 4, right: 4 }}><MasterItemCloseBtn alertType="accountant_leave" alertKey={`acc_leave_${lv.id}`} /></div>}
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1a1a2e' }}>
                    {lv.branch}지사 {lv.name} {lv.position_title || ''} {leaveLabel}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#e65100', marginTop: 2 }}>
                    {isToday && <span style={{ background: '#d93025', color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700, marginRight: 6 }}>오늘</span>}
                    {isTomorrow && !isToday && <span style={{ background: '#f9a825', color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700, marginRight: 6 }}>내일</span>}
                    {periodStr}
                    {lv.reason && lv.leave_type === '특별휴가' && <span style={{ color: '#9aa0a6', marginLeft: 8 }}>({lv.reason})</span>}
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: '0.72rem', color: '#9aa0a6', marginTop: 6 }}>
              결재 관련 문의는 다른 총무 담당자에게 연락해주세요.
            </div>
          </div>
        </section>
      )}

      {/* 업무협조요청 알림 */}
      {coopAlerts.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ExternalLink size={18} color="#7b1fa2" /> 업무협조요청
            <span style={{ background: '#7b1fa2', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{coopAlerts.length}건</span>
            <MasterCloseBtn alertType="coop" keys={coopAlerts.map((a: any) => `coop_${a.id}`)} onClose={() => setCoopAlerts([])} />
          </h3>
          <div className="doc-list">
            {coopAlerts.map((a: any) => {
              const caseNo = a.case_number ? `${a.case_year}${a.case_type}${a.case_number}` : '';
              return (
                <div key={a.id} style={{ position: 'relative' }}>
                  <Link to="/admin-notes?tab=cooperation" className="doc-item" style={{ borderLeft: '3px solid #7b1fa2' }}>
                    <div className="doc-info">
                      <div>
                        <div className="doc-title">{a.sender_name} {a.sender_position} ({a.sender_branch}) → 업무협조요청</div>
                        <div className="doc-meta">
                          {a.court && <span>{a.court}</span>}
                          {caseNo && <span style={{ fontWeight: 600 }}>{caseNo}</span>}
                          <span>{a.created_at?.slice(0, 10)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                  {isMaster && <div style={{ position: 'absolute', top: 8, right: 8 }}><MasterItemCloseBtn alertType="coop" alertKey={`coop_${a.id}`} /></div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* [5-2] 내 미제출 보고서 D-Day (담당자 본인용 — 항상 노출) */}
      {(() => {
        const myAlerts = alerts.filter((a) => a.userId === user?.id);
        if (myAlerts.length === 0) return null;
        return (
          <section className="section">
            <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={18} color="#d93025" /> 내 미제출 보고서
              <span className="missing-alert-count">{myAlerts.length}건</span>
              <MasterCloseBtn alertType="my_missing" keys={myAlerts.map(a => `my_missing_${a.userId}_${a.date}_${a.activity || ''}`)} onClose={() => setAlerts(prev => prev.filter(a => a.userId !== user?.id))} />
            </h3>
            <div className="missing-alert-list">
              {myAlerts.map((a, i) => (
                <div key={i} className="missing-alert-item" style={{ borderLeft: `3px solid ${a.dDay >= 7 ? '#d93025' : a.dDay >= 3 ? '#e65100' : '#f9ab00'}` }}>
                  <div className="missing-alert-content" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                    <span style={{
                      minWidth: 52, textAlign: 'center', padding: '3px 8px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700,
                      background: a.dDay >= 7 ? '#fce4ec' : a.dDay >= 3 ? '#fff3e0' : '#fffde7',
                      color: a.dDay >= 7 ? '#d93025' : a.dDay >= 3 ? '#e65100' : '#f9ab00',
                    }}>D+{a.dDay}</span>
                    <div style={{ flex: 1 }}>
                      <div className="missing-alert-main">
                        <span className="missing-alert-doc">{a.missingDoc}</span>
                      </div>
                      <div className="missing-alert-detail">{a.date} · {a.activity}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* 계약서/보고서 미작성 경고 (역할별 범위) */}
      {myMissingDocs.length > 0 && (() => {
        const role = user?.role || '';
        const scopeTitle = role === 'manager' ? '팀 미작성 알림'
          : role === 'admin' ? '지사 미작성 알림'
          : role === 'director' ? '관할지사 미작성 알림'
          : ['master', 'ceo', 'cc_ref', 'accountant', 'accountant_asst'].includes(role) ? '전체 미작성 알림'
          : '본인 미작성 알림';
        const showOwner = ['manager', 'admin', 'director', 'master', 'ceo', 'cc_ref', 'accountant', 'accountant_asst'].includes(role);
        return (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} color="#d93025" /> {scopeTitle}
            <span className="missing-alert-count" style={{ background: '#fce4ec', color: '#d93025' }}>{myMissingDocs.length}건</span>
            <MasterCloseBtn alertType="my_doc_missing" keys={myMissingDocs.map(r => `my_doc_missing_${r.id}`)} onClose={() => setMyMissingDocs([])} />
          </h3>
          <div className="missing-alert-list">
            {myMissingDocs.slice(0, 10).map(r => {
              const docLabel = r.type === '낙찰' ? '물건분석보고서' : '컨설팅계약서';
              return (
                <div key={r.id} style={{ position: 'relative' }}>
                  <Link to="/sales" className="missing-alert-item" style={{ borderLeft: '3px solid #d93025', textDecoration: 'none' }}>
                    <div style={{ flex: 1 }}>
                      <div className="missing-alert-main">
                        <span className="missing-alert-doc" style={{ color: '#d93025' }}>{docLabel} 미작성</span>
                        {showOwner && r.user_name && <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600, background: '#f3e5f5', color: '#7b1fa2' }}>{r.user_name}</span>}
                        <span style={{ marginLeft: 8, fontSize: '0.78rem', color: '#5f6368' }}>{r.client_name}</span>
                      </div>
                      <div className="missing-alert-detail">{r.contract_date} · {r.type} · {r.amount?.toLocaleString()}원</div>
                    </div>
                  </Link>
                  {isMaster && <div style={{ position: 'absolute', top: 8, right: 8 }}><MasterItemCloseBtn alertType="my_doc_missing" alertKey={`my_doc_missing_${r.id}`} /></div>}
                </div>
              );
            })}
            {myMissingDocs.length > 10 && <div className="missing-alert-more">외 {myMissingDocs.length - 10}건 더 있음</div>}
          </div>
        </section>
        );
      })()}

      {/* 미제출 알림 (팀장/관리자용 — 팀원에겐 비노출) */}
      {alerts.length > 0 && canApprove && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} color="#d93025" /> 미제출 알림
            <span className="missing-alert-count">{alerts.length}건</span>
            <MasterCloseBtn alertType="missing_report" keys={alerts.map(a => `missing_${a.userId}_${a.date}_${a.activity || ''}`)} onClose={() => setAlerts([])} />
          </h3>
          <div className="missing-alert-list">
            {(() => {
              // 같은 사용자+카테고리 묶기
              const grouped: { userName: string; missingDoc: string; count: number; dates: string[]; maxDDay: number }[] = [];
              alerts.forEach((a) => {
                const existing = grouped.find((g) => g.userName === a.userName && g.missingDoc === a.missingDoc);
                if (existing) {
                  existing.count++;
                  if (!existing.dates.includes(a.date)) existing.dates.push(a.date);
                  existing.maxDDay = Math.max(existing.maxDDay, a.dDay);
                } else {
                  grouped.push({ userName: a.userName, missingDoc: a.missingDoc, count: 1, dates: [a.date], maxDDay: a.dDay });
                }
              });
              return grouped.slice(0, 15).map((g, i) => (
                <div key={i} className="missing-alert-item">
                  <span style={{
                    minWidth: 48, textAlign: 'center', padding: '2px 6px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700,
                    background: g.maxDDay >= 7 ? '#fce4ec' : g.maxDDay >= 3 ? '#fff3e0' : '#fffde7',
                    color: g.maxDDay >= 7 ? '#d93025' : g.maxDDay >= 3 ? '#e65100' : '#f9ab00',
                  }}>D+{g.maxDDay}</span>
                  <div className="missing-alert-content">
                    <div className="missing-alert-main">
                      <strong>{g.userName}</strong> — <span className="missing-alert-doc">{g.missingDoc}</span>
                      {g.count > 1 && <span className="missing-alert-badge">{g.count}건</span>}
                    </div>
                    <div className="missing-alert-detail">
                      {g.dates.sort().join(', ')}
                    </div>
                  </div>
                </div>
              ));
            })()}
            {alerts.length > 15 && (
              <div className="missing-alert-more">외 {alerts.length - 15}건 더 있음</div>
            )}
          </div>
        </section>
      )}

      {/* 일정 공백 알림 — 본인은 본인 것만, 팀장+는 팀/지사 전체 (entriesForDetect가 권한별로 이미 필터링됨) */}
      {(() => {
        const filteredGaps = scheduleGaps.filter(g => !dismissedKeys.has(`gap_${g.userName}_${g.date}`));
        if (filteredGaps.length === 0) return null;
        const gapTitle = canApprove ? '일정 공백 알림' : '내 일정 공백';
        return (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} color="#e65100" /> {gapTitle}
            <span className="missing-alert-count">{filteredGaps.length}건</span>
            {user?.role === 'master' && (
              <button className="btn btn-sm" style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#9aa0a6' }}
                onClick={async () => {
                  if (!confirm(`${filteredGaps.length}건을 모두 삭제하시겠습니까?`)) return;
                  const keys = filteredGaps.map(g => ({ alert_type: 'schedule_gap', alert_key: `gap_${g.userName}_${g.date}` }));
                  await api.journal.dismissAlertsBulk(keys);
                  setDismissedKeys(prev => { const n = new Set(prev); keys.forEach(k => n.add(k.alert_key)); return n; });
                }}>모두 닫기</button>
            )}
          </h3>
          <div className="missing-alert-list">
            {filteredGaps.slice(0, 10).map((g, i) => (
              <div key={i} className="missing-alert-item" style={{ borderLeft: '3px solid #e65100', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="missing-alert-text">
                  <strong>{g.userName}</strong>
                  <span className="missing-alert-date">{g.date}</span>
                  <span style={{ color: '#e65100', fontSize: '0.78rem' }}>
                    공백: {g.gaps.join(', ')}
                  </span>
                </div>
                {user?.role === 'master' && (
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#bdc1c6', padding: 2 }}
                    onClick={async () => {
                      const key = `gap_${g.userName}_${g.date}`;
                      await api.journal.dismissAlert('schedule_gap', key);
                      setDismissedKeys(prev => new Set(prev).add(key));
                    }}>
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
        );
      })()}

      {/* 중복 임장 사건번호 알림 */}
      {dupInspections.length > 0 && (
        <section className="section">
          {/* 액션형 경고 배너 — 컨설팅 중복 처리 원칙 */}
          <div style={{
            padding: '14px 18px',
            marginBottom: 12,
            background: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)',
            border: '2px solid #e65100',
            borderLeft: '6px solid #d93025',
            borderRadius: 10,
            boxShadow: '0 2px 8px rgba(217, 48, 37, 0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertTriangle size={22} color="#d93025" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#b71c1c', marginBottom: 4 }}>
                  ⚠ 컨설팅 중복사건 처리 안내
                </div>
                <div style={{ fontSize: '0.82rem', color: '#3c4043', lineHeight: 1.55 }}>
                  본 건은 <strong style={{ color: '#d93025' }}>컨설팅 중복사건</strong>에 해당하므로, <strong>관리자는 관련 자료를 별도로 공유하지 마시고 즉시 변호사님께 직접 전달</strong>해 주시기 바랍니다.
                </div>
              </div>
            </div>
          </div>
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={18} color="#7b1fa2" /> 동일 사건 임장 알림
            <span style={{ background: '#7b1fa2', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{dupInspections.length}건</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
              <span style={{ fontSize: '0.68rem', color: !dupAllBranches ? '#7b1fa2' : '#9aa0a6', fontWeight: !dupAllBranches ? 600 : 400 }}>내 지사</span>
              <div onClick={() => setDupAllBranches(!dupAllBranches)}
                style={{ width: 32, height: 18, borderRadius: 9, background: dupAllBranches ? '#7b1fa2' : '#dadce0', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                <div style={{ width: 14, height: 14, borderRadius: 7, background: '#fff', position: 'absolute', top: 2, left: dupAllBranches ? 16 : 2, transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
              </div>
              <span style={{ fontSize: '0.68rem', color: dupAllBranches ? '#7b1fa2' : '#9aa0a6', fontWeight: dupAllBranches ? 600 : 400 }}>전 지사</span>
              <MasterCloseBtn alertType="dup_inspection" keys={dupInspections.map(d => `dup_${d.case_no}_${d.court}_${d.branch || ''}`)} onClose={() => setDupInspections([])} />
            </div>
          </h3>
          <div className="missing-alert-list">
            {dupInspections.slice(0, 15).map((dup, i) => {
              const names = dup.user_names.split(',');
              const nameDisplay = names.map((n, idx) => (
                <span key={idx}>
                  {idx > 0 && <span style={{ fontWeight: 400 }}>{idx === names.length - 1 ? '과(와) ' : ', '}</span>}
                  <strong>{n.trim()}</strong>
                </span>
              ));
              return (
                <div key={i} className="missing-alert-item" style={{ borderLeft: '3px solid #7b1fa2', position: 'relative' }}>
                  {isMaster && <div style={{ position: 'absolute', top: 6, right: 6 }}><MasterItemCloseBtn alertType="dup_inspection" alertKey={`dup_${dup.case_no}_${dup.court}_${dup.branch || ''}`} /></div>}
                  <div className="missing-alert-content">
                    <div className="missing-alert-main" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 700, background: '#f3e5f5', color: '#7b1fa2' }}>{dup.case_no}</span>
                      {dup.court && <span style={{ padding: '2px 6px', borderRadius: 8, fontSize: '0.68rem', background: '#e8eaf6', color: '#3949ab' }}>{dup.court}</span>}
                      {dupAllBranches && dup.branch && <span style={{ padding: '2px 6px', borderRadius: 8, fontSize: '0.68rem', background: '#e0f2f1', color: '#00695c' }}>{dup.branch}</span>}
                      <span style={{ fontSize: '0.82rem' }}>
                        {nameDisplay}의 동일 임장 건입니다.
                      </span>
                    </div>
                    <div className="missing-alert-detail" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>임장일: {dup.first_date === dup.last_date ? dup.first_date : `${dup.first_date} ~ ${dup.last_date}`}</span>
                      <Link to={`/admin-notes?tab=cooperation&court=${encodeURIComponent(dup.court || '')}&case_no=${encodeURIComponent(dup.case_no || '')}`}
                        style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 6, background: '#7b1fa2', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        업무협조요청
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 계약서/물건보고서 확인 대기 알림 */}
      {contractAlerts.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={18} color="#7b1fa2" /> 계약서/물건보고서 확인대기
            <span className="missing-alert-count">{contractAlerts.length}건</span>
            <MasterCloseBtn alertType="contract_alert" keys={contractAlerts.map(r => `contract_${r.id}`)} onClose={() => setContractAlerts([])} />
          </h3>
          <div className="missing-alert-list">
            {contractAlerts.slice(0, 10).map((r, i) => (
              <div key={i} className="missing-alert-item" style={{ borderLeft: `3px solid ${r.contract_submitted ? '#1a73e8' : '#d93025'}`, position: 'relative' }}>
                {isMaster && <div style={{ position: 'absolute', top: 6, right: 6 }}><MasterItemCloseBtn alertType="contract_alert" alertKey={`contract_${r.id}`} /></div>}
                <div className="missing-alert-content">
                  <div className="missing-alert-main">
                    <strong>{r.user_name}</strong> — {r.client_name}
                    <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 600, background: r.contract_submitted ? '#e3f2fd' : '#fce4ec', color: r.contract_submitted ? '#1a73e8' : '#d93025' }}>
                      {r.contract_submitted ? '제출 확인 대기' : '미작성 승인 대기'}
                    </span>
                  </div>
                  {r.contract_not_reason && <div className="missing-alert-detail">사유: {r.contract_not_reason}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 승인 대기 알림 */}
      {pendingApprovals.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bell size={18} color="#e65100" /> 승인 대기
            <span style={{ background: '#e65100', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{pendingApprovals.length}건</span>
            <MasterCloseBtn alertType="pending_approval" keys={pendingApprovals.map((d: any) => `approval_${d.id}`)} onClose={() => setPendingApprovals([])} />
          </h3>
          <div className="doc-list">
            {pendingApprovals.map((doc: any) => {
              const isWaiting = doc.myStatus === 'waiting_final';
              return (
                <div key={doc.id} style={{ position: 'relative' }}>
                  <Link to={'/documents/' + doc.id} className="doc-item" style={{ borderLeft: `3px solid ${isWaiting ? '#1a73e8' : '#e65100'}` }}>
                    <div className="doc-info">
                      <FileText size={16} style={{ color: isWaiting ? '#1a73e8' : '#e65100', marginRight: 8, flexShrink: 0 }} />
                      <div>
                        <div className="doc-title">{doc.title}</div>
                        <div className="doc-meta">
                          <span>작성자: {doc.author_name}</span>
                          {doc.department && <span>{doc.department}</span>}
                          <span>{new Date(doc.updated_at).toLocaleDateString('ko-KR')}</span>
                        </div>
                      </div>
                    </div>
                    <span className={`status-badge ${isWaiting ? 'status-draft' : 'status-submitted'}`}>
                      {isWaiting ? '최종 승인 대기' : '승인 필요'}
                    </span>
                  </Link>
                  {isMaster && <div style={{ position: 'absolute', top: 8, right: 8 }}><MasterItemCloseBtn alertType="pending_approval" alertKey={`approval_${doc.id}`} /></div>}
                </div>
              );
            })}
          </div>
        </section>
      )}


      {/* 입금 대기 매출 (회계/관리자급) */}
      {pendingSales.length > 0 && (() => {
        const filteredPending = pendingSalesBranch ? pendingSales.filter((r: any) => r.branch === pendingSalesBranch) : pendingSales;
        const branches = [...new Set(pendingSales.map((r: any) => r.branch).filter(Boolean))].sort();
        return (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <DollarSign size={18} color="#e65100" /> 입금 대기 매출
            <span style={{ background: '#e65100', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{filteredPending.length}건</span>
            {branches.length > 1 && (
              <select value={pendingSalesBranch} onChange={e => setPendingSalesBranch(e.target.value)}
                style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: '0.75rem', borderRadius: 6, border: '1px solid #dadce0' }}>
                <option value="">전체 지사</option>
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
            <MasterCloseBtn alertType="pending_sales" keys={pendingSales.map((r: any) => `pending_sales_${r.id}`)} onClose={() => setPendingSales([])} />
          </h3>
          <div className="doc-list">
            {filteredPending.slice(0, 10).map((r: any) => (
              <div key={r.id} style={{ position: 'relative' }}>
                <Link to="/sales" className="doc-item" style={{ borderLeft: '3px solid #e65100' }}>
                  <div className="doc-info">
                    <DollarSign size={16} style={{ color: '#e65100', marginRight: 8, flexShrink: 0 }} />
                    <div>
                      <div className="doc-title">{r.branch ? `[${r.branch}] ` : ''}{r.user_name} — {r.client_name} ({r.type})</div>
                      <div className="doc-meta">
                        <span>{(r.amount || 0).toLocaleString()}원</span>
                        <span>{r.contract_date}</span>
                      </div>
                    </div>
                  </div>
                </Link>
                {isMaster && <div style={{ position: 'absolute', top: 8, right: 8 }}><MasterItemCloseBtn alertType="pending_sales" alertKey={`pending_sales_${r.id}`} /></div>}
              </div>
            ))}
          </div>
        </section>
        );
      })()}

      {/* 환불 신청 (회계/관리자급) */}
      {refundRequests.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RotateCcw size={18} color="#d93025" /> 환불 신청
            <span style={{ background: '#d93025', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{refundRequests.length}건</span>
            <MasterCloseBtn alertType="refund_request" keys={refundRequests.map((r: any) => `refund_request_${r.id}`)} onClose={() => setRefundRequests([])} />
          </h3>
          <div className="doc-list">
            {refundRequests.map((r: any) => (
              <div key={r.id} style={{ position: 'relative' }}>
                <Link to="/sales" className="doc-item" style={{ borderLeft: '3px solid #d93025' }}>
                  <div className="doc-info">
                    <RotateCcw size={16} style={{ color: '#d93025', marginRight: 8, flexShrink: 0 }} />
                    <div>
                      <div className="doc-title">{r.user_name} — {r.client_name} 환불신청</div>
                      <div className="doc-meta">
                        <span>{(r.amount || 0).toLocaleString()}원</span>
                        <span>{r.refund_requested_at ? new Date(r.refund_requested_at).toLocaleDateString('ko-KR') : ''}</span>
                      </div>
                    </div>
                  </div>
                </Link>
                {isMaster && <div style={{ position: 'absolute', top: 8, right: 8 }}><MasterItemCloseBtn alertType="refund_request" alertKey={`refund_request_${r.id}`} /></div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 환불 영향 알림 — 이전 기간 환불로 성과금/수익 회수 필요 */}
      {refundImpacts.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} color="#e65100" /> 환불 회수 필요
            <span style={{ background: '#e65100', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{refundImpacts.length}건</span>
            <MasterCloseBtn alertType="refund_impact" keys={refundImpacts.map((imp: any) => `refund_impact_${imp.id}`)} onClose={() => setRefundImpacts([])} />
          </h3>
          <div className="doc-list">
            {refundImpacts.map((imp: any) => (
              <div key={imp.id} style={{ position: 'relative' }}>
                <Link to="/payroll" className="doc-item" style={{ borderLeft: '3px solid #e65100' }}>
                  <div className="doc-info">
                    <AlertTriangle size={16} style={{ color: '#e65100', marginRight: 8, flexShrink: 0 }} />
                    <div>
                      <div className="doc-title">
                        [{imp.user_branch}] {imp.user_name} — {imp.client_name} ({imp.type}) 환불
                      </div>
                      <div className="doc-meta">
                        <span style={{ color: '#d93025', fontWeight: 600 }}>-{(imp.amount || 0).toLocaleString()}원</span>
                        <span>{imp.bonus_period_label} 매출</span>
                        <span>{imp.refund_approved_at ? new Date(imp.refund_approved_at).toLocaleDateString('ko-KR') + ' 환불승인' : ''}</span>
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#e65100', marginTop: 2 }}>
                        {imp.is_contract && '→ 계약건수 차감, 랭킹 변동 가능'}
                        {imp.affects_bonus && ' / 성과금 재계산 필요'}
                        {imp.affects_commission && imp.recovery_amount > 0 && ` / 회수금액: ${imp.recovery_amount.toLocaleString()}원`}
                        {!imp.is_contract && !imp.affects_bonus && !imp.affects_commission && '→ 다음 정산 시 공제 확인 필요'}
                      </div>
                    </div>
                  </div>
                </Link>
                {isMaster && <div style={{ position: 'absolute', top: 8, right: 8 }}><MasterItemCloseBtn alertType="refund_impact" alertKey={`refund_impact_${imp.id}`} /></div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 입금 등록 알림 (전체 — D-Day 입금일자 기준, 빨간 표기) */}
      {depositNotices.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} color="#d93025" /> 입금 등록 (미처리)
            <span style={{ background: '#d93025', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{depositNotices.length}건</span>
            <MasterCloseBtn alertType="deposit_notice" keys={depositNotices.map((d: any) => `deposit_${d.id}`)} onClose={() => setDepositNotices([])} />
          </h3>
          <div className="doc-list">
            {depositNotices.map((d: any) => {
              const dDay = Math.ceil((new Date(d.deposit_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              return (
                <div key={d.id} style={{ position: 'relative' }}>
                  <Link to="/sales" className="doc-item" style={{ borderLeft: '3px solid #d93025' }}>
                    <div className="doc-info">
                      <Clock size={16} style={{ color: '#d93025', marginRight: 8, flexShrink: 0 }} />
                      <div>
                        <div className="doc-title">입금자: {d.depositor} — {(d.amount || 0).toLocaleString()}원</div>
                        <div className="doc-meta">
                          <span>입금일: {d.deposit_date}</span>
                          <span style={{ fontWeight: 700, color: '#d93025' }}>
                            D{dDay <= 0 ? '+' : '-'}{Math.abs(dDay)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                  {isMaster && <div style={{ position: 'absolute', top: 8, right: 8 }}><MasterItemCloseBtn alertType="deposit_notice" alertKey={`deposit_${d.id}`} /></div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 기준매출 미달 경고 (총무/관리자급만) */}
      {salesAlerts.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingDown size={18} color="#e65100" /> 기준매출 미달
            <span style={{ background: '#e65100', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{salesAlerts.length}명</span>
            <MasterCloseBtn alertType="sales_shortfall" keys={salesAlerts.map((a: any) => `shortfall_${a.id}`)} onClose={() => setSalesAlerts([])} />
          </h3>
          <div className="doc-list">
            {salesAlerts.map((a: any) => (
              <div key={a.id} className="doc-item" style={{ borderLeft: '3px solid #e65100', position: 'relative' }}>
                {isMaster && <div style={{ position: 'absolute', top: 8, right: 8 }}><MasterItemCloseBtn alertType="sales_shortfall" alertKey={`shortfall_${a.id}`} /></div>}
                <div className="doc-info">
                  <TrendingDown size={16} style={{ color: '#e65100', marginRight: 8, flexShrink: 0 }} />
                  <div>
                    <div className="doc-title">{a.user_name} — 기준매출 미달</div>
                    <div className="doc-meta">
                      <span>{a.branch} {a.department}</span>
                      <span>기준: {(a.standard_sales || 0).toLocaleString()}원</span>
                      <span>실적: {(a.total_sales || 0).toLocaleString()}원</span>
                      <span>연속 {a.consecutive_misses}회 미달</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 강등 대상 경고 (3회 연속 미달 — 총무/관리자급만) */}
      {demotionCandidates.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ArrowDownCircle size={18} color="#d93025" /> 강등 대상
            <span style={{ background: '#d93025', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{demotionCandidates.length}명</span>
            <MasterCloseBtn alertType="demotion" keys={demotionCandidates.map((a: any) => `demotion_${a.id}`)} onClose={() => setDemotionCandidates([])} />
          </h3>
          <div className="doc-list">
            {demotionCandidates.map((a: any) => (
              <div key={a.id} className="doc-item" style={{ borderLeft: '3px solid #d93025', background: '#fce4ec', position: 'relative' }}>
                {isMaster && <div style={{ position: 'absolute', top: 8, right: 8 }}><MasterItemCloseBtn alertType="demotion" alertKey={`demotion_${a.id}`} /></div>}
                <div className="doc-info">
                  <ArrowDownCircle size={16} style={{ color: '#d93025', marginRight: 8, flexShrink: 0 }} />
                  <div>
                    <div className="doc-title" style={{ color: '#d93025' }}>{a.user_name} — 강등 대상 (연속 {a.consecutive_misses}회 미달)</div>
                    <div className="doc-meta">
                      <span>{a.branch} {a.department}</span>
                      <span>현재 직급: {a.grade || '미지정'}</span>
                      <span>기준: {(a.standard_sales || 0).toLocaleString()}원 / 실적: {(a.total_sales || 0).toLocaleString()}원</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 취소 신청 내역 (관리자) */}
      {cancelRequests.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} color="#d93025" /> 취소 신청
            <span style={{ background: '#d93025', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{cancelRequests.length}건</span>
            <MasterCloseBtn alertType="cancel_request" keys={cancelRequests.map((d: any) => `cancel_${d.id}`)} onClose={() => setCancelRequests([])} />
          </h3>
          <div className="doc-list">
            {cancelRequests.map((doc: any) => (
              <div key={doc.id} className="doc-item" style={{ borderLeft: '3px solid #d93025' }}>
                <div className="doc-info" style={{ flex: 1 }}>
                  <FileX size={16} style={{ color: '#d93025', marginRight: 8, flexShrink: 0 }} />
                  <div>
                    <div className="doc-title">{doc.title}</div>
                    <div className="doc-meta">
                      <span>작성자: {doc.author_name}</span>
                      <span>사유: {doc.cancel_reason || '없음'}</span>
                      <span>{new Date(doc.updated_at).toLocaleDateString('ko-KR')}</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Link to={'/documents/' + doc.id} className="btn btn-sm">확인</Link>
                  <button className="btn btn-sm btn-danger" onClick={async () => {
                    if (!confirm(`"${doc.title}" 문서를 취소 처리하시겠습니까?`)) return;
                    try {
                      await api.documents.cancelApprove(doc.id);
                      setCancelRequests(prev => prev.filter(d => d.id !== doc.id));
                    } catch (err: any) { alert(err.message); }
                  }}>취소 승인</button>
                  {isMaster && <MasterItemCloseBtn alertType="cancel_request" alertKey={`cancel_${doc.id}`} />}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-header">
          <h3 className="section-title">최근 문서</h3>
          <Link to="/documents" className="btn btn-sm">전체 보기</Link>
        </div>
        <div className="doc-list">
          {documents.slice(0, 5).map((doc) => {
            const cfg = statusConfig[doc.status];
            const Icon = cfg?.icon || FileText;
            return (
              <Link to={'/documents/' + doc.id} key={doc.id} className="doc-item">
                <div className="doc-info">
                  <Icon size={16} style={{ color: 'var(--gray-400)', marginRight: 8, flexShrink: 0 }} />
                  <div>
                    <div className="doc-title">{doc.title}</div>
                    <div className="doc-meta">
                      {doc.author_name && <span>{doc.author_name}</span>}
                      <span>{new Date(doc.updated_at).toLocaleDateString('ko-KR')}</span>
                    </div>
                  </div>
                </div>
                <span className={`status-badge ${cfg?.className}`}>{cfg?.label}</span>
              </Link>
            );
          })}
          {documents.length === 0 && <div className="empty-state">아직 문서가 없습니다.</div>}
        </div>
      </section>
    </div>
  );
}

// 외근 여부 판정: 회사 밖 활동인지
function isOutdoorEntry(entry: JournalEntry): boolean {
  try {
    const d = JSON.parse(entry.data);
    if (d.companion) return false;
    // 임장: 항상 외근
    if (entry.activity_type === '임장') return true;
    // 미팅: 회사 미팅(internalMeeting)은 제외, 그 외는 외근
    if (entry.activity_type === '미팅') return !d.internalMeeting;
    // 입찰: 현장출근 + 대리입찰 아닌 경우
    if (entry.activity_type === '입찰' && (d.fieldCheckIn || d.fieldCheckOut) && !d.bidProxy) return true;
  } catch { /* */ }
  return false;
}

// 시간 문자열 → 분 변환 (ex: "09:30" → 570)
function timeToMin(t: string): number {
  const [h, m] = (t || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// 외근 블록 계산: 연속된 외근 활동을 하나의 블록으로 묶기 (현재 미사용 — link 전환 후 보류)
// @ts-expect-error: legacy 함수 — 향후 타 알림에서 재사용 가능성 있어 보존
function countOutdoorBlocks(dayEntries: JournalEntry[]): number {
  // 외근 일정만 추출 + 시간 파싱
  const outdoors: { from: number; to: number }[] = [];
  dayEntries.forEach((e) => {
    if (!isOutdoorEntry(e)) return;
    try {
      const d = JSON.parse(e.data);
      if (!d.timeFrom) return;
      outdoors.push({ from: timeToMin(d.timeFrom), to: timeToMin(d.timeTo || d.timeFrom) });
    } catch { /* */ }
  });

  if (outdoors.length === 0) return 0;

  // 시간순 정렬
  outdoors.sort((a, b) => a.from - b.from);

  // 모든 일정(외근 포함)을 시간순 정렬하여 사이에 비외근이 끼는지 확인
  const allSorted: { from: number; to: number; outdoor: boolean }[] = [];
  dayEntries.forEach((e) => {
    try {
      const d = JSON.parse(e.data);
      if (!d.timeFrom) return;
      allSorted.push({
        from: timeToMin(d.timeFrom),
        to: timeToMin(d.timeTo || d.timeFrom),
        outdoor: isOutdoorEntry(e),
      });
    } catch { /* */ }
  });
  allSorted.sort((a, b) => a.from - b.from);

  // 블록 계산: 외근이 이어지면 같은 블록, 사이에 비외근이 끼거나 시간이 끊기면 새 블록
  let blocks = 1;
  let lastOutdoorTo = outdoors[0].to;

  for (let i = 1; i < outdoors.length; i++) {
    const cur = outdoors[i];
    // 이전 외근 종료 ~ 현재 외근 시작 사이에 비외근(사무/개인)이 있는지 확인
    const gapHasIndoor = allSorted.some(
      (a) => !a.outdoor && a.from >= lastOutdoorTo && a.to <= cur.from
    );
    // 시간이 안 이어지거나 사이에 실내 활동이 있으면 새 블록
    if (cur.from > lastOutdoorTo || gapHasIndoor) {
      blocks++;
    }
    lastOutdoorTo = Math.max(lastOutdoorTo, cur.to);
  }

  return blocks;
}

// D-Day 계산 (오늘 기준 경과일)
function calcDDay(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - target.getTime()) / 86400000);
}

// 외근보고서 link 강제 시작일 (이 날짜 이전 외근은 link 없어도 알림 안 뜸 — legacy 보호)
const OUTDOOR_LINK_ENFORCE_FROM = '2026-05-01';

// [5-1] 일지 ↔ 문서 교차검증
// 입찰/임장/미팅 → 외근보고서 (link 기반), 개인 → 연차/반차/시간차/병가 (제목 매칭)
function detectMissing(entries: JournalEntry[], docs: Document[], linkedEntryIds: Set<string> = new Set()): MissingAlert[] {
  const alerts: MissingAlert[] = [];

  // 사용자+날짜별 일지 그룹
  const byUserDate: Record<string, JournalEntry[]> = {};
  entries.forEach((e) => {
    const key = `${e.user_id}_${e.target_date}`;
    if (!byUserDate[key]) byUserDate[key] = [];
    byUserDate[key].push(e);
  });

  // 외근 매칭은 link 기반으로 전환됨 (regex/풀 매칭 제거)
  // docs는 개인 신청서 매칭에만 사용

  // 외근일 오름차순으로 처리
  const sortedKeys = Object.keys(byUserDate).sort((a, b) => {
    return byUserDate[a][0].target_date.localeCompare(byUserDate[b][0].target_date);
  });

  sortedKeys.forEach((mapKey) => {
    const dayEntries = byUserDate[mapKey];
    const userId = dayEntries[0].user_id;
    const userName = dayEntries[0].user_name || '';
    const date = dayEntries[0].target_date;
    const dDay = calcDDay(date);

    // 해당 사용자의 제출/승인된 문서
    const userDocs = docs.filter((d) => d.author_id === userId);

    // 1. 개인 → 연차/반차/시간차/병가 신청서 필요
    dayEntries.forEach((entry) => {
      try {
        const d = JSON.parse(entry.data);
        if (entry.activity_type === '개인') {
          const reason = (d.reason || '').toLowerCase();
          if (reason.includes('연차') || reason.includes('월차') || reason.includes('휴가')) {
            const hasDoc = userDocs.some((doc) => doc.title.includes('연차') || doc.title.includes('휴가'));
            if (!hasDoc) {
              alerts.push({ userName, userId, date, activity: `개인 - ${d.reason}`, missingDoc: '연차휴가 신청서 미제출', dDay });
            }
          }
          if (reason.includes('반차')) {
            const hasDoc = userDocs.some((doc) => doc.title.includes('반차'));
            if (!hasDoc) {
              alerts.push({ userName, userId, date, activity: `개인 - ${d.reason}`, missingDoc: '반차 신청서 미제출', dDay });
            }
          }
          if (reason.includes('시간차')) {
            const hasDoc = userDocs.some((doc) => doc.title.includes('시간차') || doc.title.includes('지각') || doc.title.includes('조퇴') || doc.title.includes('외출'));
            if (!hasDoc) {
              alerts.push({ userName, userId, date, activity: `개인 - ${d.reason}`, missingDoc: '지각/조퇴/외출 사유서 미제출', dDay });
            }
          }
          if (reason.includes('병가')) {
            const hasDoc = userDocs.some((doc) => doc.title.includes('병가') || doc.title.includes('결근'));
            if (!hasDoc) {
              alerts.push({ userName, userId, date, activity: `개인 - ${d.reason}`, missingDoc: '결근 사유서 미제출', dDay });
            }
          }
        }
      } catch { /* */ }
    });

    // 1-2. 입찰 건: 작성입찰가/제시입찰가/낙찰가 미작성 감지
    // 낙찰가는 입찰일이 오늘 또는 과거인 건만 (미래 예약은 결과 미정)
    // 취하/변경(bidCancelled)인 경우 작성입찰가/낙찰가 검사는 스킵 (제시입찰가는 사전 입력값이라 그대로 검사)
    const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    dayEntries.forEach((entry) => {
      if (entry.activity_type !== '입찰') return;
      try {
        const d = JSON.parse(entry.data);
        const missing: string[] = [];
        if (!d.bidPrice && !d.bidCancelled) missing.push('작성입찰가');
        if (!d.suggestedPrice) missing.push('제시입찰가');
        if (!d.winPrice && !d.bidWon && !d.bidCancelled && entry.target_date <= todayKst) missing.push('낙찰가');
        if (missing.length > 0) {
          alerts.push({ userName, userId, date, activity: `입찰 — ${d.caseNo || ''}`, missingDoc: `${missing.join(', ')} 미작성`, dDay });
        }
      } catch { /* */ }
    });

    // 2. 외근 블록(입찰/임장/미팅) → link 기반 검증
    // 정책: 외근일 ≥ cutoff 일 때만 검사. 외근 entry 단위 link 필수.
    //   - 모든 외근 entry에 link 있음 → 충족
    //   - 1개라도 누락 → "외근 보고서 미제출 (N건 중 M건 미연결)"
    //   - cutoff 이전 외근은 backfill 결과만 활용 + 알림 비활성화
    if (date >= OUTDOOR_LINK_ENFORCE_FROM) {
      const outdoorEntries = dayEntries.filter((e) => isOutdoorEntry(e));
      if (outdoorEntries.length > 0) {
        const unlinkedCount = outdoorEntries.filter((e) => !linkedEntryIds.has(e.id)).length;
        if (unlinkedCount > 0) {
          const totalText = outdoorEntries.length === unlinkedCount
            ? `${outdoorEntries.length}건 미연결`
            : `${outdoorEntries.length}건 중 ${unlinkedCount}건 미연결`;
          alerts.push({
            userName, userId, date,
            activity: `외근(${outdoorEntries.length}건)`,
            missingDoc: `외근 보고서 미제출 (${totalText})`,
            dDay,
          });
        }
      }
    }

    // 3. 출장 → 출장신청서/보고서
    const hasBizTrip = dayEntries.some((e) => {
      try {
        const d = JSON.parse(e.data);
        return e.activity_type === '미팅' && d.meetingType === '기타' &&
          ((d.etcReason || '').includes('출장') || (d.place || '').includes('출장'));
      } catch { return false; }
    });

    if (hasBizTrip) {
      const hasRequest = userDocs.some((doc) => doc.title.includes('출장') && doc.title.includes('신청'));
      const hasReport = userDocs.some((doc) => doc.title.includes('출장') && doc.title.includes('보고'));
      if (!hasRequest) alerts.push({ userName, userId, date, activity: '출장', missingDoc: '출장 신청서 미제출', dDay });
      if (!hasReport) alerts.push({ userName, userId, date, activity: '출장', missingDoc: '출장 보고서 미제출', dDay });
    }
  });

  // 중복 제거
  const unique = alerts.filter((a, i) =>
    alerts.findIndex((b) => b.userName === a.userName && b.date === a.date && b.missingDoc === a.missingDoc) === i
  );

  return unique.sort((a, b) => b.dDay - a.dDay); // D-Day 큰 순 (오래된 것 먼저)
}

// [3-3] 일정 공백 감지: 09:00~18:00 중 11:30~12:30 제외한 시간대에 빈 구간
function detectScheduleGaps(entries: JournalEntry[]): ScheduleGapAlert[] {
  const alerts: ScheduleGapAlert[] = [];

  // 사용자+날짜별 그룹
  const byUserDate: Record<string, JournalEntry[]> = {};
  entries.forEach((e) => {
    const key = `${e.user_id}_${e.target_date}`;
    if (!byUserDate[key]) byUserDate[key] = [];
    byUserDate[key].push(e);
  });

  // 필수 시간대: 09:00~11:30, 12:30~18:00 (분 단위)
  const REQUIRED_BLOCKS = [
    { from: 540, to: 690 },  // 09:00 ~ 11:30
    { from: 750, to: 1080 }, // 12:30 ~ 18:00
  ];

  Object.values(byUserDate).forEach((dayEntries) => {
    const userName = dayEntries[0].user_name || '';
    const date = dayEntries[0].target_date;

    // 개인(연차 등) 전일이면 공백 아님
    const hasFullDayOff = dayEntries.some(e => e.activity_type === '개인');
    if (hasFullDayOff) return;

    // 해당 날짜 일정의 시간 범위 수집
    const covered: { from: number; to: number }[] = [];
    dayEntries.forEach((e) => {
      try {
        const d = JSON.parse(e.data);
        if (!d.timeFrom) return;
        covered.push({ from: timeToMin(d.timeFrom), to: timeToMin(d.timeTo || d.timeFrom) });
      } catch { /* */ }
    });

    if (covered.length === 0) return; // 시간 없는 일정만 있으면 스킵

    // 시간순 정렬 + 병합
    covered.sort((a, b) => a.from - b.from);
    const merged: { from: number; to: number }[] = [];
    for (const c of covered) {
      const last = merged[merged.length - 1];
      if (last && c.from <= last.to) {
        last.to = Math.max(last.to, c.to);
      } else {
        merged.push({ ...c });
      }
    }

    // 필수 블록별 공백 찾기
    const gaps: string[] = [];
    for (const block of REQUIRED_BLOCKS) {
      let cursor = block.from;
      for (const m of merged) {
        if (m.to <= cursor) continue;
        if (m.from > cursor && m.from < block.to) {
          // cursor ~ m.from 구간이 공백
          const gapStart = Math.max(cursor, block.from);
          const gapEnd = Math.min(m.from, block.to);
          if (gapEnd - gapStart >= 30) { // 30분 이상 공백만
            gaps.push(`${minToTime(gapStart)}~${minToTime(gapEnd)}`);
          }
        }
        cursor = Math.max(cursor, m.to);
      }
      // 마지막 구간 이후 공백
      if (cursor < block.to) {
        const gapStart = Math.max(cursor, block.from);
        if (block.to - gapStart >= 30) {
          gaps.push(`${minToTime(gapStart)}~${minToTime(block.to)}`);
        }
      }
    }

    if (gaps.length > 0) {
      alerts.push({ userName, date, gaps });
    }
  });

  return alerts.sort((a, b) => b.date.localeCompare(a.date));
}

function minToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
