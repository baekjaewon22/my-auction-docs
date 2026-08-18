import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, CalendarDays, Clock3, FileText, Hash, RefreshCw, Scale, Search, UserRound, X } from 'lucide-react';
import { api, type LawitgoProgressItem } from '../api';

const PROGRESS_STAGES = ['사건 수임', '인도명령 신청', '인도명령 결정', '강제집행 신청', '강제집행 실시'];

function formatDate(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || '-';
  return date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatCacheTime(value: string): string {
  if (!value) return '';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function uiDocument(css: string, html: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https://www.lawitgo.com; font-src data: https://www.lawitgo.com; base-uri 'none'; form-action 'none';"><style>html,body{margin:0;padding:0;background:#fff;color:#202124;font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}*{box-sizing:border-box}${css}</style></head><body>${html}</body></html>`;
}

function isCompleted(item: LawitgoProgressItem): boolean {
  return /완료|종결|종료|closed|complete|done/i.test(`${item.status} ${item.statusLabel} ${item.stage} ${item.stageLabel}`);
}

function progressStageIndex(item: LawitgoProgressItem): number {
  const text = `${item.stage} ${item.stageLabel} ${item.progressSummary}`;
  if (/강제집행.*(실시|완료)|집행완료/.test(text)) return 4;
  if (/강제집행.*신청/.test(text)) return 3;
  if (/인도명령.*(결정|인용)/.test(text)) return 2;
  if (/인도명령.*신청/.test(text)) return 1;
  const numeric = Number(String(item.stage || '').match(/[1-5]/)?.[0]);
  if (numeric) return numeric - 1;
  return isCompleted(item) ? 4 : 0;
}

export default function LawitgoProgress() {
  const [items, setItems] = useState<LawitgoProgressItem[]>([]);
  const [refreshedAt, setRefreshedAt] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<{ item: LawitgoProgressItem; ui: { html: string; css: string }; refreshedAt: string; consultantStatement: { title: string; format: 'text'; content: string } | null } | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'completed' | 'all'>('active');

  const loadList = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.lawitgoProgress.list();
      const nextItems = result.items || [];
      setItems(nextItems);
      setRefreshedAt(result.refreshedAt || '');
      setSelectedId(current => nextItems.some(item => item.id === current) ? current : (nextItems[0]?.id || ''));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '사건 진행사항을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadList(); }, []);

  useEffect(() => {
    setStatementOpen(false);
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    api.lawitgoProgress.get(selectedId)
      .then(result => { if (!cancelled) setDetail(result); })
      .catch(loadError => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : '상세 진행사항을 불러오지 못했습니다.'); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const counts = useMemo(() => ({
    active: items.filter(item => !isCompleted(item)).length,
    completed: items.filter(isCompleted).length,
    all: items.length,
  }), [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().replace(/\s+/g, '').toLowerCase();
    return items.filter(item => {
      if (statusFilter === 'active' && isCompleted(item)) return false;
      if (statusFilter === 'completed' && !isCompleted(item)) return false;
      if (!normalizedQuery) return true;
      return [item.clientName, item.title, item.caseNumber, item.court, item.consultantName]
        .some(value => String(value || '').replace(/\s+/g, '').toLowerCase().includes(normalizedQuery));
    });
  }, [items, query, statusFilter]);

  useEffect(() => {
    if (filteredItems.length === 0) {
      if (selectedId) setSelectedId('');
      return;
    }
    if (!filteredItems.some(item => item.id === selectedId)) setSelectedId(filteredItems[0].id);
  }, [filteredItems, selectedId]);

  const selected = detail?.item || items.find(item => item.id === selectedId) || null;
  const srcDoc = useMemo(() => detail ? uiDocument(detail.ui.css, detail.ui.html) : '', [detail]);
  const stageIndex = selected ? progressStageIndex(selected) : 0;
  const currentStageLabel = selected ? (selected.stageLabel || PROGRESS_STAGES[stageIndex]) : '';

  return (
    <div className="page lawitgo-progress-page">
      <div className="lawitgo-workspace" aria-label="명도 진행사항">
        <aside className="lawitgo-case-sidebar">
          <div className="lawitgo-case-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="고객명, 사건번호 검색" /></div>
          <div className="lawitgo-case-tabs">
            <button className={statusFilter === 'active' ? 'active' : ''} onClick={() => setStatusFilter('active')}>진행 {counts.active}</button>
            <button className={statusFilter === 'completed' ? 'active' : ''} onClick={() => setStatusFilter('completed')}>완료 {counts.completed}</button>
            <button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setStatusFilter('all')}>전체 {counts.all}</button>
          </div>
          <div className="lawitgo-case-list" aria-label="명도 사건 목록">
            {loading ? <div className="lawitgo-list-message">불러오는 중...</div> : filteredItems.length === 0 ? <div className="lawitgo-list-message">표시할 사건이 없습니다.</div> : filteredItems.map(item => (
              <button key={item.id} type="button" className={`lawitgo-case-row${selectedId === item.id ? ' selected' : ''}`} onClick={() => { setSelectedId(item.id); setError(''); }}>
                <div><strong>{item.clientName || item.title}</strong><span>{item.statusLabel || item.stageLabel || '사건수임'}</span></div>
                <p>{[item.court, item.caseNumber].filter(Boolean).join(' ') || item.title}</p>
                <small>{formatDate(item.receivedAt || item.updatedAt)}{item.consultantName ? ` · ${item.consultantName}` : ''}</small>
              </button>
            ))}
          </div>
          <div className="lawitgo-sidebar-footer">
            <span>{refreshedAt ? `기준 ${formatCacheTime(refreshedAt)}` : '09·12·15·18시 갱신'}</span>
            <button type="button" onClick={loadList} disabled={loading} aria-label="새로고침"><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
          </div>
        </aside>

        <main className="lawitgo-case-detail">
          {error && <div className="lawitgo-progress-error">{error}</div>}
          {!selected ? (
            <div className="lawitgo-progress-empty"><BriefcaseBusiness size={34} /><strong>표시할 명도 진행 사건이 없습니다.</strong></div>
          ) : (
            <>
              <section className="lawitgo-summary-card">
                <header><span className="lawitgo-section-icon"><Scale size={19} /></span><div><h2>사건 기본 정보</h2><em>{selected.statusLabel || '상담 접수'}</em></div></header>
                <div className="lawitgo-basic-grid">
                  <div><UserRound size={15} /><span>의뢰인<strong>{selected.clientName || selected.title}</strong></span></div>
                  <div><FileText size={15} /><span>사건번호<strong>{selected.caseNumber || '-'}</strong></span></div>
                  <div><Hash size={15} /><span>사건 종류<strong>{selected.caseType || selected.stageLabel || '명도 사건'}</strong></span></div>
                  <div><CalendarDays size={15} /><span>접수일<strong>{formatDate(selected.receivedAt || selected.updatedAt)}</strong></span></div>
                </div>
              </section>

              <section className="lawitgo-summary-card lawitgo-stage-card">
                <header><span className="lawitgo-section-icon"><Clock3 size={19} /></span><div><h2>나의 사건 진행내용</h2></div></header>
                <div className="lawitgo-stage-track">
                  {PROGRESS_STAGES.map((label, index) => <div key={label} className={`${index < stageIndex ? 'done' : ''}${index === stageIndex ? ' current' : ''}`}><span>{index + 1}</span><strong>{label}</strong><small>{index === stageIndex ? '진행중' : index < stageIndex ? '완료' : '대기'}</small></div>)}
                </div>
              </section>

              <section className="lawitgo-summary-card lawitgo-current-card">
                <header><span className="lawitgo-section-icon"><BriefcaseBusiness size={19} /></span><div><h2>진행중</h2><em>{currentStageLabel}</em></div></header>
                <div className="lawitgo-current-summary"><b>{stageIndex + 1}</b><div><strong>{currentStageLabel}</strong><p>{selected.progressSummary || '담당자가 사건을 확인하고 다음 절차를 준비하고 있습니다.'}</p></div></div>
              </section>

              <section className="lawitgo-summary-card lawitgo-embedded-detail">
                <header><span className="lawitgo-section-icon"><FileText size={19} /></span><div><h2>상세 진행내역</h2></div></header>
                {detailLoading ? <div className="page-loading">상세 진행사항을 불러오는 중...</div> : detail ? <iframe className="lawitgo-progress-frame" title={`${selected.title} 진행사항`} sandbox="" srcDoc={srcDoc} /> : null}
              </section>

              {isCompleted(selected) && detail?.consultantStatement && (
                <section className="lawitgo-summary-card" style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setStatementOpen(true)}
                    style={{ minWidth: 180 }}
                  >
                    <FileText size={16} /> 결산내역서
                  </button>
                </section>
              )}
            </>
          )}
        </main>
      </div>
      {statementOpen && detail?.consultantStatement && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="결산내역서"
          onClick={() => setStatementOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1400, background: 'rgba(32,33,36,.52)', display: 'grid', placeItems: 'center', padding: 16 }}
        >
          <div onClick={event => event.stopPropagation()} style={{ width: 'min(680px, 100%)', maxHeight: '88vh', overflow: 'auto', background: '#fff', borderRadius: 14, boxShadow: '0 18px 50px rgba(0,0,0,.24)' }}>
            <header style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid #e8eaed', padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{detail.consultantStatement.title || '결산내역서'}</strong>
              <button type="button" onClick={() => setStatementOpen(false)} aria-label="닫기" style={{ border: 0, background: '#f1f3f4', width: 32, height: 32, borderRadius: 16, display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={17} /></button>
            </header>
            <pre style={{ margin: 0, padding: 20, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.7, color: '#202124' }}>{detail.consultantStatement.content}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
