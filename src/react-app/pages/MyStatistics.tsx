import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarRange, CheckCircle2, MapPin, Target, Trophy } from 'lucide-react';
import { api } from '../api';

type Response = Awaited<ReturnType<typeof api.myStatistics.get>>;
type Breakdown = Response['property_types'][number];

const money = (value: number) => `${Math.round(value || 0).toLocaleString('ko-KR')}원`;

function SummaryCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <article className="my-stats-summary-card"><span className="my-stats-summary-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function BreakdownChart({ title, subtitle, rows }: { title: string; subtitle: string; rows: Breakdown[] }) {
  return <section className="card my-stats-panel">
    <div className="my-stats-section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>
    {rows.length === 0 ? <div className="my-stats-empty">집계할 입찰 데이터가 없습니다.</div> : <div className="my-stats-bars">
      {rows.map((row, index) => <div className="my-stats-bar-row" key={row.label}>
        <div className="my-stats-bar-label"><strong>{row.label}</strong><span>입찰 {row.total_count}건 · 낙찰 {row.won_count}건 · 낙찰률 {row.win_rate}%</span></div>
        <div className="my-stats-bar-tracks">
          <div className="my-stats-bar-metric"><span>입찰 점유율 <b>{row.total_share}%</b></span><div className="my-stats-bar-track" aria-label={`${row.label} 입찰 점유율 ${row.total_share}%`}><i className="my-stats-bar-fill blue" style={{ width: `${Math.max(row.total_share, row.total_count ? 2 : 0)}%`, animationDelay: `${Math.min(index, 12) * 45}ms` }} /></div></div>
          <div className="my-stats-bar-metric"><span>매출 점유율 <b>{row.revenue_share}%</b></span><div className="my-stats-bar-track" aria-label={`${row.label} 매출 점유율 ${row.revenue_share}%`}><i className="my-stats-bar-fill green" style={{ width: `${Math.max(row.revenue_share, row.total_revenue ? 2 : 0)}%`, animationDelay: `${Math.min(index, 12) * 45 + 80}ms` }} /></div></div>
        </div>
        <div className="my-stats-bar-result"><b>낙찰률 {row.win_rate}%</b>{row.revenue_case_count > 0 ? <span>{money(row.total_revenue)} · 평균 {money(row.average_revenue)}</span> : <span className="my-stats-no-record">{row.revenue_missing_count > 0 ? `매출 기록 없음 · 과거 낙찰 ${row.revenue_missing_count}건` : '확정 매출 없음'}</span>}</div>
      </div>)}
    </div>}
  </section>;
}

export default function MyStatistics() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.myStatistics.get({ user_id: userId || undefined, from: from || undefined, to: to || undefined })
      .then((response) => { if (active) setData(response); })
      .catch((requestError: Error) => { if (active) setError(requestError.message || '통계를 불러오지 못했습니다.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, from, to]);

  const maxMonthlyRevenue = useMemo(() => Math.max(1, ...(data?.monthly_revenue || []).map((row) => row.total)), [data]);
  const revenueStrengths = useMemo(() => {
    if (!data) return [] as string[];
    const properties = data.property_types.filter((row) => row.total_revenue > 0);
    const courts = data.courts.filter((row) => row.total_revenue > 0);
    const topProperty = [...properties].sort((a, b) => b.total_revenue - a.total_revenue)[0];
    const efficientProperty = [...properties].filter((row) => row.revenue_case_count >= 2).sort((a, b) => b.average_revenue - a.average_revenue)[0];
    const topCourt = [...courts].sort((a, b) => b.total_revenue - a.total_revenue)[0];
    return [
      topProperty ? `${topProperty.label}에서 ${money(topProperty.total_revenue)}으로 가장 많은 낙찰 매출이 발생했습니다.` : '',
      efficientProperty ? `${efficientProperty.label}의 사건당 평균매출이 ${money(efficientProperty.average_revenue)}으로 가장 높습니다.` : '',
      topCourt ? `${topCourt.label}이 매출 ${money(topCourt.total_revenue)}과 낙찰률 ${topCourt.win_rate}%로 주요 강점 지역입니다.` : '',
    ].filter(Boolean);
  }, [data]);

  if (loading && !data) return <div className="page-loading">마이통계를 불러오는 중...</div>;
  if (error && !data) return <div className="card empty-state">{error}</div>;
  if (!data) return null;

  return <div className="my-stats-page">
    <header className="my-stats-hero">
      <div><span className="my-stats-eyebrow">MY PERFORMANCE</span><h1>마이통계</h1><p>{data.selected_user.name}님의 입찰·낙찰과 실제 확정매출을 함께 분석합니다.</p></div>
      <div className="my-stats-filters">
        {data.viewer_can_select_user && <label><span>조회 대상</span><select value={userId || data.selected_user.id} onChange={(event) => setUserId(event.target.value)}>{data.users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.branch || user.department || user.position_title}</option>)}</select></label>}
        <label><span>시작일</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>종료일</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        {(from || to) && <button type="button" className="btn btn-sm" onClick={() => { setFrom(''); setTo(''); }}>전체기간</button>}
      </div>
    </header>

    {error && <div className="my-stats-error">{error}</div>}
    <div className="my-stats-coverage-note" role="note"><strong>매출 기록 기준</strong><span>입찰 후 낙찰되어 마이오피스에 연결된 확정매출만 반영합니다. {data.revenue.coverage_from ? `${data.revenue.coverage_from}부터 확인되는 기록을 사용하며,` : '확인되는 매출 기록이 없어'} 그 이전 낙찰은 0원이 아닌 <em className="my-stats-no-record">기록 없음</em>으로 처리합니다.</span></div>

    <div className="my-stats-summary-grid">
      <SummaryCard icon={<BarChart3 size={21} />} label="확정 낙찰매출" value={money(data.revenue.total)} detail={`매출 기록 ${data.revenue.confirmed_case_count}건 기준`} />
      <SummaryCard icon={<Trophy size={21} />} label="매출 발생 사건 수" value={`${data.revenue.confirmed_case_count}건`} detail={`대기 ${data.revenue.pending_case_count}건 · 환불 ${data.revenue.refunded_case_count}건`} />
      <SummaryCard icon={<CheckCircle2 size={21} />} label="사건당 평균매출" value={money(data.revenue.average_per_case)} detail="확정매출 ÷ 매출 발생 사건" />
      <SummaryCard icon={<Target size={21} />} label="최종 낙찰률" value={`${data.summary.overall_win_rate}%`} detail={`낙찰 ${data.summary.won_bids}건 / 확정결과 ${data.summary.decided_bids}건`} />
    </div>

    <div className="my-stats-two-column">
      <section className="card my-stats-panel"><div className="my-stats-section-heading"><div><h2>최근 3·6·12개월 매출 변화</h2><p>각 기간의 낙찰 확정매출과 직전 동일 기간 비교</p></div><CalendarRange size={20} /></div><div className="my-stats-rolling-grid">
        {data.rolling_revenue.map((row) => <article key={row.months}><span>최근 {row.months}개월</span><strong className={row.has_records ? undefined : 'my-stats-no-record'}>{row.has_records ? money(row.total) : '기록 없음'}</strong><small>{row.has_records ? `${row.case_count}건 · ${row.change_rate === null ? '이전 비교 기록 부족' : `직전 대비 ${row.change_rate > 0 ? '+' : ''}${row.change_rate}%`}` : '마이오피스 매출 기록 이후 집계'}</small></article>)}
      </div></section>
      <section className="card my-stats-panel my-stats-dependency"><div className="my-stats-section-heading"><div><h2>최고 매출 사건 의존도</h2><p>일회성 고액 사건에 매출이 집중되어 있는지 확인</p></div><Trophy size={20} /></div>
        {data.revenue.confirmed_case_count === 0 ? <div className="my-stats-empty compact">분석 가능한 확정매출이 없습니다.</div> : <><div className="my-stats-dependency-value"><strong>{data.revenue.top_case_share}%</strong><span>최고 1건 {money(data.revenue.top_case_amount)}</span></div><div className="my-stats-dependency-track" aria-label={`최고 매출 사건 의존도 ${data.revenue.top_case_share}%`}><i style={{ width: `${data.revenue.top_case_share}%` }} /></div><p>상위 3건이 전체 확정매출의 <b>{data.revenue.top_three_share}%</b>를 차지합니다.</p></>}
      </section>
    </div>

    <div className="my-stats-two-column">
      <BreakdownChart title="물건 종류별 입찰·매출 점유율" subtitle="입찰 건수 점유율과 실제 확정매출 점유율을 분리해 비교합니다" rows={data.property_types} />
      <BreakdownChart title="법원·지역별 입찰·매출 점유율" subtitle="법원별 입찰 건수 점유율과 실제 확정매출 점유율을 분리해 비교합니다" rows={data.courts} />
    </div>

    <div className="my-stats-two-column my-stats-bottom-grid">
      <section className="card my-stats-panel"><div className="my-stats-section-heading"><div><h2>월별 낙찰매출 추이</h2><p>마이오피스에서 확정된 낙찰매출만 월별 표시</p></div><CalendarRange size={20} /></div>
        {data.monthly_revenue.length === 0 ? <div className="my-stats-empty">월별 매출 기록이 없습니다.</div> : <div className="my-stats-monthly">{data.monthly_revenue.map((row, index) => <div key={row.month} className="my-stats-month-row my-stats-revenue-month-row"><span>{row.month}</span><div className="my-stats-month-track"><i style={{ width: `${(row.total / maxMonthlyRevenue) * 100}%`, animationDelay: `${Math.min(index, 18) * 35}ms` }} /></div><b>{money(row.total)}</b><small>{row.case_count}건</small></div>)}</div>}
      </section>
      <section className="card my-stats-panel my-stats-insights"><div className="my-stats-section-heading"><div><h2>수익 강점 분석</h2><p>낙찰률과 실제 확정매출을 함께 본 개인 분석</p></div><MapPin size={20} /></div>
        <h3>매출 강점</h3><ul>{revenueStrengths.length ? revenueStrengths.map((item) => <li key={item}>{item}</li>) : <li>매출 강점을 판단할 수 있는 기록이 아직 부족합니다.</li>}</ul>
        <h3 className="weak">확인할 점</h3><ul>{data.revenue.missing_record_count > 0 && <li>낙찰 {data.revenue.missing_record_count}건은 매출 기록 이전 또는 연결 정보가 없어 금액 분석에서 제외했습니다.</li>}{data.revenue.top_case_share >= 50 && <li>최고 매출 1건의 비중이 높아 반복 가능한 강점인지 추가 관찰이 필요합니다.</li>}{data.revenue.missing_record_count === 0 && data.revenue.top_case_share < 50 && <li>현재 기록에서 큰 데이터 왜곡 신호가 없습니다.</li>}</ul>
        <div className="my-stats-note"><p>낙찰률은 전체 확정 입찰 결과를 분모로 계산하고, 매출은 낙찰 후 연결된 확정매출만 합산합니다.</p></div>
      </section>
    </div>

    <section className="card my-stats-panel"><div className="my-stats-section-heading"><div><h2>법원 × 물건종류 교차 성과</h2><p>입찰량이 많은 조합 순서로 최대 40개를 표시합니다.</p></div><MapPin size={20} /></div><div className="my-stats-matrix-wrap"><table className="my-stats-matrix"><thead><tr><th>법원</th><th>물건종류</th><th>입찰</th><th>낙찰</th><th>낙찰률</th></tr></thead><tbody>{data.court_property_matrix.map((row) => <tr key={`${row.court}-${row.property_type}`}><td>{row.court}</td><td>{row.property_type}</td><td>{row.total_count}건</td><td>{row.won_count}건</td><td><b>{row.win_rate}%</b></td></tr>)}</tbody></table></div></section>

  </div>;
}
