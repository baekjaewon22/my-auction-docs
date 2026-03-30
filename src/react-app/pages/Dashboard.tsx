import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store';
import { api } from '../api';
import type { Document } from '../types';
import type { JournalEntry } from '../journal/types';
import { FileText, FilePlus, FileCheck, FileX, Files, TrendingUp, AlertTriangle } from 'lucide-react';

const statusConfig: Record<string, { label: string; className: string; icon: typeof FileText }> = {
  draft: { label: '작성중', className: 'status-draft', icon: FilePlus },
  submitted: { label: '제출', className: 'status-submitted', icon: FileText },
  approved: { label: '승인', className: 'status-approved', icon: FileCheck },
  rejected: { label: '반려', className: 'status-rejected', icon: FileX },
};

interface BidStat {
  total: number;
  withSuggested: number;
  withWin: number;
  avgDeviation: number;
  deviationOver5: number;
  winRate: number;
  totalSuggested: number;
  totalActual: number;
  totalWin: number;
}

function parseCurrency(val: string): number {
  return Number((val || '').replace(/[^0-9]/g, '')) || 0;
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [bidStats, setBidStats] = useState<BidStat | null>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = ['master', 'ceo', 'admin'].includes(user?.role || '');

  useEffect(() => {
    const promises: Promise<unknown>[] = [api.documents.list()];
    if (isAdmin) promises.push(api.journal.list({ range: 'all' }));

    Promise.all(promises).then(([docRes, journalRes]) => {
      setDocuments((docRes as { documents: Document[] }).documents);

      if (journalRes) {
        const entries = (journalRes as { entries: JournalEntry[] }).entries;
        const bidEntries = entries.filter((e) => e.activity_type === '입찰');

        let withSuggested = 0, withWin = 0, deviationOver5 = 0;
        let totalSuggested = 0, totalActual = 0, totalWin = 0;
        const deviations: number[] = [];

        bidEntries.forEach((e) => {
          try {
            const d = JSON.parse(e.data);
            const suggested = parseCurrency(d.suggestedPrice);
            const actual = parseCurrency(d.bidPrice);
            const win = parseCurrency(d.winPrice);

            if (suggested > 0) {
              withSuggested++;
              totalSuggested += suggested;
            }
            if (actual > 0) totalActual += actual;
            if (win > 0) {
              withWin++;
              totalWin += win;
            }

            if (suggested > 0 && actual > 0) {
              const dev = (suggested - actual) / suggested;
              deviations.push(dev);
              if (dev >= 0.05) deviationOver5++;
            }
          } catch { /* ignore */ }
        });

        setBidStats({
          total: bidEntries.length,
          withSuggested,
          withWin,
          avgDeviation: deviations.length > 0 ? deviations.reduce((a, b) => a + b, 0) / deviations.length * 100 : 0,
          deviationOver5,
          winRate: withWin > 0 && totalActual > 0 ? (totalWin / totalActual) * 100 : 0,
          totalSuggested,
          totalActual,
          totalWin,
        });
      }
    }).finally(() => setLoading(false));
  }, []);

  const stats = {
    total: documents.length,
    draft: documents.filter((d) => d.status === 'draft').length,
    submitted: documents.filter((d) => d.status === 'submitted').length,
    approved: documents.filter((d) => d.status === 'approved').length,
    rejected: documents.filter((d) => d.status === 'rejected').length,
  };

  const fmtWon = (n: number) => n > 0 ? n.toLocaleString() + '원' : '-';

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page dashboard-page">
      <div className="page-header">
        <h2>대시보드</h2>
        <p className="greeting">안녕하세요, <strong>{user?.name}</strong>님!</p>
      </div>

      {/* Document Stats */}
      <div className="stats-grid">
        <div className="stat-card"><Files size={28} className="stat-icon" /><div className="stat-number">{stats.total}</div><div className="stat-label">전체 문서</div></div>
        <div className="stat-card stat-draft"><FilePlus size={28} className="stat-icon" /><div className="stat-number">{stats.draft}</div><div className="stat-label">작성중</div></div>
        <div className="stat-card stat-submitted"><FileText size={28} className="stat-icon" /><div className="stat-number">{stats.submitted}</div><div className="stat-label">제출</div></div>
        <div className="stat-card stat-approved"><FileCheck size={28} className="stat-icon" /><div className="stat-number">{stats.approved}</div><div className="stat-label">승인</div></div>
        <div className="stat-card stat-rejected"><FileX size={28} className="stat-icon" /><div className="stat-number">{stats.rejected}</div><div className="stat-label">반려</div></div>
      </div>

      {/* Bid Statistics (admin+ only) */}
      {isAdmin && bidStats && bidStats.total > 0 && (
        <section className="section">
          <h3 className="section-title"><TrendingUp size={18} style={{ marginRight: 6 }} /> 입찰 통계</h3>
          <div className="bid-stats-grid">
            <div className="bid-stat-card">
              <div className="bid-stat-value">{bidStats.total}</div>
              <div className="bid-stat-label">총 입찰 건수</div>
            </div>
            <div className="bid-stat-card">
              <div className="bid-stat-value">{fmtWon(bidStats.totalSuggested)}</div>
              <div className="bid-stat-label">총 제시입찰가</div>
            </div>
            <div className="bid-stat-card">
              <div className="bid-stat-value">{fmtWon(bidStats.totalActual)}</div>
              <div className="bid-stat-label">총 작성입찰가</div>
            </div>
            <div className="bid-stat-card">
              <div className="bid-stat-value">{fmtWon(bidStats.totalWin)}</div>
              <div className="bid-stat-label">총 낙찰가</div>
            </div>
            <div className="bid-stat-card">
              <div className="bid-stat-value">{bidStats.winRate > 0 ? bidStats.winRate.toFixed(1) + '%' : '-'}</div>
              <div className="bid-stat-label">낙찰가율 (낙찰/입찰)</div>
            </div>
            <div className="bid-stat-card">
              <div className="bid-stat-value">{bidStats.avgDeviation.toFixed(1)}%</div>
              <div className="bid-stat-label">평균 차이율 (제시↔실제)</div>
            </div>
            {bidStats.deviationOver5 > 0 && (
              <div className="bid-stat-card bid-stat-warning">
                <AlertTriangle size={20} className="bid-stat-warn-icon" />
                <div className="bid-stat-value">{bidStats.deviationOver5}건</div>
                <div className="bid-stat-label">5% 이상 차이 발생</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Recent Documents */}
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
