import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store';
import { api } from '../api';
import type { Document } from '../types';
import type { JournalEntry } from '../journal/types';
import { FileText, FilePlus, FileCheck, FileX, Files, AlertTriangle, ExternalLink, Bell, DollarSign } from 'lucide-react';
import type { ApprovalStep } from '../types';

const statusConfig: Record<string, { label: string; className: string; icon: typeof FileText }> = {
  draft: { label: '작성중', className: 'status-draft', icon: FilePlus },
  submitted: { label: '제출', className: 'status-submitted', icon: FileText },
  approved: { label: '승인', className: 'status-approved', icon: FileCheck },
  rejected: { label: '반려', className: 'status-rejected', icon: FileX },
};

interface MissingAlert {
  userName: string;
  date: string;
  activity: string;
  missingDoc: string;
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [alerts, setAlerts] = useState<MissingAlert[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<(Document & { steps?: ApprovalStep[] })[]>([]);
  const [cancelRequests, setCancelRequests] = useState<Document[]>([]);
  const [commissionAlerts, setCommissionAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const canApprove = ['master', 'ceo', 'cc_ref', 'admin', 'manager'].includes(user?.role || '');
  const isAdmin = ['master', 'ceo', 'cc_ref', 'admin'].includes(user?.role || '');

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

        // 수수료 미정산 알림 (관리자급 이상만)
        if (isAdmin) {
          try {
            const commRes = await api.commissions.myPending();
            setCommissionAlerts(commRes.commissions || []);
          } catch { /* */ }
        }
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

      {/* 미제출 알림 */}
      {alerts.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} color="#d93025" /> 미제출 알림
            <span className="missing-alert-count">{alerts.length}건</span>
          </h3>
          <div className="missing-alert-list">
            {(() => {
              // 같은 사용자+카테고리 묶기
              const grouped: { userName: string; missingDoc: string; count: number; dates: string[]; activities: string[] }[] = [];
              alerts.forEach((a) => {
                const existing = grouped.find((g) => g.userName === a.userName && g.missingDoc === a.missingDoc);
                if (existing) {
                  existing.count++;
                  if (!existing.dates.includes(a.date)) existing.dates.push(a.date);
                } else {
                  grouped.push({ userName: a.userName, missingDoc: a.missingDoc, count: 1, dates: [a.date], activities: [a.activity] });
                }
              });
              return grouped.slice(0, 10).map((g, i) => (
                <div key={i} className="missing-alert-item">
                  <div className="missing-alert-icon"><AlertTriangle size={14} /></div>
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
            {alerts.length > 10 && (
              <div className="missing-alert-more">외 {alerts.length - 10}건 더 있음</div>
            )}
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

      {/* 수수료 미정산 알림 */}
      {commissionAlerts.length > 0 && (
        <section className="section">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarSign size={18} color="#e65100" /> 미정산 수수료
            <span style={{ background: '#e65100', color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem' }}>{commissionAlerts.length}건</span>
          </h3>
          <div className="doc-list">
            {commissionAlerts.map((c: any) => {
              const days = Math.floor((Date.now() + 9 * 60 * 60 * 1000 - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24));
              return (
                <Link to="/commissions" key={c.id} className="doc-item" style={{ borderLeft: `3px solid ${days > 30 ? '#d93025' : '#e65100'}` }}>
                  <div className="doc-info">
                    <DollarSign size={16} style={{ color: '#e65100', marginRight: 8, flexShrink: 0 }} />
                    <div>
                      <div className="doc-title">{c.user_display_name || c.user_name} — {c.case_no || '사건번호 미입력'}</div>
                      <div className="doc-meta">
                        <span>고객: {c.client_name || '-'}</span>
                        <span>D+{days}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
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

// 일지 ↔ 문서 매칭 검사
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

    // 해당 사용자의 제출/승인된 문서
    const userDocs = docs.filter((d) => d.author_id === userId);

    // 1. 개인(연차/반차) → 신청서 필요
    dayEntries.forEach((entry) => {
      try {
        const d = JSON.parse(entry.data);
        if (entry.activity_type === '개인') {
          const reason = (d.reason || '').toLowerCase();
          if (reason.includes('연차') || reason.includes('월차') || reason.includes('휴가')) {
            const hasDoc = userDocs.some((doc) => doc.title.includes('연차') || doc.title.includes('휴가'));
            if (!hasDoc) {
              alerts.push({ userName, date, activity: `개인 - ${d.reason}`, missingDoc: '연차휴가 신청서 미제출' });
            }
          }
          if (reason.includes('반차')) {
            const hasDoc = userDocs.some((doc) => doc.title.includes('반차'));
            if (!hasDoc) {
              alerts.push({ userName, date, activity: `개인 - ${d.reason}`, missingDoc: '반차 신청서 미제출' });
            }
          }
        }
      } catch { /* */ }
    });

    // 2. 외근 블록 → 외근 보고서 매칭
    const blockCount = countOutdoorBlocks(dayEntries);
    if (blockCount > 0) {
      // 해당 날짜의 외근 보고서 수 (제목에 날짜 또는 "외근"+"보고" 포함)
      const outingReportCount = userDocs.filter((doc) =>
        doc.title.includes('외근') && doc.title.includes('보고')
      ).length;

      const missing = blockCount - outingReportCount;
      if (missing > 0) {
        for (let i = 0; i < missing; i++) {
          alerts.push({ userName, date, activity: `외근(${blockCount}블록)`, missingDoc: '외근 보고서 미제출' });
        }
      }
    }

    // 3. 출장 일지 있으면 출장신청서/보고서 확인
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
      if (!hasRequest) alerts.push({ userName, date, activity: '출장', missingDoc: '출장 신청서 미제출' });
      if (!hasReport) alerts.push({ userName, date, activity: '출장', missingDoc: '출장 보고서 미제출' });
    }
  });

  // 중복 제거: 같은 사용자+날짜+미제출 문서 단위
  const unique = alerts.filter((a, i) =>
    alerts.findIndex((b) => b.userName === a.userName && b.date === a.date && b.missingDoc === a.missingDoc) === i
  );

  return unique.sort((a, b) => b.date.localeCompare(a.date));
}
