import { useEffect, useState } from 'react';
import { api } from '../api';
import { BarChart3, TrendingUp, TrendingDown, AlertTriangle, DollarSign, CreditCard, Users, Building2 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';

const COLORS = ['#1a73e8', '#188038', '#e65100', '#7b1fa2', '#d93025', '#00897b', '#5c6bc0', '#f4511e'];

function fmtWon(n: number) {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억';
  if (n >= 10000) return Math.round(n / 10000).toLocaleString() + '만';
  return n.toLocaleString();
}

type ExpenseCategoryRow = {
  category: string;
  total: number;
  count?: number;
};

const EXPENSE_MAJOR_ORDER = ['인건비', '세금', '사무실', '통신/시스템', '광고/영업', '차량/출장', '식대/복리', '비품/소모품', '기타'];

function getExpenseMajorCategory(category: unknown) {
  const text = String(category || '').trim();
  if (!text) return '기타';
  if (/인건비|급여|직원급여|실적급여|퇴직금|4대보험|보험료/.test(text)) return '인건비';
  if (/세금|부가세|소득세|주민세|법인세|지방세|등록면허세|자동차세|원천세/.test(text)) return '세금';
  if (/사무실|임대료|관리비|전기|수도|가스|인테리어|보증금|권리금/.test(text)) return '사무실';
  if (/통신|전화|인터넷|팩스|대표번호|서버|호스팅|홈페이지|채널톡|앱|문자|SMS|Adobe|전자계약/.test(text)) return '통신/시스템';
  if (/광고|영업|지지옥션|전자민원|DM|홍보|마케팅|브리핑/.test(text)) return '광고/영업';
  if (/차량|유류|주유|주차|하이패스|출장|숙소|항공|교통/.test(text)) return '차량/출장';
  if (/식대|식비|회식|복리|간식|커피|음료|복지/.test(text)) return '식대/복리';
  if (/비품|문구|소모품|명함|A4|용지|프린터|복사기|렌탈|정수기|공기청정기|파쇄기|카드단말기|사무기기/.test(text)) return '비품/소모품';
  return '기타';
}

function groupExpensesByMajor(rows: ExpenseCategoryRow[]) {
  const map = new Map<string, { name: string; value: number; count: number; details: ExpenseCategoryRow[] }>();
  rows.forEach((row) => {
    const major = getExpenseMajorCategory(row.category);
    const current = map.get(major) || { name: major, value: 0, count: 0, details: [] };
    current.value += Number(row.total || 0);
    current.count += Number(row.count || 0);
    current.details.push(row);
    map.set(major, current);
  });
  return [...map.values()]
    .map((group) => ({
      ...group,
      details: group.details.sort((a, b) => Number(b.total || 0) - Number(a.total || 0)).slice(0, 4),
    }))
    .filter((group) => group.value > 0)
    .sort((a, b) => {
      const orderDiff = EXPENSE_MAJOR_ORDER.indexOf(a.name) - EXPENSE_MAJOR_ORDER.indexOf(b.name);
      return orderDiff !== 0 ? orderDiff : b.value - a.value;
    });
}

export default function FinanceAnalytics() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(6);

  useEffect(() => {
    setLoading(true);
    (api as any).analytics.summary(period)
      .then((res: any) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) return <div className="page-loading">로딩중...</div>;
  if (!data) return <div className="page"><div className="empty-state">데이터를 불러올 수 없습니다.</div></div>;

  const { salesByMonth, salesByType, salesByUser, salesByBranch, receivables, cardByCategory, spendingAlerts, ratios } = data;
  const expenseMajorCategories = groupExpensesByMajor(cardByCategory as ExpenseCategoryRow[]);
  const expenseMajorTotal = expenseMajorCategories.reduce((sum, row) => sum + row.value, 0);

  // 월별 손익 차트 데이터
  const monthlyPL = (data.months as string[]).map(m => {
    const sale = (salesByMonth as any[]).find(s => s.month === m);
    const cards = (data.cardByMonth as any[]).filter(c => c.month === m);
    const expenseTotal = cards.reduce((s: number, c: any) => s + (c.total || 0), 0);
    return {
      month: m.slice(5) + '월',
      매출: sale?.revenue || 0,
      통합지출: expenseTotal,
      인건비: ratios.monthlySalary,
      순이익: (sale?.revenue || 0) - expenseTotal - ratios.monthlySalary,
    };
  });

  return (
    <div className="page">
      <div className="page-header">
        <h2><BarChart3 size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 회계분석</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {[3, 6, 12].map(p => (
            <button key={p} className={`btn btn-sm ${period === p ? 'btn-primary' : ''}`}
              style={period !== p ? { border: '1px solid #dadce0', background: '#fff' } : {}}
              onClick={() => setPeriod(p)}>{p}개월</button>
          ))}
        </div>
      </div>

      {/* 핵심 지표 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #1a73e8' }}>
          <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>총 매출</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a73e8' }}>{fmtWon(ratios.totalRevenue)}</div>
        </div>
        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #e65100' }}>
          <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>통합 지출</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#e65100' }}>{fmtWon(ratios.totalExpenseSpend ?? ratios.totalCardSpend)}</div>
        </div>
        <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #7b1fa2' }}>
          <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>월 인건비</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#7b1fa2' }}>{fmtWon(ratios.monthlySalary)}</div>
        </div>
        <div className="card" style={{ padding: '16px 20px', borderLeft: `4px solid ${ratios.profitRatio >= 0 ? '#188038' : '#d93025'}` }}>
          <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>수익률</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: ratios.profitRatio >= 0 ? '#188038' : '#d93025' }}>{ratios.profitRatio}%</div>
        </div>
      </div>

      {/* 비율 지표 바 */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {[
          { label: '인건비율', value: ratios.laborRatio, warn: 50, color: '#7b1fa2', icon: <Users size={16} /> },
          { label: '통합지출률', value: ratios.expenseRatio ?? ratios.cardRatio, warn: 30, color: '#e65100', icon: <CreditCard size={16} /> },
          { label: '수익률', value: ratios.profitRatio, warn: -1, color: ratios.profitRatio >= 0 ? '#188038' : '#d93025', icon: ratios.profitRatio >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} /> },
        ].map((r, i) => (
          <div key={i} style={{ flex: '1 1 140px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ color: r.color }}>{r.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.72rem', color: '#5f6368' }}>{r.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 6, background: '#f1f3f4', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(Math.abs(r.value), 100)}%`, height: '100%', background: r.value > r.warn ? '#d93025' : r.color, borderRadius: 3, transition: 'width 0.5s' }} />
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: r.color }}>{r.value}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ⚠️ 지출 점검 알림 */}
      {spendingAlerts.length > 0 && (
        <div className="card" style={{ padding: '16px 20px', marginBottom: 20, borderLeft: '4px solid #d93025' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={18} color="#d93025" /> 지출 점검
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {spendingAlerts.map((a: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#fce4ec', borderRadius: 8, fontSize: '0.82rem' }}>
                <span style={{ fontWeight: 700, color: '#d93025' }}>⚠️</span>
                <span style={{ fontWeight: 600 }}>{a.category}</span>
                <span style={{ color: '#5f6368' }}>{fmtWon(a.previous)} → {fmtWon(a.current)}</span>
                <span style={{ fontWeight: 700, color: a.change > 50 ? '#d93025' : '#e65100' }}>+{a.change}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 미수금 현황 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>입금 대기</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#e65100' }}>{receivables.pending.count}건 · {fmtWon(receivables.pending.total || 0)}</div>
        </div>
        <div className="card" style={{ padding: '16px 20px', borderLeft: receivables.overdue.count > 0 ? '4px solid #d93025' : undefined }}>
          <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>30일 이상 미수금</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: receivables.overdue.count > 0 ? '#d93025' : '#188038' }}>
            {receivables.overdue.count > 0 ? `${receivables.overdue.count}건 · ${fmtWon(receivables.overdue.total || 0)}` : '없음'}
          </div>
        </div>
      </div>

      {/* 차트 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, marginBottom: 24 }}>

        {/* 월별 손익 */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#1a1a2e' }}><DollarSign size={16} style={{ verticalAlign: 'middle' }} /> 월별 손익 현황</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={monthlyPL}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={10} tickFormatter={(v) => fmtWon(v)} />
              <Tooltip formatter={(v: any) => fmtWon(Number(v) || 0)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="매출" fill="#1a73e8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="통합지출" fill="#e65100" radius={[4, 4, 0, 0]} />
              <Bar dataKey="순이익" fill="#188038" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 매출 유형별 비중 */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#1a1a2e' }}>매출 유형별 비중</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={(salesByType as any[]).map(s => ({ name: s.type, value: s.total }))} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} label={({ name, percent }: any) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                {(salesByType as any[]).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => fmtWon(Number(v) || 0)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* 담당자별 매출 */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#1a1a2e' }}><Users size={16} style={{ verticalAlign: 'middle' }} /> 담당자별 매출</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={(salesByUser as any[]).slice(0, 8).map(s => ({ name: s.name, 매출: s.total }))} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" />
              <XAxis type="number" fontSize={10} tickFormatter={(v) => fmtWon(v)} />
              <YAxis type="category" dataKey="name" fontSize={11} width={60} />
              <Tooltip formatter={(v: any) => fmtWon(Number(v) || 0)} />
              <Bar dataKey="매출" fill="#1a73e8" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 통합 지출 카테고리 */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#1a1a2e' }}><CreditCard size={16} style={{ verticalAlign: 'middle' }} /> 통합 지출 대분류</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'center' }}>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={expenseMajorCategories} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={88} label={({ percent }: any) => `${((percent || 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                  {expenseMajorCategories.map((_: any, i: number) => <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any, _: any, item: any) => [`${fmtWon(Number(v) || 0)}원`, item?.payload?.name || '지출']} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
              {expenseMajorCategories.map((row, i) => {
                const pct = expenseMajorTotal > 0 ? Math.round((row.value / expenseMajorTotal) * 100) : 0;
                return (
                  <div key={row.name} style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: COLORS[(i + 3) % COLORS.length], flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, color: '#202124', minWidth: 72 }}>{row.name}</span>
                      <span style={{ color: '#5f6368', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{fmtWon(row.value)}원 · {pct}%</span>
                    </div>
                    <div style={{ marginLeft: 16, marginTop: 2, color: '#80868b', fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.details.map(d => d.category).join(', ')}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 지사별 매출 */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#1a1a2e' }}><Building2 size={16} style={{ verticalAlign: 'middle' }} /> 지사별 매출</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={(salesByBranch as any[]).filter(b => b.branch).map(b => ({ name: b.branch, 매출: b.total }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={10} tickFormatter={(v) => fmtWon(v)} />
              <Tooltip formatter={(v: any) => fmtWon(Number(v) || 0)} />
              <Bar dataKey="매출" fill="#7b1fa2" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 매출 추이 */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#1a1a2e' }}><TrendingUp size={16} style={{ verticalAlign: 'middle' }} /> 매출 추이</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={monthlyPL}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={10} tickFormatter={(v) => fmtWon(v)} />
              <Tooltip formatter={(v: any) => fmtWon(Number(v) || 0)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="매출" stroke="#1a73e8" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="순이익" stroke="#188038" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
