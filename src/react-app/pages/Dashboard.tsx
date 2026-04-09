import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store';
import { api } from '../api';
import type { Document } from '../types';
import type { JournalEntry } from '../journal/types';
import { FileText, FilePlus, FileCheck, FileX, Files, AlertTriangle, ExternalLink, Bell, DollarSign, TrendingDown, ArrowDownCircle, Clock, RotateCcw } from 'lucide-react';
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

export default function Dashboard() {
  const { user } = useAuthStore();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [alerts, setAlerts] = useState<MissingAlert[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<(Document & { steps?: ApprovalStep[] })[]>([]);
  const [cancelRequests, setCancelRequests] = useState<Document[]>([]);
  const [salesAlerts, setSalesAlerts] = useState<SalesEvaluation[]>([]);
  const [demotionCandidates, setDemotionCandidates] = useState<SalesEvaluation[]>([]);
  const [pendingSales, setPendingSales] = useState<SalesRecord[]>([]);
  const [refundRequests, setRefundRequests] = useState<SalesRecord[]>([]);
  const [depositNotices, setDepositNotices] = useState<DepositNotice[]>([]);
  const [scheduleGaps, setScheduleGaps] = useState<ScheduleGapAlert[]>([]);
  const [contractAlerts, setContractAlerts] = useState<SalesRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const canApprove = ['master', 'ceo', 'cc_ref', 'admin', 'manager'].includes(user?.role || '');
  const isAdmin = ['master', 'ceo', 'cc_ref', 'admin'].includes(user?.role || '');
  const canSeeAccountingAlerts = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(user?.role || '');

  useEffect(() => {
    const promises: Promise<any>[] = [
      api.documents.list(),
      api.journal.list({ range: 'month' }),
    ];
    // 승인 권한자면 submitted 문서도 조회
    if (canApprove) {
      promises.push(api.documents.list('submitted'));
    }
    // 관리자면 취소신청 목록도 조회
    if (isAdmin) {
      promises.push(api.documents.cancelRequests());
    }

    Promise.all(promises)
      .then(async ([docRes, journalRes, submittedRes, cancelRes]) => {
        const allDocs = docRes.documents as Document[];
        const myDocs = allDocs.filter((d: any) => d.author_id === user?.id);
        setDocuments(myDocs);

        if (journalRes) {
          const entries = (journalRes as { entries: JournalEntry[] }).entries;
          setAlerts(detectMissing(entries, allDocs));
          setScheduleGaps(detectScheduleGaps(entries));
        }

        // 계약서 확인 대기 알림 (관리자/회계)
        if (canApprove || isAdmin) {
          try {
            const sRes = await api.sales.list({});
            const pending = (sRes.records as SalesRecord[]).filter(r =>
              (r.contract_submitted && !r.contract_not_approved) || (r.contract_not_submitted && !r.contract_not_approved)
            );
            setContractAlerts(pending);
          } catch { /* */ }
        }

        // 승인 대기 문서 + 결재선 확인
        if (submittedRes && canApprove) {
          const submitted = (submittedRes.documents as Document[]).filter((d: any) => d.author_id !== user?.id);
          const pending: (Document & { steps?: ApprovalStep[]; myStatus?: string })[] = [];
          const isTopRole = ['master', 'ceo', 'cc_ref'].includes(user?.role || '');

          for (const doc of submitted.slice(0, 20)) {
            try {
              const stepsRes = await api.documents.steps(doc.id);
              const steps = stepsRes.steps || [];
              // 내 차례인지 확인
              const myStep = steps.find((s: ApprovalStep) => s.approver_id === user?.id && s.status === 'pending');
              const prevDone = myStep ? steps.filter((s: ApprovalStep) => s.step_order < myStep.step_order).every((s: ApprovalStep) => s.status === 'approved') : false;
              // 내가 이미 승인했지만 최종 승인 전인 문서
              const myApproved = steps.find((s: ApprovalStep) => s.approver_id === user?.id && s.status === 'approved');
              const hasPending = steps.some((s: ApprovalStep) => s.status === 'pending');

              if ((myStep && prevDone) || isTopRole) {
                pending.push({ ...doc, steps, myStatus: 'need_approve' });
              } else if (myApproved && hasPending) {
                pending.push({ ...doc, steps, myStatus: 'waiting_final' });
              }
            } catch { /* */ }
          }
          setPendingApprovals(pending);
        }

        // 취소 신청 목록
        if (cancelRes && isAdmin) {
          setCancelRequests(cancelRes.documents || []);
        }


        // 매출 미달/강등 경고 (총무/관리자급만 — 담당자 본인에게는 비노출)
        if (canSeeAccountingAlerts) {
          try {
            const alertRes = await api.accounting.alerts();
            setSalesAlerts(alertRes.current_period_alerts || []);
            setDemotionCandidates(alertRes.demotion_candidates || []);
          } catch { /* */ }
        }

        // 매출 입금대기/환불신청 알림 (회계/관리자급)
        if (canSeeAccountingAlerts) {
          try {
            const [pendRes, refRes] = await Promise.all([
              api.sales.dashboardPending(),
              api.sales.dashboardRefundRequests(),
            ]);
            setPendingSales(pendRes.records || []);
            setRefundRequests(refRes.records || []);
          } catch { /* */ }
        }

        // 입금등록 알림 (전체 — 회계가 등록한 입금내역)
        try {
          const depRes = await api.sales.deposits();
          setDepositNotices((depRes.deposits || []).filter((d: DepositNotice) => d.status === 'pending'));
        } catch { /* */ }
      })
      .finally(() => setLoading(false));
  }, []);

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

      {/* [5-2] 내 미제출 보고서 D-Day (담당자 본인용 — 항상 노출) */}
      {(() => {
        const myAlerts = alerts.filter((a) => a.userId === user?.id);
        if (myAlerts.length === 0) return null;
        return (
          <section className="section">
            <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={18} color="#d93025" /> 내 미제출 보고서
              <span className="missing-alert-count">{myAlerts.length}건</span>
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

      {/* 미제출 알림 (관리자용) */}
      {alerts.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} color="#d93025" /> 미제출 알림
            <span className="missing-alert-count">{alerts.length}건</span>
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

      {/* 일정 공백 알림 */}
      {scheduleGaps.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} color="#e65100" /> 일정 공백 알림
            <span className="missing-alert-count">{scheduleGaps.length}건</span>
          </h3>
          <div className="missing-alert-list">
            {scheduleGaps.slice(0, 10).map((g, i) => (
              <div key={i} className="missing-alert-item" style={{ borderLeft: '3px solid #e65100' }}>
                <div className="missing-alert-text">
                  <strong>{g.userName}</strong>
                  <span className="missing-alert-date">{g.date}</span>
                  <span style={{ color: '#e65100', fontSize: '0.78rem' }}>
                    공백: {g.gaps.join(', ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 계약서 확인 대기 알림 */}
      {contractAlerts.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={18} color="#7b1fa2" /> 계약서 확인 대기
            <span className="missing-alert-count">{contractAlerts.length}건</span>
          </h3>
          <div className="missing-alert-list">
            {contractAlerts.slice(0, 10).map((r, i) => (
              <div key={i} className="missing-alert-item" style={{ borderLeft: `3px solid ${r.contract_submitted ? '#1a73e8' : '#d93025'}` }}>
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
          </h3>
          <div className="doc-list">
            {pendingApprovals.map((doc: any) => {
              const isWaiting = doc.myStatus === 'waiting_final';
              return (
                <Link to={'/documents/' + doc.id} key={doc.id} className="doc-item" style={{ borderLeft: `3px solid ${isWaiting ? '#1a73e8' : '#e65100'}` }}>
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
              );
            })}
          </div>
        </section>
      )}


      {/* 입금 대기 매출 (회계/관리자급) */}
      {pendingSales.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarSign size={18} color="#e65100" /> 입금 대기 매출
            <span style={{ background: '#e65100', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{pendingSales.length}건</span>
          </h3>
          <div className="doc-list">
            {pendingSales.slice(0, 10).map((r: any) => (
              <Link to="/sales" key={r.id} className="doc-item" style={{ borderLeft: '3px solid #e65100' }}>
                <div className="doc-info">
                  <DollarSign size={16} style={{ color: '#e65100', marginRight: 8, flexShrink: 0 }} />
                  <div>
                    <div className="doc-title">{r.user_name} — {r.client_name} ({r.type})</div>
                    <div className="doc-meta">
                      <span>{(r.amount || 0).toLocaleString()}원</span>
                      <span>{r.contract_date}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 환불 신청 (회계/관리자급) */}
      {refundRequests.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RotateCcw size={18} color="#d93025" /> 환불 신청
            <span style={{ background: '#d93025', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{refundRequests.length}건</span>
          </h3>
          <div className="doc-list">
            {refundRequests.map((r: any) => (
              <Link to="/sales" key={r.id} className="doc-item" style={{ borderLeft: '3px solid #d93025' }}>
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
          </h3>
          <div className="doc-list">
            {depositNotices.map((d: any) => {
              const dDay = Math.ceil((new Date(d.deposit_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              return (
                <Link to="/sales" key={d.id} className="doc-item" style={{ borderLeft: '3px solid #d93025' }}>
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
          </h3>
          <div className="doc-list">
            {salesAlerts.map((a: any) => (
              <div key={a.id} className="doc-item" style={{ borderLeft: '3px solid #e65100' }}>
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
          </h3>
          <div className="doc-list">
            {demotionCandidates.map((a: any) => (
              <div key={a.id} className="doc-item" style={{ borderLeft: '3px solid #d93025', background: '#fce4ec' }}>
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
    // 임장: 항상 외근
    if (entry.activity_type === '임장') return true;
    // 미팅: 항상 외근
    if (entry.activity_type === '미팅') return true;
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

// 외근 블록 계산: 연속된 외근 활동을 하나의 블록으로 묶기
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

// [5-1] 일지 ↔ 문서 교차검증
// 입찰/임장/미팅 → 외근보고서, 개인 → 연차/반차/시간차/병가
function detectMissing(entries: JournalEntry[], docs: Document[]): MissingAlert[] {
  const alerts: MissingAlert[] = [];

  // 사용자+날짜별 일지 그룹
  const byUserDate: Record<string, JournalEntry[]> = {};
  entries.forEach((e) => {
    const key = `${e.user_id}_${e.target_date}`;
    if (!byUserDate[key]) byUserDate[key] = [];
    byUserDate[key].push(e);
  });

  Object.values(byUserDate).forEach((dayEntries) => {
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

    // 2. 외근 블록(입찰/임장/미팅) → 외근 보고서 매칭
    const blockCount = countOutdoorBlocks(dayEntries);
    if (blockCount > 0) {
      const outingReportCount = userDocs.filter((doc) =>
        doc.title.includes('외근') && doc.title.includes('보고')
      ).length;

      const missing = blockCount - outingReportCount;
      if (missing > 0) {
        for (let i = 0; i < missing; i++) {
          alerts.push({ userName, userId, date, activity: `외근(${blockCount}블록)`, missingDoc: '외근 보고서 미제출', dDay });
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
