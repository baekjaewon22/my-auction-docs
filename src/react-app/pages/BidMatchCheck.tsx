import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';

const PAGE_SIZE = 10;
const PAGE_WINDOW = 5;

type MatchData = {
  briefing_unmatched: BriefingUnmatchedRow[];
  analysis_unmatched: unknown[];
  counts: {
    briefing_total: number;
    analysis_total: number;
    briefing_unmatched: number;
    analysis_unmatched: number;
  };
};

type BriefingUnmatchedRow = {
  id: string;
  target_date: string;
  case_number: string;
  item_no?: string;
  client_name?: string;
  court?: string;
  assignee_name?: string;
  assignee_branch?: string;
  assignee_department?: string;
};

function dateOnly(value: string) {
  return String(value || '').slice(0, 10) || '-';
}

export default function BidMatchCheck() {
  const [data, setData] = useState<MatchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.adminNotes.bidMatchCheck());
      setPage(1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const briefing = data?.briefing_unmatched || [];
  const totalPages = Math.max(1, Math.ceil(briefing.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageGroupStart = Math.floor((currentPage - 1) / PAGE_WINDOW) * PAGE_WINDOW + 1;
  const visiblePages = Array.from(
    { length: Math.min(PAGE_WINDOW, totalPages - pageGroupStart + 1) },
    (_, index) => pageGroupStart + index,
  );
  const visibleBriefing = briefing.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="bid-match-check">
      <div className="bid-match-summary">
        <div>
          <span>분석 누락</span>
          <strong>{data?.counts.briefing_unmatched ?? 0}</strong>
        </div>
        <div>
          <span>브리핑자료 제출 전체</span>
          <strong>{data?.counts.briefing_total ?? 0}</strong>
        </div>
        <div>
          <span>입찰분석 전체</span>
          <strong>{data?.counts.analysis_total ?? 0}</strong>
        </div>
        <button className="btn btn-primary" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      <div className="bid-match-grid bid-match-grid-single">
        <section className="bid-match-panel">
          <h3>브리핑자료는 제출됐으나 입찰분석에 없는 건</h3>
          <div className="bid-match-list">
            {visibleBriefing.map(row => (
              <div key={row.id} className="bid-match-item">
                <div>
                  <strong>{row.case_number || '-'}</strong>
                  {row.item_no && <span className="bid-match-muted">물건 {row.item_no}</span>}
                </div>
                <p>{row.client_name || '-'} · {row.court || '-'}</p>
                <div className="bid-match-assignee">
                  <span>담당자</span>
                  <strong>{row.assignee_name || '미확인'}</strong>
                  {(row.assignee_branch || row.assignee_department) && (
                    <small>{[row.assignee_branch, row.assignee_department].filter(Boolean).join(' · ')}</small>
                  )}
                </div>
                <small>{dateOnly(row.target_date)} · 브리핑자료 제출</small>
              </div>
            ))}
            {!loading && briefing.length === 0 && <div className="empty-state">누락 건이 없습니다.</div>}
            {loading && <div className="empty-state">확인 중...</div>}
          </div>
          {!loading && briefing.length > 0 && (
            <div className="bid-match-pagination" aria-label="분석 누락 목록 페이지 이동">
              <span>총 {briefing.length.toLocaleString('ko-KR')}건 · {currentPage}/{totalPages}페이지</span>
              <div className="bid-analysis-pages">
                {pageGroupStart > 1 && (
                  <button
                    type="button"
                    className="prev-group"
                    onClick={() => setPage(Math.max(1, pageGroupStart - PAGE_WINDOW))}
                    aria-label="이전 페이지 묶음"
                  >
                    ‹
                  </button>
                )}
                {visiblePages.map(pageNumber => (
                  <button
                    key={pageNumber}
                    type="button"
                    className={currentPage === pageNumber ? 'active' : ''}
                    onClick={() => setPage(pageNumber)}
                    aria-current={currentPage === pageNumber ? 'page' : undefined}
                  >
                    {pageNumber}
                  </button>
                ))}
                {pageGroupStart + PAGE_WINDOW - 1 < totalPages && (
                  <button
                    type="button"
                    className="next-group"
                    onClick={() => setPage(pageGroupStart + PAGE_WINDOW)}
                    aria-label="다음 페이지 묶음"
                  >
                    ›
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
