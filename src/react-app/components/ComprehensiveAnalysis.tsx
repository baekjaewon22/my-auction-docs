// 종합분석 — 개인별 360° KPI 대시보드 + 한눈에 보기 그리드
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import {
  X, Award, AlertTriangle, ChevronLeft, ChevronRight, HelpCircle,
  Trophy, TrendingUp, Flame, Target, Moon, Gem, AlertCircle,
  ShieldCheck, XCircle, CalendarCheck, CalendarX, Sparkles, Rocket,
  ThumbsUp, Pin,
} from 'lucide-react';

type TagKey =
  | 'champion' | 'stable' | 'underperform'
  | 'active' | 'efficient' | 'inactive'
  | 'precise' | 'deviated'
  | 'safe' | 'refunded'
  | 'punctual' | 'absent'
  | 'new' | 'growing';

const TAG_META: Record<TagKey, { Icon: any; label: string; color: string; bg: string }> = {
  champion:     { Icon: Trophy,       label: '챔피언',   color: '#b8860b', bg: '#fff8e1' },
  stable:       { Icon: TrendingUp,   label: '안정',     color: '#1e8e3e', bg: '#e6f4ea' },
  underperform: { Icon: AlertTriangle, label: '미달',    color: '#c5221f', bg: '#fce8e6' },
  active:       { Icon: Flame,        label: '활발',     color: '#ea580c', bg: '#ffedd5' },
  efficient:    { Icon: Target,       label: '효율',     color: '#0b57d0', bg: '#e8f0fe' },
  inactive:     { Icon: Moon,         label: '저조',     color: '#5f6368', bg: '#f1f3f4' },
  precise:      { Icon: Gem,          label: '정확',     color: '#0891b2', bg: '#e0f7fa' },
  deviated:     { Icon: AlertCircle,  label: '편차잦음', color: '#c2410c', bg: '#fff7ed' },
  safe:         { Icon: ShieldCheck,  label: '안정',     color: '#15803d', bg: '#dcfce7' },
  refunded:     { Icon: XCircle,      label: '환불',     color: '#dc2626', bg: '#fee2e2' },
  punctual:     { Icon: CalendarCheck, label: '성실',    color: '#059669', bg: '#d1fae5' },
  absent:       { Icon: CalendarX,    label: '결근잦음', color: '#dc2626', bg: '#fee2e2' },
  new:          { Icon: Sparkles,     label: '신규',     color: '#7c3aed', bg: '#ede9fe' },
  growing:      { Icon: Rocket,       label: '성장',     color: '#0d9488', bg: '#ccfbf1' },
};

function TagPill({ tagKey, size = 'sm' }: { tagKey: TagKey; size?: 'sm' | 'md' }) {
  const meta = TAG_META[tagKey];
  if (!meta) return null;
  const iconSize = size === 'md' ? 13 : 11;
  const fontSize = size === 'md' ? 11 : 10;
  const padding = size === 'md' ? '3px 8px' : '2px 6px';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding, borderRadius: 6, fontSize, fontWeight: 600,
      background: meta.bg, color: meta.color, lineHeight: 1.2,
    }}>
      <meta.Icon size={iconSize} strokeWidth={2.2} />
      {meta.label}
    </span>
  );
}

interface CompMember {
  id: string; name: string; role: string; branch: string; department: string;
  position_title: string; grade: string; hire_date: string; hire_months: number;
  is_freelancer: boolean; pay_type: string;
  salary: number; standard_sales: number;
  activity: { 임장: number; 브리핑: number; 입찰: number; 미팅: number; 사무: number; 총합: number };
  sales: {
    total: number; confirmed: number; pending: number; refunded: number;
    confirmed_count: number; refunded_count: number; sales_count: number;
    target_rate: number; target_amount: number;
    target_base?: number; period_months?: number;
    monthly_trend: { ym: string; amount: number }[];
    growth_rate: number;
  };
  conversion: { bid_to_win: number };
  anomalies: { deviation: number; refund: number; total: number };
  score: { total: number; grade: string; breakdown: Record<string, number> };
  tags: TagKey[];
  strengths: string[]; weaknesses: string[];
  evaluation: any | null;
}

const fmtKRW = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(0)}만` : `${n.toLocaleString()}원`;
const gradeColor = (g: string) => g === 'S' ? '#7b1fa2' : g === 'A' ? '#188038' : g === 'B' ? '#1a73e8' : g === 'C' ? '#e65100' : '#d93025';

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${y}년 ${m}월`;
}

export default function ComprehensiveAnalysis({
  filterBranch, filterDept, filterUser,
}: {
  filterBranch: string; filterDept: string; filterUser: string;
  filterMonth?: string; filterMonthEnd?: string;
}) {
  const [data, setData] = useState<{ members: CompMember[]; benchmarks: any; metadata: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<'score' | 'sales' | 'low' | 'new'>('score');
  const [openMember, setOpenMember] = useState<CompMember | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // 종합분석 자체 월 state — 글로벌 필터와 분리하여 직관적으로 운용
  const [month, setMonth] = useState<string>(getCurrentMonth());
  const isCurrentMonth = month === getCurrentMonth();

  useEffect(() => {
    setLoading(true);
    api.analytics.comprehensive({
      branch: filterBranch, department: filterDept, user_id: filterUser,
      month, month_end: month, // 단일 월 단위 — 매월 새롭게
    })
      .then((r) => setData(r as any))
      .catch(() => setData({ members: [], benchmarks: {}, metadata: {} }))
      .finally(() => setLoading(false));
  }, [filterBranch, filterDept, filterUser, month]);

  const sortedMembers = useMemo(() => {
    if (!data) return [];
    const arr = [...data.members];
    switch (sortKey) {
      case 'score': arr.sort((a, b) => b.score.total - a.score.total); break;
      case 'sales': arr.sort((a, b) => b.sales.confirmed - a.sales.confirmed); break;
      case 'low': arr.sort((a, b) => a.score.total - b.score.total); break;
      case 'new': arr.sort((a, b) => a.hire_months - b.hire_months); break;
    }
    return arr;
  }, [data, sortKey]);

  // 월 네비게이션 + 도움말 버튼 (모든 모드 공통 헤더)
  const MonthNav = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 16, padding: '10px 16px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, position: 'relative' }}>
      <button onClick={() => setMonth(shiftMonth(month, -1))}
        style={{ background: '#f1f3f4', border: 'none', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        aria-label="이전 달">
        <ChevronLeft size={18} />
      </button>
      <div style={{ fontSize: 18, fontWeight: 700, minWidth: 130, textAlign: 'center' }}>
        {formatMonthLabel(month)}
        {isCurrentMonth && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: '#1a73e8' }}>(진행 중)</span>}
      </div>
      <button onClick={() => { if (!isCurrentMonth) setMonth(shiftMonth(month, 1)); }} disabled={isCurrentMonth}
        style={{ background: isCurrentMonth ? '#f8f9fa' : '#f1f3f4', border: 'none', borderRadius: 8, width: 36, height: 36, cursor: isCurrentMonth ? 'not-allowed' : 'pointer', opacity: isCurrentMonth ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        aria-label="다음 달">
        <ChevronRight size={18} />
      </button>
      <button onClick={() => setShowHelp(true)}
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: '#f1f3f4', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#3c4043' }}>
        <HelpCircle size={14} /> 산출 기준
      </button>
    </div>
  );

  if (loading) return <div><MonthNav /><div style={{ padding: 40, textAlign: 'center', color: '#5f6368' }}>로딩중...</div>{showHelp && <HelpModal onClose={() => setShowHelp(false)} />}</div>;
  if (!data || data.members.length === 0) return <div><MonthNav /><div style={{ padding: 40, textAlign: 'center', color: '#9aa0a6' }}>표시할 직원이 없습니다.</div>{showHelp && <HelpModal onClose={() => setShowHelp(false)} />}</div>;

  // 단일 멤버 = 개인 상세 직접 표시 (필터로 1명만 선택된 경우)
  if (data.members.length === 1) {
    return (
      <div>
        <MonthNav />
        <PersonalDashboard member={data.members[0]} benchmarks={data.benchmarks} />
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      </div>
    );
  }

  return (
    <div>
      <MonthNav />
      {/* 정렬 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#5f6368', alignSelf: 'center' }}>정렬:</span>
        {([
          { key: 'score', label: '종합점수↓' },
          { key: 'sales', label: '매출↓' },
          { key: 'low', label: '부족순↑' },
          { key: 'new', label: '신규' },
        ] as const).map((s) => (
          <button key={s.key} onClick={() => setSortKey(s.key)}
            style={{
              padding: '4px 10px', fontSize: 12, borderRadius: 6,
              border: '1px solid ' + (sortKey === s.key ? '#1a73e8' : '#dadce0'),
              background: sortKey === s.key ? '#e8f0fe' : '#fff',
              color: sortKey === s.key ? '#1a73e8' : '#3c4043',
              cursor: 'pointer',
            }}>
            {s.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#5f6368', alignSelf: 'center' }}>
          정직원 {data.benchmarks.full_time_count}명 · 비율제 {data.benchmarks.freelancer_count}명 · 비율제 평균 {fmtKRW(data.benchmarks.freelancer_avg_sales || 0)}
        </span>
      </div>

      {/* 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {sortedMembers.map((m) => <MemberCard key={m.id} m={m} onClick={() => setOpenMember(m)} />)}
      </div>

      {/* 상세 모달 */}
      {openMember && (
        <div className="modal-overlay" onClick={() => setOpenMember(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 0, maxWidth: 720, width: '92%', maxHeight: '90vh', overflow: 'auto', position: 'relative' }}>
            <button onClick={() => setOpenMember(null)} style={{ position: 'absolute', top: 12, right: 12, border: 'none', background: '#f1f3f4', borderRadius: 20, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={16} />
            </button>
            <div style={{ padding: 20 }}>
              <PersonalDashboard member={openMember} benchmarks={data.benchmarks} />
            </div>
          </div>
        </div>
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

// ─────────────────────────────────────
// 카드 컴포넌트
// ─────────────────────────────────────
function MemberCard({ m, onClick }: { m: CompMember; onClick: () => void }) {
  const targetPct = Math.min(150, Math.max(0, m.sales.target_rate));
  const barColor = targetPct >= 120 ? '#188038' : targetPct >= 90 ? '#1a73e8' : targetPct >= 70 ? '#e65100' : '#d93025';

  return (
    <div onClick={onClick} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: 12, cursor: 'pointer', transition: 'box-shadow 0.15s', position: 'relative' }}
      onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
      onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}>
      {/* 등급 뱃지 */}
      <div style={{ position: 'absolute', top: 10, right: 10, background: gradeColor(m.score.grade), color: '#fff', borderRadius: 12, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
        {m.score.grade} {m.score.total}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#202124', marginBottom: 2 }}>{m.name}</div>
      <div style={{ fontSize: 11, color: '#5f6368', marginBottom: 8 }}>
        {m.is_freelancer ? '비율제' : (m.grade || m.position_title || '직원')} · {m.branch}{m.department ? '·' + m.department : ''}
      </div>

      {/* 정직원: 달성률 게이지 / 프리랜서: 추이 */}
      {!m.is_freelancer ? (
        <>
          <div style={{ fontSize: 10, color: '#5f6368', marginBottom: 2 }}>
            매출 {fmtKRW(m.sales.confirmed)} / 1인분 {fmtKRW(m.sales.target_amount)}
          </div>
          <div style={{ background: '#f1f3f4', borderRadius: 8, height: 14, overflow: 'hidden', position: 'relative', marginBottom: 6 }}>
            <div style={{ background: barColor, height: '100%', width: `${(targetPct / 150) * 100}%`, transition: 'width 0.3s' }} />
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: targetPct >= 50 ? '#fff' : '#202124' }}>
              {m.sales.target_rate.toFixed(0)}%
            </span>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 10, color: '#5f6368', marginBottom: 2 }}>
            매출 {fmtKRW(m.sales.confirmed)} (평균 대비 {m.sales.target_rate.toFixed(0)}%)
          </div>
          <div style={{ height: 30, marginBottom: 6 }}>
            <ResponsiveContainer>
              <LineChart data={m.sales.monthly_trend}>
                <Line type="monotone" dataKey="amount" stroke="#1a73e8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* 평가 미달 경고 */}
      {m.evaluation && m.evaluation.consecutive_misses >= 2 && (
        <div style={{ background: '#fce4ec', color: '#d93025', borderRadius: 6, padding: '3px 6px', fontSize: 10, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertTriangle size={11} /> 평가 미달 {m.evaluation.consecutive_misses}회
        </div>
      )}

      {/* 태그 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {m.tags.slice(0, 4).map((t, i) => <TagPill key={i} tagKey={t} size="sm" />)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────
// 개인 상세
// ─────────────────────────────────────
function PersonalDashboard({ member: m, benchmarks }: { member: CompMember; benchmarks: any }) {
  const targetPct = Math.min(150, Math.max(0, m.sales.target_rate));
  const barColor = targetPct >= 120 ? '#188038' : targetPct >= 90 ? '#1a73e8' : targetPct >= 70 ? '#e65100' : '#d93025';

  return (
    <div>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #e0e0e0' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 20 }}>
            {m.name}
            <span style={{ marginLeft: 10, fontSize: 12, color: '#5f6368', fontWeight: 400 }}>
              {m.is_freelancer ? '비율제' : m.grade || m.position_title || '직원'} · {m.branch}{m.department ? '·' + m.department : ''} · 근속 {m.hire_months}개월
            </span>
          </h3>
          <div style={{ marginTop: 6, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {m.tags.map((t, i) => <TagPill key={i} tagKey={t} size="md" />)}
          </div>
        </div>
        <div style={{ background: gradeColor(m.score.grade), color: '#fff', borderRadius: 14, padding: '6px 14px', fontSize: 18, fontWeight: 700, textAlign: 'center', minWidth: 80 }}>
          <Award size={14} /> {m.score.grade}
          <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.9 }}>{m.score.total}점</div>
        </div>
      </div>

      {/* 매출 카드 — 정직원: 1인분 대비 / 프리랜서: 비율제 평균 대비 */}
      <div style={{ background: '#f8f9fa', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: '#5f6368', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Target size={13} strokeWidth={2.2} />
            {m.is_freelancer
              ? '비율제 평균 대비'
              : `1인분(기준매출) 대비 ${m.sales.period_months ? `· ${m.sales.period_months}개월 안분` : ''}`}
          </span>
          <span style={{ fontSize: 22, fontWeight: 700, color: barColor }}>{m.sales.target_rate.toFixed(1)}%</span>
        </div>
        {!m.is_freelancer && m.sales.target_base !== undefined && m.sales.period_months !== undefined && m.sales.period_months !== 2 && (
          <div style={{ fontSize: 10, color: '#9aa0a6', marginBottom: 6 }}>
            ※ 기준매출 {fmtKRW(m.sales.target_base)} (2개월) × {m.sales.period_months}/2 = {fmtKRW(m.sales.target_amount)}
          </div>
        )}
        <div style={{ background: '#fff', borderRadius: 10, height: 22, overflow: 'hidden', position: 'relative', border: '1px solid #e0e0e0' }}>
          <div style={{ background: barColor, height: '100%', width: `${(targetPct / 150) * 100}%`, transition: 'width 0.3s' }} />
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: targetPct >= 50 ? '#fff' : '#202124' }}>
            {fmtKRW(m.sales.confirmed)} / {fmtKRW(m.sales.target_amount)}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 10, fontSize: 11 }}>
          <div><div style={{ color: '#5f6368' }}>확정</div><div style={{ fontWeight: 700, color: '#188038' }}>{fmtKRW(m.sales.confirmed)}</div></div>
          <div><div style={{ color: '#5f6368' }}>대기</div><div style={{ fontWeight: 700, color: '#e65100' }}>{fmtKRW(m.sales.pending)}</div></div>
          <div><div style={{ color: '#5f6368' }}>환불</div><div style={{ fontWeight: 700, color: '#d93025' }}>{fmtKRW(m.sales.refunded)}</div></div>
          <div><div style={{ color: '#5f6368' }}>건수</div><div style={{ fontWeight: 700 }}>{m.sales.confirmed_count}건</div></div>
        </div>
      </div>

      {/* 종합 점수 breakdown */}
      <div style={{ background: '#f8f9fa', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#3c4043' }}>종합 점수 분해</div>
        {Object.entries(m.score.breakdown).map(([k, v]) => {
          const max = m.is_freelancer
            ? ({ 매출: 25, 전환: 25, 활동: 20, 출근: 15, 성장: 15 } as Record<string, number>)[k] || 100
            : ({ 매출: 35, 전환: 20, 활동: 15, 출근: 15, 안정: 10, 이상: -5 } as Record<string, number>)[k] || 100;
          const isNeg = (v as number) < 0;
          const pct = isNeg ? Math.min(100, Math.abs(v as number) / Math.abs(max) * 100) : ((v as number) / Math.abs(max)) * 100;
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 50, fontSize: 11, color: '#5f6368' }}>{k}</span>
              <div style={{ flex: 1, background: '#fff', borderRadius: 4, height: 10, overflow: 'hidden', border: '1px solid #e0e0e0' }}>
                <div style={{ background: isNeg ? '#d93025' : '#1a73e8', height: '100%', width: `${pct}%` }} />
              </div>
              <span style={{ width: 40, fontSize: 11, fontWeight: 700, textAlign: 'right' }}>{v}/{max}</span>
            </div>
          );
        })}
      </div>

      {/* 활동 퍼널 */}
      <div style={{ background: '#f8f9fa', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>활동 → 성과 퍼널</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <FunnelStep label="임장" count={m.activity.임장} color="#1a73e8" />
          →
          <FunnelStep label="브리핑" count={m.activity.브리핑} color="#7b1fa2" />
          →
          <FunnelStep label="입찰" count={m.activity.입찰} color="#188038" />
          →
          <FunnelStep label="낙찰" count={m.conversion.bid_to_win > 0 ? Math.round(m.activity.입찰 * m.conversion.bid_to_win / 100) : 0} color="#e65100" />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: '#5f6368' }}>
          입찰→낙찰 전환율: <strong>{m.conversion.bid_to_win.toFixed(1)}%</strong>
        </div>
      </div>

      {/* 월별 매출 추이 */}
      <div style={{ background: '#f8f9fa', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>최근 12개월 매출 추이 {m.sales.growth_rate !== 0 && <span style={{ color: m.sales.growth_rate > 0 ? '#188038' : '#d93025', marginLeft: 8 }}>MoM {m.sales.growth_rate > 0 ? '+' : ''}{m.sales.growth_rate.toFixed(1)}%</span>}</div>
        <div style={{ height: 140 }}>
          <ResponsiveContainer>
            <BarChart data={m.sales.monthly_trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="ym" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 10000 ? `${(v / 10000).toFixed(0)}만` : v.toString()} />
              <Tooltip formatter={(v: any) => fmtKRW(v as number)} />
              {!m.is_freelancer && m.sales.target_amount > 0 && (
                <ReferenceLine y={m.sales.target_amount} stroke="#d93025" strokeDasharray="3 3" label={{ value: '1인분', fontSize: 10, fill: '#d93025' }} />
              )}
              {m.is_freelancer && benchmarks.freelancer_avg_sales > 0 && (
                <ReferenceLine y={benchmarks.freelancer_avg_sales} stroke="#d93025" strokeDasharray="3 3" label={{ value: '평균', fontSize: 10, fill: '#d93025' }} />
              )}
              <Bar dataKey="amount" fill="#1a73e8" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 강점 / 약점 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div style={{ background: '#e8f5e9', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#188038', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <ThumbsUp size={14} strokeWidth={2.2} /> 잘하는 점
          </div>
          {m.strengths.map((s, i) => (
            <div key={i} style={{ fontSize: 11, color: '#3c4043', marginBottom: 3 }}>• {s}</div>
          ))}
          {m.strengths.length === 0 && <div style={{ fontSize: 11, color: '#9aa0a6' }}>—</div>}
        </div>
        <div style={{ background: '#fce4ec', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#d93025', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Pin size={14} strokeWidth={2.2} /> 부족한 점
          </div>
          {m.weaknesses.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: '#3c4043', marginBottom: 3 }}>• {w}</div>
          ))}
          {m.weaknesses.length === 0 && <div style={{ fontSize: 11, color: '#9aa0a6' }}>—</div>}
        </div>
      </div>

      {/* 평가 이력 */}
      {m.evaluation && (
        <div style={{ background: '#fff3e0', borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>최근 2개월 평가</div>
          <div style={{ fontSize: 11, color: '#3c4043' }}>
            기간: {m.evaluation.period_start} ~ {m.evaluation.period_end}
            <span style={{ marginLeft: 10 }}>실제 {fmtKRW(m.evaluation.total_sales)} / 기준 {fmtKRW(m.evaluation.standard_sales)}</span>
            <span style={{ marginLeft: 10, fontWeight: 700, color: m.evaluation.met_target ? '#188038' : '#d93025' }}>
              {m.evaluation.met_target ? '✓ 달성' : '✗ 미달'}
            </span>
            {m.evaluation.consecutive_misses > 0 && (
              <span style={{ marginLeft: 10, color: '#d93025' }}>연속 미달 {m.evaluation.consecutive_misses}회</span>
            )}
          </div>
        </div>
      )}

      {/* 이상감지 요약 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 11 }}>
        <StatBox label="5% 편차" value={m.anomalies.deviation} color={m.anomalies.deviation > 0 ? '#e65100' : '#188038'} />
        <StatBox label="환불" value={m.anomalies.refund} color={m.anomalies.refund > 0 ? '#d93025' : '#188038'} />
        <StatBox label="이상 합계" value={m.anomalies.total} color={m.anomalies.total > 0 ? '#d93025' : '#188038'} />
      </div>
    </div>
  );
}

function FunnelStep({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '6px 4px', background: color + '18', border: `1px solid ${color}40`, borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: '#5f6368' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{count}</div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 8, textAlign: 'center' }}>
      <div style={{ color: '#5f6368' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 산출 기준 도움말 모달
// ─────────────────────────────────────────────────────
function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 0, maxWidth: 820, width: '94%', maxHeight: '92vh', overflow: 'auto', position: 'relative' }}>
        <div style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid #e0e0e0', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <HelpCircle size={20} /> 종합분석 산출 기준
          </h2>
          <button onClick={onClose} style={{ border: 'none', background: '#f1f3f4', borderRadius: 20, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 20, fontSize: 13, lineHeight: 1.6, color: '#3c4043' }}>

          <HelpSection title="📊 종합 점수 구성">
            <p>직군별로 다른 가중치가 적용됩니다. 점수 합계로 등급(S/A/B/C/D)이 결정됩니다.</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={thStyle}>항목</th>
                  <th style={thStyle}>정직원</th>
                  <th style={thStyle}>프리랜서</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style={tdStyle}>매출</td><td style={tdStyle}>35</td><td style={tdStyle}>25</td></tr>
                <tr><td style={tdStyle}>전환율</td><td style={tdStyle}>20</td><td style={tdStyle}>25</td></tr>
                <tr><td style={tdStyle}>활동량</td><td style={tdStyle}>15</td><td style={tdStyle}>20</td></tr>
                <tr><td style={tdStyle}>출근/일지</td><td style={tdStyle}>15</td><td style={tdStyle}>— (만점 처리)</td></tr>
                <tr><td style={tdStyle}>안정성</td><td style={tdStyle}>10</td><td style={tdStyle}>—</td></tr>
                <tr><td style={tdStyle}>성장률</td><td style={tdStyle}>—</td><td style={tdStyle}>15</td></tr>
                <tr><td style={tdStyle}>이상지표</td><td style={tdStyle}>최대 -5</td><td style={tdStyle}>—</td></tr>
                <tr style={{ background: '#fff3e0' }}><td style={tdStyle}><strong>합계</strong></td><td style={tdStyle}><strong>100</strong></td><td style={tdStyle}><strong>100</strong></td></tr>
              </tbody>
            </table>
            <p style={{ marginTop: 8 }}>
              <strong>등급:</strong> S (90+) · A (80+) · B (70+) · C (60+) · D (60 미만)
            </p>
          </HelpSection>

          <HelpSection title="💰 매출 점수">
            <p><strong>정직원</strong>: 본인 매출 / (기준매출 × 조회 개월수 / 2) × 100%</p>
            <ul style={ulStyle}>
              <li>기준매출은 사용자관리 화면에서 <code>급여 × 1.3 × 4</code>로 자동 계산되며 <strong>2개월치</strong> 기준입니다.</li>
              <li>1개월 조회 시 → 기준매출 × 0.5로 안분</li>
              <li>2개월 조회 시 → 기준매출 그대로</li>
              <li>달성률 150% 이상이면 매출 점수 만점</li>
            </ul>
            <p><strong>프리랜서</strong>: 본인 매출 / 전 지사 비율제 평균 매출 × 100%</p>
            <ul style={ulStyle}>
              <li>같은 기간 모든 비율제 컨설턴트의 평균과 비교</li>
              <li>150% 이상이면 만점</li>
            </ul>
          </HelpSection>

          <HelpSection title="🎯 전환율 점수 (입찰 → 낙찰)">
            <p>(낙찰 건수 / 입찰 건수) × 100%</p>
            <ul style={ulStyle}>
              <li>입찰 일지에서 <code>bidWon: true</code> 표시된 건만 낙찰로 카운트</li>
              <li>낙찰률이 그대로 100점 만점 척도</li>
              <li>예: 입찰 10건 중 3건 낙찰 → 30% → 점수 6점(정직원, 만점 20)</li>
              <li><strong>입찰이 0건이면 0%로 표시</strong> (분모 없음)</li>
            </ul>
            <p style={{ background: '#fce4ec', padding: 8, borderRadius: 6, marginTop: 6 }}>
              <strong>"입찰→낙찰 0% — 낮음" 표시 조건:</strong> 입찰 1건 이상 AND 낙찰률 30% 미만
            </p>
          </HelpSection>

          <HelpSection title="🔥 활동량 점수">
            <p>본인 활동수(임장+브리핑+입찰+미팅+사무) / 조직 평균 활동수 × 100% = <strong>활동 지수</strong></p>
            <ul style={ulStyle}>
              <li>150% 이상이면 활동 점수 만점</li>
              <li>조직 평균은 같은 조회 화면의 모든 컨설턴트 평균</li>
            </ul>
          </HelpSection>

          <HelpSection title="📅 출근/일지 점수 (정직원만)">
            <p>일지 작성 일수 / 평일 수 × 100%</p>
            <ul style={ulStyle}>
              <li><strong>프리랜서는 일지 작성 의무가 없으므로 자동 만점 처리</strong></li>
              <li>주말은 평일에 포함 안 함</li>
              <li>같은 날 활동 여러 건은 1일로 카운트하지 않고, 활동 합계로 단순화</li>
            </ul>
          </HelpSection>

          <HelpSection title="🛡 안정성 점수 (정직원만)">
            <p>100 - 환불률 (환불 건수 / 전체 매출 건수 × 100)</p>
            <ul style={ulStyle}>
              <li>환불 0건이면 만점</li>
              <li>매출 1건 중 환불 1건 = 0점</li>
            </ul>
          </HelpSection>

          <HelpSection title="📈 성장률 점수 (프리랜서만)">
            <p>(이번달 매출 - 전월 매출) / 전월 매출 × 100% = MoM 성장률</p>
            <ul style={ulStyle}>
              <li>+50% 성장 = 100점, 보합(0%) = 50점, -50% = 0점</li>
              <li>전월 매출이 0이면 성장률 0%로 처리</li>
            </ul>
          </HelpSection>

          <HelpSection title="⚠️ 이상지표 (정직원 패널티)">
            <ul style={ulStyle}>
              <li><strong>5% 편차</strong>: 입찰 일지 중 <code>deviationReason</code> 필드가 있는 건수 (제시가 vs 실제 입찰가 5% 초과)</li>
              <li><strong>환불</strong>: <code>status='refunded'</code>인 매출 건수</li>
              <li>(편차 + 환불) 합계 1건당 -1점, 최대 -5점까지 차감</li>
            </ul>
          </HelpSection>

          <HelpSection title="🏷 자동 성향 태그 임계값">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={thStyle}>태그</th>
                  <th style={thStyle}>조건</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style={tdStyle}><TagPill tagKey="champion" /></td><td style={tdStyle}>매출 달성률 ≥ 120%</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="stable" /></td><td style={tdStyle}>매출 달성률 90~120%</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="underperform" /></td><td style={tdStyle}>매출 달성률 &lt; 90% (입사 3개월+ 한정)</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="active" /></td><td style={tdStyle}>활동 지수 ≥ 130%</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="efficient" /></td><td style={tdStyle}>활동 보통 + 입찰낙찰률 ≥ 70%</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="inactive" /></td><td style={tdStyle}>활동 지수 &lt; 70%</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="precise" /></td><td style={tdStyle}>5% 편차 0건 (입찰 1건 이상)</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="deviated" /></td><td style={tdStyle}>5% 편차 ≥ 3건</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="safe" /></td><td style={tdStyle}>환불 0건 + 매출 1건 이상 (정직원만)</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="refunded" /></td><td style={tdStyle}>환불 ≥ 1건</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="punctual" /></td><td style={tdStyle}>일지 작성률 ≥ 95% (정직원만)</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="absent" /></td><td style={tdStyle}>일지 작성률 &lt; 70% (정직원만)</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="new" /></td><td style={tdStyle}>근속 &lt; 3개월</td></tr>
                <tr><td style={tdStyle}><TagPill tagKey="growing" /></td><td style={tdStyle}>MoM 성장률 ≥ 20% (프리랜서만)</td></tr>
              </tbody>
            </table>
          </HelpSection>

          <HelpSection title="📌 부족한 점 진단 임계값">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={thStyle}>진단 메시지</th>
                  <th style={thStyle}>발동 조건</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style={tdStyle}>매출 N% — 1인분 미달</td><td style={tdStyle}>달성률 &lt; 80%</td></tr>
                <tr><td style={tdStyle}>입찰→낙찰 N% — 낮음</td><td style={tdStyle}>입찰 1건 이상 AND 낙찰률 &lt; 30%</td></tr>
                <tr><td style={tdStyle}>활동량 평균 이하</td><td style={tdStyle}>활동 지수 &lt; 70%</td></tr>
                <tr><td style={tdStyle}>환불 N건 — 사후관리 강화</td><td style={tdStyle}>환불 ≥ 1건</td></tr>
                <tr><td style={tdStyle}>일지 작성률 70% 미만</td><td style={tdStyle}>일지 작성률 &lt; 70% (정직원만)</td></tr>
                <tr><td style={tdStyle}>5% 편차 N건 — 정확도 개선</td><td style={tdStyle}>5% 편차 ≥ 3건</td></tr>
              </tbody>
            </table>
          </HelpSection>

          <HelpSection title="💪 잘하는 점 진단 임계값">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={thStyle}>진단 메시지</th>
                  <th style={thStyle}>발동 조건</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style={tdStyle}>매출 N% 달성 — 우수</td><td style={tdStyle}>달성률 ≥ 110%</td></tr>
                <tr><td style={tdStyle}>입찰→낙찰 전환율 N% 우수</td><td style={tdStyle}>낙찰률 ≥ 70%</td></tr>
                <tr><td style={tdStyle}>5% 편차 없음</td><td style={tdStyle}>편차 0건 + 입찰 1건 이상</td></tr>
                <tr><td style={tdStyle}>환불 0건 — 사후관리 우수</td><td style={tdStyle}>환불 0건 + 매출 1건 이상</td></tr>
                <tr><td style={tdStyle}>일지 작성률 95% 이상</td><td style={tdStyle}>작성률 ≥ 95% (정직원만)</td></tr>
              </tbody>
            </table>
          </HelpSection>

          <HelpSection title="🗓 매월 자동 갱신">
            <p>월 네비게이션의 <strong>"진행 중"</strong> 표시는 현재 달입니다. 매월 1일 00시(KST)가 되면 자동으로 새 달의 빈 데이터로 시작됩니다. 이전 달은 좌측 화살표로 조회 가능합니다.</p>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #e0e0e0', fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #f1f3f4' };
const ulStyle: React.CSSProperties = { margin: '6px 0 8px 0', paddingLeft: 20 };

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 22, paddingBottom: 14, borderBottom: '1px solid #f1f3f4' }}>
      <h3 style={{ margin: '0 0 10px 0', fontSize: 14, color: '#1a73e8', fontWeight: 700 }}>{title}</h3>
      {children}
    </section>
  );
}
