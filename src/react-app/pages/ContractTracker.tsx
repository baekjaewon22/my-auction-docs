import { useEffect, useMemo, useState } from 'react';
import { FileSignature, Users, TrendingUp, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api';

type Period = 'yesterday' | 'today' | 'week' | 'month';

type TrackerUser = {
  user_id: string; user_name: string; branch: string; department: string;
  position_title: string; role: string; login_type: string;
  contract_count: number; total_amount: number; raw_count: number;
};

const PERIOD_TABS: { value: Period; label: string; sub: string }[] = [
  { value: 'yesterday', label: '어제', sub: '실시간' },
  { value: 'today', label: '오늘', sub: '실시간' },
  { value: 'week', label: '일주일', sub: '최근 7일' },
  { value: 'month', label: '한달', sub: '월 단위' },
];

function fmtMonthStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 지사 정렬 순서 (컨설턴트 일지와 유사)
const BRANCH_ORDER = ['의정부', '서초', '대전', '부산', '미지정'];

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

export default function ContractTracker() {
  const [period, setPeriod] = useState<Period>('today');
  const [monthStr, setMonthStr] = useState<string>(() => fmtMonthStr(new Date()));
  const [users, setUsers] = useState<TrackerUser[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [dateRange, setDateRange] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.sales.contractTracker(period, monthStr);
      setUsers(res.users || []);
      setTotalCount(res.total_count || 0);
      setTotalAmount(res.total_amount || 0);
      setDateRange({ from: res.from, to: res.to });
      setLastRefresh(new Date());
    } catch (err: any) { alert(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [period, monthStr]);

  // 어제·오늘 탭: 계약자만 / 그 외(일주일·한달): 전체 표시
  const visibleUsers = useMemo(() => {
    if (period === 'yesterday' || period === 'today') return users.filter(u => u.contract_count > 0);
    return users;
  }, [users, period]);

  // 월 네비게이션 헬퍼
  const shiftMonth = (delta: number) => {
    const [y, m] = monthStr.split('-').map(Number);
    const next = new Date(y, m - 1 + delta, 1);
    setMonthStr(fmtMonthStr(next));
  };
  const isCurrentMonth = monthStr === fmtMonthStr(new Date());
  const monthLabel = (() => {
    const [y, m] = monthStr.split('-').map(Number);
    return `${y}년 ${m}월`;
  })();

  // 지사 → 부서 그룹핑 + 정렬 (계약건수 내림차순, 그 안에서 이름 오름차순)
  const grouped = useMemo(() => {
    const byBranch: Record<string, Record<string, TrackerUser[]>> = {};
    for (const u of visibleUsers) {
      const b = u.branch || '미지정';
      const d = u.department || '(부서 없음)';
      if (!byBranch[b]) byBranch[b] = {};
      if (!byBranch[b][d]) byBranch[b][d] = [];
      byBranch[b][d].push(u);
    }
    return byBranch;
  }, [visibleUsers]);

  const orderedBranches = useMemo(() => {
    const keys = Object.keys(grouped);
    return keys.sort((a, b) => {
      const ai = BRANCH_ORDER.indexOf(a); const bi = BRANCH_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1; if (bi === -1) return -1;
      return ai - bi;
    });
  }, [grouped]);

  return (
    <div className="page">
      <div className="page-header">
        <h2><FileSignature size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 컨설턴트 계약관리</h2>
        <button className="btn btn-sm" onClick={load} disabled={loading} title="새로고침">
          <RefreshCw size={13} className={loading ? 'drive-spin' : ''} /> 새로고침
        </button>
      </div>

      {/* 기간 탭 */}
      <div className="ct-tabs">
        {PERIOD_TABS.map(t => (
          <button key={t.value} className={`ct-tab ${period === t.value ? 'active' : ''}`} onClick={() => setPeriod(t.value)}>
            <span className="ct-tab-label">{t.label}</span>
            <span className="ct-tab-sub">{t.sub}</span>
          </button>
        ))}
      </div>

      {/* 월 네비게이터 — period='month'일 때만 */}
      {period === 'month' && (
        <div className="ct-month-nav">
          <button className="ct-month-btn" onClick={() => shiftMonth(-1)} title="이전 달">
            <ChevronLeft size={16} />
          </button>
          <div className="ct-month-label">
            {monthLabel}
            {isCurrentMonth && <span className="ct-month-now">현재</span>}
          </div>
          <button className="ct-month-btn" onClick={() => shiftMonth(1)} disabled={isCurrentMonth} title="다음 달">
            <ChevronRight size={16} />
          </button>
          {!isCurrentMonth && (
            <button className="ct-month-today" onClick={() => setMonthStr(fmtMonthStr(new Date()))}>
              이번달로
            </button>
          )}
        </div>
      )}

      {/* 전체 요약 */}
      <div className="ct-summary">
        <div className="ct-summary-card">
          <div className="ct-summary-icon"><Users size={18} color="#1a73e8" /></div>
          <div>
            <div className="ct-summary-label">전직원 계약건수</div>
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
          <div className="ct-summary-icon" style={{ background: '#fff3e0' }}>📅</div>
          <div>
            <div className="ct-summary-label">조회 기간 · 실시간</div>
            <div className="ct-summary-value" style={{ fontSize: '0.88rem', fontWeight: 600 }}>
              {dateRange?.from === dateRange?.to ? dateRange?.from : `${dateRange?.from} ~ ${dateRange?.to}`}
              <span style={{ fontSize: '0.72rem', color: '#9aa0a6', fontWeight: 400, marginLeft: 8 }}>
                마지막 로드 {lastRefresh.toTimeString().slice(0, 5)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 지사별 카드 그리드 */}
      {loading ? (
        <div className="ct-empty">로딩중...</div>
      ) : orderedBranches.length === 0 ? (
        <div className="ct-empty">
          {period === 'yesterday' ? '어제 계약 건이 없습니다.'
            : period === 'today' ? '오늘 계약 건이 없습니다.'
            : '표시할 인원이 없습니다.'}
        </div>
      ) : (
        orderedBranches.map(branch => {
          const departments = grouped[branch];
          const branchTotal = Object.values(departments).flat().reduce((s, u) => s + u.contract_count, 0);
          const branchAmount = Object.values(departments).flat().reduce((s, u) => s + u.total_amount, 0);
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
                              {u.department && <span className="ct-card-dept">· {u.department}</span>}
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
