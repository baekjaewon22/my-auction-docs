import { useEffect, useState, useRef } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { User } from '../types';
import { useBranches } from '../hooks/useBranches';
import Select from '../components/Select';
import { Receipt, Camera } from 'lucide-react';

function fmtWon(n: number): string { return n.toLocaleString('ko-KR') + '원'; }
function toMoneyDisplay(val: string): string {
  const num = val.replace(/[^0-9]/g, '');
  return num ? Number(num).toLocaleString('ko-KR') : '';
}
function fromMoneyDisplay(val: string): string {
  return val.replace(/[^0-9]/g, '');
}

export default function Payroll() {
  useAuthStore();
  const { branches: BRANCHES } = useBranches();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [filterBranch, setFilterBranch] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'payroll' | 'summary' | 'branch'>('payroll');

  // 회계 수동 입력 필드
  const [deduction, setDeduction] = useState('0');
  const [extraPay, setExtraPay] = useState('0');
  const [extraLabel, setExtraLabel] = useState('');
  const [extraDeduction, setExtraDeduction] = useState('0');
  const [extraDeductionLabel, setExtraDeductionLabel] = useState('');
  const [cardUsage, setCardUsage] = useState(0);

  // 지사별 합산
  const [branchData, setBranchData] = useState<any[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const branchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.users.list().then(res => setUsers(res.users)).catch(() => {});
  }, []);

  const loadPayroll = async () => {
    if (!selectedUserId) return;
    setLoading(true);
    try {
      const [res, cardRes] = await Promise.all([
        api.payroll.get(selectedUserId, selectedMonth),
        api.card.userTotal(selectedUserId, selectedMonth),
      ]);
      setData(res);
      setCardUsage(cardRes.total || 0);
      setDeduction('0');
      setExtraPay('0');
      setExtraLabel('');
    } catch (err: any) { alert(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (selectedUserId) loadPayroll(); }, [selectedUserId, selectedMonth]);

  const loadBranch = async () => {
    setBranchLoading(true);
    try {
      const res = await api.payroll.branchSummary(selectedMonth);
      setBranchData(res.branches || []);
    } catch { setBranchData([]); }
    finally { setBranchLoading(false); }
  };

  useEffect(() => { if (tab === 'branch') loadBranch(); }, [tab, selectedMonth]);

  const handleCopyPng = async (ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return;
    try {
      const { default: html2canvas } = await import('html2canvas' as any);
      const canvas = await (html2canvas as any)(ref.current, {
        scale: 2, backgroundColor: '#ffffff', useCORS: true,
      });
      canvas.toBlob(async (blob: Blob | null) => {
        if (!blob) { alert('이미지 생성 실패'); return; }
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          alert('클립보드에 복사되었습니다.');
        } catch {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `급여정산_${data?.user?.name}_${selectedMonth}.png`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }, 'image/png');
    } catch {
      alert('PNG 변환에 실패했습니다.');
    }
  };

  // 지사 필터 적용
  const filteredUsers = (filterBranch ? users.filter(u => u.branch === filterBranch) : users).filter(u => u.role !== 'master');
  const userOpts = filteredUsers.map(u => ({ value: u.id, label: `${u.name} (${u.department || ''} · ${u.branch || ''})` }));
  const branchOpts = BRANCHES.map(b => ({ value: b, label: b }));

  const s = data?.summary;

  // 공제/기타 반영 계산
  const deductionNum = Number(deduction) || 0;
  const extraPayNum = Number(extraPay) || 0;
  const extraDeductionNum = Number(extraDeduction) || 0;
  const unpaidDeduction = s?.unpaid_leave_deduction || 0;
  const basePay = s ? s.salary + s.position_allowance : 0;
  const afterDeduction = basePay - deductionNum - unpaidDeduction - extraDeductionNum;
  const totalPay = s ? afterDeduction + s.bonus + extraPayNum : 0;

  return (
    <div className="page">
      <div className="page-header">
        <h2><Receipt size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 급여정산</h2>
      </div>

      {/* 필터 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ minWidth: 120 }}>
          <label className="form-label">지사</label>
          <Select size="sm" options={[{ value: '', label: '전체 지사' }, ...branchOpts]}
            value={branchOpts.find(o => o.value === filterBranch) || { value: '', label: '전체 지사' }}
            onChange={(o: any) => { setFilterBranch(o?.value || ''); setSelectedUserId(''); setData(null); }}
            placeholder="지사" isClearable />
        </div>
        <div style={{ minWidth: 260 }}>
          <label className="form-label">담당자</label>
          <Select options={userOpts}
            value={userOpts.find(o => o.value === selectedUserId) || null}
            onChange={(o: any) => setSelectedUserId(o?.value || '')}
            placeholder="담당자 선택" isSearchable />
        </div>
        <div>
          <label className="form-label">정산 월</label>
          <input type="month" className="form-input" value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)} />
        </div>
      </div>

      {/* 탭 */}
      <div className="filter-bar" style={{ marginBottom: 20 }}>
        <button className={`filter-btn ${tab === 'payroll' ? 'active' : ''}`} onClick={() => setTab('payroll')}>
          급여정산
        </button>
        {data && <button className={`filter-btn ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>
          회사이익 및 매출정리
        </button>}
        <button className={`filter-btn ${tab === 'branch' ? 'active' : ''}`} onClick={() => setTab('branch')}>
          지사별 합산
        </button>
      </div>

      {loading && <div className="page-loading">로딩중...</div>}

      {/* ━━━ 급여정산 탭 ━━━ */}
      {data && !loading && tab === 'payroll' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 8, marginBottom: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => handleCopyPng(printRef)}>
              <Camera size={14} /> PNG 복사
            </button>
          </div>

          <div ref={printRef} className="payroll-sheet">
            {data.accounting.pay_type === 'commission' ? (
              /* ━━━ 비율제 정산표 ━━━ */
              <>
                <div className="payroll-header">
                  <div className="payroll-title">수 익 정 산</div>
                  <div className="payroll-period">{data?.period_label || selectedMonth.replace('-', '년 ')}월</div>
                </div>

                <div className="payroll-info-row">
                  <div className="payroll-info-cell">
                    <span className="payroll-info-label">담당자</span>
                    <span className="payroll-info-value">{data.user.name}</span>
                  </div>
                  <div className="payroll-info-cell">
                    <span className="payroll-info-label">소속</span>
                    <span className="payroll-info-value">{data.user.branch} · {data.user.department}</span>
                  </div>
                  <div className="payroll-info-cell">
                    <span className="payroll-info-label">정산유형</span>
                    <span className="payroll-info-value accent">비율제 ({data.accounting.commission_rate}%)</span>
                  </div>
                  <div className="payroll-info-cell highlight">
                    <span className="payroll-info-label">확정매출 건</span>
                    <span className="payroll-info-value accent">{s.contract_count}건</span>
                  </div>
                </div>

                {/* 매출 목록 */}
                <table className="payroll-table">
                  <thead>
                    <tr>
                      <th style={{ width: '12%' }}>날짜</th>
                      <th style={{ width: '22%' }}>고객명 (입금자명)</th>
                      <th style={{ width: '14%' }}>매출항목</th>
                      <th style={{ width: '18%', textAlign: 'right' }}>매출액</th>
                      <th style={{ width: '16%', textAlign: 'right' }}>공급가액</th>
                      <th style={{ width: '14%', textAlign: 'right' }}>부가세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: '#9aa0a6', padding: 32 }}>해당 기간 확정매출 내역이 없습니다.</td></tr>
                    ) : (
                      <>
                        {data.records.map((r: any, i: number) => (
                          <tr key={r.id} className={i % 2 === 1 ? 'stripe' : ''}>
                            <td>{r.contract_date?.slice(5)}</td>
                            <td>{r.client_name}{r.depositor_different === 1 && r.depositor_name && <span className="payroll-depositor">({r.depositor_name})</span>}</td>
                            <td><span className={`payroll-type payroll-type-${r.type}`}>{r.type}</span></td>
                            <td className="num">{fmtWon(r.amount)}</td>
                            <td className="num sub">{fmtWon(r.supply_amount)}</td>
                            <td className="num sub">{fmtWon(r.vat_amount)}</td>
                          </tr>
                        ))}
                        <tr className="payroll-total-row">
                          <td colSpan={3}>합계 ({data.records.length}건)</td>
                          <td className="num">{fmtWon(s.total_sales)}</td>
                          <td className="num">{fmtWon(s.total_supply)}</td>
                          <td className="num">{fmtWon(s.total_vat)}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>

                {/* 환불 내역 */}
                {data.refunded_records?.length > 0 && (
                  <>
                    <div className="payroll-section-title refund">환불 내역</div>
                    <table className="payroll-table refund">
                      <tbody>
                        {data.refunded_records.map((r: any) => (
                          <tr key={r.id}>
                            <td style={{ width: '12%' }}>{r.contract_date?.slice(5)}</td>
                            <td style={{ width: '22%' }}>{r.client_name}</td>
                            <td style={{ width: '14%' }}>{r.type}</td>
                            <td className="num" style={{ width: '18%', color: '#d93025' }}>-{fmtWon(r.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {/* 비율제 정산 */}
                {(() => {
                  const rate = data.accounting.commission_rate || 0;
                  const netSales = s.total_supply - Math.round((data.refunded_records || []).reduce((sum: number, r: any) => sum + Math.round(r.amount / 1.1), 0));
                  const commissionAmount = Math.round(netSales * rate / 100);
                  const tax33 = Math.round(commissionAmount * 0.033);
                  const finalPay = commissionAmount - tax33;
                  const companyRevenue = netSales - commissionAmount;
                  return (
                    <>
                      <div className="payroll-section-title">수익 정산</div>
                      <div className="payroll-bonus-box">
                        <div className="payroll-bonus-row">
                          <span>총 매출액 (부가세 포함)</span>
                          <span className="num">{fmtWon(s.total_sales - s.total_refund)}</span>
                        </div>
                        <div className="payroll-bonus-row">
                          <span>부가세</span>
                          <span className="num" style={{ color: '#9aa0a6' }}>{fmtWon(s.total_sales - s.total_refund - netSales)}</span>
                        </div>
                        <div className="payroll-bonus-row" style={{ fontWeight: 700 }}>
                          <span>매출 금액 (부가세 제외)</span>
                          <span className="num">{fmtWon(netSales)}</span>
                        </div>
                      </div>

                      <div className="payroll-section-title">담당자 정산</div>
                      <div className="payroll-bonus-box">
                        <div className="payroll-bonus-row">
                          <span>수입 금액 (매출 × {rate}%)</span>
                          <span className="num" style={{ fontWeight: 700, color: '#1a73e8' }}>{fmtWon(commissionAmount)}</span>
                        </div>
                        <div className="payroll-bonus-row" style={{ color: '#d93025' }}>
                          <span>원천세 (3.3%)</span>
                          <span className="num">-{fmtWon(tax33)}</span>
                        </div>
                        <div className="payroll-bonus-row grand-total">
                          <span>실 지급액</span>
                          <span className="num">{fmtWon(finalPay)}</span>
                        </div>
                      </div>

                      <div className="payroll-section-title">회사 수익</div>
                      <div className="payroll-bonus-box">
                        <div className="payroll-bonus-row">
                          <span>매출 금액 (부가세 제외)</span>
                          <span className="num">{fmtWon(netSales)}</span>
                        </div>
                        <div className="payroll-bonus-row" style={{ color: '#d93025' }}>
                          <span>담당자 수입 ({rate}%)</span>
                          <span className="num">-{fmtWon(commissionAmount)}</span>
                        </div>
                        <div className="payroll-bonus-row grand-total" style={{ color: companyRevenue >= 0 ? '#188038' : '#d93025' }}>
                          <span>회사 매출</span>
                          <span className="num">{fmtWon(companyRevenue)}</span>
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* 법인카드 */}
                {cardUsage > 0 && (
                  <div style={{ marginTop: 12, padding: '10px 16px', background: '#fff3e0', borderRadius: 8, border: '1px solid #ffd699', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', color: '#e65100' }}>법인카드 사용금액</span>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e65100' }}>{fmtWon(cardUsage)}</span>
                  </div>
                )}

                <div className="payroll-footer">
                  <div className="payroll-footer-date">{data?.period_label || selectedMonth.replace('-', '년 ')}월 수익정산</div>
                  <div className="payroll-footer-company">마이옥션</div>
                </div>
              </>
            ) : (
              /* ━━━ 급여제 정산표 (기존) ━━━ */
              <>
            <div className="payroll-header">
              <div className="payroll-title">급 여 정 산</div>
              <div className="payroll-period">{data?.period_label || selectedMonth.replace('-', '년 ')}월</div>
            </div>

            {/* 담당자 정보 */}
            <div className="payroll-info-row">
              <div className="payroll-info-cell">
                <span className="payroll-info-label">담당자</span>
                <span className="payroll-info-value">{data.user.name}</span>
              </div>
              <div className="payroll-info-cell">
                <span className="payroll-info-label">소속</span>
                <span className="payroll-info-value">{data.user.branch} · {data.user.department}</span>
              </div>
              <div className="payroll-info-cell">
                <span className="payroll-info-label">직급</span>
                <span className="payroll-info-value">{data.accounting.grade || '-'}</span>
              </div>
              {!data.is_hq && (
              <div className="payroll-info-cell highlight">
                <span className="payroll-info-label">해당 월 계약 건</span>
                <span className="payroll-info-value accent">{s.contract_count}건</span>
              </div>
              )}
            </div>

            {/* 매출 목록 테이블 — 본사관리 제외 */}
            {!data.is_hq && (
            <>
            <table className="payroll-table">
              <thead>
                <tr>
                  <th style={{ width: '12%' }}>날짜</th>
                  <th style={{ width: '22%' }}>고객명 (입금자명)</th>
                  <th style={{ width: '14%' }}>매출항목</th>
                  <th style={{ width: '18%', textAlign: 'right' }}>매출액</th>
                  <th style={{ width: '16%', textAlign: 'right' }}>공급가액</th>
                  <th style={{ width: '14%', textAlign: 'right' }}>부가세</th>
                </tr>
              </thead>
              <tbody>
                {data.records.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#9aa0a6', padding: 32 }}>해당 월 확정매출 내역이 없습니다.</td></tr>
                ) : (
                  <>
                    {data.records.map((r: any, i: number) => (
                      <tr key={r.id} className={i % 2 === 1 ? 'stripe' : ''}>
                        <td>{r.contract_date?.slice(5)}</td>
                        <td>
                          {r.client_name}
                          {r.depositor_different === 1 && r.depositor_name && <span className="payroll-depositor">({r.depositor_name})</span>}
                        </td>
                        <td><span className={`payroll-type payroll-type-${r.type}`}>{r.type}</span></td>
                        <td className="num">{fmtWon(r.amount)}</td>
                        <td className="num sub">{fmtWon(r.supply_amount)}</td>
                        <td className="num sub">{fmtWon(r.vat_amount)}</td>
                      </tr>
                    ))}
                    <tr className="payroll-total-row">
                      <td colSpan={3}>합계 ({data.records.length}건)</td>
                      <td className="num">{fmtWon(s.total_sales)}</td>
                      <td className="num">{fmtWon(s.total_supply)}</td>
                      <td className="num">{fmtWon(s.total_vat)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>

            {/* 환불 내역 */}
            {data.refunded_records?.length > 0 && (
              <>
                <div className="payroll-section-title refund">환불 내역</div>
                <table className="payroll-table refund">
                  <tbody>
                    {data.refunded_records.map((r: any) => (
                      <tr key={r.id}>
                        <td style={{ width: '12%' }}>{r.contract_date?.slice(5)}</td>
                        <td style={{ width: '22%' }}>{r.client_name}</td>
                        <td style={{ width: '14%' }}>{r.type}</td>
                        <td className="num" style={{ width: '18%', color: '#d93025' }}>-{fmtWon(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            </>
            )}

            {/* 상여금 (구간별 누진) — 본사관리 제외 */}
            {!data.is_hq && (
            <>
            <div className="payroll-section-title">성과금</div>
            <div className="payroll-bonus-box">
              <div className="payroll-bonus-row">
                <span>기준매출</span>
                <span className="num">{fmtWon(s.standard_sales)}</span>
              </div>
              <div className="payroll-bonus-row">
                <span>초과매출</span>
                <span className="num" style={{ color: s.excess > 0 ? '#188038' : '#9aa0a6' }}>
                  {s.excess > 0 ? fmtWon(s.excess) : '0원 (미달성)'}
                </span>
              </div>
              {s.excess > 0 && getBonusBreakdown(s.excess).map((tier, i) => (
                <div key={i} className="payroll-bonus-row" style={{ fontSize: '0.8rem', color: '#5f6368' }}>
                  <span>{tier.label}: {fmtWon(tier.base)} × {tier.rate}%</span>
                  <span className="num">{fmtWon(tier.amount)}</span>
                </div>
              ))}
              <div className="payroll-bonus-row total">
                <span>성과금</span>
                <span className="num accent">{fmtWon(s.bonus)}</span>
              </div>
            </div>
            </>
            )}

            {/* 급여 정산 */}
            <div className="payroll-section-title">급여 정산</div>
            <div className="payroll-bonus-box">
              <div className="payroll-bonus-row">
                <span>기본급여</span>
                <span className="num">{fmtWon(s.salary)}</span>
              </div>
              <div className="payroll-bonus-row">
                <span>직급수당</span>
                <span className="num">{fmtWon(s.position_allowance)}</span>
              </div>
              <div className="payroll-bonus-row" style={{ borderTop: '1px solid #e8eaed' }}>
                <span style={{ fontWeight: 600 }}>기본급+직급수당</span>
                <span className="num" style={{ fontWeight: 600 }}>{fmtWon(basePay)}</span>
              </div>
              <div className="payroll-bonus-row" style={{ color: '#d93025' }}>
                <span>공제합계 (4대보험료 등)</span>
                <span className="num">-{fmtWon(deductionNum)}</span>
              </div>
              {(s.unpaid_leave_days > 0) && (
                <div className="payroll-bonus-row" style={{ color: '#d93025' }}>
                  <span>무급휴가 공제 ({s.unpaid_leave_days}일)</span>
                  <span className="num">-{fmtWon(unpaidDeduction)}</span>
                </div>
              )}
              {extraDeductionNum > 0 && (
                <div className="payroll-bonus-row" style={{ color: '#d93025' }}>
                  <span>{extraDeductionLabel || '추가 공제'}</span>
                  <span className="num">-{fmtWon(extraDeductionNum)}</span>
                </div>
              )}
              {!data.is_hq && (
              <div className="payroll-bonus-row">
                <span>성과금</span>
                <span className="num">{fmtWon(s.bonus)}</span>
              </div>
              )}
              {extraPayNum > 0 && (
                <div className="payroll-bonus-row">
                  <span>{extraLabel || '기타'}</span>
                  <span className="num">{fmtWon(extraPayNum)}</span>
                </div>
              )}
              <div className="payroll-bonus-row grand-total">
                <span>총 지급액</span>
                <span className="num">{fmtWon(totalPay)}</span>
              </div>
            </div>

            {/* 법인카드 사용금액 */}
            {cardUsage > 0 && (
              <div style={{ marginTop: 12, padding: '10px 16px', background: '#fff3e0', borderRadius: 8, border: '1px solid #ffd699', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: '#e65100' }}>법인카드 사용금액</span>
                <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e65100' }}>{fmtWon(cardUsage)}</span>
              </div>
            )}

            <div className="payroll-footer">
              <div className="payroll-footer-date">{data?.period_label || selectedMonth.replace('-', '년 ')}월 급여정산</div>
              <div className="payroll-footer-company">마이옥션</div>
            </div>
              </>
            )}
          </div>

          {/* 수동 입력 (PNG 영역 밖) */}
          <div className="card" style={{ marginTop: 20, padding: 20, maxWidth: 800 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '0.95rem', color: '#3c4043' }}>회계 입력란</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              <div>
                <label className="form-label">공제합계 (4대보험료 등)</label>
                <input className="form-input" value={toMoneyDisplay(deduction)}
                  onChange={(e) => setDeduction(fromMoneyDisplay(e.target.value))} style={{ width: '100%' }} placeholder="공제 금액" />
              </div>
              <div>
                <label className="form-label">기타 추가정산 명목</label>
                <input className="form-input" value={extraLabel}
                  onChange={(e) => setExtraLabel(e.target.value)} style={{ width: '100%' }} placeholder="예: 교통비, 여비 등" />
              </div>
              <div>
                <label className="form-label">기타 추가정산 금액</label>
                <input className="form-input" value={toMoneyDisplay(extraPay)}
                  onChange={(e) => setExtraPay(fromMoneyDisplay(e.target.value))} style={{ width: '100%' }} placeholder="0" />
              </div>
              <div>
                <label className="form-label">추가 공제 명목</label>
                <input className="form-input" value={extraDeductionLabel}
                  onChange={(e) => setExtraDeductionLabel(e.target.value)} style={{ width: '100%' }} placeholder="예: 선지급금 회수 등" />
              </div>
              <div>
                <label className="form-label">추가 공제 금액</label>
                <input className="form-input" value={toMoneyDisplay(extraDeduction)}
                  onChange={(e) => setExtraDeduction(fromMoneyDisplay(e.target.value))} style={{ width: '100%' }} placeholder="0" />
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: '0.78rem', color: '#9aa0a6' }}>
              총지급액 = ((기본급여 + 직급수당) - 공제합계 - 추가공제) + 상여금 + 기타
            </div>
          </div>
        </>
      )}

      {/* ━━━ 회사이익 및 매출정리 탭 (월 기준) ━━━ */}
      {data && !loading && tab === 'summary' && (() => {
        // 선택 월 기준 매출 필터링
        const monthRecords = data.records.filter((r: any) => r.contract_date?.startsWith(selectedMonth));
        const monthRefunded = data.refunded_records?.filter((r: any) => r.contract_date?.startsWith(selectedMonth)) || [];
        const mSales = monthRecords.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
        const mRefund = monthRefunded.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
        const mNet = mSales - mRefund;
        const mContracts = monthRecords.filter((r: any) => r.type === '계약').length;
        // 비용: 급여정산서 금액 그대로 (성과금은 지급월에만 발생)
        const [, mm] = selectedMonth.split('-').map(Number);
        const isPayoutMonth = mm % 2 === 0; // 짝수월 = 성과금 지급월
        const mBonus = isPayoutMonth ? s.bonus : 0;
        const mTotalPay = s.salary + s.position_allowance + mBonus;
        const mProfit = mNet - mTotalPay;
        const monthLabel = selectedMonth.replace('-', '년 ') + '월';
        return (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 8, marginBottom: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => handleCopyPng(summaryRef)}>
              <Camera size={14} /> PNG 복사
            </button>
          </div>

          <div ref={summaryRef} className="payroll-sheet payroll-summary-sheet">
            <div className="payroll-header">
              <div className="payroll-title">매출 및 이익 정리</div>
              <div className="payroll-period">{data.user.name} · {monthLabel}</div>
            </div>

            <div className="payroll-summary-grid">
              <div className="payroll-summary-card blue">
                <div className="payroll-summary-card-title">매출 현황 ({monthLabel})</div>
                <div className="payroll-summary-item"><span>총 확정매출</span><span className="num">{fmtWon(mSales)}</span></div>
                <div className="payroll-summary-item"><span>환불 합계</span><span className="num" style={{ color: '#d93025' }}>-{fmtWon(mRefund)}</span></div>
                <div className="payroll-summary-item bold"><span>순매출</span><span className="num">{fmtWon(mNet)}</span></div>
                <div className="payroll-summary-item"><span>계약 건수</span><span className="num">{mContracts}건</span></div>
              </div>

              <div className="payroll-summary-card orange">
                <div className="payroll-summary-card-title">비용 ({monthLabel})</div>
                <div className="payroll-summary-item"><span>기본급여</span><span className="num">{fmtWon(s.salary)}</span></div>
                <div className="payroll-summary-item"><span>직급수당</span><span className="num">{fmtWon(s.position_allowance)}</span></div>
                <div className="payroll-summary-item"><span>성과금{!isPayoutMonth ? ' (홀수월 미지급)' : ''}</span><span className="num">{fmtWon(mBonus)}</span></div>
                <div className="payroll-summary-item bold"><span>지출 합계</span><span className="num">{fmtWon(mTotalPay)}</span></div>
              </div>

              <div className={`payroll-summary-card ${mProfit >= 0 ? 'green' : 'red'}`}>
                <div className="payroll-summary-card-title">회사 이익 ({monthLabel})</div>
                <div className="payroll-summary-item"><span>순매출</span><span className="num">{fmtWon(mNet)}</span></div>
                <div className="payroll-summary-item"><span>지출 합계</span><span className="num">{fmtWon(mTotalPay)}</span></div>
                <div className="payroll-summary-item grand">
                  <span>회사 이익</span>
                  <span className="num" style={{ color: mProfit >= 0 ? '#188038' : '#d93025' }}>
                    {mProfit >= 0 ? '+' : ''}{fmtWon(mProfit)}
                  </span>
                </div>
                <div className="payroll-summary-item">
                  <span>이익률</span>
                  <span className="num">{mNet > 0 ? ((mProfit / mNet) * 100).toFixed(1) : '0'}%</span>
                </div>
              </div>
            </div>

            <div className="payroll-footer">
              <div className="payroll-footer-date">{monthLabel} 매출/이익 정리</div>
              <div className="payroll-footer-company">마이옥션</div>
            </div>
          </div>
        </>
        );
      })()}

      {/* ━━━ 지사별 합산 탭 ━━━ */}
      {tab === 'branch' && (
        <>
          {branchLoading ? <div className="page-loading">로딩중...</div> : (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={() => handleCopyPng(branchRef)}>
                  <Camera size={14} /> PNG 복사
                </button>
              </div>
              <div ref={branchRef} className="payroll-sheet payroll-summary-sheet">
                <div className="payroll-header">
                  <div className="payroll-title">지사별 매출 및 이익 정리</div>
                  <div className="payroll-period">{selectedMonth.replace('-', '년 ')}월</div>
                </div>

                {branchData.length === 0 ? (
                  <div className="empty-state">데이터가 없습니다.</div>
                ) : (
                  <>
                    <div className="payroll-summary-grid">
                      {branchData.map((b: any) => {
                        const netSales = (b.confirmed_total || 0) - (b.refunded_total || 0);
                        const laborCost = (b.total_salary || 0) + (b.total_allowance || 0);
                        const profit = netSales - laborCost;
                        return (
                          <div key={b.branch} className={`payroll-summary-card ${profit >= 0 ? 'green' : 'red'}`}>
                            <div className="payroll-summary-card-title">{b.branch} 지사</div>
                            <div className="payroll-summary-item"><span>확정매출</span><span className="num">{fmtWon(b.confirmed_total || 0)}</span></div>
                            <div className="payroll-summary-item"><span>환불</span><span className="num" style={{ color: '#d93025' }}>-{fmtWon(b.refunded_total || 0)}</span></div>
                            <div className="payroll-summary-item bold"><span>순매출</span><span className="num">{fmtWon(netSales)}</span></div>
                            <div className="payroll-summary-item"><span>계약 건수</span><span className="num">{b.contract_count || 0}건</span></div>
                            <div className="payroll-summary-item"><span>입금대기</span><span className="num" style={{ color: '#e65100' }}>{fmtWon(b.pending_total || 0)}</span></div>
                            <div style={{ borderTop: '1px solid rgba(0,0,0,0.1)', marginTop: 8, paddingTop: 8 }}>
                              <div className="payroll-summary-item"><span>인건비 (급여+수당)</span><span className="num">{fmtWon(laborCost)}</span></div>
                              <div className="payroll-summary-item"><span>인원</span><span className="num">{b.staff_count || 0}명</span></div>
                              <div className="payroll-summary-item grand">
                                <span>이익</span>
                                <span className="num" style={{ color: profit >= 0 ? '#188038' : '#d93025' }}>
                                  {profit >= 0 ? '+' : ''}{fmtWon(profit)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 전체 합계 */}
                    {branchData.length > 1 && (() => {
                      const totals = branchData.reduce((acc: any, b: any) => ({
                        confirmed: acc.confirmed + (b.confirmed_total || 0),
                        refunded: acc.refunded + (b.refunded_total || 0),
                        pending: acc.pending + (b.pending_total || 0),
                        contracts: acc.contracts + (b.contract_count || 0),
                        salary: acc.salary + (b.total_salary || 0),
                        allowance: acc.allowance + (b.total_allowance || 0),
                        staff: acc.staff + (b.staff_count || 0),
                      }), { confirmed: 0, refunded: 0, pending: 0, contracts: 0, salary: 0, allowance: 0, staff: 0 });
                      const net = totals.confirmed - totals.refunded;
                      const labor = totals.salary + totals.allowance;
                      const profit = net - labor;
                      return (
                        <div className={`payroll-summary-card ${profit >= 0 ? 'green' : 'red'}`} style={{ marginTop: 12 }}>
                          <div className="payroll-summary-card-title">전체 합계</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                            <div className="payroll-summary-item"><span>확정매출</span><span className="num">{fmtWon(totals.confirmed)}</span></div>
                            <div className="payroll-summary-item"><span>환불</span><span className="num">-{fmtWon(totals.refunded)}</span></div>
                            <div className="payroll-summary-item"><span>순매출</span><span className="num">{fmtWon(net)}</span></div>
                            <div className="payroll-summary-item"><span>계약</span><span className="num">{totals.contracts}건</span></div>
                            <div className="payroll-summary-item"><span>인건비</span><span className="num">{fmtWon(labor)}</span></div>
                            <div className="payroll-summary-item"><span>인원</span><span className="num">{totals.staff}명</span></div>
                          </div>
                          <div className="payroll-summary-item grand" style={{ marginTop: 8 }}>
                            <span>전체 이익</span>
                            <span className="num" style={{ color: profit >= 0 ? '#188038' : '#d93025' }}>
                              {profit >= 0 ? '+' : ''}{fmtWon(profit)}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}

                <div className="payroll-footer">
                  <div className="payroll-footer-date">{selectedMonth.replace('-', '년 ')}월 지사별 합산</div>
                  <div className="payroll-footer-company">마이옥션</div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'payroll' && !data && !loading && !selectedUserId && (
        <div className="empty-state">담당자를 선택하면 급여정산 내역이 표시됩니다.</div>
      )}
    </div>
  );
}

// 구간별 누진 성과금 계산 내역
// 0 ~ 501만원 미만: 20%, 501만원 이상 ~ 1501만원 미만: 25%, 1501만원 이상: 30%
function getBonusBreakdown(excess: number) {
  if (excess <= 0) return [];
  const tiers: { label: string; base: number; rate: number; amount: number }[] = [];
  const T1 = 5010000;  // 501만원
  const T2 = 15010000; // 1501만원

  if (excess < T1) {
    tiers.push({ label: '0~501만 미만', base: excess, rate: 20, amount: Math.round(excess * 0.20) });
  } else if (excess < T2) {
    tiers.push({ label: '0~501만 미만', base: T1, rate: 20, amount: Math.round(T1 * 0.20) });
    tiers.push({ label: '501만~1,501만 미만', base: excess - T1, rate: 25, amount: Math.round((excess - T1) * 0.25) });
  } else {
    tiers.push({ label: '0~501만 미만', base: T1, rate: 20, amount: Math.round(T1 * 0.20) });
    tiers.push({ label: '501만~1,501만 미만', base: T2 - T1, rate: 25, amount: Math.round((T2 - T1) * 0.25) });
    tiers.push({ label: '1,501만 이상', base: excess - T2, rate: 30, amount: Math.round((excess - T2) * 0.30) });
  }
  return tiers;
}

