import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { ROLE_LABELS } from '../types';
import type { Role } from '../types';
import type { JournalEntry } from '../journal/types';
import { ACTIVITY_COLORS, type ActivityType } from '../journal/types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { BarChart3, TrendingUp, AlertTriangle, UserCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import Select from '../components/Select';

interface Member {
  id: string; name: string; role: string; branch: string; department: string;
}

function parseCurrency(val: string): number {
  return Number((val || '').replace(/[^0-9]/g, '')) || 0;
}

const COLORS = ['#1a73e8', '#e65100', '#188038', '#7b1fa2', '#f9ab00', '#d93025', '#00897b', '#5c6bc0'];

export default function Statistics() {
  const { user } = useAuthStore();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const tabs = ['입찰 분석', '근태 분석', '이상 감지'];

  const isCeoPlus = user?.role === 'master' || user?.role === 'ceo';

  useEffect(() => {
    Promise.all([api.journal.list({ range: 'all' }), api.journal.members()])
      .then(([eRes, mRes]) => { setEntries(eRes.entries); setMembers(mRes.members); })
      .finally(() => setLoading(false));
  }, []);

  // Available branches/depts/users for filters
  const branches = [...new Set(members.map((m) => m.branch).filter(Boolean))].sort();
  const filteredDepts = [...new Set(
    members.filter((m) => !filterBranch || m.branch === filterBranch).map((m) => m.department).filter(Boolean)
  )].sort();
  const filteredUsers = members.filter((m) =>
    (!filterBranch || m.branch === filterBranch) &&
    (!filterDept || m.department === filterDept)
  );

  // 월별 옵션
  const monthOptions = [...new Set(entries.map((e) => e.target_date.slice(0, 7)))].sort((a, b) => b.localeCompare(a))
    .map((m) => ({ value: m, label: m }));

  // Apply filters
  const filteredMembers = members.filter((m) =>
    (!filterBranch || m.branch === filterBranch) &&
    (!filterDept || m.department === filterDept) &&
    (!filterUser || m.id === filterUser)
  );
  const filteredEntries = entries.filter((e) => {
    if (filterMonth && !e.target_date.startsWith(filterMonth)) return false;
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
          {isCeoPlus && branches.length > 0 && (
            <div className="stats-branch-slide">
              <button
                className={`stats-branch-btn ${filterBranch === '' ? 'active' : ''}`}
                onClick={() => { setFilterBranch(''); setFilterDept(''); setFilterUser(''); }}
              >
                전체
              </button>
              {branches.map((b) => (
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
              placeholder="전체 기간"
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
          <button className="btn-link" style={{ fontSize: '0.75rem', marginLeft: 8 }} onClick={() => { setFilterBranch(''); setFilterDept(''); setFilterUser(''); setFilterMonth(''); }}>초기화</button>
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
            {t}
          </button>
        ))}
        <button className="journal-slide-btn" onClick={() => setTab((t) => (t + 1) % tabs.length)}>
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="stats-content">
        {tab === 0 && <BidAnalysis entries={filteredEntries} members={filteredMembers} viewLevel={filterUser ? 'person' : filterDept ? 'team' : filterBranch ? 'branch' : 'all'} allEntries={entries} allMembers={members} />}
        {tab === 1 && <AttendanceAnalysis entries={filteredEntries} members={filteredMembers} viewLevel={filterUser ? 'person' : filterDept ? 'team' : filterBranch ? 'branch' : 'all'} allEntries={entries} allMembers={members} />}
        {tab === 2 && <AnomalyDetection entries={filteredEntries} members={filteredMembers} />}
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
      if (w > 0) { if (a >= w) win++; else lose++; } else pending++;
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
          <XAxis dataKey="name" fontSize={11} />
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
                  <Pie data={resultPie} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={(props: any) => `${props.name} ${props.value}건`}>
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
                          <Pie data={bPie} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={(props: any) => `${props.name} ${props.value}`}>
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
                    <Pie data={resultPie} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={(props: any) => `${props.name} ${props.value}건`}>
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
            <Pie data={counts} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={(props: any) => `${props.name} ${(props.percent * 100).toFixed(0)}%`}>
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
          <XAxis dataKey="name" fontSize={11} />
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
                        <XAxis dataKey="name" fontSize={11} />
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
                        <XAxis dataKey="name" fontSize={11} />
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

  // 임장 사건번호
  entries.filter((e) => e.activity_type === '임장').forEach((e) => {
    try {
      const d = JSON.parse(e.data);
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

  // 1. 임장O → 입찰X (브리핑 여부 무관)
  const inspNoBid = allCases.filter((c) => c.hasInspection && !c.hasBid);

  // 2. 임장O + 브리핑O → 입찰X
  const inspBriefNoBid = allCases.filter((c) => c.hasInspection && c.hasBriefing && !c.hasBid);

  // 3. 임장O → 브리핑X (브리핑 미제출)
  const inspNoBrief = allCases.filter((c) => c.hasInspection && !c.hasBriefing);

  // 4. 5% 초과 차이
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

  const renderCaseTable = (cases: CasePipeline[], title: string, color: string, desc: string) => (
    <div className="stats-chart-card">
      <h4 style={{ color }}>{title} ({cases.length}건)</h4>
      <p className="stats-desc">{desc}</p>
      {cases.length > 0 ? (
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>담당자</th><th>팀</th><th>사건번호</th><th>임장</th><th>브리핑</th><th>입찰</th></tr></thead>
            <tbody>
              {cases.map((c, i) => (
                <tr key={i}>
                  <td><strong>{c.member?.name}</strong></td>
                  <td>{c.member?.department || '-'}</td>
                  <td style={{ fontWeight: 600 }}>{c.caseNo}</td>
                  <td style={{ color: c.hasInspection ? '#188038' : '#d93025' }}>{c.hasInspection ? `✓ ${c.inspDate}` : '—'}</td>
                  <td style={{ color: c.hasBriefing ? '#1a73e8' : '#d93025' }}>{c.hasBriefing ? `✓ ${c.briefDate}` : '—'}</td>
                  <td style={{ color: c.hasBid ? '#188038' : '#d93025', fontWeight: 700 }}>{c.hasBid ? `✓ ${c.bidDate}` : '✗ 미입찰'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">해당 건이 없습니다.</div>
      )}
    </div>
  );

  return (
    <div className="stats-section-content">
      <h3 className="stats-subtitle"><AlertTriangle size={18} /> 이상 감지 — 업무 파이프라인 (임장 → 브리핑 → 입찰)</h3>

      {renderCaseTable(inspNoBid, '임장 후 미입찰', '#e65100', '임장을 진행했으나 입찰 기록이 없는 사건입니다.')}
      {renderCaseTable(inspBriefNoBid, '임장 + 브리핑 완료 → 미입찰', '#d93025', '임장과 브리핑까지 했으나 입찰을 하지 않은 사건입니다.')}
      {renderCaseTable(inspNoBrief, '임장 후 브리핑 미제출', '#7b1fa2', '임장을 진행했으나 브리핑자료를 제출하지 않은 사건입니다.')}

      {/* 5% deviation */}
      <div className="stats-chart-card">
        <h4 style={{ color: '#d93025' }}>제시입찰가 대비 5% 이상 차이 ({deviationAlerts.length}건)</h4>
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
