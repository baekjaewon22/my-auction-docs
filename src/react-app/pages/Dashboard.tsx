import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store';
import { api } from '../api';
import type { Document } from '../types';
import type { JournalEntry } from '../journal/types';
import { FileText, FilePlus, FileCheck, FileX, Files, AlertTriangle } from 'lucide-react';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const promises: Promise<any>[] = [api.documents.list()];
    // 팀장 이상은 일지도 로드하여 매칭 체크
    if (['master', 'ceo', 'admin', 'manager'].includes(user?.role || '')) {
      promises.push(api.journal.list({ range: 'month' }));
    } else {
      // 팀원: 본인 일지만
      promises.push(api.journal.list({ range: 'month' }));
    }

    Promise.all(promises)
      .then(([docRes, journalRes]) => {
        const docs = docRes.documents as Document[];
        setDocuments(docs);

        if (journalRes) {
          const entries = (journalRes as { entries: JournalEntry[] }).entries;
          setAlerts(detectMissing(entries, docs));
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
        <p className="greeting">안녕하세요, <strong>{user?.name}</strong>님!</p>
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
            {alerts.slice(0, 10).map((a, i) => (
              <div key={i} className="missing-alert-item">
                <div className="missing-alert-icon"><AlertTriangle size={14} /></div>
                <div className="missing-alert-content">
                  <div className="missing-alert-main">
                    <strong>{a.userName}</strong> — {a.date}
                  </div>
                  <div className="missing-alert-detail">
                    일지: <span className="missing-alert-activity">{a.activity}</span> → <span className="missing-alert-doc">{a.missingDoc}</span>
                  </div>
                </div>
              </div>
            ))}
            {alerts.length > 10 && (
              <div className="missing-alert-more">외 {alerts.length - 10}건 더 있음</div>
            )}
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

    dayEntries.forEach((entry) => {
      try {
        const d = JSON.parse(entry.data);

        // 1. 개인(연차) → 연차신청서 필요
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

        // 2. 현장출근/퇴근 체크 → 외근 기록 확인
        if (d.fieldCheckIn || d.fieldCheckOut) {
          // 출장 관련 문서 확인
          if (entry.activity_type === '임장' || entry.activity_type === '입찰') {
            // 임장/입찰은 일상 업무이므로 출장보고서 불필요
          }
        }

      } catch { /* */ }
    });

    // 3. 미팅 일지 → 외근 보고서 확인
    const hasMeeting = dayEntries.some((e) => e.activity_type === '미팅');
    if (hasMeeting) {
      const hasOutingReport = userDocs.some((doc) => doc.title.includes('외근') && doc.title.includes('보고'));
      if (!hasOutingReport) {
        alerts.push({ userName, date, activity: '미팅(외근)', missingDoc: '외근 보고서 미제출' });
      }
    }

    // 4. 출장 일지 있으면 출장신청서/보고서 확인
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

  // 중복 제거
  const unique = alerts.filter((a, i) =>
    alerts.findIndex((b) => b.userName === a.userName && b.missingDoc === a.missingDoc) === i
  );

  return unique.sort((a, b) => b.date.localeCompare(a.date));
}
