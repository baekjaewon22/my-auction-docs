import { useEffect, useMemo, useState } from 'react';
import { Calendar, FileSignature, RefreshCw, Search, TrendingUp, Users } from 'lucide-react';
import { api } from '../api';

type TrackerUser = {
  user_id: string;
  user_name: string;
  branch: string;
  department: string;
  position_title: string;
  role: string;
  login_type: string;
  contract_count: number;
  total_amount: number;
  raw_count: number;
};

function fmtMonthStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMonthLabel(month: string) {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return `${y}년 ${m}월`;
}

const BRANCH_ORDER = ['의정부', '서초', '본사', '부천', '미지정'];

function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

export default function ContractTracker() {
  const currentMonth = fmtMonthStr(new Date());
  const [monthFrom, setMonthFrom] = useState<string>(currentMonth);
  const [monthTo, setMonthTo] = useState<string>(currentMonth);
  const [appliedFrom, setAppliedFrom] = useState<string>(currentMonth);
  const [appliedTo, setAppliedTo] = useState<string>(currentMonth);
  const [users, setUsers] = useState<TrackerUser[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [dateRange, setDateRange] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.sales.contractTracker({ month_from: appliedFrom, month_to: appliedTo });
      setUsers(res.users || []);
      setTotalCount(res.total_count || 0);
      setTotalAmount(res.total_amount || 0);
      setDateRange({ from: res.from, to: res.to });
      setLastRefresh(new Date());
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [appliedFrom, appliedTo]);

  const applyRange = () => {
    if (!monthFrom || !monthTo) {
      alert('조회할 시작월과 종료월을 선택해주세요.');
      return;
    }
    if (monthFrom > monthTo) {
      alert('시작월은 종료월보다 늦을 수 없습니다.');
      return;
    }
    setAppliedFrom(monthFrom);
    setAppliedTo(monthTo);
  };

  const resetCurrentMonth = () => {
    setMonthFrom(currentMonth);
    setMonthTo(currentMonth);
    setAppliedFrom(currentMonth);
    setAppliedTo(currentMonth);
  };

  const grouped = useMemo(() => {
    const byBranch: Record<string, Record<string, TrackerUser[]>> = {};
    for (const u of users) {
      const b = u.branch || '미지정';
      const d = u.department || '(부서 없음)';
      if (!byBranch[b]) byBranch[b] = {};
      if (!byBranch[b][d]) byBranch[b][d] = [];
      byBranch[b][d].push(u);
    }
    return byBranch;
  }, [users]);

  const orderedBranches = useMemo(() => {
    const keys = Object.keys(grouped);
    return keys.sort((a, b) => {
      const ai = BRANCH_ORDER.indexOf(a);
      const bi = BRANCH_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [grouped]);

  const rangeLabel = appliedFrom === appliedTo
    ? fmtMonthLabel(appliedFrom)
    : `${fmtMonthLabel(appliedFrom)} ~ ${fmtMonthLabel(appliedTo)}`;

  return (
    <div className="page">
      <div className="page-header">
        <h2><FileSignature size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 컨설턴트 계약관리</h2>
        <button className="btn btn-sm" onClick={load} disabled={loading} title="새로고침">
          <RefreshCw size={13} className={loading ? 'drive-spin' : ''} /> 새로고침
        </button>
      </div>

      <div className="ct-range-panel">
        <div className="ct-range-title">
          <Calendar size={16} />
          <span>월별 기간 조회</span>
        </div>
        <div className="ct-range-controls">
          <label className="ct-range-field">
            <span>시작월</span>
            <input type="month" value={monthFrom} onChange={(e) => setMonthFrom(e.target.value)} />
          </label>
          <label className="ct-range-field">
            <span>종료월</span>
            <input type="month" value={monthTo} onChange={(e) => setMonthTo(e.target.value)} />
          </label>
          <button className="btn btn-primary btn-sm" onClick={applyRange} disabled={loading}>
            <Search size={14} /> 검색
          </button>
          <button className="btn btn-sm" onClick={resetCurrentMonth} disabled={loading}>
            이번 달
          </button>
        </div>
      </div>

      <div className="ct-summary">
        <div className="ct-summary-card">
          <div className="ct-summary-icon"><Users size={18} color="#1a73e8" /></div>
          <div>
            <div className="ct-summary-label">전체 계약건수</div>
            <div className="ct-summary-value">{totalCount}<span className="ct-summary-unit">건</span></div>
          </div>
        </div>
        <div className="ct-summary-card">
          <div className="ct-summary-icon"><TrendingUp size={18} color="#188038" /></div>
          <div>
            <div className="ct-summary-label">총 계약금액</div>
            <div className="ct-summary-value">{fmt(totalAmount)}<span className="ct-summary-unit">원</span></div>
          </div>
        </div>
        <div className="ct-summary-card" style={{ gridColumn: 'span 2' }}>
          <div className="ct-summary-icon" style={{ background: '#fff3e0' }}><Calendar size={18} color="#f57c00" /></div>
          <div>
            <div className="ct-summary-label">조회 기간</div>
            <div className="ct-summary-value" style={{ fontSize: '0.88rem', fontWeight: 600 }}>
              {rangeLabel}
              {dateRange && (
                <span style={{ fontSize: '0.72rem', color: '#9aa0a6', fontWeight: 400, marginLeft: 8 }}>
                  {dateRange.from} ~ {dateRange.to} · 마지막 로드 {lastRefresh.toTimeString().slice(0, 5)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="ct-empty">로딩중...</div>
      ) : orderedBranches.length === 0 ? (
        <div className="ct-empty">표시할 인원이 없습니다.</div>
      ) : (
        orderedBranches.map(branch => {
          const departments = grouped[branch];
          const branchUsers = Object.values(departments).flat();
          const branchTotal = branchUsers.reduce((s, u) => s + u.contract_count, 0);
          const branchAmount = branchUsers.reduce((s, u) => s + u.total_amount, 0);
          return (
            <section key={branch} className="ct-branch-section">
              <div className="ct-branch-head">
                <span className="ct-branch-name">{branch}</span>
                <span className="ct-branch-stats">
                  {branchTotal}건 · {fmt(branchAmount)}원
                </span>
              </div>
              {Object.keys(departments).sort().map(dept => (
                <div key={dept} className="ct-dept-block">
                  <div className="ct-dept-head">{dept}</div>
                  <div className="ct-card-grid">
                    {departments[dept]
                      .sort((a, b) => b.contract_count - a.contract_count || a.user_name.localeCompare(b.user_name))
                      .map(u => {
                        const empty = u.contract_count === 0;
                        return (
                          <div key={u.user_id} className={`ct-card ${empty ? 'empty' : ''}`}>
                            <div className="ct-card-head">
                              <span className="ct-card-branch">{u.branch}</span>
                              {u.department && <span className="ct-card-dept"> · {u.department}</span>}
                            </div>
                            <div className="ct-card-name">
                              {u.user_name}
                              {u.position_title && <span className="ct-card-title">{u.position_title}</span>}
                              {u.login_type === 'freelancer' && <span className="ct-card-tag">프리랜서</span>}
                            </div>
                            <div className="ct-card-stats">
                              <div className="ct-card-count">
                                <span className="ct-card-num">{u.contract_count}</span>
                                <span className="ct-card-unit">건</span>
                              </div>
                              <div className="ct-card-amount">{fmt(u.total_amount)}원</div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}
