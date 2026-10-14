import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Bell, CheckCircle2, ChevronDown, ChevronUp, Clipboard,
  ExternalLink, KeyRound, Newspaper, RefreshCw, Search, ShieldAlert,
} from 'lucide-react';
import { api } from '../api';
import { useAuthStore } from '../store';

type TabKey = 'summary' | 'all' | 'risk' | 'sources';
type Mention = {
  id: string; external_id: string; url: string; source_type: string; source_name: string; author?: string;
  published_at?: string | null; collected_at: string; title: string; snippet: string;
  matched_keywords: string[]; relevance: { label?: string; score?: number; reason?: string };
  sentiment: { label?: string; confidence?: number; reason?: string };
  risk: { level?: string; score?: number; categories?: string[]; reasons?: string[] };
  topics: string[]; engagement: { views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null };
  duplicate?: { similar_count?: number }; evidence: string[]; workflow_status: string;
};
type Digest = {
  id: string; report_date: string; summary: { status?: string; headline?: string; description?: string; what_changed?: string[]; what_to_check?: string[] };
  stats: Record<string, number | null>; urgent_mentions: Array<{ external_id: string; reason: string }>;
  top_topics: Array<{ key?: string; label?: string; count?: number; previous_count?: number | null; sentiment?: string }>;
  emerging_issues: Array<{ title?: string; count?: number; reason?: string }>;
  repeated_issues: Array<{ title?: string; count?: number; first_seen_at?: string }>;
  positive_mentions: Array<{ external_id?: string; reason?: string }>;
  source_breakdown: Array<{ source_type?: string; collected?: number; unique_mentions?: number; negative?: number }>;
  keyword_breakdown: Array<{ keyword?: string; count?: number }>;
  data_quality: string[];
};
type Run = { run_id: string; started_at: string; finished_at?: string; status: string; received_count: number; accepted_count: number; sources: Array<{ source?: string; status?: string; searched?: number; collected?: number; new_mentions?: number; error?: string | null }> };
type MentionKey = { id: string; name: string; token_prefix: string; last_used_at?: string | null; revoked_at?: string | null };

const RISK_LABELS: Record<string, string> = { critical: '긴급', high: '높음', watch: '주의', normal: '일반', unknown: '미확인' };
const SENTIMENT_LABELS: Record<string, string> = { positive: '긍정', neutral: '중립', negative: '부정', mixed: '혼합', unknown: '미확인' };
const WORKFLOW_LABELS: Record<string, string> = { unreviewed: '검토 전', reviewed: '확인 완료', action_required: '대응 필요', in_progress: '대응 중', resolved: '대응 완료', excluded: '관련 없음' };
const SOURCE_LABELS: Record<string, string> = { news: '뉴스', blog: '블로그', cafe: '카페', community: '커뮤니티', youtube: '유튜브', instagram: '인스타', x: 'X', facebook: '페이스북', other: '기타' };

function count(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('ko-KR') : '-';
}

function shortDate(value?: string | null) {
  if (!value) return '게시 시각 미확인';
  return value.replace('T', ' ').slice(0, 16);
}

export default function ExternalMentions() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';
  const [tab, setTab] = useState<TabKey>('summary');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [sentiment, setSentiment] = useState('');
  const [openDate, setOpenDate] = useState('');
  const [keyPanel, setKeyPanel] = useState(false);
  const [keys, setKeys] = useState<MentionKey[]>([]);
  const [keyName, setKeyName] = useState('Claude Cowork 외부 언급 수집');
  const [newToken, setNewToken] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [mentionResult, digestResult, runResult] = await Promise.all([
        api.mentions.list({ limit: 200 }), api.mentions.digests({ limit: 30 }), api.mentions.runs(20),
      ]);
      setMentions(mentionResult.mentions as Mention[]);
      setDigests(digestResult.digests as Digest[]);
      setRuns(runResult.runs as Run[]);
      if (!openDate && digestResult.digests[0]) setOpenDate(digestResult.digests[0].report_date);
    } catch (err: any) { setError(err?.message || '외부 언급 자료를 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const existing = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const previous = existing?.content;
    const robots = existing || document.head.appendChild(document.createElement('meta'));
    robots.name = 'robots'; robots.content = 'noindex,nofollow';
    return () => { if (!existing) robots.remove(); else robots.content = previous || ''; };
  }, []);

  const latest = digests[0];
  const stats = latest?.stats || {};
  const riskMentions = useMemo(() => mentions.filter((mention) => ['critical', 'high', 'watch'].includes(mention.risk?.level || '')), [mentions]);
  const visibleMentions = useMemo(() => mentions.filter((mention) => {
    if (tab === 'risk' && !['critical', 'high', 'watch'].includes(mention.risk?.level || '')) return false;
    if (source && mention.source_type !== source) return false;
    if (sentiment && mention.sentiment?.label !== sentiment) return false;
    const search = query.trim().toLowerCase();
    return !search || `${mention.title} ${mention.snippet} ${mention.source_name} ${mention.matched_keywords.join(' ')}`.toLowerCase().includes(search);
  }), [mentions, query, sentiment, source, tab]);

  const updateStatus = async (id: string, workflowStatus: string) => {
    await api.mentions.updateStatus(id, { workflow_status: workflowStatus });
    setMentions((current) => current.map((item) => item.id === id ? { ...item, workflow_status: workflowStatus } : item));
  };
  const loadKeys = async () => setKeys((await api.mentions.keys()).api_keys as MentionKey[]);
  const toggleKeys = async () => { const next = !keyPanel; setKeyPanel(next); if (next) await loadKeys(); };
  const createKey = async () => { const result = await api.mentions.createKey({ name: keyName }); setNewToken(result.token); await loadKeys(); };
  const revokeKey = async (id: string) => { if (!window.confirm('이 외부 언급 API 키를 폐기할까요?')) return; await api.mentions.revokeKey(id); await loadKeys(); };

  const renderMention = (mention: Mention) => <article className={`emm-mention risk-${mention.risk?.level || 'unknown'}`} key={mention.id}>
    <div className="emm-mention-meta"><span>{SOURCE_LABELS[mention.source_type] || mention.source_type}</span><b>{mention.source_name}</b><time>{shortDate(mention.published_at || mention.collected_at)}</time><em className={`sentiment-${mention.sentiment?.label || 'unknown'}`}>{SENTIMENT_LABELS[mention.sentiment?.label || 'unknown'] || '미확인'}</em></div>
    <div className="emm-mention-head"><div><strong>{mention.title}</strong><p>{mention.snippet}</p></div><span className={`emm-risk ${mention.risk?.level || 'unknown'}`}>{RISK_LABELS[mention.risk?.level || 'unknown'] || '미확인'}</span></div>
    {!!mention.risk?.reasons?.length && <div className="emm-reasons"><b>확인 이유</b>{mention.risk.reasons.map((reason, index) => <p key={index}>{reason}</p>)}</div>}
    <div className="emm-keywords">{mention.matched_keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}{(mention.duplicate?.similar_count || 0) > 1 && <span>유사 언급 {mention.duplicate?.similar_count}건</span>}</div>
    <div className="emm-mention-footer"><div><span>{WORKFLOW_LABELS[mention.workflow_status] || mention.workflow_status}</span>{mention.engagement?.views != null && <small>조회 {count(mention.engagement.views)}</small>}{mention.engagement?.comments != null && <small>댓글 {count(mention.engagement.comments)}</small>}</div><div className="emm-actions"><button onClick={() => void updateStatus(mention.id, 'reviewed')}><CheckCircle2 size={14} /> 확인 완료</button><button onClick={() => void updateStatus(mention.id, 'action_required')}><Bell size={14} /> 대응 필요</button><a href={mention.url} target="_blank" rel="noreferrer">원문 <ExternalLink size={13} /></a></div></div>
  </article>;

  return <div className="emm-page">
    <header className="emm-hero"><div><span>BRAND MONITORING CENTER</span><h1>마이옥션 외부 언급</h1><p>뉴스·블로그·카페·커뮤니티에서 마이옥션이 어떻게 언급되는지 매일 확인합니다.</p></div><div className="emm-hero-actions"><button onClick={() => void load()}><RefreshCw size={16} /> 새로고침</button>{isMaster && <button onClick={() => void toggleKeys()}><KeyRound size={16} /> 수신 API 키</button>}</div></header>

    {keyPanel && <section className="briefing-key-panel"><div className="briefing-section-title"><div><h3>외부 언급 전용 API 키</h3><p>주간 브리핑·오늘의 뉴스 키와 분리되며, 원문은 발급 직후 한 번만 표시됩니다.</p></div></div><div className="briefing-key-create"><input value={keyName} onChange={(event) => setKeyName(event.target.value)} aria-label="키 이름" /><button className="btn btn-primary" onClick={() => void createKey()}>새 키 발급</button></div>{newToken && <div className="briefing-token-once"><strong>지금 안전하게 보관하세요.</strong><code>{newToken}</code><button onClick={() => void navigator.clipboard.writeText(newToken)}><Clipboard size={15} /> 복사</button></div>}<div className="briefing-key-list">{keys.map((key) => <div key={key.id}><span><strong>{key.name}</strong><small>{key.token_prefix}… · 최근 사용 {key.last_used_at || '없음'}</small></span>{key.revoked_at ? <em>폐기됨</em> : <button onClick={() => void revokeKey(key.id)}>폐기</button>}</div>)}</div></section>}

    <nav className="emm-tabs" aria-label="외부 언급 화면 선택"><button className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}><Activity /> 오늘 요약</button><button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}><Newspaper /> 전체 언급</button><button className={tab === 'risk' ? 'active' : ''} onClick={() => setTab('risk')}><ShieldAlert /> 주의 언급 <b>{riskMentions.length}</b></button><button className={tab === 'sources' ? 'active' : ''} onClick={() => setTab('sources')}><Search /> 수집 상태</button></nav>

    {loading ? <div className="emm-state">외부 언급 자료를 불러오고 있습니다...</div> : error ? <div className="emm-state error">{error}</div> : <>
      {tab === 'summary' && <>
        <section className="emm-scorecards"><article><span>중복 제거 후 언급</span><strong>{count(stats.unique_mentions ?? mentions.length)}</strong><small>전체 수집 {count(stats.collected)}</small></article><article><span>즉시 확인</span><strong>{count((stats.critical || 0) + (stats.high || 0))}</strong><small>주의 {count(stats.watch)}</small></article><article><span>부정 언급</span><strong>{count(stats.negative)}</strong><small>긍정 {count(stats.positive)}</small></article><article><span>중복 제거</span><strong>{count(stats.duplicates_removed)}</strong><small>같은 내용 묶음</small></article></section>
        {latest ? <>
          <section className={`emm-summary status-${latest.summary?.status || 'normal'}`}><span>{latest.report_date} 종합 판단</span><h2>{latest.summary?.headline || '오늘의 종합 판단이 없습니다.'}</h2><p>{latest.summary?.description}</p></section>
          <section className="emm-change-grid"><article><h3>무엇이 달라졌나요?</h3>{(latest.summary?.what_changed || []).length ? latest.summary.what_changed?.map((item, index) => <p key={index}>{item}</p>) : <p>보고된 변화가 없습니다.</p>}</article><article><h3>무엇을 확인해야 하나요?</h3>{(latest.summary?.what_to_check || []).length ? latest.summary.what_to_check?.map((item, index) => <p key={index}>{item}</p>) : <p>현재 바로 확인할 사항이 없습니다.</p>}</article></section>
          {!!riskMentions.length && <section><div className="emm-section-head"><div><span>우선 검토</span><h2>오늘 바로 확인할 언급</h2></div><button onClick={() => setTab('risk')}>전체 보기</button></div><div className="emm-mention-list">{riskMentions.slice(0, 5).map(renderMention)}</div></section>}
          <section className="emm-digest-history"><div className="emm-section-head"><div><span>날짜별 기록</span><h2>일일 언급 브리핑</h2></div></div>{digests.map((digest) => { const open = openDate === digest.report_date; return <article className={open ? 'open' : ''} key={digest.id}><button onClick={() => setOpenDate(open ? '' : digest.report_date)}><time>{digest.report_date}</time><span><strong>{digest.summary?.headline}</strong><small>실제 언급 {count(digest.stats?.unique_mentions)}건 · 주의 이상 {count((digest.stats?.critical || 0) + (digest.stats?.high || 0) + (digest.stats?.watch || 0))}건</small></span>{open ? <ChevronUp /> : <ChevronDown />}</button>{open && <div className="emm-digest-body"><div><h4>많이 언급된 주제</h4>{digest.top_topics?.map((topic, index) => <p key={index}><b>{topic.label || topic.key}</b><span>{count(topic.count)}건</span></p>)}</div><div><h4>새로 나타난 내용</h4>{digest.emerging_issues?.length ? digest.emerging_issues.map((issue, index) => <p key={index}><b>{issue.title}</b><span>{issue.reason}</span></p>) : <p><span>특이사항 없음</span></p>}</div>{!!digest.data_quality?.length && <div className="quality"><h4>수집 확인 사항</h4>{digest.data_quality.map((item, index) => <p key={index}><span>{item}</span></p>)}</div>}</div>}</article>; })}</section>
        </> : <div className="emm-state">아직 수신된 일일 종합 보고가 없습니다. 개별 언급은 전체 언급 탭에서 확인할 수 있습니다.</div>}
      </>}

      {(tab === 'all' || tab === 'risk') && <section><div className="emm-section-head"><div><span>{tab === 'risk' ? '위험도 우선' : '수집 원문'}</span><h2>{tab === 'risk' ? '주의가 필요한 언급' : '전체 외부 언급'}</h2></div></div><div className="emm-filters"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목·내용·키워드 검색" /></label><select value={source} onChange={(event) => setSource(event.target.value)}><option value="">모든 출처</option>{Object.entries(SOURCE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select value={sentiment} onChange={(event) => setSentiment(event.target.value)}><option value="">모든 반응</option>{Object.entries(SENTIMENT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><div className="emm-mention-list">{visibleMentions.length ? visibleMentions.map(renderMention) : <div className="emm-state">조건에 맞는 외부 언급이 없습니다.</div>}</div></section>}

      {tab === 'sources' && <section><div className="emm-section-head"><div><span>자동 수집 확인</span><h2>최근 수집 실행 상태</h2></div></div><div className="emm-run-list">{runs.length ? runs.map((run) => <article key={run.run_id}><header><div><strong>{run.run_id}</strong><time>{shortDate(run.started_at)}</time></div><span className={run.status}>{run.status === 'success' ? '정상' : run.status === 'partial' ? '일부 실패' : run.status === 'failed' ? '실패' : '실행 중'}</span></header><p>수신 {count(run.received_count)}건 · 중복 정리 후 {count(run.accepted_count)}건</p><div>{run.sources?.map((item, index) => <span className={item.status === 'failed' ? 'failed' : ''} key={`${item.source}-${index}`}><b>{item.source}</b> {item.status === 'failed' ? item.error || '수집 실패' : `신규 ${count(item.new_mentions)}건`}</span>)}</div></article>) : <div className="emm-state">아직 수집 실행 기록이 없습니다.</div>}</div></section>}
    </>}
  </div>;
}
