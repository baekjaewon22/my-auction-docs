import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, BarChart3, Check, Clipboard, KeyRound, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../api';
import { useAuthStore } from '../store';

type CheckStatus = 'done' | 'pending' | 'partial';
type Briefing = {
  id: string; report_key: string; site: string; type: 'weekly' | 'monthly'; report_date: string;
  period_start: string; period_end: string; title: string; summary: string;
  kpis: Record<string, number | null>;
  highlights: Array<{ label: string; value: number | null; previous?: number | null; baseline?: number | null; note?: string }>;
  warnings: Array<{ level: 'warn' | 'info'; text: string }>;
  checks: Array<{ key: string; item: string; status: CheckStatus; evidence?: string }>;
  todos: string[]; reels: Array<Record<string, unknown>>; channels: Array<Record<string, unknown>>;
  devices: Array<Record<string, unknown>>; landing: Record<string, unknown> | Array<Record<string, unknown>>;
  audience: Array<Record<string, unknown>>; corrections: Array<Record<string, unknown> | string>;
  notes: string[]; content_md: string; html?: string | null; revision: number;
};
type BriefingKey = { id: string; name: string; site: string | null; token_prefix: string; last_used_at: string | null; revoked_at: string | null; created_at: string };

const KPI_CONFIG = [
  { key: 'signups_per_day', label: '일평균 가입', percent: false },
  { key: 'direct_share', label: '직접 가입 비중', percent: true },
  { key: 'ig_followers', label: '인스타 팔로워', percent: false },
  { key: 'ig_reach_avg', label: '인스타 일평균 도달', percent: false },
  { key: 'desktop_cvr', label: 'PC 전환율', percent: true },
  { key: 'mobile_cvr', label: '모바일 전환율', percent: true },
  { key: 'app_webview_signups', label: '앱웹뷰 가입', percent: false },
  { key: 'new_user_signups', label: '신규 사용자 가입', percent: false },
  { key: 'pc_main_landing_sessions', label: 'PC 메인 유입', percent: false },
] as const;
const SITE_LABELS: Record<string, string> = { myauction: '마이옥션', myeongseung: '명승', sevenstars: '세븐스타즈' };

function formatValue(value: unknown, percent = false) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (percent) return `${(number * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
  return number.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${36 - ((value - min) / range) * 30}`).join(' ');
  return <svg className="briefing-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>;
}

function MarkdownContent({ source }: { source: string }) {
  const nodes: React.ReactNode[] = []; let list: string[] = [];
  const flushList = () => { if (list.length) { nodes.push(<ul key={`list-${nodes.length}`}>{list.map((item, index) => <li key={index}>{item}</li>)}</ul>); list = []; } };
  source.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trimEnd(); const listMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (listMatch) { list.push(listMatch[1]); return; }
    flushList(); if (!line.trim()) return;
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const Tag = `h${heading[1].length}` as 'h1' | 'h2' | 'h3' | 'h4';
      nodes.push(<Tag key={index}>{heading[2]}</Tag>);
    } else if (line.startsWith('> ')) nodes.push(<blockquote key={index}>{line.slice(2)}</blockquote>);
    else nodes.push(<p key={index}>{line}</p>);
  });
  flushList(); return <div className="briefing-markdown">{nodes}</div>;
}

function BriefingList() {
  const { user } = useAuthStore(); const navigate = useNavigate(); const { site: routeSite } = useParams(); const [searchParams, setSearchParams] = useSearchParams();
  const site = routeSite || searchParams.get('site') || 'myauction'; const type = (searchParams.get('type') || 'weekly') as 'weekly' | 'monthly';
  const [items, setItems] = useState<Briefing[]>([]); const [availableSites, setAvailableSites] = useState<string[]>(['myauction']); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [keyPanel, setKeyPanel] = useState(false); const [keys, setKeys] = useState<BriefingKey[]>([]); const [newToken, setNewToken] = useState('');
  const [keyName, setKeyName] = useState('마케팅 주간 브리핑 자동화'); const isMaster = user?.role === 'master';
  const load = async () => { setLoading(true); setError(''); try { const [result, all] = await Promise.all([api.briefings.list({ site, type, limit: 20 }), api.briefings.list({ limit: 100 })]); setItems(result.briefings as Briefing[]); setAvailableSites([...new Set(['myauction', ...all.briefings.map((item: Briefing) => item.site)])]); } catch (err: any) { setError(err?.message || '브리핑을 불러오지 못했습니다.'); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [site, type]);
  const trendItems = items.slice(0, 12).reverse();
  const loadKeys = async () => { if (isMaster) setKeys((await api.briefings.keys()).api_keys as BriefingKey[]); };
  const toggleKeys = async () => { const next = !keyPanel; setKeyPanel(next); if (next) await loadKeys(); };
  const createKey = async () => { const result = await api.briefings.createKey({ name: keyName, site }); setNewToken(result.token); await loadKeys(); };
  const revokeKey = async (id: string) => { if (!window.confirm('이 API 키를 폐기할까요? 폐기 후에는 복구할 수 없습니다.')) return; await api.briefings.revokeKey(id); await loadKeys(); };
  return <div className="briefings-page">
    <header className="briefings-hero"><div><span className="briefings-kicker">MARKETING INTELLIGENCE</span><h2>마이옥션 주간 브리핑</h2><p>매주 수집된 마케팅 흐름과 실행 과제를 한눈에 확인합니다.</p></div><div className="briefings-hero-actions"><button className="btn btn-secondary" onClick={load}><RefreshCw size={16} /> 새로고침</button>{isMaster && <button className="btn btn-secondary" onClick={toggleKeys}><KeyRound size={16} /> API 키 관리</button>}</div></header>
    {keyPanel && <section className="briefing-key-panel"><div className="briefing-section-title"><div><h3>수신 API 키</h3><p>원문 키는 발급 직후 한 번만 표시됩니다.</p></div></div><div className="briefing-key-create"><input value={keyName} onChange={(event) => setKeyName(event.target.value)} aria-label="키 이름" /><button className="btn btn-primary" onClick={createKey}>새 키 발급</button></div>{newToken && <div className="briefing-token-once"><strong>지금 안전하게 보관하세요.</strong><code>{newToken}</code><button onClick={() => navigator.clipboard.writeText(newToken)}><Clipboard size={15} /> 복사</button></div>}<div className="briefing-key-list">{keys.map((key) => <div key={key.id}><span><strong>{key.name}</strong><small>{key.token_prefix}… · {key.site || '전체 사이트'} · 최근 사용 {key.last_used_at || '없음'}</small></span>{key.revoked_at ? <em>폐기됨</em> : <button onClick={() => revokeKey(key.id)}>폐기</button>}</div>)}</div></section>}
    <div className="briefing-filter-row"><div className="briefing-tabs">{availableSites.map((value) => <button key={value} className={site === value ? 'active' : ''} onClick={() => navigate(`/briefings/${value}?type=${type}`)}>{SITE_LABELS[value] || value}</button>)}</div><div className="briefing-type-toggle"><button className={type === 'weekly' ? 'active' : ''} onClick={() => setSearchParams({ type: 'weekly' })}>주간</button><button className={type === 'monthly' ? 'active' : ''} onClick={() => setSearchParams({ type: 'monthly' })}>월간</button></div></div>
    <section className="briefing-kpi-grid">{KPI_CONFIG.map((config) => { const values = trendItems.map((item) => item.kpis?.[config.key]).filter((value): value is number => typeof value === 'number'); if (!values.length) return null; const latest = values[values.length - 1]; const previous = values.length > 1 ? values[values.length - 2] : undefined; const delta = previous === undefined || previous === 0 ? null : ((latest - previous) / Math.abs(previous)) * 100; return <article className="briefing-kpi-card" key={config.key}><span>{config.label}</span><strong>{formatValue(latest, config.percent)}</strong>{delta !== null && <small className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}% 전회 대비</small>}<Sparkline values={values} /></article>; })}</section>
    <section className="briefing-list-section"><div className="briefing-section-title"><div><h3>브리핑 회차</h3><p>최신 보고서부터 표시됩니다.</p></div><BarChart3 size={20} /></div>{loading ? <div className="briefing-state">불러오는 중...</div> : error ? <div className="briefing-state error">{error}</div> : !items.length ? <div className="briefing-state">아직 수신된 브리핑이 없습니다.</div> : <div className="briefing-list">{items.map((item) => <button key={item.id} onClick={() => navigate(`/briefings/${item.site}/${item.report_date}`)}><time>{item.report_date}</time><span><strong>{item.title}</strong><small>{item.summary}</small></span><span className="briefing-list-badges">{item.warnings?.length > 0 && <em className="warn"><AlertTriangle size={12} /> {item.warnings.length}</em>}{item.type === 'monthly' && <em>월간</em>}<ArrowRight size={17} /></span></button>)}</div>}</section>
  </div>;
}

function DataTable({ rows, kind }: { rows: Array<Record<string, any>>; kind: 'channels' | 'reels' }) {
  if (!rows.length) return null;
  const columns = kind === 'channels' ? [['source_medium', '채널'], ['sessions', '세션'], ['conversions', '전환'], ['cvr', '전환율'], ['prev_sessions', '직전 세션'], ['prev_conversions', '직전 전환']] : [['date', '날짜'], ['hook', '훅'], ['views', '조회'], ['reach', '도달'], ['saved', '저장'], ['shares', '공유'], ['formula_ok', '공식 적용']];
  return <div className="briefing-table-wrap"><table><thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map(([key]) => <td key={key}>{typeof row[key] === 'number' ? formatValue(row[key], key === 'cvr') : typeof row[key] === 'boolean' ? (row[key] ? '예' : '아니오') : String(row[key] ?? '-')}</td>)}</tr>)}</tbody></table></div>;
}

function objectRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>;
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) =>
      item && typeof item === 'object' ? { segment: key, ...(item as Record<string, unknown>) } : { segment: key, value: item });
  }
  return [];
}

const ANALYTICS_LABELS: Record<string, string> = {
  segment: '구분', device: '기기', device_category: '기기', audience: '사용자', user_type: '사용자',
  sessions: '세션', users: '사용자 수', signups: '가입', conversions: '전환', cvr: '전환율',
  new_users: '신규', returning_users: '재방문', share: '비중', value: '값',
};

function AnalyticsTable({ title, value }: { title: string; value: unknown }) {
  const rows = objectRows(value);
  if (!rows.length) return null;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return <section className="briefing-analytics-card"><h4>{title}</h4><div className="briefing-table-wrap"><table><thead><tr>{columns.map((key) => <th key={key}>{ANALYTICS_LABELS[key] || key}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((key) => <td key={key}>{typeof row[key] === 'number' ? formatValue(row[key], key === 'cvr' || key === 'share') : String(row[key] ?? '-')}</td>)}</tr>)}</tbody></table></div></section>;
}

function LandingBars({ landing, kpis }: { landing: Briefing['landing']; kpis: Briefing['kpis'] }) {
  const raw = objectRows(landing);
  const aliases: Record<string, string> = { pc: 'PC', desktop: 'PC', pc_signups: 'PC', desktop_signups: 'PC', mobile: '모바일웹', mobile_web: '모바일웹', mobile_web_signups: '모바일웹', app: '앱웹뷰', app_webview: '앱웹뷰', app_webview_signups: '앱웹뷰' };
  const bars = raw.map((row) => {
    const rawLabel = String(row.label ?? row.name ?? row.segment ?? row.device ?? '');
    const key = rawLabel.toLowerCase();
    const value = Number(row.signups ?? row.conversions ?? row.value ?? row.count);
    return { label: aliases[key] || rawLabel, value };
  }).filter((item) => item.label && Number.isFinite(item.value));
  if (!bars.some((item) => item.label === '앱웹뷰') && typeof kpis.app_webview_signups === 'number') bars.push({ label: '앱웹뷰', value: kpis.app_webview_signups });
  if (!bars.length) return null;
  const max = Math.max(...bars.map((item) => item.value), 1);
  return <section className="briefing-analytics-card"><h4>PC·모바일웹·앱웹뷰 가입</h4><div className="briefing-signup-bars">{bars.map((item) => <div key={item.label}><span>{item.label}</span><div><i style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }} /></div><strong>{formatValue(item.value)}</strong></div>)}</div></section>;
}

function Corrections({ items }: { items: Briefing['corrections'] }) {
  if (!items?.length) return null;
  return <section className="briefing-corrections"><h3>데이터 보정 내역</h3>{items.map((item, index) => <p key={index}>{typeof item === 'string' ? item : String(item.text ?? item.note ?? item.description ?? JSON.stringify(item))}</p>)}</section>;
}

function BriefingDetail() {
  const { site = 'myauction', reportDate = '' } = useParams(); const [data, setData] = useState<{ briefing: Briefing; previous?: any; next?: any; previous_checks: Briefing['checks'] } | null>(null); const [error, setError] = useState(''); const [tab, setTab] = useState<'report' | 'html'>('report');
  useEffect(() => { api.briefings.byDate(site, reportDate).then((result) => setData(result as any)).catch((err) => setError(err?.message || '브리핑을 불러오지 못했습니다.')); }, [site, reportDate]);
  if (error) return <div className="briefings-page"><div className="briefing-state error">{error}</div></div>; if (!data) return <div className="briefings-page"><div className="briefing-state">불러오는 중...</div></div>;
  const item = data.briefing; const previousStatus = new Map((data.previous_checks || []).map((check) => [check.key, check.status]));
  return <div className="briefings-page briefing-detail-page"><div className="briefing-detail-nav"><Link to={`/briefings?site=${site}&type=${item.type}`}><ArrowLeft size={16} /> 목록</Link><div>{data.previous && <Link to={`/briefings/${site}/${data.previous.report_date}`}><ArrowLeft size={15} /> 이전</Link>}{data.next && <Link to={`/briefings/${site}/${data.next.report_date}`}>다음 <ArrowRight size={15} /></Link>}<button onClick={() => navigator.clipboard.writeText(item.content_md)}><Clipboard size={15} /> 원문 복사</button></div></div>
    <header className="briefing-detail-hero"><span>{SITE_LABELS[item.site] || item.site} · {item.type === 'monthly' ? '월간 정밀 분석' : '주간 브리핑'}</span><h2>{item.title}</h2><time>{item.period_start} — {item.period_end}</time><p>{item.summary}</p></header>
    {!!item.warnings.length && <section className="briefing-warning-box"><h3><AlertTriangle size={18} /> 확인이 필요한 항목</h3>{item.warnings.map((warning, index) => <p key={index}>{warning.text}</p>)}</section>}
    {!!item.highlights.length && <section><div className="briefing-section-title"><h3>큰 변화</h3></div><div className="briefing-highlight-grid">{item.highlights.slice(0, 3).map((highlight, index) => <article key={index}><span>{highlight.label}</span><strong>{formatValue(highlight.value)}</strong>{highlight.previous !== undefined && <small>직전 {formatValue(highlight.previous)}</small>}<p>{highlight.note}</p></article>)}</div></section>}
    {!!item.checks.length && <section className="briefing-check-section"><div className="briefing-section-title"><h3>개발·광고 진행 체크</h3></div><div className="briefing-check-list">{item.checks.map((check) => { const changed = previousStatus.has(check.key) && previousStatus.get(check.key) !== check.status; return <article key={check.key} className={`${check.status} ${changed ? 'changed' : ''}`}><span className="check-icon">{check.status === 'done' ? <Check /> : check.status === 'pending' ? <XCircle /> : '◐'}</span><div><strong>{check.item}{changed && <em>상태 변경</em>}</strong><p>{check.evidence}</p></div></article>; })}</div></section>}
    {!!item.todos.length && <section className="briefing-todos"><div className="briefing-section-title"><h3>이번 주 할 일</h3></div><ol>{item.todos.map((todo, index) => <li key={index}><span>{index + 1}</span>{todo}</li>)}</ol></section>}
    {!!item.notes.length && <section className="briefing-notes">{item.notes.map((note, index) => <p key={index}>※ {note}</p>)}</section>}
    {(objectRows(item.devices).length > 0 || objectRows(item.landing).length > 0 || objectRows(item.audience).length > 0 || typeof item.kpis.app_webview_signups === 'number') && <section className="briefing-analytics-section"><div className="briefing-section-title"><h3>애널리틱스</h3></div><div className="briefing-analytics-grid"><AnalyticsTable title="기기별 성과" value={item.devices} /><LandingBars landing={item.landing} kpis={item.kpis} /><AnalyticsTable title="신규·재방문" value={item.audience} /></div></section>}
    <Corrections items={item.corrections} />
    <DataTable rows={item.channels} kind="channels" /><DataTable rows={item.reels} kind="reels" />
    {item.html && <div className="briefing-content-tabs"><button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>리포트 전문</button><button className={tab === 'html' ? 'active' : ''} onClick={() => setTab('html')}>HTML 리포트</button></div>}{tab === 'report' ? <section className="briefing-report-content"><MarkdownContent source={item.content_md} /></section> : <iframe className="briefing-html-frame" title="월간 HTML 리포트" sandbox="" srcDoc={item.html || ''} />}
  </div>;
}

export default function MarketingBriefings() {
  const { reportDate } = useParams();
  useEffect(() => {
    let robots = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const created = !robots;
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    const previous = robots.content;
    robots.content = 'noindex, nofollow';
    return () => {
      if (created) robots?.remove();
      else if (robots) robots.content = previous;
    };
  }, []);
  return reportDate ? <BriefingDetail /> : <BriefingList />;
}
