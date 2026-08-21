import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { AuctionStoryAnomaly, AuctionStoryStage } from '../api';

const STAGE_LABELS: Record<AuctionStoryStage, string> = {
  inspection: '임장',
  briefing: '브리핑자료 제출',
  bid: '입찰',
};

function currentKstMonth(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function branchClass(branch: string): string {
  if (branch.includes('서초')) return 'seocho';
  if (branch.includes('부산')) return 'busan';
  if (branch.includes('대전')) return 'daejeon';
  return 'uijeongbu';
}

function StageState({ label, date, missing }: { label: string; date: string; missing: boolean }) {
  return (
    <div className={`auction-story-stage ${missing ? 'missing' : 'complete'}`}>
      {missing ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
      <span>{label}</span>
      <small>{missing ? '누락' : date || '등록'}</small>
    </div>
  );
}

export default function AuctionStoryAnomalies() {
  const [month, setMonth] = useState(currentKstMonth);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [availableBranches, setAvailableBranches] = useState<string[]>([]);
  const [anomalies, setAnomalies] = useState<AuctionStoryAnomaly[]>([]);
  const [counts, setCounts] = useState({ total: 0, missing_inspection: 0, missing_briefing: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.personalCalendar.storyAnomalies({ month, branch: selectedBranch || undefined });
      setAvailableBranches(result.available_branches || []);
      setSelectedBranch(result.selected_branch || '');
      setAnomalies(result.anomalies || []);
      setCounts(result.counts || { total: 0, missing_inspection: 0, missing_briefing: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : '관리자 페이지를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [month, selectedBranch]);

  useEffect(() => { void load(); }, [load]);

  const branchOptions = useMemo(() => (
    availableBranches.length === 4 ? ['all', ...availableBranches] : availableBranches
  ), [availableBranches]);

  return (
    <div className="page auction-story-anomaly-page">
      <div className="page-header auction-story-anomaly-header">
        <div>
          <Link to="/personal-calendar" className="auction-story-back"><ArrowLeft size={16} /> 캘린더</Link>
          <h2><AlertTriangle size={23} /> 입찰 스토리 관리자 페이지</h2>
          <p>입찰 일정은 있으나 임장 또는 브리핑자료 제출이 누락된 사건만 표시합니다.</p>
        </div>
        <div className="auction-story-controls">
          <label><CalendarDays size={16} /><input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label>
          <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> 새로고침</button>
        </div>
      </div>

      {branchOptions.length > 0 && (
        <div className="auction-story-branch-tabs" role="tablist" aria-label="관리 지사 선택">
          {branchOptions.map(branch => (
            <button
              type="button"
              role="tab"
              aria-selected={selectedBranch === branch}
              className={selectedBranch === branch ? 'active' : ''}
              key={branch}
              onClick={() => setSelectedBranch(branch)}
            >
              {branch === 'all' ? '전체 지사' : branch}
            </button>
          ))}
        </div>
      )}

      <div className="auction-story-summary">
        <div><span>관리 대상</span><strong>{counts.total}</strong></div>
        <div><span>임장 누락</span><strong>{counts.missing_inspection}</strong></div>
        <div><span>브리핑자료 누락</span><strong>{counts.missing_briefing}</strong></div>
      </div>

      {error && <div className="auction-story-error">{error}</div>}
      {loading ? (
        <div className="page-loading">관리 대상을 확인하는 중입니다.</div>
      ) : anomalies.length === 0 ? (
        <div className="auction-story-empty"><CheckCircle2 size={28} /><strong>관리 대상이 없습니다.</strong><span>선택한 기간의 입찰 일정에는 임장과 브리핑자료가 모두 등록되어 있습니다.</span></div>
      ) : (
        <div className="auction-story-list">
          {anomalies.map(item => (
            <article className="auction-story-card" key={item.id}>
              <header>
                <div>
                  <span className={`auction-story-branch ${branchClass(item.branch)}`}>{item.branch}</span>
                  <strong>{item.assignee_name}</strong>
                  <small>{item.position_title || '직책 미등록'}</small>
                </div>
                <time>{item.reference_date}</time>
              </header>
              <div className="auction-story-case">
                <div><span>물건</span><strong>{item.property_category || '-'}</strong></div>
                <div><span>고객명</span><strong>{item.client_name || '-'}</strong></div>
                <div><span>법원</span><strong>{item.court || '-'}</strong></div>
                <div><span>사건번호</span><strong>{item.case_no || '-'}{item.item_no ? ` · 물건번호 ${item.item_no}` : ''}</strong></div>
              </div>
              <div className="auction-story-stages">
                <StageState label="임장" date={item.inspection_date} missing={item.missing_stages.includes('inspection')} />
                <StageState label="브리핑자료 제출" date={item.briefing_date} missing={item.missing_stages.includes('briefing')} />
                <StageState label="입찰" date={item.bid_date} missing={item.missing_stages.includes('bid')} />
              </div>
              <footer>
                <span>누락 항목</span>
                {item.missing_stages.map(stage => <strong key={stage}>{STAGE_LABELS[stage]}</strong>)}
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
