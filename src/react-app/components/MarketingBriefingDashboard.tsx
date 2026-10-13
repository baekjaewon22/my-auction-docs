import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, ChevronDown, ChevronUp,
  Camera, Clipboard, KeyRound, PlayCircle, RefreshCw, Search,
} from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../store';
import briefingHero from '../assets/marketing-briefing-hero.jpg';
import instagramLogo from '../../../instar.jpg';
import naverLogo from '../../../naver.jpg';
import youtubeLogo from '../../../youtube.jpg';

type TabKey = 'overview' | 'analytics' | 'youtube' | 'instagram' | 'naver';
type Briefing = {
  id: string;
  site: string;
  type: 'weekly' | 'monthly';
  report_date: string;
  period_start: string;
  period_end: string;
  title: string;
  summary: string;
  kpis: Record<string, number | null>;
  highlights?: Array<{ label: string; value: number | null; previous?: number | null; note?: string }>;
  warnings?: Array<{ level?: string; text: string }>;
  checks?: Array<{ key: string; item: string; status: 'done' | 'pending' | 'partial'; evidence?: string }>;
  todos?: string[];
  channels?: Array<Record<string, unknown>>;
  reels?: Array<Record<string, unknown>>;
  devices?: Array<Record<string, unknown>>;
  landing?: Record<string, unknown> | Array<Record<string, unknown>>;
  audience?: Array<Record<string, unknown>>;
  content_md?: string;
};
type DetailResponse = { briefing: Briefing; previous_checks?: Briefing['checks'] };
type BriefingKey = { id: string; name: string; site: string | null; token_prefix: string; last_used_at: string | null; revoked_at: string | null };

const TABS: Array<{ key: TabKey; label: string; icon: typeof BarChart3; description: string; logo?: string }> = [
  { key: 'overview', label: '종합', icon: BarChart3, description: '전체 광고·마케팅 상태' },
  { key: 'analytics', label: 'Google 애널리틱스', icon: Activity, description: '유입·UTM·가입 변화' },
  { key: 'youtube', label: '유튜브', icon: PlayCircle, description: '조회수·인기 콘텐츠', logo: youtubeLogo },
  { key: 'instagram', label: '인스타', icon: Camera, description: '도달·조회·반응', logo: instagramLogo },
  { key: 'naver', label: '네이버센터', icon: Search, description: '검색광고·키워드 점검', logo: naverLogo },
];

const METRICS: Array<{ key: string; label: string; tab: TabKey; percent?: boolean; lowerBetter?: boolean; help: string }> = [
  { key: 'signups', label: '전체 가입', tab: 'overview', help: '선택 기간에 새로 가입한 전체 인원입니다.' },
  { key: 'signups_per_day', label: '하루 평균 가입', tab: 'overview', help: '매일 평균 몇 명이 가입했는지 보여줍니다.' },
  { key: 'direct_share', label: '출처 미확인 비중', tab: 'analytics', percent: true, lowerBetter: true, help: '어디서 방문했는지 확인하기 어려운 가입 비중입니다. 낮을수록 광고 판단이 정확합니다.' },
  { key: 'google_organic_signups', label: '구글 자연검색 가입', tab: 'analytics', help: '광고가 아닌 구글 검색을 통해 가입한 수입니다.' },
  { key: 'new_user_signups', label: '신규 사용자 가입', tab: 'analytics', help: '처음 방문한 사용자 중 가입한 수입니다.' },
  { key: 'desktop_cvr', label: 'PC 가입 전환율', tab: 'analytics', percent: true, help: 'PC 방문자 중 가입까지 완료한 비율입니다.' },
  { key: 'mobile_cvr', label: '모바일 가입 전환율', tab: 'analytics', percent: true, help: '모바일 방문자 중 가입까지 완료한 비율입니다.' },
  { key: 'youtube_sessions', label: '유튜브 유입', tab: 'youtube', help: '유튜브를 보고 홈페이지로 들어온 방문 수입니다.' },
  { key: 'ig_followers', label: '팔로워', tab: 'instagram', help: '현재 인스타그램을 구독하는 사람 수입니다.' },
  { key: 'ig_reach_avg', label: '하루 평균 도달', tab: 'instagram', help: '콘텐츠를 본 계정 수의 하루 평균입니다.' },
  { key: 'reels_views_avg', label: '릴스 평균 조회', tab: 'instagram', help: '최근 릴스가 평균적으로 재생된 횟수입니다.' },
  { key: 'naver_search_cvr', label: '네이버 검색 가입률', tab: 'naver', percent: true, help: '네이버 검색광고 방문자 중 가입한 비율입니다.' },
  { key: 'naver_ad_cost', label: '광고비', tab: 'naver', lowerBetter: true, help: '선택 기간에 사용한 네이버 광고비입니다.' },
  { key: 'naver_ad_clicks', label: '광고 클릭', tab: 'naver', help: '네이버 광고를 눌러 방문한 횟수입니다.' },
  { key: 'naver_ad_signups', label: '광고 가입', tab: 'naver', help: '네이버 광고 방문 후 가입한 수입니다.' },
  { key: 'naver_ad_cpa', label: '가입 1명당 광고비', tab: 'naver', lowerBetter: true, help: '가입 한 명을 얻는 데 든 평균 광고비입니다.' },
];

const SECTION_WORDS: Record<Exclude<TabKey, 'overview'>, string[]> = {
  analytics: ['애널리틱스', 'ga4', '채널별 가입', 'utm', '유입'],
  youtube: ['유튜브', 'youtube'],
  instagram: ['인스타', '릴스', 'instagram'],
  naver: ['네이버', '검색광고', '키워드'],
};

const FINDING_MATCH: Record<Exclude<TabKey, 'overview'>, RegExp> = {
  analytics: /ga4|애널리틱스|utm|유입|세션|방문|전환|가입|추적|태그/i,
  youtube: /유튜브|youtube|영상|조회|구독/i,
  instagram: /인스타|instagram|릴스|도달|팔로워|조회|반응/i,
  naver: /네이버|naver|키워드|검색|광고|클릭|노출|cpa/i,
};

function formatValue(value: unknown, percent = false, money = false) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (percent) return `${(number * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
  return `${number.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}${money ? '원' : ''}`;
}

function deltaOf(current: number | null | undefined, previous: number | null | undefined) {
  if (typeof current !== 'number' || typeof previous !== 'number' || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function opinion(delta: number | null, lowerBetter = false) {
  if (delta === null) return '이전 자료가 쌓이면 변화 이유까지 비교할 수 있습니다.';
  if (Math.abs(delta) < 3) return '직전 보고와 비슷한 수준입니다. 급한 변화는 없습니다.';
  const improved = lowerBetter ? delta < 0 : delta > 0;
  const size = Math.abs(delta) >= 15 ? '눈에 띄게' : '조금';
  return improved ? `${size} 좋아졌습니다. 현재 방식에서 잘된 부분을 이어가세요.` : `${size} 나빠졌습니다. 원인과 광고 설정을 확인할 필요가 있습니다.`;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="mbd-sparkline-empty">비교 데이터 준비 중</div>;
  const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${38 - ((value - min) / range) * 31}`).join(' ');
  return <svg className="mbd-sparkline" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>;
}

function extractSections(markdown: string, words: string[]) {
  const sections = splitReportSections(markdown);
  return Object.entries(sections)
    .filter(([heading]) => words.some((word) => heading.toLowerCase().includes(word.toLowerCase())))
    .map(([heading, body]) => `### ${heading}\n${body}`)
    .join('\n\n');
}

type ParsedTable = { columns: string[]; rows: string[][] };
const REPORT_HEADINGS = [
  '한 줄 결론', '이번 주 화제 정보', '채널 간 연결 (추정)', '채널별 가입 (GA4)',
  '네이버 검색광고', '애널리틱스', '인스타 릴스', '유튜브', '개발·광고 진행 체크', '다음 주 할 일',
];

function cleanMarkdown(value: string) {
  return value.replace(/^#{1,4}\s*/, '').replace(/\*\*/g, '').replace(/`/g, '').trim();
}

function splitReportSections(markdown: string) {
  const sections: Record<string, string> = {};
  let heading = '보고서 안내';
  let body: string[] = [];
  const flush = () => { if (body.some((line) => line.trim())) sections[heading] = body.join('\n').trim(); body = []; };
  for (const raw of (markdown || '').split(/\r?\n/)) {
    const candidate = cleanMarkdown(raw);
    const matched = REPORT_HEADINGS.find((item) => candidate === item);
    if (matched) { flush(); heading = matched; }
    else body.push(raw);
  }
  flush();
  return sections;
}

function parseMarkdownTables(source: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length;) {
    if (!lines[index].trim().startsWith('|')) { index += 1; continue; }
    const block: string[] = [];
    while (index < lines.length) {
      if (lines[index].trim().startsWith('|')) { block.push(lines[index]); index += 1; continue; }
      if (!lines[index].trim() && lines.slice(index + 1).find((line) => line.trim())?.trim().startsWith('|')) { index += 1; continue; }
      break;
    }
    const parsed = block.map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cleanMarkdown(cell)));
    const rows = parsed.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
    if (rows.length >= 2) tables.push({ columns: rows[0], rows: rows.slice(1) });
  }
  return tables;
}

function withoutTables(source: string) {
  return source.split(/\r?\n/).filter((line) => !line.trim().startsWith('|') && line.trim()).map(cleanMarkdown);
}

function numberFrom(value: string | undefined) {
  if (!value || /—|-/.test(value.trim()) && !/\d/.test(value)) return null;
  const matched = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : null;
}

function reportSection(item: Briefing, title: string) {
  return splitReportSections(item.content_md || '')[title] || '';
}

function PlainNotes({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return <div className="mbd-plain-notes">{lines.map((line, index) => <p key={index}>{line}</p>)}</div>;
}

function VisualBars({ rows, labelIndex, valueIndex, valueLabel }: { rows: string[][]; labelIndex: number; valueIndex: number; valueLabel: string }) {
  const values = rows.map((row) => numberFrom(row[valueIndex]) || 0);
  const max = Math.max(...values, 1);
  return <div className="mbd-visual-bars">{rows.map((row, index) => <div key={`${row[labelIndex]}-${index}`} className="mbd-visual-bar"><span>{row[labelIndex]}</span><div><i style={{ width: `${Math.max((values[index] / max) * 100, values[index] ? 3 : 0)}%` }} /></div><strong>{row[valueIndex]} <small>{valueLabel}</small></strong></div>)}</div>;
}

function objectRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([name, item]) =>
    item && typeof item === 'object' ? { name, ...(item as Record<string, unknown>) } : { name, value: item });
  return [];
}

function EasyTable({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return null;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 7);
  const labels: Record<string, string> = { name: '구분', source_medium: '유입 경로', sessions: '방문', users: '사용자', conversions: '가입', signups: '가입', cvr: '가입률', views: '조회', reach: '도달', saved: '저장', shares: '공유', date: '날짜', keyword: '키워드', status: '상태', clicks: '클릭' };
  return <div className="mbd-table-card"><h4>{title}</h4><div className="mbd-table-scroll"><table><thead><tr>{columns.map((key) => <th key={key}>{labels[key] || key}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((key) => <td key={key}>{typeof row[key] === 'number' ? formatValue(row[key], key === 'cvr') : String(row[key] ?? '-')}</td>)}</tr>)}</tbody></table></div></div>;
}

function MetricCards({ tab, items }: { tab: TabKey; items: Briefing[] }) {
  const chronological = [...items].reverse();
  const configs = METRICS.filter((metric) => metric.tab === tab && chronological.some((item) => typeof item.kpis?.[metric.key] === 'number'));
  if (!configs.length) return <div className="mbd-empty">아직 이 채널의 숫자 자료가 없습니다. 아래 조사 결과와 점검 의견을 확인하세요.</div>;
  return <div className="mbd-metric-grid">{configs.map((metric) => {
    const values = chronological.map((item) => item.kpis?.[metric.key]).filter((value): value is number => typeof value === 'number');
    const current = values[values.length - 1];
    const delta = deltaOf(current, values.length > 1 ? values[values.length - 2] : undefined);
    const positive = delta !== null && (metric.lowerBetter ? delta < 0 : delta > 0);
    return <article className="mbd-metric" key={metric.key}>
      <div className="mbd-metric-head"><span>{metric.label}</span>{delta !== null && <em className={positive ? 'good' : 'bad'}>{delta > 0 ? '+' : ''}{delta.toFixed(1)}%</em>}</div>
      <strong>{formatValue(current, metric.percent, metric.key.includes('cost') || metric.key.includes('cpa'))}</strong>
      <Sparkline values={values} />
      <p>{metric.help}</p><small>{opinion(delta, metric.lowerBetter)}</small>
    </article>;
  })}</div>;
}

function Findings({ item, matcher }: { item: Briefing; matcher?: RegExp }) {
  const warnings = (item.warnings || []).filter((entry) => !matcher || matcher.test(entry.text));
  const checks = (item.checks || []).filter((entry) => !matcher || matcher.test(`${entry.item} ${entry.evidence || ''}`));
  const todos = (item.todos || []).filter((entry) => !matcher || matcher.test(entry));
  if (!warnings.length && !checks.length && !todos.length) return null;
  return <div className="mbd-findings">
    {!!warnings.length && <section className="mbd-finding warning"><h4><AlertTriangle size={18} /> 확인이 필요한 문제</h4>{warnings.map((entry, index) => <p key={index}>{entry.text}</p>)}</section>}
    {!!checks.length && <section className="mbd-finding checks"><h4><CheckCircle2 size={18} /> 진행 상황</h4>{checks.map((entry) => <p key={entry.key}><b>{entry.status === 'done' ? '완료' : entry.status === 'partial' ? '일부 진행' : '확인 필요'}</b> {entry.item}{entry.evidence ? ` — ${entry.evidence}` : ''}</p>)}</section>}
    {!!todos.length && <section className="mbd-finding todo"><h4>다음에 할 일</h4><ol>{todos.map((entry, index) => <li key={index}>{entry}</li>)}</ol></section>}
  </div>;
}

function ReportTable({ table }: { table: ParsedTable }) {
  return <div className="mbd-readable-table"><table><thead><tr>{table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function AnalyticsVisual({ item }: { item: Briefing }) {
  const channelSource = reportSection(item, '채널별 가입 (GA4)');
  const analyticsSource = reportSection(item, '애널리틱스');
  const channelTable = parseMarkdownTables(channelSource)[0];
  const deviceTable = parseMarkdownTables(analyticsSource)[0];
  const channelRows = channelTable?.rows || [];
  const sourceIndex = channelTable?.columns.findIndex((column) => /소스|채널/.test(column)) ?? 0;
  const signupIndex = channelTable?.columns.findIndex((column) => /가입/.test(column) && !/직전/.test(column)) ?? 2;
  const topChannels = [...channelRows].sort((a, b) => (numberFrom(b[signupIndex]) || 0) - (numberFrom(a[signupIndex]) || 0)).slice(0, 8);
  const notes = [...withoutTables(channelSource), ...withoutTables(analyticsSource)];
  return <div className="mbd-channel-visual analytics">
    {!!topChannels.length && <section className="mbd-visual-panel"><div className="mbd-panel-title"><div><span>가입을 만든 유입 경로</span><h4>어디에서 가입했나요?</h4></div><p>막대가 길수록 가입 기여가 큽니다.</p></div><VisualBars rows={topChannels} labelIndex={sourceIndex} valueIndex={signupIndex} valueLabel="가입" /></section>}
    {deviceTable && <section className="mbd-visual-panel"><div className="mbd-panel-title"><div><span>기기별 성과</span><h4>PC와 모바일 비교</h4></div><p>방문 수보다 가입률 차이를 함께 보세요.</p></div><div className="mbd-device-cards">{deviceTable.rows.map((row) => <article key={row[0]}><strong>{row[0] === 'desktop' ? 'PC' : row[0] === 'mobile' ? '모바일' : '태블릿'}</strong><dl><div><dt>방문</dt><dd>{row[1]}</dd></div><div><dt>가입</dt><dd>{row[2]}</dd></div><div><dt>가입률</dt><dd>{row[3]}</dd></div></dl><div className="mbd-rate-track"><i style={{ width: `${Math.min((numberFrom(row[3]) || 0) * 25, 100)}%` }} /></div><small>직전 가입 {row[4] || '-'}</small></article>)}</div></section>}
    <section className="mbd-easy-explain"><h4>쉽게 풀어보면</h4><PlainNotes lines={notes} /></section>
  </div>;
}

function NaverVisual({ item }: { item: Briefing }) {
  const source = reportSection(item, '네이버 검색광고');
  const tables = parseMarkdownTables(source);
  const summary = tables[0];
  const keywords = tables[1];
  const notes = withoutTables(source);
  const keywordRows = keywords ? [...keywords.rows].sort((a, b) => (numberFrom(b[1]) || 0) - (numberFrom(a[1]) || 0)) : [];
  return <div className="mbd-channel-visual naver">
    {summary && <section className="mbd-naver-summary">{summary.rows.map((row) => { const change = numberFrom(row[3]); const better = /비용|CPC|CPA/.test(row[0]) ? (change ?? 0) <= 0 : (change ?? 0) >= 0; return <article key={row[0]}><span>{row[0]}</span><strong>{row[1]}</strong><small>직전 {row[2]}</small>{row[3] && row[3] !== '—' && <em className={better ? 'good' : 'bad'}>{row[3]}</em>}</article>; })}</section>}
    {keywords && <section className="mbd-visual-panel"><div className="mbd-panel-title"><div><span>키워드 점검</span><h4>클릭이 많은 검색어</h4></div><p>비용과 실제 전환을 함께 비교합니다.</p></div><div className="mbd-keyword-grid">{keywordRows.slice(0, 12).map((row, index) => { const costPer = numberFrom(row[6]); const grade = costPer === null ? 'unknown' : costPer <= 4000 ? 'good' : costPer >= 8000 ? 'bad' : 'watch'; return <article key={row[0]} className={grade}><span className="rank">{index + 1}</span><div><strong>{row[0]}</strong><small>{row[1]}회 클릭 · 평균 {row[4]}위</small></div><dl><div><dt>광고비</dt><dd>{row[2]}</dd></div><div><dt>전환</dt><dd>{row[5]}</dd></div><div><dt>전환당 비용</dt><dd>{row[6]}</dd></div></dl><em>{grade === 'good' ? '효율 좋음' : grade === 'bad' ? '조정 검토' : grade === 'watch' ? '관찰 필요' : '자료 부족'}</em></article>; })}</div></section>}
    <section className="mbd-easy-explain"><h4>광고 담당자가 확인할 내용</h4><PlainNotes lines={notes} /></section>
  </div>;
}

function parseYoutubeTopicCards(item: Briefing) {
  const topic = parseMarkdownTables(reportSection(item, '이번 주 화제 정보'))[0];
  const row = topic?.rows.find((entry) => /유튜브/.test(entry[0]));
  return (row?.slice(1) || []).filter(Boolean).map((text) => ({ text, kind: /쇼츠|short/i.test(text) ? 'short' : 'long' as 'short' | 'long' }));
}

function YoutubeVisual({ item }: { item: Briefing }) {
  const source = reportSection(item, '유튜브');
  const text = withoutTables(source).join(' ');
  const value = (pattern: RegExp) => text.match(pattern)?.[1] || '-';
  const topics = parseYoutubeTopicCards(item);
  const shortLine = text.match(/쇼츠 상위:\s*(.+?)(?:사이트 유입|$)/)?.[1] || '';
  const shorts = shortLine.split(/\),\s*/).map((entry) => entry.replace(/\)?$/, ')').trim()).filter(Boolean);
  const longform = topics.filter((topic) => topic.kind === 'long');
  const topicShorts = topics.filter((topic) => topic.kind === 'short').map((topic) => topic.text);
  return <div className="mbd-channel-visual youtube">
    <section className="mbd-youtube-kpis"><article><span>전체 조회</span><strong>{value(/주간 조회\s*([\d,]+)/)}</strong><small>직전 {value(/직전\s*([\d,]+)/)}</small></article><article><span>광고 조회</span><strong>{value(/광고\s*([\d,]+)/)}</strong><small>전체 중 {value(/광고\s*[\d,]+\((\d+%)/)}</small></article><article><span>쇼츠 조회</span><strong>{value(/쇼츠\s*([\d,]+)/)}</strong><small>{value(/쇼츠\s*[\d,]+\(([-+]?\d+%)/)} 변화</small></article><article><span>사이트 가입</span><strong>{value(/가입\s*([\d,]+)/)}</strong><small>유튜브 유입의 실제 결과</small></article></section>
    <div className="mbd-video-columns"><section><div className="mbd-panel-title"><div><span>LONG FORM</span><h4>롱폼 영상 성과</h4></div></div>{longform.length ? longform.map((topic, index) => <article className="mbd-video-card long" key={index}><em>롱폼</em><strong>{topic.text}</strong><p>긴 영상은 조회수뿐 아니라 설명란 링크를 통한 사이트 방문과 가입까지 함께 확인해야 합니다.</p></article>) : <div className="mbd-empty">이번 보고서에는 롱폼별 상세 자료가 없습니다.</div>}</section><section><div className="mbd-panel-title"><div><span>SHORT FORM</span><h4>쇼츠 영상 성과</h4></div></div>{[...shorts, ...topicShorts].filter((entry, index, all) => all.indexOf(entry) === index).map((entry, index) => <article className="mbd-video-card short" key={index}><em>쇼츠 {index + 1}</em><strong>{entry}</strong><p>{/시청률\s*(?:[7-9]\d|100)%/.test(entry) ? '끝까지 보는 비율이 높습니다. 같은 전개를 반복할 가치가 있습니다.' : '첫 장면과 제목의 반전 요소를 유지하며 시청 지속률을 비교하세요.'}</p></article>)}</section></div>
    <section className="mbd-easy-explain"><h4>유튜브 결과를 쉽게 읽으면</h4><PlainNotes lines={withoutTables(source)} /></section>
  </div>;
}

function InstagramVisual({ item }: { item: Briefing }) {
  const source = reportSection(item, '인스타 릴스');
  const table = parseMarkdownTables(source)[0];
  const rows = table ? [...table.rows].sort((a, b) => (numberFrom(b[2]) || 0) - (numberFrom(a[2]) || 0)) : [];
  const maxViews = Math.max(...rows.map((row) => numberFrom(row[2]) || 0), 1);
  return <div className="mbd-channel-visual instagram">
    {!!rows.length && <section className="mbd-instagram-grid">{rows.map((row, index) => <article key={`${row[0]}-${row[1]}`} className={index < 3 ? 'top' : ''}><div className="mbd-post-rank"><span>{index < 3 ? `TOP ${index + 1}` : row[0]}</span><em>{row[5] === '✅' ? '금액 대비 소재' : '일반 소재'}</em></div><h4>{row[1]}</h4><div className="mbd-post-views"><strong>{row[2]}</strong><span>조회</span></div><div className="mbd-post-track"><i style={{ width: `${((numberFrom(row[2]) || 0) / maxViews) * 100}%` }} /></div><dl><div><dt>저장</dt><dd>{row[3]}</dd></div><div><dt>공유</dt><dd>{row[4]}</dd></div></dl><p>{numberFrom(row[4]) && numberFrom(row[4])! >= 5 ? '공유 반응이 좋습니다. 비슷한 반전 소재를 이어가세요.' : index < 3 ? '조회 성과가 좋은 게시물입니다. 제목 구조를 재사용해 보세요.' : '첫 문장의 금액·반전 요소를 더 선명하게 테스트하세요.'}</p></article>)}</section>}
    <section className="mbd-easy-explain"><h4>인스타 결과를 쉽게 읽으면</h4><PlainNotes lines={withoutTables(source)} /></section>
  </div>;
}

export function ReadableReport({ source }: { source: string }) {
  const sections = splitReportSections(source);
  return <div className="mbd-readable-report">{Object.entries(sections).map(([heading, body]) => <section key={heading}><h4>{heading}</h4><PlainNotes lines={withoutTables(body)} />{parseMarkdownTables(body).map((table, index) => <ReportTable table={table} key={index} />)}</section>)}</div>;
}

function ChannelView({ tab, item, items }: { tab: Exclude<TabKey, 'overview'>; item: Briefing; items: Briefing[] }) {
  const section = extractSections(item.content_md || '', SECTION_WORDS[tab]);
  const title = TABS.find((entry) => entry.key === tab)!;
  const hasTables = tab === 'analytics' ? objectRows(item.devices).length + objectRows(item.landing).length + objectRows(item.audience).length > 0
    : tab === 'youtube' ? false : tab === 'instagram' ? !!item.reels?.length : !!item.channels?.length;
  return <>
    <header className="mbd-section-heading"><div><span>{title.description}</span><h3>{title.label} 조사 결과</h3></div><p>전문용어 대신 “무엇이 달라졌고 무엇을 확인해야 하는지” 중심으로 정리했습니다.</p></header>
    <MetricCards tab={tab} items={items} />
    {tab === 'analytics' && <AnalyticsVisual item={item} />}
    {tab === 'youtube' && <YoutubeVisual item={item} />}
    {tab === 'instagram' && <InstagramVisual item={item} />}
    {tab === 'naver' && <NaverVisual item={item} />}
    {!section && tab === 'analytics' && <div className="mbd-data-grid"><EasyTable title="기기별 방문·가입" rows={objectRows(item.devices)} /><EasyTable title="유입 화면·UTM" rows={objectRows(item.landing)} /><EasyTable title="신규·재방문" rows={objectRows(item.audience)} /><EasyTable title="채널별 유입" rows={item.channels || []} /></div>}
    {!section && tab === 'instagram' && <EasyTable title="최근 릴스 반응" rows={item.reels || []} />}
    {!section && tab === 'naver' && <EasyTable title="검색·키워드 점검 자료" rows={(item.channels || []).filter((row) => /naver|네이버/i.test(JSON.stringify(row)))} />}
    <Findings item={item} matcher={FINDING_MATCH[tab]} />
    {!section && !hasTables && <div className="mbd-empty">이번 보고서에는 이 채널의 상세 조사 내용이 없습니다. 다음 수신 자료부터 같은 위치에 자동으로 표시됩니다.</div>}
  </>;
}

function ExpandedReport({ item, previousChecks }: { item: Briefing; previousChecks?: Briefing['checks'] }) {
  const previous = new Map((previousChecks || []).map((check) => [check.key, check.status]));
  return <div className="mbd-expanded">
    <div className="mbd-expanded-summary"><span>한눈에 보는 결론</span><p>{item.summary}</p></div>
    <Findings item={item} />
    {!!item.highlights?.length && <div className="mbd-highlight-grid">{item.highlights.slice(0, 3).map((highlight, index) => <article key={index}><span>{highlight.label}</span><strong>{formatValue(highlight.value)}</strong>{highlight.note && <p>{highlight.note}</p>}</article>)}</div>}
    {!!item.checks?.some((check) => previous.has(check.key) && previous.get(check.key) !== check.status) && <p className="mbd-changed-note">직전 보고서와 상태가 달라진 진행 항목이 있습니다. 위 진행 상황을 확인하세요.</p>}
    {item.content_md && <details className="mbd-original"><summary>전체 보고서를 항목별로 자세히 보기</summary><ReadableReport source={item.content_md} /></details>}
  </div>;
}

export default function MarketingBriefingDashboard() {
  const { user } = useAuthStore();
  const { site: routeSite } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const site = routeSite || searchParams.get('site') || 'myauction';
  const type = (searchParams.get('type') || 'weekly') as 'weekly' | 'monthly';
  const [tab, setTab] = useState<TabKey>('overview');
  const [items, setItems] = useState<Briefing[]>([]);
  const [details, setDetails] = useState<Record<string, DetailResponse>>({});
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyPanel, setKeyPanel] = useState(false);
  const [keys, setKeys] = useState<BriefingKey[]>([]);
  const [newToken, setNewToken] = useState('');
  const [keyName, setKeyName] = useState('마이옥션 주간 브리핑 자동화');
  const isMaster = user?.role === 'master';

  const load = async () => {
    setLoading(true); setError('');
    try {
      const result = await api.briefings.list({ site, type, limit: 20 });
      const nextItems = result.briefings as Briefing[];
      setItems(nextItems);
      if (nextItems[0]) {
        const detail = await api.briefings.byDate(site, nextItems[0].report_date) as DetailResponse;
        setDetails((current) => ({ ...current, [nextItems[0].report_date]: detail }));
      }
    } catch (err: any) { setError(err?.message || '브리핑을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [site, type]);

  const latest = details[items[0]?.report_date]?.briefing || items[0];
  const problemCount = (latest?.warnings?.length || 0) + (latest?.checks || []).filter((check) => check.status !== 'done').length;
  const overviewMetrics = useMemo(() => items.map((item) => ({ ...item, kpis: item.kpis || {} })), [items]);

  const toggleReport = async (item: Briefing) => {
    if (openDate === item.report_date) { setOpenDate(null); return; }
    setOpenDate(item.report_date);
    if (!details[item.report_date]) {
      const detail = await api.briefings.byDate(item.site, item.report_date) as DetailResponse;
      setDetails((current) => ({ ...current, [item.report_date]: detail }));
    }
  };
  const loadKeys = async () => setKeys((await api.briefings.keys()).api_keys as BriefingKey[]);
  const toggleKeys = async () => { const next = !keyPanel; setKeyPanel(next); if (next) await loadKeys(); };
  const createKey = async () => { const result = await api.briefings.createKey({ name: keyName, site }); setNewToken(result.token); await loadKeys(); };
  const revokeKey = async (id: string) => { if (!window.confirm('이 API 키를 폐기할까요? 폐기 후에는 복구할 수 없습니다.')) return; await api.briefings.revokeKey(id); await loadKeys(); };

  return <div className="briefings-page mbd-page">
    <header className="mbd-hero">
      <img className="mbd-hero-image" src={briefingHero} alt="" aria-hidden="true" />
      <div className="mbd-hero-copy"><span>MARKETING CHECK CENTER</span><h2>마이옥션 주간 브리핑</h2><p>광고를 잘 몰라도 문제와 변화를 바로 이해할 수 있는 마케팅 점검판입니다.</p></div>
      <div className="mbd-actions"><button className="btn btn-secondary" onClick={() => void load()}><RefreshCw size={16} /> 새로고침</button>{isMaster && <button className="btn btn-secondary" onClick={() => void toggleKeys()}><KeyRound size={16} /> API 키</button>}</div>
    </header>
    {keyPanel && <section className="briefing-key-panel"><div className="briefing-section-title"><div><h3>수신 API 키</h3><p>원문 키는 발급 직후 한 번만 표시됩니다.</p></div></div><div className="briefing-key-create"><input value={keyName} onChange={(event) => setKeyName(event.target.value)} aria-label="키 이름" /><button className="btn btn-primary" onClick={() => void createKey()}>새 키 발급</button></div>{newToken && <div className="briefing-token-once"><strong>지금 안전하게 보관하세요.</strong><code>{newToken}</code><button onClick={() => void navigator.clipboard.writeText(newToken)}><Clipboard size={15} /> 복사</button></div>}<div className="briefing-key-list">{keys.map((key) => <div key={key.id}><span><strong>{key.name}</strong><small>{key.token_prefix}… · {key.site || '전체 사이트'} · 최근 사용 {key.last_used_at || '없음'}</small></span>{key.revoked_at ? <em>폐기됨</em> : <button onClick={() => void revokeKey(key.id)}>폐기</button>}</div>)}</div></section>}

    <nav className="mbd-channel-tabs" aria-label="마케팅 채널 선택">{TABS.map(({ key, label, icon: Icon, description, logo }) => <button key={key} data-channel={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)} aria-pressed={tab === key}>
      <span className="mbd-channel-logo" aria-hidden="true">{logo ? <img src={logo} alt="" /> : key === 'analytics' ? <span className="mbd-ga-logo"><i /><i /><i /></span> : <Icon size={27} />}</span>
      <span className="mbd-channel-copy"><strong>{label}</strong><small>{description}</small></span>
    </button>)}</nav>
    <div className="mbd-toolbar"><div><button className={type === 'weekly' ? 'active' : ''} onClick={() => setSearchParams({ type: 'weekly' })}>주간</button><button className={type === 'monthly' ? 'active' : ''} onClick={() => setSearchParams({ type: 'monthly' })}>월간</button></div>{latest && <span>최근 조사일 <b>{latest.report_date}</b></span>}</div>

    {loading ? <div className="briefing-state">자료를 정리하고 있습니다...</div> : error ? <div className="briefing-state error">{error}</div> : !latest ? <div className="briefing-state">아직 수신된 브리핑이 없습니다.</div> : tab === 'overview' ? <>
      <section className="mbd-overview-top"><article className={`mbd-status ${problemCount ? 'attention' : 'good'}`}><span>현재 종합 상태</span><strong>{problemCount ? '확인 필요' : '특이사항 없음'}</strong><p>{problemCount ? `문제 또는 미완료 항목이 ${problemCount}개 있습니다. 아래에서 쉬운 설명과 할 일을 확인하세요.` : '현재 보고된 자료에서는 급하게 확인할 문제가 없습니다.'}</p></article><article className="mbd-conclusion"><span>이번 주 변화 소견</span><h3>{latest.summary}</h3><p>수치 변화와 채널별 조사 결과를 함께 보고 판단한 결론입니다.</p></article></section>
      <section><header className="mbd-section-heading"><div><span>숫자를 쉽게 읽기</span><h3>주요 수치와 변화 소견</h3></div><p>그래프는 최근 보고 순서이며, 변화가 좋은지 나쁜지도 문장으로 설명합니다.</p></header><MetricCards tab="overview" items={overviewMetrics} /></section>
      <Findings item={latest} />
      <section className="mbd-history"><header className="mbd-section-heading"><div><span>보고 날짜별 기록</span><h3>브리핑 목록</h3></div><p>날짜를 누르면 다른 페이지로 이동하지 않고 바로 펼쳐집니다.</p></header><div className="mbd-report-list">{items.map((item) => {
        const open = openDate === item.report_date;
        const detail = details[item.report_date];
        return <article key={item.id} className={open ? 'open' : ''}><button className="mbd-report-row" onClick={() => void toggleReport(item)} aria-expanded={open}><time>{item.report_date}</time><span><strong>{item.title}</strong><small>{item.summary}</small></span><em>{item.type === 'monthly' ? '월간' : '주간'} · 문제 {item.warnings?.length || 0}</em>{open ? <ChevronUp /> : <ChevronDown />}</button>{open && (detail ? <ExpandedReport item={detail.briefing} previousChecks={detail.previous_checks} /> : <div className="mbd-expanded-loading">보고서를 불러오는 중...</div>)}</article>;
      })}</div></section>
    </> : <ChannelView tab={tab} item={latest} items={items} />}
  </div>;
}
