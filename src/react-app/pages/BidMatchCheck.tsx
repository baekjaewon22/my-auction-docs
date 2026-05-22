import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';

type MatchData = {
  briefing_unmatched: any[];
  analysis_unmatched: any[];
  counts: {
    briefing_total: number;
    analysis_total: number;
    briefing_unmatched: number;
    analysis_unmatched: number;
  };
};

function dateOnly(value: string) {
  return String(value || '').slice(0, 10) || '-';
}

export default function BidMatchCheck() {
  const [data, setData] = useState<MatchData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.adminNotes.bidMatchCheck());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const briefing = data?.briefing_unmatched || [];

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
            {briefing.map(row => (
              <div key={row.id} className="bid-match-item">
                <div>
                  <strong>{row.case_number || '-'}</strong>
                  {row.item_no && <span className="bid-match-muted">물건 {row.item_no}</span>}
                </div>
                <p>{row.client_name || '-'} · {row.court || '-'}</p>
                <small>{dateOnly(row.target_date)} · 브리핑자료 제출</small>
              </div>
            ))}
            {!loading && briefing.length === 0 && <div className="empty-state">누락 건이 없습니다.</div>}
            {loading && <div className="empty-state">확인 중...</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
