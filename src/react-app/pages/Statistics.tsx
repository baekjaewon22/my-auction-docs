import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { ROLE_LABELS } from '../types';
import type { Role } from '../types';
import type { JournalEntry } from '../journal/types';
import { ACTIVITY_COLORS, type ActivityType } from '../journal/types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, LabelList,
} from 'recharts';
import { BarChart3, TrendingUp, AlertTriangle, UserCheck, ChevronLeft, ChevronRight, DollarSign } from 'lucide-react';
import type { SalesRecord } from '../types';
import Select from '../components/Select';
import { useBranches } from '../hooks/useBranches';

interface Member {
  id: string; name: string; role: string; branch: string; department: string;
}

// 본사관리 인원 판별 (실적 통계 제외 대상)
const isHQStaff = (m: Member) => m.branch === '본사 관리' || ['ceo', 'cc_ref', 'accountant', 'accountant_asst'].includes(m.role);

function parseCurrency(val: string): number {
  return Number((val || '').replace(/[^0-9]/g, '')) || 0;
}

const COLORS = ['#1a73e8', '#e65100', '#188038', '#7b1fa2', '#f9ab00', '#d93025', '#00897b', '#5c6bc0'];

export default function Statistics() {
  const { user } = useAuthStore();
  const { branches } = useBranches();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterMonthEnd, setFilterMonthEnd] = useState('');
  const [salesRecords, setSalesRecords] = useState<SalesRecord[]>([]);
  const isDirector = user?.role === 'director';
  const isSalesVisible = user?.role === 'master' || user?.role === 'ceo' || user?.role === 'cc_ref' || user?.role === 'accountant' || (user?.role === 'admin' && user?.branch === '의정부') || isDirector;
  const tabs = isDirector
    ? ['매출/환불']
    : (isSalesVisible ? ['입찰 분석', '브리핑 분석', '근태 분석', '이상 감지', '매출/환불'] : ['입찰 분석', '브리핑 분석', '근태 분석', '이상 감지']);

  const isCeoPlus = user?.role === 'master' || user?.role === 'ceo' || user?.role === 'cc_ref' || (user?.role === 'admin' && user?.branch === '의정부');

  useEffect(() => {
    Promise.all([
      api.journal.list({ range: 'all' }),
      api.journal.members(),
      api.sales.stats({ month: filterMonth || undefined, month_end: filterMonthEnd || undefined, branch: filterBranch || undefined, department: filterDept || undefined, user_id: filterUser || undefined }).catch(() => ({ records: [] })),
    ])
      .then(([eRes, mRes, sRes]) => { setEntries(eRes.entries); setMembers(mRes.members); setSalesRecords(sRes.records || []); })
      .finally(() => setLoading(false));
  }, [filterMonth, filterMonthEnd, filterBranch, filterDept, filterUser]);

  // Available branches/depts/users for filters — 지사 목록은 DB 기준
  const branchNames = branches.map((b: any) => typeof b === 'string' ? b : b.name).filter((b: string) => b !== '본사 관리');
  const filteredDepts = [...new Set(
    members.filter((m) => !filterBranch || m.branch === filterBranch).map((m) => m.department).filter(Boolean)
  )].sort();
  const filteredUsers = members.filter((m) =>
    m.role !== 'master' &&
    branchNames.includes(m.branch) &&
    (!filterBranch || m.branch === filterBranch) &&
    (!filterDept || m.department === filterDept)
  );

  // 월별 옵션 — 일지(target_date)와 매출(contract_date) 양쪽에서 수집
  const monthSet = new Set<string>();
  entries.forEach((e) => { if (e.target_date) monthSet.add(e.target_date.slice(0, 7)); });
  salesRecords.forEach((r) => { if (r.contract_date) monthSet.add(r.contract_date.slice(0, 7)); });
  const monthOptions = [...monthSet].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort((a, b) => b.localeCompare(a))
    .map((m) => ({ value: m, label: m }));

  // Apply filters
  const filteredMembers = members.filter((m) =>
    m.role !== 'master' &&
    branchNames.includes(m.branch) &&
    (!filterBranch || m.branch === filterBranch) &&
    (!filterDept || m.department === filterDept) &&
    (!filterUser || m.id === filterUser)
  );
  const filteredEntries = entries.filter((e) => {
    if (filterMonth) {
      const m = e.target_date.slice(0, 7);
      const end = filterMonthEnd || filterMonth;
      if (m < filterMonth || m > end) return false;
    }
    if (filterUser) return e.user_id === filterUser;
    if (filterDept) return e.department === filterDept && (!filterBranch || e.branch === filterBranch);
    if (filterBranch) return e.branch === filterBranch;
    return true;
  });

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2><BarChart3 size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} />통계</h2>
        {/* Filters */}
        <div className="stats-filters">
          {isCeoPlus && branchNames.length > 0 && (
            <div className="stats-branch-slide">
              <button
                className={`stats-branch-btn ${filterBranch === '' ? 'active' : ''}`}
                onClick={() => { setFilterBranch(''); setFilterDept(''); setFilterUser(''); }}
              >
                전체
              </button>
              {branchNames.map((b: string) => (
                <button
                  key={b}
                  className={`stats-branch-btn ${filterBranch === b ? 'active' : ''}`}
                  onClick={() => { setFilterBranch(filterBranch === b ? '' : b); setFilterDept(''); setFilterUser(''); }}
                >
                  {b}
                </button>
              ))}
            </div>
          )}
          <div style={{ minWidth: 140 }}>
            <Select
              size="sm"
              options={filteredDepts.map(d => ({ value: d, label: d }))}
              value={filterDept ? { value: filterDept, label: filterDept } : null}
              onChange={(o: any) => { setFilterDept(o?.value || ''); setFilterUser(''); }}
              placeholder="전체 팀"
              isClearable
            />
          </div>
          <div style={{ minWidth: 140 }}>
            <Select
              size="sm"
              options={filteredUsers.map(m => ({ value: m.id, label: `${m.name} (${ROLE_LABELS[m.role as Role]})` }))}
              value={filterUser ? { value: filterUser, label: `${filteredUsers.find(m => m.id === filterUser)?.name || ''} (${ROLE_LABELS[filteredUsers.find(m => m.id === filterUser)?.role as Role] || ''})` } : null}
              onChange={(o: any) => setFilterUser(o?.value || '')}
              placeholder="전체 인원"
              isClearable
              isSearchable
            />
          </div>
          <div style={{ minWidth: 130 }}>
            <Select
              size="sm"
              options={monthOptions}
              value={filterMonth ? { value: filterMonth, label: filterMonth } : null}
              onChange={(o: any) => setFilterMonth(o?.value || '')}
              placeholder="시작월"
              isClearable
            />
          </div>
          <div style={{ minWidth: 130 }}>
            <Select
              size="sm"
              options={monthOptions}
              value={filterMonthEnd ? { value: filterMonthEnd, label: filterMonthEnd } : null}
              onChange={(o: any) => setFilterMonthEnd(o?.value || '')}
              placeholder="종료월"
              isClearable
            />
          </div>
        </div>
      </div>

      {/* Filter summary */}
      {(filterBranch || filterDept || filterUser || filterMonth) && (
        <div className="stats-filter-summary">
          필터: {filterMonth && <span className="stats-filter-tag">{filterMonth}</span>}
          {filterBranch && <span className="stats-filter-tag">{filterBranch} 지사</span>}
          {filterDept && <span className="stats-filter-tag">{filterDept}</span>}
          {filterUser && <span className="stats-filter-tag">{filteredUsers.find((m) => m.id === filterUser)?.name}</span>}
          <button className="btn-link" style={{ fontSize: '0.75rem', marginLeft: 8 }} onClick={() => { setFilterBranch(''); setFilterDept(''); setFilterUser(''); setFilterMonth(''); setFilterMonthEnd(''); }}>초기화</button>
        </div>
      )}

      {/* Slide tabs */}
      <div className="stats-slide-tabs">
        <button className="journal-slide-btn" onClick={() => setTab((t) => (t - 1 + tabs.length) % tabs.length)}>
          <ChevronLeft size={20} />
        </button>
        {tabs.map((t, i) => (
          <button key={t} className={`stats-slide-tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>
            {i === 0 && <TrendingUp size={16} />}
            {i === 1 && <UserCheck size={16} />}
            {i === 2 && <AlertTriangle size={16} />}
            {i === 3 && <DollarSign size={16} />}
            {t}
          </button>
        ))}
        <button className="journal-slide-btn" onClick={() => setTab((t) => (t + 1) % tabs.length)}>
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="stats-content">
        {tabs[tab] === '입찰 분석' && <BidAnalysis entries={filteredEntries} members={filteredMembers.filter(m => !isHQStaff(m))} viewLevel={filterUser ? 'person' : filterDept ? 'team' : filterBranch ? 'branch' : 'all'} allEntries={entries.filter(e => branchNames.includes(e.branch))} allMembers={members.filter(m => m.role !== 'master' && branchNames.includes(m.branch) && !isHQStaff(m))} />}
        {tabs[tab] === '브리핑 분석' && <BriefingAnalysis entries={filteredEntries} members={filteredMembers.filter(m => !isHQStaff(m))} />}
        {tabs[tab] === '근태 분석' && <AttendanceAnalysis entries={filteredEntries} members={filteredMembers.filter(m => !isHQStaff(m))} viewLevel={filterUser ? 'person' : filterDept ? 'team' : filterBranch ? 'branch' : 'all'} allEntries={entries.filter(e => branchNames.includes(e.branch))} allMembers={members.filter(m => m.role !== 'master' && branchNames.includes(m.branch) && !isHQStaff(m))} />}
        {tabs[tab] === '이상 감지' && <AnomalyDetection entries={filteredEntries} members={filteredMembers.filter(m => !isHQStaff(m) && m.role !== 'freelancer' && (m as any).login_type !== 'freelancer')} />}
        {tabs[tab] === '매출/환불' && <SalesAnalysis records={isDirector ? salesRecords.filter(r => { const eb = r.attribution_branch || r.branch; return eb === '대전' || eb === '부산' || r.user_id === user?.id; }) : salesRecords} members={filteredMembers.filter(m => !isHQStaff(m))} viewLevel={filterUser ? 'person' : filterDept ? 'team' : filterBranch ? 'branch' : 'all'} />}
      </div>
    </div>
  );
}

/* ============================================================ */
/* 입찰 통계 헬퍼: 그룹 데이터 계산                                  */
/* ============================================================ */
function calcBidStats(bidEntries: JournalEntry[]) {
  let win = 0, lose = 0, pending = 0, dev5 = 0;
  bidEntries.forEach((e) => {
    try {
      const d = JSON.parse(e.data);
      const a = parseCurrency(d.bidPrice);
      const w = parseCurrency(d.winPrice);
      const s = parseCurrency(d.suggestedPrice);
      // bidWon 플래그 또는 낙찰가 기준으로 판정
      if (d.bidWon) { win++; }
      else if (w > 0) { if (a >= w) win++; else lose++; }
      else { pending++; }
      if (s > 0 && a > 0 && (s - a) / s >= 0.05) dev5++;
    } catch { /* */ }
  });
  const det = win + lose;
  return { total: bidEntries.length, win, lose, pending, dev5, winRate: det > 0 ? (win / det * 100) : 0 };
}

/* ============================================================ */
/* 1. 입찰 분석                                                   */
/* ============================================================ */
function BidAnalysis({ entries, members, viewLevel, allEntries, allMembers }: {
  entries: JournalEntry[]; members: Member[];
  viewLevel: 'all' | 'branch' | 'team' | 'person';
  allEntries?: JournalEntry[]; allMembers?: Member[];
}) {
  const bidEntries = entries.filter((e) => e.activity_type === '입찰');
  const totals = calcBidStats(bidEntries);
  const resultPie = [
    { name: '낙찰', value: totals.win },
    { name: '패찰', value: totals.lose },
    { name: '미확정', value: totals.pending },
  ].filter((d) => d.value > 0);
  const resultColors = ['#188038', '#d93025', '#9aa0a6'];

  // 그룹 바 차트 렌더 헬퍼
  const renderBarChart = (chartData: { name: string; 입찰: number; 낙찰: number; 패찰: number }[]) => {
    if (chartData.length === 0) return <div className="empty-state">입찰 데이터가 없습니다.</div>;
    return (
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" fontSize={10} interval={0} angle={-20} textAnchor="end" height={50} />
          <YAxis fontSize={11} allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="입찰" fill="#1a73e8" radius={[4, 4, 0, 0]} />
          <Bar dataKey="낙찰" fill="#188038" radius={[4, 4, 0, 0]} />
          <Bar dataKey="패찰" fill="#d93025" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="stats-section-content">
      <h3 className="stats-subtitle"><TrendingUp size={18} /> 입찰 분석 — {viewLevel === 'all' ? '지사별 비교' : viewLevel === 'branch' ? '팀별 비교' : viewLevel === 'team' ? '개인별 성과' : '개인 상세'}</h3>
      <p className="stats-desc">
        판정: 실제입찰가 &ge; 낙찰가 → <strong style={{ color: '#188038' }}>낙찰</strong> / 실제입찰가 &lt; 낙찰가 → <strong style={{ color: '#d93025' }}>패찰</strong>
      </p>

      {/* 요약 카드 */}
      <div className="bid-stats-grid">
        <div className="bid-stat-card"><div className="bid-stat-value">{totals.total}</div><div className="bid-stat-label">총 입찰</div></div>
        <div className="bid-stat-card" style={{ borderColor: '#c3e6cb' }}><div className="bid-stat-value" style={{ color: '#188038' }}>{totals.win}</div><div className="bid-stat-label">낙찰</div></div>
        <div className="bid-stat-card" style={{ borderColor: '#f5c6cb' }}><div className="bid-stat-value" style={{ color: '#d93025' }}>{totals.lose}</div><div className="bid-stat-label">패찰</div></div>
        <div className="bid-stat-card"><div className="bid-stat-value" style={{ color: '#1a73e8' }}>{totals.winRate > 0 ? totals.winRate.toFixed(1) + '%' : '-'}</div><div className="bid-stat-label">낙찰률</div></div>
        {totals.dev5 > 0 && <div className="bid-stat-card bid-stat-warning"><AlertTriangle size={20} className="bid-stat-warn-icon" /><div className="bid-stat-value">{totals.dev5}건</div><div className="bid-stat-label">5%초과</div></div>}
      </div>

      {/* 전체: 지사별 개별 카드 */}
      {viewLevel === 'all' && allEntries && allMembers && (() => {
        const branchList = [...new Set(allMembers.map((m) => m.branch).filter(Boolean))].sort();
        return (
          <>
            {/* 전체 결과 파이 */}
            <div className="stats-chart-card">
              <h4>전체 결과 분포</h4>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={resultPie} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, value, cx, cy, midAngle, outerRadius, percent }: any) => { const r = outerRadius + 20; const x = cx + r * Math.cos(-midAngle * Math.PI / 180); const y = cy + r * Math.sin(-midAngle * Math.PI / 180); return percent > 0.05 ? <text x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fill="#333">{name} {value}건</text> : null; }}>
                    {resultPie.map((_, i) => <Cell key={i} fill={resultColors[i]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* 지사별 개별 카드 */}
            <div className="stats-chart-row">
              {branchList.map((b) => {
                const bEntries = allEntries.filter((e) => e.activity_type === '입찰' && e.branch === b);
                const s = calcBidStats(bEntries);
                const bPie = [
                  { name: '낙찰', value: s.win },
                  { name: '패찰', value: s.lose },
                  { name: '미확정', value: s.pending },
                ].filter((d) => d.value > 0);
                return (
                  <div key={b} className="stats-chart-card stats-chart-half">
                    <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ background: '#1a73e8', color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem' }}>{b} 지사</span>
                      <span style={{ fontSize: '0.8rem', color: '#5f6368' }}>
                        입찰 {s.total} · 낙찰률 {s.winRate > 0 ? s.winRate.toFixed(1) + '%' : '-'}
                      </span>
                    </h4>
                    {s.total > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={bPie} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value, cx, cy, midAngle, outerRadius, percent }: any) => { const r = outerRadius + 18; const x = cx + r * Math.cos(-midAngle * Math.PI / 180); const y = cy + r * Math.sin(-midAngle * Math.PI / 180); return percent > 0.05 ? <text x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={10} fill="#333">{name} {value}</text> : null; }}>
                            {bPie.map((_, i) => <Cell key={i} fill={resultColors[i]} />)}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="empty-state">입찰 데이터 없음</div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: '#5f6368', textAlign: 'center', marginTop: 4 }}>
                      낙찰 {s.win} · 패찰 {s.lose} · 미확정 {s.pending}
                      {s.dev5 > 0 && <span style={{ color: '#d93025', marginLeft: 8 }}>5%초과 {s.dev5}건</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {/* 지사 선택: 팀별 비교 */}
      {viewLevel === 'branch' && (() => {
        const depts = [...new Set(members.map((m) => m.department).filter(Boolean))].sort();
        const deptChartData = depts.map((d) => {
          const s = calcBidStats(bidEntries.filter((e) => e.department === d));
          return { name: d, 입찰: s.total, 낙찰: s.win, 패찰: s.lose };
        });
        return (
          <>
            <div className="stats-chart-card">
              <h4>팀별 입찰 성과</h4>
              {renderBarChart(deptChartData)}
            </div>
            {depts.map((d) => {
              const deptBids = bidEntries.filter((e) => e.department === d);
              const personData = members.filter((m) => m.department === d).map((m) => {
                const s = calcBidStats(deptBids.filter((e) => e.user_id === m.id));
                return { name: m.name, 입찰: s.total, 낙찰: s.win, 패찰: s.lose };
              }).filter((p) => p.입찰 > 0);
              if (personData.length === 0) return null;
              const dStats = calcBidStats(deptBids);
              return (
                <div key={d} className="stats-chart-card">
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ background: '#7b1fa2', color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem' }}>{d}</span>
                    <span style={{ fontSize: '0.8rem', color: '#5f6368' }}>낙찰률 {dStats.winRate > 0 ? dStats.winRate.toFixed(1) + '%' : '-'}</span>
                  </h4>
                  {renderBarChart(personData)}
                </div>
              );
            })}
          </>
        );
      })()}

      {/* 팀 선택 또는 개인: 개인별 상세 */}
      {(viewLevel === 'team' || viewLevel === 'person') && (() => {
        const personData = members.map((m) => {
          const s = calcBidStats(bidEntries.filter((e) => e.user_id === m.id));
          return { name: m.name, 입찰: s.total, 낙찰: s.win, 패찰: s.lose };
        }).filter((p) => p.입찰 > 0);
        return (
          <>
            <div className="stats-chart-card">
              <h4>개인별 입찰 성과</h4>
              {renderBarChart(personData)}
            </div>
            <div className="stats-chart-row">
              <div className="stats-chart-card stats-chart-half">
                <h4>결과 분포</h4>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={resultPie} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, value, cx, cy, midAngle, outerRadius, percent }: any) => { const r = outerRadius + 20; const x = cx + r * Math.cos(-midAngle * Math.PI / 180); const y = cy + r * Math.sin(-midAngle * Math.PI / 180); return percent > 0.05 ? <text x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fill="#333">{name} {value}건</text> : null; }}>
                      {resultPie.map((_, i) => <Cell key={i} fill={resultColors[i]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="stats-chart-card stats-chart-half">
                <h4>낙찰률 vs 5%초과</h4>
                {renderBarChart(members.map((m) => {
                  const myBids = bidEntries.filter((e) => e.user_id === m.id);
                  const s = calcBidStats(myBids);
                  return { name: m.name, 입찰: 0, 낙찰: Number(s.winRate.toFixed(1)), 패찰: 0 };
                }).filter((d) => d.낙찰 > 0).map((d) => ({ name: d.name, '낙찰률(%)': d.낙찰 } as any)))}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

/* ============================================================ */
/* 2. 근태 분석                                                   */
/* ============================================================ */
function AttendanceAnalysis({ entries, members, viewLevel, allEntries, allMembers }: {
  entries: JournalEntry[]; members: Member[];
  viewLevel: 'all' | 'branch' | 'team' | 'person';
  allEntries?: JournalEntry[]; allMembers?: Member[];
}) {
  const activityTypes: ActivityType[] = ['입찰', '임장', '미팅', '사무', '개인'];

  // 활동 분포 파이차트 렌더 헬퍼
  const renderPie = (label: string, targetEntries: JournalEntry[], color?: string) => {
    const counts = activityTypes.map((t) => ({
      name: t, value: targetEntries.filter((e) => e.activity_type === t).length,
    })).filter((c) => c.value > 0);
    if (counts.length === 0) return null;
    return (
      <div className="stats-chart-card">
        <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {color && <span style={{ background: color, color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem' }}>{label}</span>}
          {!color && label}
          <span style={{ fontSize: '0.8rem', color: '#9aa0a6' }}>총 {targetEntries.length}건</span>
        </h4>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={counts} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, cx, cy, midAngle, outerRadius, percent }: any) => { const r = outerRadius + 20; const x = cx + r * Math.cos(-midAngle * Math.PI / 180); const y = cy + r * Math.sin(-midAngle * Math.PI / 180); return percent > 0.03 ? <text x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fill="#333">{name} {(percent * 100).toFixed(0)}%</text> : null; }}>
              {counts.map((_, i) => <Cell key={i} fill={Object.values(ACTIVITY_COLORS)[i] || COLORS[i]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // 활동 스택바 렌더 헬퍼
  const renderStackBar = (targetMembers: Member[], targetEntries: JournalEntry[]) => {
    const barData = targetMembers.map((m) => {
      const my = targetEntries.filter((e) => e.user_id === m.id);
      return {
        name: m.name,
        입찰: my.filter((e) => e.activity_type === '입찰').length,
        임장: my.filter((e) => e.activity_type === '임장').length,
        미팅: my.filter((e) => e.activity_type === '미팅').length,
        사무: my.filter((e) => e.activity_type === '사무').length,
        개인: my.filter((e) => e.activity_type === '개인').length,
      };
    }).filter((d) => d.입찰 + d.임장 + d.미팅 + d.사무 + d.개인 > 0);
    if (barData.length === 0) return null;
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={barData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" fontSize={10} interval={0} angle={-20} textAnchor="end" height={50} />
          <YAxis fontSize={11} />
          <Tooltip />
          <Legend />
          {activityTypes.map((t) => <Bar key={t} dataKey={t} stackId="a" fill={ACTIVITY_COLORS[t]} />)}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="stats-section-content">
      <h3 className="stats-subtitle"><UserCheck size={18} /> 근태 분석 — {viewLevel === 'all' ? '지사별 활동 분포' : viewLevel === 'branch' ? '팀별 분석' : '개인별 분석'}</h3>

      {/* 전체: 지사별 파이차트(좌우 비교) + 지사별 전체 스택바(좌우 비교) */}
      {viewLevel === 'all' && allEntries && allMembers && (() => {
        const branchList = [...new Set(allMembers.map((m) => m.branch).filter(Boolean))].sort();
        return (
          <>
            {/* 파이차트 좌우 비교 */}
            <div className="stats-chart-row">
              {branchList.map((b) => (
                <div key={b} className="stats-chart-half">
                  {renderPie(b + ' 지사', allEntries.filter((e) => e.branch === b), '#1a73e8')}
                </div>
              ))}
            </div>
            {/* 스택바 좌우 비교 (지사 전체 합산) */}
            <div className="stats-chart-row">
              {branchList.map((b) => {
                const be = allEntries.filter((e) => e.branch === b);
                const barData = [{
                  name: b + ' 지사',
                  입찰: be.filter((e) => e.activity_type === '입찰').length,
                  임장: be.filter((e) => e.activity_type === '임장').length,
                  미팅: be.filter((e) => e.activity_type === '미팅').length,
                  사무: be.filter((e) => e.activity_type === '사무').length,
                  개인: be.filter((e) => e.activity_type === '개인').length,
                }];
                return (
                  <div key={b} className="stats-chart-card stats-chart-half">
                    <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ background: '#1a73e8', color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem' }}>{b} 지사</span>
                      <span style={{ fontSize: '0.8rem', color: '#9aa0a6' }}>전체 활동 {be.length}건</span>
                    </h4>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={barData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" fontSize={10} interval={0} angle={-20} textAnchor="end" height={50} />
                        <YAxis fontSize={11} />
                        <Tooltip />
                        <Legend />
                        {activityTypes.map((t) => <Bar key={t} dataKey={t} fill={ACTIVITY_COLORS[t]} radius={[4, 4, 0, 0]} />)}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {/* 지사 선택: 팀별 전체 통계 */}
      {viewLevel === 'branch' && (() => {
        const depts = [...new Set(members.map((m) => m.department).filter(Boolean))].sort();
        return (
          <>
            {renderPie('활동 분포', entries)}
            {/* 팀별 좌우 비교 */}
            <div className="stats-chart-row">
              {depts.map((d) => {
                const de = entries.filter((e) => e.department === d);
                const barData = [{
                  name: d,
                  입찰: de.filter((e) => e.activity_type === '입찰').length,
                  임장: de.filter((e) => e.activity_type === '임장').length,
                  미팅: de.filter((e) => e.activity_type === '미팅').length,
                  사무: de.filter((e) => e.activity_type === '사무').length,
                  개인: de.filter((e) => e.activity_type === '개인').length,
                }];
                return (
                  <div key={d} className="stats-chart-card stats-chart-half">
                    <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ background: '#7b1fa2', color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem' }}>{d}</span>
                      <span style={{ fontSize: '0.8rem', color: '#9aa0a6' }}>{de.length}건</span>
                    </h4>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={barData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" fontSize={10} interval={0} angle={-20} textAnchor="end" height={50} />
                        <YAxis fontSize={11} />
                        <Tooltip />
                        <Legend />
                        {activityTypes.map((t) => <Bar key={t} dataKey={t} fill={ACTIVITY_COLORS[t]} radius={[4, 4, 0, 0]} />)}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {/* 팀/개인: 담당자별 상세 */}
      {(viewLevel === 'team' || viewLevel === 'person') && (
        <>
          {renderPie('활동 분포', entries)}
          <div className="stats-chart-card">
            <h4>담당자별 활동 유형</h4>
            {renderStackBar(members, entries)}
          </div>
        </>
      )}

      {/* 공통: 외근율 테이블 */}
      <div className="stats-chart-card">
        <h4>외근율 상세</h4>
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>담당자</th><th>팀</th><th>총 활동</th><th>입찰</th><th>임장</th><th>미팅</th><th>사무</th><th>개인</th><th>외근율</th></tr></thead>
            <tbody>
              {members.map((m) => {
                const my = entries.filter((e) => e.user_id === m.id);
                const bid = my.filter((e) => e.activity_type === '입찰').length;
                const insp = my.filter((e) => e.activity_type === '임장').length;
                const total = my.length;
                const rate = total > 0 ? ((bid + insp) / total * 100) : 0;
                if (total === 0) return null;
                return (
                  <tr key={m.id}>
                    <td><strong>{m.name}</strong></td>
                    <td>{m.department || '-'}</td>
                    <td>{total}</td>
                    <td>{bid}</td>
                    <td>{insp}</td>
                    <td>{my.filter((e) => e.activity_type === '미팅').length}</td>
                    <td>{my.filter((e) => e.activity_type === '사무').length}</td>
                    <td>{my.filter((e) => e.activity_type === '개인').length}</td>
                    <td style={{ fontWeight: 700, color: rate > 70 ? '#d93025' : rate > 50 ? '#e65100' : '#3c4043' }}>{rate.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 현장 출퇴근율 (입찰 제외) */}
      <div className="stats-chart-card">
        <h4>현장 출퇴근율 <span style={{ fontSize: '0.75rem', color: '#9aa0a6', fontWeight: 400 }}>임장·미팅 기준, 입찰 제외</span></h4>
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>담당자</th><th>팀</th><th>임장+미팅</th><th>현장출근</th><th>현장출근율</th><th>현장퇴근</th><th>현장퇴근율</th></tr></thead>
            <tbody>
              {members.map((m) => {
                // 입찰 제외, 임장+미팅만 대상
                const fieldEntries = entries.filter((e) => e.user_id === m.id && (e.activity_type === '임장' || e.activity_type === '미팅'));
                if (fieldEntries.length === 0) return null;
                let checkInCount = 0;
                let checkOutCount = 0;
                fieldEntries.forEach((e) => {
                  try {
                    const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                    if (d.fieldCheckIn) checkInCount++;
                    if (d.fieldCheckOut) checkOutCount++;
                  } catch { /* ignore */ }
                });
                const total = fieldEntries.length;
                const inRate = (checkInCount / total * 100);
                const outRate = (checkOutCount / total * 100);
                return (
                  <tr key={m.id}>
                    <td><strong>{m.name}</strong></td>
                    <td>{m.department || '-'}</td>
                    <td>{total}건</td>
                    <td>{checkInCount}건</td>
                    <td style={{ fontWeight: 700, color: inRate >= 80 ? '#188038' : inRate >= 50 ? '#e65100' : '#d93025' }}>{inRate.toFixed(0)}%</td>
                    <td>{checkOutCount}건</td>
                    <td style={{ fontWeight: 700, color: outRate >= 80 ? '#188038' : outRate >= 50 ? '#e65100' : '#d93025' }}>{outRate.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */
/* 3. 이상 감지                                                   */
/* ============================================================ */
function AnomalyDetection({ entries, members }: { entries: JournalEntry[]; members: Member[] }) {
  // 파이프라인: 임장 → 브리핑 → 입찰
  // 사건번호 기준으로 각 단계 매칭

  // 사용자별 사건번호별 단계 수집
  interface CasePipeline {
    caseNo: string;
    userId: string;
    member: Member | undefined;
    hasInspection: boolean;
    hasBriefing: boolean;
    hasBid: boolean;
    inspDate?: string;
    briefDate?: string;
    bidDate?: string;
  }

  const caseMap: Record<string, CasePipeline> = {};

  // 임장 사건번호 (기타=사전답사 등 제외)
  entries.filter((e) => e.activity_type === '임장').forEach((e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.inspClientType === '기타') return;
      const caseNo = d.caseNo || '';
      if (!caseNo) return;
      const key = `${e.user_id}_${caseNo}`;
      if (!caseMap[key]) caseMap[key] = { caseNo, userId: e.user_id, member: members.find((m) => m.id === e.user_id), hasInspection: false, hasBriefing: false, hasBid: false };
      caseMap[key].hasInspection = true;
      caseMap[key].inspDate = e.target_date;
    } catch { /* */ }
  });

  // 브리핑 사건번호 (briefingSubmit 체크된 항목)
  entries.forEach((e) => {
    try {
      const d = JSON.parse(e.data);
      if (!d.briefingSubmit || !d.briefingCaseNo) return;
      const caseNo = d.briefingCaseNo;
      const key = `${e.user_id}_${caseNo}`;
      if (!caseMap[key]) caseMap[key] = { caseNo, userId: e.user_id, member: members.find((m) => m.id === e.user_id), hasInspection: false, hasBriefing: false, hasBid: false };
      caseMap[key].hasBriefing = true;
      caseMap[key].briefDate = e.target_date;
    } catch { /* */ }
  });

  // 입찰 사건번호
  entries.filter((e) => e.activity_type === '입찰').forEach((e) => {
    try {
      const d = JSON.parse(e.data);
      const caseNo = d.caseNo || '';
      if (!caseNo) return;
      const key = `${e.user_id}_${caseNo}`;
      if (!caseMap[key]) caseMap[key] = { caseNo, userId: e.user_id, member: members.find((m) => m.id === e.user_id), hasInspection: false, hasBriefing: false, hasBid: false };
      caseMap[key].hasBid = true;
      caseMap[key].bidDate = e.target_date;
    } catch { /* */ }
  });

  const allCases = Object.values(caseMap);

  // 30일 경과 기준 — 임장 등록일 기준 D+30 이후 입찰이 없으면 '미입찰 이상'으로 간주
  const DAYS_THRESHOLD = 30;
  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayMs = Date.UTC(todayKST.getUTCFullYear(), todayKST.getUTCMonth(), todayKST.getUTCDate());
  const daysSince = (dateStr?: string): number => {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 0;
    const t = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.max(0, Math.floor((todayMs - t) / 86400000));
  };

  // 1. 임장O → 입찰X (브리핑 여부 무관)
  const inspNoBid = allCases.filter((c) => c.hasInspection && !c.hasBid);

  // 2. 임장O + 브리핑O → 입찰X
  const inspBriefNoBid = allCases.filter((c) => c.hasInspection && c.hasBriefing && !c.hasBid);

  // 3. 임장O → 브리핑X (브리핑 미제출)
  const inspNoBrief = allCases.filter((c) => c.hasInspection && !c.hasBriefing);

  // 30일 경과 기준 분류
  const overdueNoBid = inspNoBid.filter((c) => daysSince(c.inspDate) >= DAYS_THRESHOLD);
  const waitingNoBid = inspNoBid.filter((c) => daysSince(c.inspDate) < DAYS_THRESHOLD);
  const overdueBriefNoBid = inspBriefNoBid.filter((c) => daysSince(c.inspDate) >= DAYS_THRESHOLD);
  const overdueNoBrief = inspNoBrief.filter((c) => daysSince(c.inspDate) >= DAYS_THRESHOLD);

  // 4. 제시입찰가 vs 실제입찰가 5% 초과 차이
  const deviationAlerts: { member: Member; date: string; caseNo: string; suggested: number; actual: number; deviation: number; reason: string }[] = [];
  entries.filter((e) => e.activity_type === '입찰').forEach((e) => {
    try {
      const d = JSON.parse(e.data);
      const s = parseCurrency(d.suggestedPrice);
      const a = parseCurrency(d.bidPrice);
      if (s > 0 && a > 0) {
        const dev = (s - a) / s * 100;
        if (dev >= 5) {
          const member = members.find((m) => m.id === e.user_id);
          if (member) deviationAlerts.push({ member, date: e.target_date, caseNo: d.caseNo || '', suggested: s, actual: a, deviation: dev, reason: d.deviationReason || '' });
        }
      }
    } catch { /* */ }
  });

  // 4-2. 제시입찰가 vs 낙찰가 5% 초과 차이
  const winDevAlerts: { member: Member; date: string; caseNo: string; suggested: number; winPrice: number; deviation: number }[] = [];
  entries.filter((e) => e.activity_type === '입찰').forEach((e) => {
    try {
      const d = JSON.parse(e.data);
      const s = parseCurrency(d.suggestedPrice);
      const w = parseCurrency(d.winPrice);
      if (s > 0 && w > 0) {
        const dev = Math.abs(s - w) / s * 100;
        if (dev >= 5) {
          const member = members.find((m) => m.id === e.user_id);
          if (member) winDevAlerts.push({ member, date: e.target_date, caseNo: d.caseNo || '', suggested: s, winPrice: w, deviation: dev });
        }
      }
    } catch { /* */ }
  });

  // 5. 일지 미작성
  const today = new Date();
  const last30: string[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    if (d.getDay() !== 0 && d.getDay() !== 6) last30.push(d.toISOString().split('T')[0]);
  }
  const missingDays = members.filter((m) => ['member', 'manager'].includes(m.role)).map((m) => {
    const myDates = new Set(entries.filter((e) => e.user_id === m.id).map((e) => e.target_date));
    const missing = last30.filter((d) => !myDates.has(d));
    return { name: m.name, department: m.department, missing: missing.length, total: last30.length };
  }).filter((m) => m.missing > 0).sort((a, b) => b.missing - a.missing);

  const fmtWon = (n: number) => (n / 10000).toLocaleString() + '만원';

  // ── 이상감지 통계 (임장 → 입찰 전환율 기반) ──
  const inspCases = allCases.filter((c) => c.hasInspection);
  const totalInsp = inspCases.length;
  const convertedBid = inspCases.filter((c) => c.hasBid).length;
  const waitingBid = inspCases.filter((c) => !c.hasBid && daysSince(c.inspDate) < DAYS_THRESHOLD).length;
  const overdueBid = inspCases.filter((c) => !c.hasBid && daysSince(c.inspDate) >= DAYS_THRESHOLD).length;
  const conversionRate = totalInsp > 0 ? (convertedBid / totalInsp * 100) : 0;

  // 상태 도넛 데이터
  const statusPie = [
    { name: '입찰 완료', value: convertedBid, color: '#188038' },
    { name: `대기중(<${DAYS_THRESHOLD}일)`, value: waitingBid, color: '#f9ab00' },
    { name: `미입찰(${DAYS_THRESHOLD}일 경과)`, value: overdueBid, color: '#d93025' },
  ].filter((d) => d.value > 0);

  // 파이프라인 퍼널 데이터
  const briefCount = allCases.filter((c) => c.hasInspection && c.hasBriefing).length;
  const funnelData = [
    { stage: '임장', count: totalInsp, fill: '#1a73e8' },
    { stage: '브리핑', count: briefCount, fill: '#7b1fa2' },
    { stage: '입찰', count: convertedBid, fill: '#188038' },
  ];

  // 담당자별 전환율
  const memberStats: Record<string, { id: string; name: string; dept: string; insp: number; bid: number; overdue: number }> = {};
  inspCases.forEach((c) => {
    if (!c.member) return;
    const k = c.member.id;
    if (!memberStats[k]) memberStats[k] = { id: k, name: c.member.name, dept: c.member.department || '-', insp: 0, bid: 0, overdue: 0 };
    memberStats[k].insp++;
    if (c.hasBid) memberStats[k].bid++;
    else if (daysSince(c.inspDate) >= DAYS_THRESHOLD) memberStats[k].overdue++;
  });
  const memberRates = Object.values(memberStats)
    .map((m) => ({ ...m, rate: m.insp > 0 ? Math.round(m.bid / m.insp * 100) : 0 }))
    .sort((a, b) => b.insp - a.insp);

  // 지사별 전환율
  const branchStats: Record<string, { branch: string; insp: number; bid: number; overdue: number }> = {};
  inspCases.forEach((c) => {
    if (!c.member) return;
    const br = c.member.branch || '미지정';
    if (!branchStats[br]) branchStats[br] = { branch: br, insp: 0, bid: 0, overdue: 0 };
    branchStats[br].insp++;
    if (c.hasBid) branchStats[br].bid++;
    else if (daysSince(c.inspDate) >= DAYS_THRESHOLD) branchStats[br].overdue++;
  });
  const branchRates = Object.values(branchStats).map((b) => ({ ...b, rate: b.insp > 0 ? Math.round(b.bid / b.insp * 100) : 0 }));

  const dayBadge = (days: number) => {
    const overdue = days >= DAYS_THRESHOLD;
    return (
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 700,
        background: overdue ? '#fce8e6' : '#fef7e0', color: overdue ? '#d93025' : '#b06000',
      }}>
        {overdue ? `${days}일 경과` : `D+${days}`}
      </span>
    );
  };

  const renderCaseTable = (cases: CasePipeline[], title: string, color: string, desc: string) => {
    const sorted = [...cases].sort((a, b) => daysSince(b.inspDate) - daysSince(a.inspDate));
    return (
      <div className="stats-chart-card">
        <h4 style={{ color }}>{title} ({sorted.length}건)</h4>
        <p className="stats-desc">{desc}</p>
        {sorted.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>담당자</th><th>팀</th><th>사건번호</th><th>임장</th><th>경과</th><th>브리핑</th><th>입찰</th></tr></thead>
              <tbody>
                {sorted.map((c, i) => {
                  const d = daysSince(c.inspDate);
                  return (
                    <tr key={i}>
                      <td><strong>{c.member?.name}</strong></td>
                      <td>{c.member?.department || '-'}</td>
                      <td style={{ fontWeight: 600 }}>{c.caseNo}</td>
                      <td style={{ color: c.hasInspection ? '#188038' : '#d93025' }}>{c.hasInspection ? `✓ ${c.inspDate}` : '—'}</td>
                      <td>{c.hasInspection ? dayBadge(d) : '—'}</td>
                      <td style={{ color: c.hasBriefing ? '#1a73e8' : '#d93025' }}>{c.hasBriefing ? `✓ ${c.briefDate}` : '—'}</td>
                      <td style={{ color: c.hasBid ? '#188038' : '#d93025', fontWeight: 700 }}>{c.hasBid ? `✓ ${c.bidDate}` : '✗ 미입찰'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">해당 건이 없습니다.</div>
        )}
      </div>
    );
  };

  return (
    <div className="stats-section-content">
      <h3 className="stats-subtitle"><AlertTriangle size={18} /> 이상 감지 — 업무 파이프라인 (임장 → 브리핑 → 입찰)</h3>
      <p className="stats-desc">
        <strong>30일 경과 기준</strong> — 임장 등록일 기준 {DAYS_THRESHOLD}일이 지나도록 입찰 기록이 없으면 <strong style={{ color: '#d93025' }}>이상(미입찰)</strong>으로 분류합니다.
      </p>

      {/* KPI 카드 */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-number" style={{ color: '#1a73e8' }}>{totalInsp}</div><div className="stat-label">총 임장 건수</div></div>
        <div className="stat-card"><div className="stat-number" style={{ color: '#188038' }}>{convertedBid}</div><div className="stat-label">입찰 전환</div></div>
        <div className="stat-card"><div className="stat-number" style={{ color: conversionRate >= 50 ? '#188038' : '#e65100' }}>{conversionRate.toFixed(1)}%</div><div className="stat-label">전환율</div></div>
        <div className="stat-card"><div className="stat-number" style={{ color: '#f9ab00' }}>{waitingBid}</div><div className="stat-label">{DAYS_THRESHOLD}일내 대기</div></div>
        <div className="stat-card"><div className="stat-number" style={{ color: '#d93025' }}>{overdueBid}</div><div className="stat-label">{DAYS_THRESHOLD}일 경과 미입찰</div></div>
      </div>

      {/* 상태 도넛 + 파이프라인 퍼널 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="stats-chart-card">
          <h4>임장 → 입찰 상태 분포</h4>
          {statusPie.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={statusPie} cx="50%" cy="50%" innerRadius={55} outerRadius={95} dataKey="value"
                  label={({ name, value, cx, cy, midAngle, outerRadius, percent }: any) => {
                    if (percent < 0.04) return null;
                    const r = outerRadius + 18;
                    const x = cx + r * Math.cos(-midAngle * Math.PI / 180);
                    const y = cy + r * Math.sin(-midAngle * Math.PI / 180);
                    return <text x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fill="#333">{name} {value}</text>;
                  }}
                >
                  {statusPie.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (<div className="empty-state">임장 데이터가 없습니다.</div>)}
        </div>

        <div className="stats-chart-card">
          <h4>파이프라인 단계 전환</h4>
          {totalInsp > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={funnelData} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stage" fontSize={12} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {funnelData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  <LabelList dataKey="count" position="top" fontSize={12} fontWeight={700} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (<div className="empty-state">임장 데이터가 없습니다.</div>)}
          <div style={{ marginTop: 4, fontSize: '0.8rem', color: '#5f6368', textAlign: 'center' }}>
            브리핑 전환 {totalInsp > 0 ? Math.round(briefCount / totalInsp * 100) : 0}% · 입찰 전환 {conversionRate.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* 담당자별 전환율 */}
      {memberRates.length > 0 && (
        <div className="stats-chart-card">
          <h4>담당자별 임장 대비 입찰 전환율</h4>
          <p className="stats-desc">임장 건수가 있는 담당자만 표시됩니다. 막대 길이는 건수, 색상은 전환율을 의미합니다.</p>
          <ResponsiveContainer width="100%" height={Math.max(240, memberRates.length * 28)}>
            <BarChart data={memberRates} layout="vertical" margin={{ top: 6, right: 60, left: 0, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} allowDecimals={false} />
              <YAxis dataKey="name" type="category" width={70} fontSize={11} />
              <Tooltip formatter={(v: any, n: any, p: any) => {
                if (n === '입찰 전환') return [`${v}건 (전환율 ${p.payload.rate}%)`, n];
                if (n === '30일 경과 미입찰') return [`${v}건`, n];
                return [v, n];
              }} />
              <Legend />
              <Bar dataKey="bid" name="입찰 전환" stackId="a" fill="#188038" radius={[0, 0, 0, 0]} />
              <Bar dataKey="overdue" name="30일 경과 미입찰" stackId="a" fill="#d93025" radius={[0, 4, 4, 0]}>
                <LabelList dataKey="rate" position="right" formatter={(v: any) => `${v}%`} fontSize={11} fontWeight={700} fill="#3c4043" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 지사별 전환율 */}
      {branchRates.length > 0 && (
        <div className="stats-chart-card">
          <h4>지사별 임장 → 입찰 전환</h4>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={branchRates} margin={{ top: 20, right: 30, left: 0, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="branch" fontSize={12} />
              <YAxis yAxisId="left" fontSize={11} allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} unit="%" fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="insp" name="임장" fill="#1a73e8" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="bid" name="입찰 전환" fill="#188038" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="overdue" name="30일 경과 미입찰" fill="#d93025" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="rate" position="top" formatter={(v: any) => `${v}%`} fontSize={11} fontWeight={700} fill="#188038" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {renderCaseTable(overdueNoBid, `임장 후 30일 경과 미입찰 (이상)`, '#d93025', `임장 등록 후 ${DAYS_THRESHOLD}일이 경과했으나 입찰 기록이 없는 사건입니다.`)}
      {renderCaseTable(overdueBriefNoBid, `임장+브리핑 완료 후 30일 경과 미입찰 (심각)`, '#b71c1c', '브리핑까지 완료했음에도 30일이 지나도록 입찰하지 않은 사건입니다.')}
      {renderCaseTable(overdueNoBrief, `임장 후 30일 경과 브리핑 미제출`, '#7b1fa2', `임장 후 ${DAYS_THRESHOLD}일이 지나도록 브리핑 자료가 제출되지 않은 사건입니다.`)}
      {renderCaseTable(waitingNoBid, `임장 후 ${DAYS_THRESHOLD}일내 대기`, '#f9ab00', `아직 ${DAYS_THRESHOLD}일이 지나지 않아 입찰 여부를 지켜보는 중인 사건입니다.`)}

      {/* 제시입찰가 vs 실제입찰가 5% 차이 */}
      <div className="stats-chart-card">
        <h4 style={{ color: '#d93025' }}>제시입찰가 vs 실제입찰가 — 5% 이상 차이 ({deviationAlerts.length}건)</h4>
        {deviationAlerts.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>담당자</th><th>일자</th><th>사건번호</th><th>제시가</th><th>실제입찰가</th><th>차이율</th><th>사유</th></tr></thead>
              <tbody>
                {deviationAlerts.map((item, i) => (
                  <tr key={i}>
                    <td><strong>{item.member.name}</strong></td>
                    <td>{item.date}</td>
                    <td>{item.caseNo}</td>
                    <td>{fmtWon(item.suggested)}</td>
                    <td>{fmtWon(item.actual)}</td>
                    <td style={{ color: '#d93025', fontWeight: 700 }}>-{item.deviation.toFixed(1)}%</td>
                    <td style={{ color: item.reason ? '#3c4043' : '#d93025' }}>{item.reason || '미작성'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (<div className="empty-state">해당 건이 없습니다.</div>)}
      </div>

      {/* 제시입찰가 vs 낙찰가 5% 차이 */}
      <div className="stats-chart-card">
        <h4 style={{ color: '#e65100' }}>제시입찰가 vs 낙찰가 — 5% 이상 차이 ({winDevAlerts.length}건)</h4>
        {winDevAlerts.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>담당자</th><th>일자</th><th>사건번호</th><th>제시가</th><th>낙찰가</th><th>차이율</th></tr></thead>
              <tbody>
                {winDevAlerts.map((item, i) => (
                  <tr key={i}>
                    <td><strong>{item.member.name}</strong></td>
                    <td>{item.date}</td>
                    <td>{item.caseNo}</td>
                    <td>{fmtWon(item.suggested)}</td>
                    <td>{fmtWon(item.winPrice)}</td>
                    <td style={{ color: '#e65100', fontWeight: 700 }}>{item.winPrice > item.suggested ? '+' : '-'}{item.deviation.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (<div className="empty-state">해당 건이 없습니다.</div>)}
      </div>

      {/* Missing journal */}
      <div className="stats-chart-card">
        <h4>일지 미작성 현황 (최근 30일 평일)</h4>
        {missingDays.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={missingDays} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={11} />
                <YAxis dataKey="name" type="category" width={80} fontSize={11} />
                <Tooltip />
                <Bar dataKey="missing" name="미작성일" fill="#f9ab00" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="table-wrapper" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead><tr><th>담당자</th><th>팀</th><th>평일 수</th><th>미작성일</th><th>작성률</th></tr></thead>
                <tbody>
                  {missingDays.map((m) => (
                    <tr key={m.name}>
                      <td><strong>{m.name}</strong></td>
                      <td>{m.department || '-'}</td>
                      <td>{m.total}</td>
                      <td style={{ color: m.missing > 5 ? '#d93025' : '#e65100', fontWeight: 600 }}>{m.missing}일</td>
                      <td>{((m.total - m.missing) / m.total * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (<div className="empty-state">모든 인원이 일지를 작성했습니다.</div>)}
      </div>
    </div>
  );
}

// ━━━━ 매출/환불 통계 ━━━━
function SalesAnalysis({ records, viewLevel }: {
  records: SalesRecord[];
  members: { id: string; name: string; role: string; branch: string; department: string }[];
  viewLevel: string;
}) {
  // 공급가액 기준 (÷1.1)
  const toSupply = (amount: number) => Math.round(amount / 1.1);
  const confirmed = records.filter(r => r.status === 'confirmed');
  const refunded = records.filter(r => r.status === 'refunded');
  const pending = records.filter(r => r.status === 'pending');
  const totalConfirmed = confirmed.reduce((s, r) => s + toSupply(r.amount), 0);
  const totalRefunded = refunded.reduce((s, r) => s + toSupply(r.amount), 0);
  const totalPending = pending.reduce((s, r) => s + toSupply(r.amount), 0);
  const contractCount = records.filter(r => r.type === '계약' && r.status !== 'refunded').length;

  // 담당자별 or 팀별 or 지사별 집계
  const groupBy = viewLevel === 'person' ? 'person'
    : viewLevel === 'team' ? 'department'
    : viewLevel === 'branch' ? 'branch' : 'branch';

  const grouped: Record<string, { confirmed: number; refunded: number; pending: number; count: number }> = {};
  records.forEach(r => {
    const key = groupBy === 'person' ? (r.user_name || r.user_id)
      : groupBy === 'department' ? (r.department || '미지정')
      : ((r.attribution_branch || r.branch) || '미지정');
    if (!grouped[key]) grouped[key] = { confirmed: 0, refunded: 0, pending: 0, count: 0 };
    grouped[key].count++;
    if (r.status === 'confirmed') grouped[key].confirmed += toSupply(r.amount);
    else if (r.status === 'refunded') grouped[key].refunded += toSupply(r.amount);
    else if (r.status === 'pending') grouped[key].pending += toSupply(r.amount);
  });

  const chartData = Object.entries(grouped).map(([name, v]) => ({
    name, 확정매출: v.confirmed, 환불: v.refunded, 대기: v.pending,
  }));

  // 매출추이 (일별 누적 실선그래프)
  const dailyMap: Record<string, { confirmed: number; refunded: number }> = {};
  records.forEach(r => {
    const d = r.contract_date?.slice(0, 10);
    if (!d) return;
    if (!dailyMap[d]) dailyMap[d] = { confirmed: 0, refunded: 0 };
    if (r.status === 'confirmed') dailyMap[d].confirmed += toSupply(r.amount);
    else if (r.status === 'refunded') dailyMap[d].refunded += toSupply(r.amount);
  });
  const sortedDays = Object.keys(dailyMap).sort();
  let cumConfirmed = 0;
  let cumRefunded = 0;
  const trendData = sortedDays.map(d => {
    cumConfirmed += dailyMap[d].confirmed;
    cumRefunded += dailyMap[d].refunded;
    return { date: d.slice(5), 누적매출: cumConfirmed, 누적환불: cumRefunded, 순매출: cumConfirmed - cumRefunded };
  });

  return (
    <div>
      {/* 요약 카드 */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-number" style={{ color: '#1a73e8' }}>{contractCount}</div><div className="stat-label">계약 건수</div></div>
        <div className="stat-card stat-approved"><div className="stat-number">{totalConfirmed.toLocaleString()}</div><div className="stat-label">확정매출</div></div>
        <div className="stat-card stat-submitted"><div className="stat-number">{totalPending.toLocaleString()}</div><div className="stat-label">입금대기</div></div>
        <div className="stat-card stat-rejected"><div className="stat-number">{totalRefunded.toLocaleString()}</div><div className="stat-label">환불</div></div>
      </div>

      {/* 지사별 매출 카테고리 원형그래프 */}
      {(() => {
        const branchOrder = ['의정부', '서초', '대전', '부산'];
        const typeColors: Record<string, string> = {
          '계약': '#1a73e8', '낙찰': '#7c4dff', '중개': '#188038',
          '권리분석보증서': '#e65100', '매수신청대리': '#d93025', '기타': '#9aa0a6',
        };
        const branchPies = branchOrder.map(branch => {
          const branchConfirmed = confirmed.filter(r => (r.attribution_branch || r.branch) === branch);
          const typeMap: Record<string, number> = {};
          branchConfirmed.forEach(r => {
            const t = r.type || '기타';
            typeMap[t] = (typeMap[t] || 0) + toSupply(r.amount);
          });
          const data = Object.entries(typeMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
          const total = data.reduce((s, d) => s + d.value, 0);
          return { branch, data, total };
        }).filter(b => b.total > 0);

        if (branchPies.length === 0) return null;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(branchPies.length, 4)}, 1fr)`, gap: 12, marginBottom: 20 }}>
            {branchPies.map(bp => (
              <div key={bp.branch} className="card" style={{ padding: 16, textAlign: 'center' }}>
                <h4 style={{ margin: '0 0 4px', fontSize: '0.9rem', color: '#1a1a2e' }}>{bp.branch}</h4>
                <div style={{ fontSize: '0.75rem', color: '#9aa0a6', marginBottom: 8 }}>확정매출 {bp.total.toLocaleString()}원</div>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={bp.data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={30} paddingAngle={2}>
                      {bp.data.map((d, i) => <Cell key={i} fill={typeColors[d.name] || COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => (Number(v) || 0).toLocaleString() + '원'} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 6 }}>
                  {bp.data.map((d, i) => (
                    <span key={i} style={{ fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: typeColors[d.name] || COLORS[i % COLORS.length], display: 'inline-block' }} />
                      {d.name} {d.value.toLocaleString()}원
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* 차트 */}
      {chartData.length > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <h4 style={{ marginBottom: 16 }}>{groupBy === 'person' ? '담당자별' : groupBy === 'department' ? '팀별' : '지사별'} 매출 현황</h4>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => (v / 10000).toFixed(0) + '만'} />
              <Tooltip formatter={(v: any) => (Number(v) || 0).toLocaleString() + '원'} />
              <Legend />
              <Bar dataKey="확정매출" fill="#188038" />
              <Bar dataKey="환불" fill="#d93025" />
              <Bar dataKey="대기" fill="#e65100" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 매출추이 (실선그래프) */}
      {trendData.length > 1 && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <h4 style={{ marginBottom: 16 }}>매출추이</h4>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={(v) => (v / 10000).toFixed(0) + '만'} />
              <Tooltip formatter={(v: any) => (Number(v) || 0).toLocaleString() + '원'} />
              <Legend />
              <Line type="monotone" dataKey="누적매출" stroke="#188038" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="순매출" stroke="#1a73e8" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="누적환불" stroke="#d93025" strokeWidth={1} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 상세 테이블 */}
      <div className="card" style={{ padding: 20 }}>
        <h4 style={{ marginBottom: 12 }}>상세 내역</h4>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>{groupBy === 'person' ? '담당자' : groupBy === 'department' ? '팀' : '지사'}</th><th>건수</th><th>확정매출</th><th>환불</th><th>대기</th></tr>
            </thead>
            <tbody>
              {Object.entries(grouped).sort((a, b) => b[1].confirmed - a[1].confirmed).map(([name, v]) => (
                <tr key={name}>
                  <td><strong>{name}</strong></td>
                  <td>{v.count}</td>
                  <td style={{ color: '#188038', fontWeight: 600 }}>{v.confirmed.toLocaleString()}원</td>
                  <td style={{ color: '#d93025' }}>{v.refunded.toLocaleString()}원</td>
                  <td style={{ color: '#e65100' }}>{v.pending.toLocaleString()}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/* 브리핑 분석                                                     */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function BriefingAnalysis({ entries, members }: { entries: JournalEntry[]; members: Member[] }) {
  // 브리핑자료제출 건
  const briefingSubmits = entries.filter(e => e.activity_type === '브리핑자료제출');
  // 미팅 > 브리핑 건
  const briefingMeetings = entries.filter(e => {
    if (e.activity_type !== '미팅') return false;
    try { const d = JSON.parse(e.data); return d.meetingType === '브리핑'; } catch { return false; }
  });

  const totalSubmits = briefingSubmits.length;
  const totalMeetings = briefingMeetings.length;
  const conversionRate = totalSubmits > 0 ? Math.round((totalMeetings / totalSubmits) * 100) : 0;

  // 담당자별 통계
  const userStats: Record<string, { name: string; branch: string; submits: number; meetings: number }> = {};
  briefingSubmits.forEach(e => {
    if (!userStats[e.user_id]) {
      const m = members.find(mm => mm.id === e.user_id);
      userStats[e.user_id] = { name: (e as any).user_name || m?.name || '', branch: e.branch || m?.branch || '', submits: 0, meetings: 0 };
    }
    userStats[e.user_id].submits++;
  });
  briefingMeetings.forEach(e => {
    if (!userStats[e.user_id]) {
      const m = members.find(mm => mm.id === e.user_id);
      userStats[e.user_id] = { name: (e as any).user_name || m?.name || '', branch: e.branch || m?.branch || '', submits: 0, meetings: 0 };
    }
    userStats[e.user_id].meetings++;
  });
  const userList = Object.values(userStats).filter(u => u.submits > 0 || u.meetings > 0).sort((a, b) => b.submits - a.submits);

  // 차트 데이터
  const chartData = userList.slice(0, 10).map(u => ({
    name: u.name,
    제출: u.submits,
    브리핑: u.meetings,
    전환율: u.submits > 0 ? Math.round((u.meetings / u.submits) * 100) : 0,
  }));

  return (
    <div>
      <h3 className="stats-subtitle"><TrendingUp size={18} /> 브리핑 분석 — 자료제출 vs 실제 브리핑</h3>

      {/* 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #0d47a1' }}>
          <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>브리핑 자료제출</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0d47a1' }}>{totalSubmits}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>건</span></div>
        </div>
        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #e65100' }}>
          <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>실제 브리핑 미팅</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#e65100' }}>{totalMeetings}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>건</span></div>
        </div>
        <div className="card" style={{ padding: '16px 20px', borderLeft: `4px solid ${conversionRate >= 50 ? '#188038' : '#d93025'}` }}>
          <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>브리핑 전환율</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: conversionRate >= 50 ? '#188038' : '#d93025' }}>{conversionRate}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>%</span></div>
        </div>
      </div>

      {/* 차트 */}
      {chartData.length > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <h4 style={{ margin: '0 0 16px', fontSize: '0.9rem' }}>담당자별 브리핑 제출 vs 실제 미팅</h4>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="제출" fill="#0d47a1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="브리핑" fill="#e65100" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 담당자별 상세 테이블 */}
      <div className="card" style={{ padding: 20 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>담당자별 상세</h4>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>담당자</th><th>지사</th><th>자료제출</th><th>브리핑 미팅</th><th>전환율</th></tr>
            </thead>
            <tbody>
              {userList.map((u, i) => {
                const rate = u.submits > 0 ? Math.round((u.meetings / u.submits) * 100) : 0;
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{u.name}</td>
                    <td style={{ fontSize: '0.78rem', color: '#5f6368' }}>{u.branch}</td>
                    <td style={{ color: '#0d47a1', fontWeight: 600 }}>{u.submits}</td>
                    <td style={{ color: '#e65100', fontWeight: 600 }}>{u.meetings}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600,
                        background: rate >= 50 ? '#e8f5e9' : rate > 0 ? '#fff3e0' : '#f5f5f5',
                        color: rate >= 50 ? '#188038' : rate > 0 ? '#e65100' : '#9aa0a6',
                      }}>{rate}%</span>
                    </td>
                  </tr>
                );
              })}
              {userList.length === 0 && <tr><td colSpan={5} className="empty-state">브리핑 데이터가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
