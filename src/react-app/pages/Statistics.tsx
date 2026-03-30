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

  // Apply filters
  const filteredMembers = members.filter((m) =>
    (!filterBranch || m.branch === filterBranch) &&
    (!filterDept || m.department === filterDept) &&
    (!filterUser || m.id === filterUser)
  );
  const filteredEntries = entries.filter((e) => {
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
          {isCeoPlus && (
            <select value={filterBranch} onChange={(e) => { setFilterBranch(e.target.value); setFilterDept(''); setFilterUser(''); }} className="stats-filter-select">
              <option value="">전체 지사</option>
              {branches.map((b) => <option key={b} value={b}>{b} 지사</option>)}
            </select>
          )}
          <select value={filterDept} onChange={(e) => { setFilterDept(e.target.value); setFilterUser(''); }} className="stats-filter-select">
            <option value="">전체 팀</option>
            {filteredDepts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className="stats-filter-select">
            <option value="">전체 인원</option>
            {filteredUsers.map((m) => <option key={m.id} value={m.id}>{m.name} ({ROLE_LABELS[m.role as Role]})</option>)}
          </select>
        </div>
      </div>

      {/* Filter summary */}
      {(filterBranch || filterDept || filterUser) && (
        <div className="stats-filter-summary">
          필터: {filterBranch && <span className="stats-filter-tag">{filterBranch} 지사</span>}
          {filterDept && <span className="stats-filter-tag">{filterDept}</span>}
          {filterUser && <span className="stats-filter-tag">{filteredUsers.find((m) => m.id === filterUser)?.name}</span>}
          <button className="btn-link" style={{ fontSize: '0.75rem', marginLeft: 8 }} onClick={() => { setFilterBranch(''); setFilterDept(''); setFilterUser(''); }}>초기화</button>
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
        {tab === 0 && <BidAnalysis entries={filteredEntries} members={filteredMembers} showBranchBreakdown={isCeoPlus && !filterBranch} allEntries={entries} allMembers={members} />}
        {tab === 1 && <AttendanceAnalysis entries={filteredEntries} members={filteredMembers} />}
        {tab === 2 && <AnomalyDetection entries={filteredEntries} members={filteredMembers} />}
      </div>
    </div>
  );
}

/* ============================================================ */
/* 1. 입찰 분석                                                   */
/* ============================================================ */
function BidAnalysis({ entries, members, showBranchBreakdown, allEntries, allMembers }: {
  entries: JournalEntry[]; members: Member[];
  showBranchBreakdown?: boolean; allEntries?: JournalEntry[]; allMembers?: Member[];
}) {
  const bidEntries = entries.filter((e) => e.activity_type === '입찰');

  // 판정 기준:
  // 실제입찰가 >= 낙찰가 → 낙찰
  // 실제입찰가 < 낙찰가 → 패찰
  // 낙찰가 미입력 → 미확정

  const personStats = members.map((m) => {
    const myBids = bidEntries.filter((e) => e.user_id === m.id);
    let totalSuggested = 0, totalActual = 0, totalWin = 0;
    let winCount = 0, loseCount = 0, pendingCount = 0, deviationOver5 = 0;
    const deviations: number[] = [];

    myBids.forEach((e) => {
      try {
        const d = JSON.parse(e.data);
        const s = parseCurrency(d.suggestedPrice);
        const a = parseCurrency(d.bidPrice);
        const w = parseCurrency(d.winPrice);
        if (s > 0) totalSuggested += s;
        if (a > 0) totalActual += a;

        // 낙찰 판정
        if (w > 0) {
          totalWin += w;
          if (a >= w) { winCount++; }    // 낙찰: 실제입찰가 >= 낙찰가
          else { loseCount++; }           // 패찰: 실제입찰가 < 낙찰가
        } else {
          pendingCount++;                 // 미확정: 낙찰가 미입력
        }

        // 제시가 vs 실제가 차이
        if (s > 0 && a > 0) {
          const dev = (s - a) / s * 100;
          deviations.push(dev);
          if (dev >= 5) deviationOver5++;
        }
      } catch { /* */ }
    });

    const determined = winCount + loseCount;

    return {
      name: m.name,
      role: m.role,
      department: m.department,
      bids: myBids.length,
      totalSuggested,
      totalActual,
      totalWin,
      winCount,
      loseCount,
      pendingCount,
      winRate: determined > 0 ? (winCount / determined * 100) : 0,
      avgDeviation: deviations.length > 0 ? deviations.reduce((a, b) => a + b, 0) / deviations.length : 0,
      deviationOver5,
      deviationRate: myBids.length > 0 ? (deviationOver5 / myBids.length * 100) : 0,
    };
  }).filter((p) => p.bids > 0);

  // 전체 합산
  const totals = personStats.reduce((acc, p) => ({
    bids: acc.bids + p.bids,
    win: acc.win + p.winCount,
    lose: acc.lose + p.loseCount,
    pending: acc.pending + p.pendingCount,
    dev5: acc.dev5 + p.deviationOver5,
  }), { bids: 0, win: 0, lose: 0, pending: 0, dev5: 0 });

  // Charts
  const barData = personStats.map((p) => ({
    name: p.name,
    입찰: p.bids,
    낙찰: p.winCount,
    패찰: p.loseCount,
    미확정: p.pendingCount,
  }));

  const rateData = personStats.map((p) => ({
    name: p.name,
    '낙찰률(%)': Number(p.winRate.toFixed(1)),
    '5%초과비율(%)': Number(p.deviationRate.toFixed(1)),
  }));

  // Pie for overall win/lose/pending
  const resultPie = [
    { name: '낙찰', value: totals.win },
    { name: '패찰', value: totals.lose },
    { name: '미확정', value: totals.pending },
  ].filter((d) => d.value > 0);
  const resultColors = ['#188038', '#d93025', '#9aa0a6'];

  const fmtWon = (n: number) => n > 0 ? (n / 10000).toLocaleString() + '만원' : '-';

  return (
    <div className="stats-section-content">
      <h3 className="stats-subtitle"><TrendingUp size={18} /> 담당자별 입찰 성과</h3>
      <p className="stats-desc">
        판정 기준: 실제입찰가 &ge; 낙찰가 → <strong style={{ color: '#188038' }}>낙찰</strong> / 실제입찰가 &lt; 낙찰가 → <strong style={{ color: '#d93025' }}>패찰</strong> / 낙찰가 미입력 → 미확정
      </p>

      {/* Summary cards */}
      <div className="bid-stats-grid">
        <div className="bid-stat-card"><div className="bid-stat-value">{totals.bids}</div><div className="bid-stat-label">총 입찰</div></div>
        <div className="bid-stat-card" style={{ borderColor: '#c3e6cb' }}><div className="bid-stat-value" style={{ color: '#188038' }}>{totals.win}</div><div className="bid-stat-label">낙찰</div></div>
        <div className="bid-stat-card" style={{ borderColor: '#f5c6cb' }}><div className="bid-stat-value" style={{ color: '#d93025' }}>{totals.lose}</div><div className="bid-stat-label">패찰</div></div>
        <div className="bid-stat-card"><div className="bid-stat-value" style={{ color: '#9aa0a6' }}>{totals.pending}</div><div className="bid-stat-label">미확정</div></div>
        <div className="bid-stat-card"><div className="bid-stat-value" style={{ color: '#1a73e8' }}>{totals.bids > 0 && (totals.win + totals.lose) > 0 ? (totals.win / (totals.win + totals.lose) * 100).toFixed(1) + '%' : '-'}</div><div className="bid-stat-label">전체 낙찰률</div></div>
        {totals.dev5 > 0 && <div className="bid-stat-card bid-stat-warning"><AlertTriangle size={20} className="bid-stat-warn-icon" /><div className="bid-stat-value">{totals.dev5}건</div><div className="bid-stat-label">5%초과 차이</div></div>}
      </div>

      <div className="stats-chart-row">
        {/* Result pie */}
        <div className="stats-chart-card stats-chart-half">
          <h4>입찰 결과 분포</h4>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={resultPie} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={(props: any) => `${props.name} ${props.value}건`}>
                {resultPie.map((_, i) => <Cell key={i} fill={resultColors[i]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Bar chart */}
        <div className="stats-chart-card stats-chart-half">
          <h4>담당자별 입찰 / 낙찰 / 패찰</h4>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar dataKey="입찰" fill="#1a73e8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="낙찰" fill="#188038" radius={[4, 4, 0, 0]} />
              <Bar dataKey="패찰" fill="#d93025" radius={[4, 4, 0, 0]} />
              <Bar dataKey="미확정" fill="#bdc1c6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Line chart - 낙찰률 vs 5% 초과 비율 */}
      <div className="stats-chart-card">
        <h4>낙찰률 vs 5% 초과 차이 비율 (담당자별)</h4>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={rateData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" fontSize={12} />
            <YAxis fontSize={12} unit="%" />
            <Tooltip />
            <Legend />
            <Bar dataKey="낙찰률(%)" fill="#188038" radius={[4, 4, 0, 0]} />
            <Bar dataKey="5%초과비율(%)" fill="#d93025" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="stats-desc" style={{ marginTop: 8 }}>
          5% 초과 비율이 높고 낙찰률이 낮은 담당자는 입찰가 조정 패턴을 점검할 필요가 있습니다.
        </p>
      </div>

      {/* Detail Table */}
      <div className="stats-chart-card">
        <h4>상세 데이터</h4>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>담당자</th>
                <th>팀</th>
                <th>입찰</th>
                <th>낙찰</th>
                <th>패찰</th>
                <th>미확정</th>
                <th>낙찰률</th>
                <th>제시가 합</th>
                <th>입찰가 합</th>
                <th>평균차이율</th>
                <th>5%초과</th>
                <th>초과비율</th>
              </tr>
            </thead>
            <tbody>
              {personStats.sort((a, b) => b.winRate - a.winRate).map((p) => (
                <tr key={p.name}>
                  <td><strong>{p.name}</strong> <span style={{ color: '#9aa0a6', fontSize: '0.65rem' }}>{ROLE_LABELS[p.role as Role]}</span></td>
                  <td>{p.department || '-'}</td>
                  <td>{p.bids}</td>
                  <td style={{ color: '#188038', fontWeight: 600 }}>{p.winCount}</td>
                  <td style={{ color: '#d93025', fontWeight: 600 }}>{p.loseCount}</td>
                  <td style={{ color: '#9aa0a6' }}>{p.pendingCount}</td>
                  <td style={{ fontWeight: 700, color: p.winRate >= 50 ? '#188038' : p.winRate > 0 ? '#e65100' : '#9aa0a6' }}>
                    {p.winRate > 0 ? p.winRate.toFixed(1) + '%' : '-'}
                  </td>
                  <td>{fmtWon(p.totalSuggested)}</td>
                  <td>{fmtWon(p.totalActual)}</td>
                  <td style={{ color: p.avgDeviation >= 5 ? '#d93025' : '#3c4043' }}>{p.avgDeviation.toFixed(1)}%</td>
                  <td style={{ color: p.deviationOver5 > 0 ? '#d93025' : '#9aa0a6', fontWeight: p.deviationOver5 > 0 ? 700 : 400 }}>{p.deviationOver5}건</td>
                  <td style={{ color: p.deviationRate >= 30 ? '#d93025' : p.deviationRate > 0 ? '#e65100' : '#9aa0a6', fontWeight: 600 }}>
                    {p.deviationRate > 0 ? p.deviationRate.toFixed(0) + '%' : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 지사별 비교 (대표 이상, 필터 미적용 시) */}
      {showBranchBreakdown && allEntries && allMembers && (
        <div className="stats-chart-card">
          <h4>지사별 입찰 성과 비교</h4>
          {(() => {
            const branchList = [...new Set(allMembers.map((m) => m.branch).filter(Boolean))].sort();
            const branchData = branchList.map((branch) => {
              const bEntries = allEntries.filter((e) => e.activity_type === '입찰' && e.branch === branch);
              let win = 0, lose = 0, pending = 0, dev5 = 0;
              bEntries.forEach((e) => {
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
              return {
                name: branch + ' 지사',
                입찰: bEntries.length,
                낙찰: win,
                패찰: lose,
                미확정: pending,
                낙찰률: det > 0 ? Number((win / det * 100).toFixed(1)) : 0,
                '5%초과': dev5,
              };
            });

            return (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={branchData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="입찰" fill="#1a73e8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="낙찰" fill="#188038" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="패찰" fill="#d93025" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="5%초과" fill="#f9ab00" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="table-wrapper" style={{ marginTop: 12 }}>
                  <table className="data-table">
                    <thead><tr><th>지사</th><th>입찰</th><th>낙찰</th><th>패찰</th><th>미확정</th><th>낙찰률</th><th>5%초과</th></tr></thead>
                    <tbody>
                      {branchData.map((b) => (
                        <tr key={b.name}>
                          <td><strong>{b.name}</strong></td>
                          <td>{b.입찰}</td>
                          <td style={{ color: '#188038', fontWeight: 600 }}>{b.낙찰}</td>
                          <td style={{ color: '#d93025', fontWeight: 600 }}>{b.패찰}</td>
                          <td style={{ color: '#9aa0a6' }}>{b.미확정}</td>
                          <td style={{ fontWeight: 700, color: b.낙찰률 >= 50 ? '#188038' : '#e65100' }}>{b.낙찰률 > 0 ? b.낙찰률 + '%' : '-'}</td>
                          <td style={{ color: b['5%초과'] > 0 ? '#d93025' : '#9aa0a6', fontWeight: 600 }}>{b['5%초과']}건</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/* ============================================================ */
/* 2. 근태 분석                                                   */
/* ============================================================ */
function AttendanceAnalysis({ entries, members }: { entries: JournalEntry[]; members: Member[] }) {
  const activityTypes: ActivityType[] = ['입찰', '임장', '미팅', '사무', '개인'];

  // Per-person activity breakdown
  const personActivity = members.map((m) => {
    const myEntries = entries.filter((e) => e.user_id === m.id);
    const bid = myEntries.filter((e) => e.activity_type === '입찰').length;
    const insp = myEntries.filter((e) => e.activity_type === '임장').length;
    const meet = myEntries.filter((e) => e.activity_type === '미팅').length;
    const office = myEntries.filter((e) => e.activity_type === '사무').length;
    const personal = myEntries.filter((e) => e.activity_type === '개인').length;

    let fieldCheckInCount = 0, fieldCheckOutCount = 0;
    myEntries.forEach((e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.fieldCheckIn) fieldCheckInCount++;
        if (d.fieldCheckOut) fieldCheckOutCount++;
      } catch { /* */ }
    });

    return {
      name: m.name,
      role: m.role,
      department: m.department,
      total: myEntries.length,
      bid, insp, meet, office, personal,
      fieldCheckIn: fieldCheckInCount,
      fieldCheckOut: fieldCheckOutCount,
      외근율: myEntries.length > 0 ? ((bid + insp) / myEntries.length * 100) : 0,
    };
  }).filter((p) => p.total > 0);

  // Pie chart - overall distribution
  const overallCounts = activityTypes.map((t) => ({
    name: t,
    value: entries.filter((e) => e.activity_type === t).length,
  })).filter((c) => c.value > 0);

  const barData = personActivity.map((p) => ({
    name: p.name,
    입찰: p.bid,
    임장: p.insp,
    미팅: p.meet,
    사무: p.office,
    개인: p.personal,
  }));

  return (
    <div className="stats-section-content">
      <h3 className="stats-subtitle"><UserCheck size={18} /> 근태 및 활동 분석</h3>

      <div className="stats-chart-row">
        {/* Pie */}
        <div className="stats-chart-card stats-chart-half">
          <h4>전체 활동 분포</h4>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={overallCounts} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={(props: any) => `${props.name} ${(props.percent * 100).toFixed(0)}%`}>
                {overallCounts.map((_, i) => <Cell key={i} fill={Object.values(ACTIVITY_COLORS)[i] || COLORS[i]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Field check stats */}
        <div className="stats-chart-card stats-chart-half">
          <h4>현장 출퇴근 현황</h4>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={personActivity.map((p) => ({ name: p.name, 현장출근: p.fieldCheckIn, 현장퇴근: p.fieldCheckOut }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar dataKey="현장출근" fill="#d93025" radius={[4, 4, 0, 0]} />
              <Bar dataKey="현장퇴근" fill="#e65100" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stacked bar per person */}
      <div className="stats-chart-card">
        <h4>담당자별 활동 유형 분포</h4>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={barData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Legend />
            {activityTypes.map((t) => (
              <Bar key={t} dataKey={t} stackId="a" fill={ACTIVITY_COLORS[t]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detail Table */}
      <div className="stats-chart-card">
        <h4>외근율 상세</h4>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>담당자</th>
                <th>팀</th>
                <th>총 활동</th>
                <th>입찰</th>
                <th>임장</th>
                <th>미팅</th>
                <th>사무</th>
                <th>개인</th>
                <th>현장출근</th>
                <th>현장퇴근</th>
                <th>외근율</th>
              </tr>
            </thead>
            <tbody>
              {personActivity.sort((a, b) => b.외근율 - a.외근율).map((p) => (
                <tr key={p.name}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.department || '-'}</td>
                  <td>{p.total}</td>
                  <td>{p.bid}</td>
                  <td>{p.insp}</td>
                  <td>{p.meet}</td>
                  <td>{p.office}</td>
                  <td>{p.personal}</td>
                  <td style={{ color: '#d93025', fontWeight: 600 }}>{p.fieldCheckIn}</td>
                  <td style={{ color: '#e65100', fontWeight: 600 }}>{p.fieldCheckOut}</td>
                  <td style={{ fontWeight: 700, color: p.외근율 > 70 ? '#d93025' : p.외근율 > 50 ? '#e65100' : '#3c4043' }}>
                    {p.외근율.toFixed(0)}%
                  </td>
                </tr>
              ))}
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
  // 1. 임장 했지만 입찰 안한 케이스
  const inspectionNoBid: { member: Member; date: string; caseNo: string }[] = [];

  // Group by user+date
  const byUserDate: Record<string, JournalEntry[]> = {};
  entries.forEach((e) => {
    const key = `${e.user_id}_${e.target_date}`;
    if (!byUserDate[key]) byUserDate[key] = [];
    byUserDate[key].push(e);
  });

  Object.values(byUserDate).forEach((dayEntries) => {
    const inspections = dayEntries.filter((e) => e.activity_type === '임장');

    inspections.forEach((insp) => {
      try {
        const d = JSON.parse(insp.data);
        const caseNo = d.caseNo || '';
        // Check if there's a bid for this case on any date
        const hasBid = entries.some((e) =>
          e.user_id === insp.user_id && e.activity_type === '입찰' &&
          JSON.parse(e.data).caseNo === caseNo
        );
        if (!hasBid && caseNo) {
          const member = members.find((m) => m.id === insp.user_id);
          if (member) {
            inspectionNoBid.push({ member, date: insp.target_date, caseNo });
          }
        }
      } catch { /* */ }
    });
  });

  // 2. 제시입찰가 대비 5% 이상 낮은 입찰
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
          if (member) {
            deviationAlerts.push({
              member, date: e.target_date, caseNo: d.caseNo || '',
              suggested: s, actual: a, deviation: dev, reason: d.deviationReason || '',
            });
          }
        }
      }
    } catch { /* */ }
  });

  // 3. 일지 미작성 일수 (최근 30일 기준)
  const today = new Date();
  const last30: string[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (d.getDay() !== 0 && d.getDay() !== 6) { // 평일만
      last30.push(d.toISOString().split('T')[0]);
    }
  }

  const missingDays = members.filter((m) => ['member', 'manager'].includes(m.role)).map((m) => {
    const myDates = new Set(entries.filter((e) => e.user_id === m.id).map((e) => e.target_date));
    const missing = last30.filter((d) => !myDates.has(d));
    return { name: m.name, department: m.department, missing: missing.length, total: last30.length };
  }).filter((m) => m.missing > 0).sort((a, b) => b.missing - a.missing);

  const fmtWon = (n: number) => (n / 10000).toLocaleString() + '만원';

  return (
    <div className="stats-section-content">
      <h3 className="stats-subtitle"><AlertTriangle size={18} /> 이상 감지 및 알림</h3>

      {/* Inspection without bid */}
      <div className="stats-chart-card">
        <h4 style={{ color: '#e65100' }}>임장 후 미입찰 건 ({inspectionNoBid.length}건)</h4>
        <p className="stats-desc">임장을 진행했으나 해당 사건에 대한 입찰 기록이 없는 건입니다.</p>
        {inspectionNoBid.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>담당자</th><th>팀</th><th>일자</th><th>사건번호</th></tr></thead>
              <tbody>
                {inspectionNoBid.map((item, i) => (
                  <tr key={i}>
                    <td><strong>{item.member.name}</strong></td>
                    <td>{item.member.department || '-'}</td>
                    <td>{item.date}</td>
                    <td style={{ color: '#e65100', fontWeight: 600 }}>{item.caseNo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">해당 건이 없습니다.</div>
        )}
      </div>

      {/* 5% deviation alerts */}
      <div className="stats-chart-card">
        <h4 style={{ color: '#d93025' }}>제시입찰가 대비 5% 이상 차이 ({deviationAlerts.length}건)</h4>
        <p className="stats-desc">브리핑 시 제시된 금액보다 5% 이상 낮게 입찰한 건입니다.</p>
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
        ) : (
          <div className="empty-state">해당 건이 없습니다.</div>
        )}
      </div>

      {/* Missing journal days */}
      <div className="stats-chart-card">
        <h4>일지 미작성 현황 (최근 30일 평일 기준)</h4>
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
        ) : (
          <div className="empty-state">모든 인원이 일지를 작성했습니다.</div>
        )}
      </div>
    </div>
  );
}
