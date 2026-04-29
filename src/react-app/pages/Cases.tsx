// 외부 사건 관리 — 법률사무소 명승(landing-law) 수임 사건
// - 매출 시스템과 완전 격리. 급여정산 명도성과금에만 사용
// - 목록 + 검색 + 상세 모달 + 2개월 단위 명도성과금 요약

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import { Briefcase, Search, X, Calendar, User, Building2, Coins, Award, FileText, Hash } from 'lucide-react';

interface CaseRow {
  id: string;
  external_id: string;
  registered_at: string;
  consultant_name: string | null;
  consultant_position: string | null;
  consultant_user_id: string | null;
  consultant_branch: string | null;
  consultant_department: string | null;
  manager_username: string;
  manager_name: string;
  manager_user_id: string | null;
  manager_branch: string | null;
  manager_department: string | null;
  client_name: string;
  fee_type: 'fixed' | 'actual';
  fee_amount: number;
  bimonthly_period: string;
  raw_payload: string | null;
  created_at: string;
  updated_at: string;
}

interface BonusSummaryRow {
  consultant_user_id: string | null;
  consultant_name: string;
  consultant_position: string | null;
  consultant_branch: string | null;
  consultant_department: string | null;
  cnt: number;
  total_fee: number;
  total_fee_raw: number;
  total_fee_adjusted: number;
  bonus: number;
}

const fmtKRW = (n: number) => n.toLocaleString('ko-KR') + '원';
const fmtKRWShort = (n: number) => n >= 10000 ? `${Math.floor(n / 10000).toLocaleString()}만` : `${n.toLocaleString()}원`;

function getCurrentBimonthlyPeriod(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const start = m % 2 === 1 ? m : m - 1;
  return `${y}-${String(start).padStart(2, '0')}_${String(start + 1).padStart(2, '0')}`;
}

function shiftPeriod(period: string, delta: number): string {
  const m = period.match(/^(\d{4})-(\d{2})_(\d{2})$/);
  if (!m) return period;
  const y = parseInt(m[1], 10);
  const startM = parseInt(m[2], 10);
  // 한 구간이 2개월 → delta=1 이면 +2개월
  const newStart = startM + delta * 2;
  const totalMonths = (y - 1) * 12 + (newStart - 1);
  const newY = Math.floor(totalMonths / 12) + 1;
  const newM = (totalMonths % 12) + 1;
  return `${newY}-${String(newM).padStart(2, '0')}_${String(newM + 1).padStart(2, '0')}`;
}

function labelOfPeriod(period: string): string {
  const m = period.match(/^(\d{4})-(\d{2})_(\d{2})$/);
  if (!m) return period;
  return `${m[1]}년 ${parseInt(m[2], 10)}~${parseInt(m[3], 10)}월`;
}

const FEE_BANDS = [
  { upTo: 2_000_000,  label: '~ 200만',     bonus: 100_000 },
  { upTo: 5_000_000,  label: '200만 ~ 500만', bonus: 200_000 },
  { upTo: 7_000_000,  label: '500만 ~ 700만', bonus: 300_000 },
  { upTo: 10_000_000, label: '700만 ~ 1000만', bonus: 400_000 },
  { upTo: 20_000_000, label: '1000만 ~ 2000만', bonus: 600_000 },
  { upTo: Infinity,   label: '2000만 초과',  bonus: 800_000 },
];

export default function Cases() {
  const { user } = useAuthStore();
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<string>(getCurrentBimonthlyPeriod());
  const [tab, setTab] = useState<'list' | 'bonus'>('list');
  const [openCase, setOpenCase] = useState<CaseRow | null>(null);
  const [bonus, setBonus] = useState<BonusSummaryRow[]>([]);
  const [bonusLoading, setBonusLoading] = useState(false);

  const isAdminPlus = user?.role === 'master' || user?.role === 'ceo' || user?.role === 'cc_ref' || user?.role === 'accountant' || user?.role === 'accountant_asst' || (user?.role === 'admin' && user?.branch === '의정부');

  const load = () => {
    setLoading(true);
    api.cases.list({ search, period: tab === 'list' ? '' : period, limit: 500 })
      .then((r) => setRows(r.cases || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  const loadBonus = () => {
    setBonusLoading(true);
    api.cases.bonusSummary(period)
      .then((r) => setBonus(r.summary || []))
      .catch(() => setBonus([]))
      .finally(() => setBonusLoading(false));
  };

  useEffect(() => { load(); }, [search, period]);
  useEffect(() => { if (tab === 'bonus') loadBonus(); }, [tab, period]);

  const totalFee = useMemo(() => rows.reduce((s, r) => s + (r.fee_amount || 0), 0), [rows]);

  return (
    <div className="page">
      <div className="page-header">
        <h2><Briefcase size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} />명도 사건 (외부)</h2>
        <div style={{ fontSize: 12, color: '#5f6368', marginTop: 4 }}>
          법률사무소 명승에서 자동 수신된 사건. 기존 매출 시스템과 분리되며, 급여정산의 명도성과금에만 사용됩니다.
        </div>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid #e0e0e0' }}>
        <button onClick={() => setTab('list')}
          style={{ padding: '8px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14,
            borderBottom: tab === 'list' ? '2px solid #1a73e8' : '2px solid transparent',
            color: tab === 'list' ? '#1a73e8' : '#5f6368', fontWeight: tab === 'list' ? 700 : 400 }}>
          사건 목록
        </button>
        <button onClick={() => setTab('bonus')}
          style={{ padding: '8px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14,
            borderBottom: tab === 'bonus' ? '2px solid #1a73e8' : '2px solid transparent',
            color: tab === 'bonus' ? '#1a73e8' : '#5f6368', fontWeight: tab === 'bonus' ? 700 : 400 }}>
          명도성과금 (2개월 단위)
        </button>
      </div>

      {/* 검색 + 구간 네비 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {tab === 'list' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 240 }}>
            <Search size={16} color="#5f6368" />
            <input
              type="text"
              placeholder="담당자/위임인/사건ID 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, padding: '6px 10px', border: '1px solid #dadce0', borderRadius: 6, fontSize: 13 }}
            />
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setPeriod(shiftPeriod(period, -1))} style={navBtnStyle}>◀</button>
          <span style={{ fontSize: 14, fontWeight: 700, minWidth: 130, textAlign: 'center' }}>
            {labelOfPeriod(period)}
          </span>
          <button onClick={() => setPeriod(shiftPeriod(period, 1))} style={navBtnStyle}>▶</button>
        </div>
        {tab === 'list' && (
          <button onClick={() => setPeriod(getCurrentBimonthlyPeriod())} style={{ ...navBtnStyle, padding: '4px 10px', fontSize: 12 }}>
            현재 구간
          </button>
        )}
      </div>

      {/* 탭 콘텐츠 */}
      {tab === 'list' && (
        <>
          {/* 요약 카드 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
            <SummaryCard label="총 사건" value={`${rows.length}건`} color="#1a73e8" />
            <SummaryCard label="총 수임료" value={fmtKRWShort(totalFee)} color="#188038" />
            <SummaryCard label="현재 구간" value={labelOfPeriod(period)} color="#7b1fa2" />
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#5f6368' }}>로딩중...</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9aa0a6' }}>등록된 사건이 없습니다.</div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>등록일</th>
                    <th>구간</th>
                    <th>컨설턴트 (성과금 귀속)</th>
                    <th>위임인</th>
                    <th>담당자 (명도팀)</th>
                    <th>유형</th>
                    <th style={{ textAlign: 'right' }}>수임료</th>
                    <th>외부 ID</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => setOpenCase(r)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontSize: 12 }}>{r.registered_at?.slice(0, 10)}</td>
                      <td style={{ fontSize: 11, color: '#5f6368' }}>{labelOfPeriod(r.bimonthly_period)}</td>
                      <td style={{ fontWeight: 600 }}>
                        {r.consultant_name || '-'}
                        {r.consultant_position && <span style={{ marginLeft: 4, color: '#5f6368', fontSize: 11, fontWeight: 400 }}>{r.consultant_position}</span>}
                        {r.consultant_branch && <span style={{ marginLeft: 4, color: '#9aa0a6', fontSize: 11 }}>{r.consultant_branch}{r.consultant_department ? '·' + r.consultant_department : ''}</span>}
                        {!r.consultant_user_id && r.consultant_name && <span style={{ marginLeft: 4, fontSize: 10, color: '#d93025' }}>(미매칭)</span>}
                      </td>
                      <td>{r.client_name}</td>
                      <td style={{ fontSize: 12, color: '#5f6368' }}>
                        {r.manager_name}
                        {r.manager_branch && <span style={{ marginLeft: 4, fontSize: 11, color: '#9aa0a6' }}>{r.manager_branch}{r.manager_department ? '·' + r.manager_department : ''}</span>}
                      </td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, background: r.fee_type === 'fixed' ? '#e8f0fe' : '#fff3e0', color: r.fee_type === 'fixed' ? '#1a73e8' : '#e65100' }}>
                          {r.fee_type === 'fixed' ? '정액' : '실비'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKRW(r.fee_amount)}</td>
                      <td style={{ fontSize: 11, color: '#9aa0a6' }}>{r.external_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'bonus' && (
        <>
          {/* 매출 자동 INSERT 트리거 (마스터/총무담당) */}
          {(user?.role === 'master' || user?.role === 'accountant') && (
            <div style={{ marginBottom: 16, padding: 12, background: '#fff8e1', borderRadius: 8, border: '1px solid #ffd54f' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                매출 자동 추가 (2개월 마감)
              </div>
              <div style={{ fontSize: 11, color: '#5f6368', marginBottom: 10 }}>
                {labelOfPeriod(period)} 명도성과금을 매출내역에 추가합니다. (마감월 말일자, INSERT OR IGNORE — 한 번 들어가면 변동 없음)
                <br />
                ※ 매월 1일 00:45 KST에 자동 cron으로도 실행됩니다. 마감 전 미리 보고 싶을 때만 수동 사용.
              </div>
              <button
                onClick={async () => {
                  if (!confirm(`${labelOfPeriod(period)} 명도성과금을 매출내역에 추가하시겠습니까?\n\n- 급여제·비율제 모두 대상\n- 본사관리만 제외\n- 이미 들어간 건은 변동 없음`)) return;
                  try {
                    const r = await api.cases.finalizeBonus(period);
                    alert(`처리 완료\n\n신규 INSERT: ${r.inserted}건\n기존 처리됨(skip): ${r.skipped}건\n자격 미달: ${r.ineligible}건\n\n${r.details.map(d => `${d.user_name} ${d.bonus.toLocaleString()}원 — ${d.status}${d.reason ? ` (${d.reason})` : ''}`).join('\n')}`);
                  } catch (err: any) {
                    alert('실패: ' + err.message);
                  }
                }}
                style={{ padding: '8px 16px', background: '#f57c00', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                매출내역에 명도성과금 추가
              </button>
            </div>
          )}

          {/* 등급표 */}
          <details style={{ marginBottom: 16, padding: 12, background: '#f8f9fa', borderRadius: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>명도성과금 등급표 (총 금액 기준)</summary>
            <table style={{ width: '100%', marginTop: 8, fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fff' }}>
                  <th style={{ padding: 6, borderBottom: '1px solid #e0e0e0', textAlign: 'left' }}>총 수임료</th>
                  <th style={{ padding: 6, borderBottom: '1px solid #e0e0e0', textAlign: 'right' }}>성과금</th>
                </tr>
              </thead>
              <tbody>
                {FEE_BANDS.map((b, i) => (
                  <tr key={i}><td style={{ padding: 6, borderBottom: '1px solid #f1f3f4' }}>{b.label}</td><td style={{ padding: 6, borderBottom: '1px solid #f1f3f4', textAlign: 'right', fontWeight: 700 }}>{fmtKRWShort(b.bonus)}</td></tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 6, fontSize: 11, color: '#5f6368' }}>
              ※ 구간별이 아닌 <strong>조정 후 총 금액 기준</strong> 단계 산정.<br />
              ※ 조정 산식 — 정액제: 수임료 −150,000원 / 실비제: 수임료 ÷ 1.1 (부가세 제외)<br />
              ※ 예: 정액 700만 → 685만 → 30만원 / 실비 700만 → 636만 → 30만원
            </div>
          </details>

          {bonusLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#5f6368' }}>로딩중...</div>
          ) : bonus.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9aa0a6' }}>해당 구간 사건이 없습니다.</div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>컨설턴트 (성과금 귀속)</th>
                    <th>지사 / 팀</th>
                    <th style={{ textAlign: 'right' }}>사건 수</th>
                    <th style={{ textAlign: 'right' }}>수임료(원본)</th>
                    <th style={{ textAlign: 'right' }}>조정 후 (성과금기준)</th>
                    <th style={{ textAlign: 'right' }}>성과금</th>
                  </tr>
                </thead>
                <tbody>
                  {bonus.map((b, i) => (
                    <tr key={i}>
                      <td>
                        {b.consultant_name}
                        {b.consultant_position && <span style={{ marginLeft: 4, color: '#5f6368', fontSize: 11 }}>{b.consultant_position}</span>}
                        {!b.consultant_user_id && <span style={{ marginLeft: 6, fontSize: 10, color: '#d93025' }}>(미매칭)</span>}
                      </td>
                      <td style={{ fontSize: 12, color: '#5f6368' }}>{b.consultant_branch || '-'} {b.consultant_department ? '· ' + b.consultant_department : ''}</td>
                      <td style={{ textAlign: 'right' }}>{b.cnt}건</td>
                      <td style={{ textAlign: 'right', color: '#5f6368' }}>{fmtKRW(b.total_fee_raw || b.total_fee)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtKRW(b.total_fee_adjusted || b.total_fee)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#188038' }}>+{fmtKRW(b.bonus)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: '#f8f9fa', fontWeight: 700 }}>
                    <td colSpan={2}>합계</td>
                    <td style={{ textAlign: 'right' }}>{bonus.reduce((s, b) => s + b.cnt, 0)}건</td>
                    <td style={{ textAlign: 'right', color: '#5f6368' }}>{fmtKRW(bonus.reduce((s, b) => s + (b.total_fee_raw || b.total_fee), 0))}</td>
                    <td style={{ textAlign: 'right' }}>{fmtKRW(bonus.reduce((s, b) => s + (b.total_fee_adjusted || b.total_fee), 0))}</td>
                    <td style={{ textAlign: 'right', color: '#188038' }}>+{fmtKRW(bonus.reduce((s, b) => s + b.bonus, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {!isAdminPlus && (
            <div style={{ marginTop: 12, padding: 10, background: '#fff8e1', borderRadius: 6, fontSize: 12, color: '#5f6368' }}>
              본인이 담당한 사건만 표시됩니다.
            </div>
          )}
        </>
      )}

      {/* 상세 모달 */}
      {openCase && <CaseDetailModal c={openCase} onClose={() => setOpenCase(null)} />}
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  padding: '4px 10px', border: '1px solid #dadce0', background: '#fff', borderRadius: 6,
  cursor: 'pointer', fontSize: 13,
};

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 11, color: '#5f6368', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function CaseDetailModal({ c, onClose }: { c: CaseRow; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 0, maxWidth: 600, width: '92%', maxHeight: '90vh', overflow: 'auto', position: 'relative' }}>
        <div style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid #e0e0e0', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}><Briefcase size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />사건 상세</h3>
          <button onClick={onClose} style={{ border: 'none', background: '#f1f3f4', borderRadius: 20, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 20, fontSize: 13 }}>
          <DetailRow icon={<Hash size={14} />} label="외부 ID" value={c.external_id} mono />
          <DetailRow icon={<FileText size={14} />} label="자체 ID" value={c.id} mono />
          <DetailRow icon={<Calendar size={14} />} label="등록일" value={c.registered_at} />
          <DetailRow icon={<Award size={14} />} label="구간" value={labelOfPeriod(c.bimonthly_period)} />
          <DetailRow icon={<User size={14} />} label="담당자" value={`${c.manager_name} (${c.manager_username})`} />
          <DetailRow icon={<Building2 size={14} />} label="소속" value={`${c.manager_branch || '-'}${c.manager_department ? ' · ' + c.manager_department : ''}${c.manager_user_id ? '' : ' (미매칭)'}`} />
          <DetailRow icon={<User size={14} />} label="컨설턴트" value={c.consultant_name ? `${c.consultant_name} ${c.consultant_position || ''}` : '-'} />
          <DetailRow icon={<User size={14} />} label="위임인" value={c.client_name} highlight />
          <DetailRow icon={<Coins size={14} />} label="수임료" value={`${fmtKRW(c.fee_amount)} (${c.fee_type === 'fixed' ? '정액' : '실비'})`} highlight />
          <DetailRow icon={<Calendar size={14} />} label="등록 시각" value={c.created_at} />
          <DetailRow icon={<Calendar size={14} />} label="최종 수정" value={c.updated_at} />
          {c.raw_payload && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#5f6368' }}>원본 페이로드 (감사용)</summary>
              <pre style={{ marginTop: 8, padding: 10, background: '#f8f9fa', borderRadius: 6, fontSize: 11, overflow: 'auto', maxHeight: 200 }}>{c.raw_payload}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value, mono, highlight }: { icon: React.ReactNode; label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid #f1f3f4' }}>
      <span style={{ minWidth: 100, color: '#5f6368', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
        {icon} {label}
      </span>
      <span style={{
        flex: 1, fontWeight: highlight ? 700 : 400,
        fontFamily: mono ? 'monospace' : undefined,
        fontSize: mono ? 12 : 13,
        color: highlight ? '#1a73e8' : '#202124',
      }}>{value}</span>
    </div>
  );
}
