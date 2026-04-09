import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { SalesRecord, DepositNotice } from '../types';
import { BRANCHES } from '../types';
import Select from '../components/Select';
import {
  DollarSign, Plus, CheckCircle, RotateCcw, Clock, X, Upload, Activity
} from 'lucide-react';
import type { JournalEntry } from '../journal/types';

const TYPE_OPTIONS = [
  { value: '계약', label: '계약' },
  { value: '낙찰', label: '낙찰' },
  { value: '중개', label: '중개' },
  { value: '기타', label: '기타' },
];

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '입금대기', color: '#e65100', bg: '#fff3e0' },
  confirmed: { label: '확정매출', color: '#188038', bg: '#e8f5e9' },
  refund_requested: { label: '환불신청', color: '#d93025', bg: '#fce4ec' },
  refunded: { label: '환불완료', color: '#9aa0a6', bg: '#f5f5f5' },
};

function getDateLabel(type: string): string {
  if (type === '낙찰' || type === '중개') return '발생일';
  return '계약서 작성일';
}

function formatCurrency(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}
function toMoneyDisplay(val: string): string {
  const num = val.replace(/[^0-9]/g, '');
  return num ? Number(num).toLocaleString('ko-KR') : '';
}
function fromMoneyDisplay(val: string): string {
  return val.replace(/[^0-9]/g, '');
}

export default function Sales() {
  const { user: currentUser } = useAuthStore();
  const [records, setRecords] = useState<SalesRecord[]>([]);
  const [deposits, setDeposits] = useState<DepositNotice[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string; role: string; branch: string; department: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [filterUser, setFilterUser] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));

  // 입금확인 시 입금일자
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmDepositDate, setConfirmDepositDate] = useState(() => new Date().toISOString().slice(0, 10));
  // 상세 팝업
  const [detailRecord, setDetailRecord] = useState<SalesRecord | null>(null);

  // 폼
  const [formType, setFormType] = useState('계약');
  const [formTypeDetail, setFormTypeDetail] = useState('');
  const [formClientName, setFormClientName] = useState('');
  const [formDepositorDiff, setFormDepositorDiff] = useState(false);
  const [formDepositorName, setFormDepositorName] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formContractDate, setFormContractDate] = useState(() => new Date().toISOString().slice(0, 10));
  // [6-1] 수수료 계산 (계약 타입만) - 감정가%, 낙찰가%
  const [formAppraisalRate, setFormAppraisalRate] = useState('');
  const [formWinningRate, setFormWinningRate] = useState('');

  // 입금등록 폼
  const [depDepositor, setDepDepositor] = useState('');
  const [depAmount, setDepAmount] = useState('');
  const [depDate, setDepDate] = useState(() => new Date().toISOString().slice(0, 10));

  // 정렬
  const [sortKey, setSortKey] = useState<string>('contract_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // 클레임 폼
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimType, setClaimType] = useState('계약');
  const [claimClient, setClaimClient] = useState('');

  // [6-3] 활동내역
  const [salesTab, setSalesTab] = useState<'list' | 'activity' | 'upload'>('list');
  const [activityEntries, setActivityEntries] = useState<JournalEntry[]>([]);
  const [activityUser, setActivityUser] = useState('');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [activityPage, setActivityPage] = useState(0);
  const ACTIVITY_PAGE_SIZE = 20;

  const role = currentUser?.role || 'member';
  const isAccountant = ['accountant', 'accountant_asst'].includes(role);
  const isMaster = role === 'master';
  const canModifyAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role);
  const canApproveAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'].includes(role); // 최종승인
  const isAdminPlus = ['master', 'ceo', 'cc_ref', 'admin'].includes(role);
  const showUserFilter = isAdminPlus || isAccountant;

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const promises: Promise<any>[] = [
        api.sales.list({ month: filterMonth, user_id: filterUser || undefined }),
      ];
      if (canModifyAccounting || isAccountant) promises.push(api.sales.deposits());
      if (showUserFilter) promises.push(api.journal.members());
      const [salesRes, depRes, memRes] = await Promise.all(promises);
      setRecords(salesRes.records);
      if (depRes) setDeposits(depRes.deposits);
      if (memRes) setMembers(memRes.members);
    } catch (err: any) { console.error(err); }
    finally { if (!silent) setLoading(false); }
  };

  useEffect(() => { load(); }, [filterMonth, filterUser]);

  const resetForm = () => {
    setFormType('계약'); setFormTypeDetail(''); setFormClientName('');
    setFormDepositorDiff(false); setFormDepositorName('');
    setFormAmount(''); setFormContractDate(new Date().toISOString().slice(0, 10));
    setFormAppraisalRate(''); setFormWinningRate('');
    setShowAddForm(false);
  };

  const handleAdd = async () => {
    if (!formClientName) { alert('계약자명을 입력하세요.'); return; }
    if (!fromMoneyDisplay(formAmount) || Number(fromMoneyDisplay(formAmount)) <= 0) { alert('금액을 입력하세요.'); return; }
    // [6-1] 계약 타입이면 감정가%/낙찰가% 필수
    if (formType === '계약') {
      if (!formAppraisalRate || !formWinningRate) { alert('감정가 %와 낙찰가 %를 모두 입력하세요.'); return; }
    }
    try {
      await api.sales.create({
        type: formType, type_detail: formType === '기타' ? formTypeDetail : '',
        client_name: formClientName, depositor_name: formDepositorDiff ? formDepositorName : '',
        depositor_different: formDepositorDiff, amount: Number(fromMoneyDisplay(formAmount)),
        contract_date: formContractDate,
        ...(formType === '계약' ? {
          appraisal_rate: Number(formAppraisalRate),
          winning_rate: Number(formWinningRate),
        } : {}),
      });
      resetForm(); load();
    } catch (err: any) { alert(err.message); }
  };

  // 입금확인 (회계 → 확인 시 회계장부로 이동)
  const handleConfirm = async (id: string) => {
    if (!confirmDepositDate) { alert('입금일자를 입력하세요.'); return; }
    try { await api.sales.confirm(id, confirmDepositDate); setConfirmingId(null); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleDepositCreate = async () => {
    if (!depDepositor || !fromMoneyDisplay(depAmount)) { alert('입금자와 금액을 입력하세요.'); return; }
    try {
      await api.sales.createDeposit({ depositor: depDepositor, amount: Number(fromMoneyDisplay(depAmount)), deposit_date: depDate });
      setShowDepositForm(false); setDepDepositor(''); setDepAmount(''); load();
    } catch (err: any) { alert(err.message); }
  };

  const handleClaim = async (depositId: string) => {
    if (!claimClient) { alert('계약자명을 입력하세요.'); return; }
    try {
      await api.sales.claimDeposit(depositId, { type: claimType, client_name: claimClient });
      setClaimingId(null); setClaimClient(''); load();
    } catch (err: any) { alert(err.message); }
  };

  const handleDepositApprove = async (id: string) => {
    try { await api.sales.approveDeposit(id); load(); }
    catch (err: any) { alert(err.message); }
  };

  // [6-3] 활동내역: 담당자 선택 시 전체 일지 + 전체 매출 로드
  const [allRecords, setAllRecords] = useState<SalesRecord[]>([]);
  const loadActivity = async (userId?: string) => {
    try {
      const [jRes, sRes] = await Promise.all([
        api.journal.list({ range: 'all' }),
        api.sales.list({ user_id: userId || undefined }),
      ]);
      setActivityEntries(jRes.entries);
      setAllRecords(sRes.records);
      setSelectedClient(null);
      setActivityPage(0);
    } catch { setActivityEntries([]); setAllRecords([]); }
  };
  useEffect(() => { if (salesTab === 'activity') loadActivity(activityUser || undefined); }, [salesTab, activityUser]);

  const filteredMembers = filterBranch ? members.filter(m => m.branch === filterBranch) : members;
  const memberOpts = filteredMembers.map(m => ({ value: m.id, label: `${m.name} (${m.department})` }));
  const branchOpts = BRANCHES.map(b => ({ value: b, label: b }));

  const contractCount = records.filter(r => r.type === '계약' && r.status !== 'refunded').length;
  const confirmedTotal = records.filter(r => r.status === 'confirmed').reduce((sum, r) => sum + r.amount, 0);
  const pendingTotal = records.filter(r => r.status === 'pending').reduce((sum, r) => sum + r.amount, 0);

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2><DollarSign size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 매출확인</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
            <Plus size={14} /> 매출내역 추가
          </button>
          {canModifyAccounting && (
            <button className="btn btn-sm" onClick={() => setShowDepositForm(true)}>입금등록</button>
          )}
        </div>
      </div>

      {/* 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #1a73e8' }}>
          <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>계약건수</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1a73e8' }}>{contractCount}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>건</span></div>
        </div>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #188038' }}>
          <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>확정매출</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#188038' }}>{formatCurrency(confirmedTotal)}</div>
        </div>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #e65100' }}>
          <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>입금대기</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#e65100' }}>{formatCurrency(pendingTotal)}</div>
        </div>
      </div>

      {/* 필터 */}
      <div className="filter-bar" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="month" className="form-input" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={{ width: 160 }} />
        {showUserFilter && (
          <>
            <div style={{ minWidth: 120 }}>
              <Select size="sm" options={[{ value: '', label: '전체 지사' }, ...branchOpts]}
                value={branchOpts.find(o => o.value === filterBranch) || { value: '', label: '전체 지사' }}
                onChange={(o: any) => { setFilterBranch(o?.value || ''); setFilterUser(''); }} placeholder="지사" isClearable />
            </div>
            <div style={{ minWidth: 200 }}>
              <Select size="sm" options={[{ value: '', label: '전체 담당자' }, ...memberOpts]}
                value={memberOpts.find(o => o.value === filterUser) || { value: '', label: '전체 담당자' }}
                onChange={(o: any) => setFilterUser(o?.value || '')} placeholder="담당자" isClearable />
            </div>
          </>
        )}
      </div>

      {/* 탭 */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <button className={`filter-btn ${salesTab === 'list' ? 'active' : ''}`} onClick={() => setSalesTab('list')}>매출내역</button>
        <button className={`filter-btn ${salesTab === 'activity' ? 'active' : ''}`} onClick={() => setSalesTab('activity')}>
          <Activity size={14} style={{ marginRight: 4 }} /> 활동내역
        </button>
        {canModifyAccounting && (
          <button className={`filter-btn ${salesTab === 'upload' ? 'active' : ''}`} onClick={() => setSalesTab('upload')}>
            <Upload size={14} style={{ marginRight: 4 }} /> 엑셀 업로드
          </button>
        )}
      </div>

      {/* ━━━ 활동내역 탭 [6-3] ━━━ */}
      {salesTab === 'activity' && (() => {
        // 담당자 필터 적용된 계약자 목록
        const userSales = activityUser ? allRecords.filter(r => r.user_id === activityUser) : allRecords;
        const userJournals = activityUser ? activityEntries.filter(e => e.user_id === activityUser) : activityEntries;
        const clientList = [...new Set(userSales.map(r => r.client_name).filter(Boolean))].map(name => {
          const sales = userSales.filter(r => r.client_name === name);
          const journals = userJournals.filter(e => { try { const d = JSON.parse(e.data); return d.client === name || d.bidder === name || d.meetingClient === name; } catch { return false; } });
          const allDates = [...sales.map(r => r.contract_date), ...journals.map(e => e.target_date)].filter(Boolean).sort();
          const lastDate = allDates[allDates.length - 1] || '';
          const hasWon = journals.some(e => { try { return JSON.parse(e.data).bidWon; } catch { return false; } });
          return { name, lastDate, hasWon, salesCount: sales.length, journalCount: journals.length };
        }).sort((a, b) => b.lastDate.localeCompare(a.lastDate));

        const totalPages = Math.ceil(clientList.length / ACTIVITY_PAGE_SIZE);
        const pagedClients = clientList.slice(activityPage * ACTIVITY_PAGE_SIZE, (activityPage + 1) * ACTIVITY_PAGE_SIZE);

        // 상세 타임라인
        if (selectedClient) {
          const clientSales = allRecords.filter(r => r.client_name === selectedClient);
          const clientJournals = activityEntries.filter(e => { try { const d = JSON.parse(e.data); return d.client === selectedClient || d.bidder === selectedClient || d.meetingClient === selectedClient; } catch { return false; } });
          type TItem = { date: string; kind: 'sale' | 'journal'; data: any };
          const timeline: TItem[] = [
            ...clientSales.map(r => ({ date: r.contract_date, kind: 'sale' as const, data: r })),
            ...clientJournals.map(e => ({ date: e.target_date, kind: 'journal' as const, data: e })),
          ].sort((a, b) => a.date.localeCompare(b.date));
          const totalAmount = clientSales.filter(r => r.status === 'confirmed').reduce((s, r) => s + r.amount, 0);
          const COLORS: Record<string, string> = { '입찰': '#1a73e8', '임장': '#188038', '미팅': '#e65100', '브리핑자료제출': '#0d47a1', '사무': '#7b1fa2' };

          return (
            <div>
              <button className="btn btn-sm" onClick={() => setSelectedClient(null)} style={{ marginBottom: 12 }}>← 목록으로</button>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', background: '#f8f9fa', borderBottom: '1px solid #e8eaed' }}>
                  <strong style={{ fontSize: '1.1rem' }}>{selectedClient}</strong>
                  <span style={{ marginLeft: 12, fontSize: '0.82rem', color: '#9aa0a6' }}>총 {timeline.length}건</span>
                  {totalAmount > 0 && <span style={{ marginLeft: 12, fontWeight: 700, color: '#1a73e8' }}>확정매출 {formatCurrency(totalAmount)}</span>}
                </div>
                <div style={{ padding: '8px 20px' }}>
                  {timeline.length === 0 && <div className="empty-state">활동 기록이 없습니다.</div>}
                  {timeline.map((item, i) => {
                    if (item.kind === 'sale') {
                      const r = item.data as SalesRecord;
                      return (
                        <div key={'s' + r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: i < timeline.length - 1 ? '1px solid #f3f4f6' : 'none', fontSize: '0.82rem' }}>
                          <span style={{ color: '#9aa0a6', minWidth: 80, fontSize: '0.78rem' }}>{r.contract_date}</span>
                          <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, background: '#fce4ec', color: '#d93025' }}>매출</span>
                          <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, background: '#f3f4f6', color: '#5f6368' }}>{r.type}</span>
                          <span style={{ fontWeight: 600 }}>{formatCurrency(r.amount)}</span>
                          <span style={{ padding: '2px 6px', borderRadius: 8, fontSize: '0.68rem', fontWeight: 600, background: STATUS_LABELS[r.status].bg, color: STATUS_LABELS[r.status].color }}>{STATUS_LABELS[r.status].label}</span>
                          {r.user_name && <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>{r.user_name}</span>}
                        </div>
                      );
                    }
                    const e = item.data as JournalEntry;
                    const d = (() => { try { return JSON.parse(e.data); } catch { return {} as any; } })();
                    return (
                      <div key={'j' + e.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: i < timeline.length - 1 ? '1px solid #f3f4f6' : 'none', fontSize: '0.82rem' }}>
                        <span style={{ color: '#9aa0a6', minWidth: 80, fontSize: '0.78rem' }}>{e.target_date}</span>
                        <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, background: (COLORS[e.activity_type] || '#999') + '18', color: COLORS[e.activity_type] || '#999' }}>{e.activity_type}</span>
                        <div style={{ flex: 1 }}>
                          {e.activity_subtype && <span style={{ color: '#3c4043' }}>{e.activity_subtype}</span>}
                          {d.timeFrom && <span style={{ color: '#9aa0a6', marginLeft: 6 }}>{d.timeFrom}~{d.timeTo}</span>}
                          {d.caseNo && <span style={{ color: '#9aa0a6', marginLeft: 6 }}>사건: {d.caseNo}</span>}
                          {d.court && <span style={{ color: '#9aa0a6', marginLeft: 6 }}>{d.court}</span>}
                          {d.place && <div style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>장소: {d.place}</div>}
                          {d.bidPrice && <span style={{ color: '#5f6368', marginLeft: 6 }}>입찰가: {d.bidPrice}</span>}
                          {d.suggestedPrice && <span style={{ color: '#9aa0a6', marginLeft: 6 }}>제시가: {d.suggestedPrice}</span>}
                          {d.bidWon && <span style={{ marginLeft: 6, color: '#188038', fontWeight: 700 }}>낙찰</span>}
                          {d.bidProxy && <span style={{ marginLeft: 6, color: '#7b1fa2', fontSize: '0.75rem' }}>(대리)</span>}
                          {d.meetingType && <span style={{ color: '#9aa0a6', marginLeft: 6 }}>({d.meetingType})</span>}
                        </div>
                        {e.user_name && <span style={{ color: '#9aa0a6', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{e.user_name}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        }

        // 리스트 뷰
        return (
          <div>
            {/* 담당자 선택 */}
            <div style={{ marginBottom: 16, maxWidth: 300 }}>
              <label className="form-label">담당자</label>
              <Select options={[{ value: '', label: '전체 담당자' }, ...memberOpts]}
                value={memberOpts.find(o => o.value === activityUser) || { value: '', label: '전체 담당자' }}
                onChange={(o: any) => { setActivityUser(o?.value || ''); setActivityPage(0); }}
                placeholder="담당자 선택" isSearchable />
            </div>

            {/* 계약자 리스트 테이블 */}
            <div className="table-wrapper">
              <table className="data-table">
                <thead><tr><th>마지막 등록일</th><th>고객명</th><th>낙찰</th><th>매출건</th><th>활동건</th></tr></thead>
                <tbody>
                  {pagedClients.map(c => (
                    <tr key={c.name} onClick={() => setSelectedClient(c.name)} className="clickable-row" style={{ cursor: 'pointer' }}>
                      <td style={{ fontSize: '0.82rem', color: '#5f6368' }}>{c.lastDate || '-'}</td>
                      <td><strong>{c.name}</strong></td>
                      <td style={{ textAlign: 'center' }}>
                        {c.hasWon ? <span style={{ color: '#188038', fontWeight: 700, fontSize: '0.82rem' }}>낙찰</span> : <span style={{ color: '#9aa0a6' }}>-</span>}
                      </td>
                      <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{c.salesCount}건</td>
                      <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{c.journalCount}건</td>
                    </tr>
                  ))}
                  {pagedClients.length === 0 && <tr><td colSpan={5} className="empty-state">등록된 고객이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* 페이징 */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                <button className="btn btn-sm" disabled={activityPage === 0} onClick={() => setActivityPage(p => p - 1)}>이전</button>
                <span style={{ padding: '6px 12px', fontSize: '0.82rem', color: '#5f6368' }}>{activityPage + 1} / {totalPages}</span>
                <button className="btn btn-sm" disabled={activityPage >= totalPages - 1} onClick={() => setActivityPage(p => p + 1)}>다음</button>
              </div>
            )}
            <div style={{ fontSize: '0.78rem', color: '#9aa0a6', marginTop: 8, textAlign: 'center' }}>총 {clientList.length}명</div>
          </div>
        );
      })()}

      {/* ━━━ 엑셀 업로드 탭 [6-4] ━━━ */}
      {salesTab === 'upload' && canModifyAccounting && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '1rem' }}>매출 엑셀 업로드</h3>

          {/* 양식 안내 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.85rem', color: '#3c4043', fontWeight: 600, marginBottom: 8 }}>엑셀 양식 (필수)</div>
            <div className="table-wrapper" style={{ maxWidth: 600 }}>
              <table className="data-table" style={{ fontSize: '0.82rem' }}>
                <thead><tr><th>담당자</th><th>날짜</th><th>고객명</th><th>매출항목</th><th>입금액</th></tr></thead>
                <tbody>
                  <tr style={{ color: '#9aa0a6' }}>
                    <td>홍길동</td><td>2026-03-05</td><td>김고객</td><td>계약</td><td>3,300,000</td>
                  </tr>
                  <tr style={{ color: '#9aa0a6' }}>
                    <td>홍길동</td><td>2026-03-12</td><td>박고객</td><td>낙찰</td><td>5,500,000</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#9aa0a6', marginTop: 6, lineHeight: 1.5 }}>
              매출항목: 계약 / 낙찰 / 중개 / 기타<br />
              입금액: 부가세 포함 금액 (숫자 또는 콤마 포함 가능)
            </div>
          </div>

          {/* 양식 다운로드 */}
          <div style={{ marginBottom: 16 }}>
            <button className="btn btn-sm" onClick={async () => {
              const XLSX = await import('xlsx');
              const ws = XLSX.utils.aoa_to_sheet([
                ['담당자', '날짜', '고객명', '매출항목', '입금액'],
                ['홍길동', '2026-03-05', '김고객', '계약', 3300000],
                ['홍길동', '2026-03-12', '박고객', '낙찰', 5500000],
              ]);
              ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 14 }];
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, '매출');
              XLSX.writeFile(wb, '매출업로드양식.xlsx');
            }}>양식 다운로드 (.xlsx)</button>
          </div>

          {/* 파일 업로드 */}
          <input type="file" accept=".xlsx,.xls" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const XLSX = await import('xlsx');
              const data = await file.arrayBuffer();
              const wb = XLSX.read(data, { type: 'array' });
              const ws = wb.Sheets[wb.SheetNames[0]];
              const rows = XLSX.utils.sheet_to_json<any>(ws);
              if (rows.length === 0) { alert('데이터가 없습니다.'); return; }

              // 컬럼명 매핑
              const mapped = rows.map((r: any) => ({
                user_name: r['담당자'] || r['담당자명'] || '',
                type: r['매출항목'] || r['유형'] || '계약',
                client_name: r['고객명'] || r['계약자명'] || '',
                amount: Number(String(r['입금액'] || r['금액'] || '0').replace(/[^0-9]/g, '')) || 0,
                contract_date: r['날짜'] || r['계약일'] || '',
                deposit_date: r['날짜'] || r['계약일'] || '', // 기존 데이터이므로 입금 확정 처리
              }));

              // 미리보기
              const valid = mapped.filter(r => r.user_name && r.client_name && r.amount > 0);
              const invalid = mapped.length - valid.length;
              let msg = `총 ${mapped.length}건 중 ${valid.length}건 등록 가능`;
              if (invalid > 0) msg += ` (${invalid}건 누락 — 담당자/고객명/금액 확인)`;
              msg += '\n\n업로드하시겠습니까?';
              if (!confirm(msg)) return;

              const res = await api.sales.bulkImport(valid) as any;
              let resultMsg = `${res.count}건이 등록되었습니다. (확정매출로 반영)`;
              if (res.skipped?.length > 0) resultMsg += `\n\n건너뛴 ${res.skipped.length}건:\n${res.skipped.join('\n')}`;
              alert(resultMsg);
              setSalesTab('list');
              load();
            } catch (err: any) { alert('업로드 실패: ' + err.message); }
            e.target.value = '';
          }} />
        </div>
      )}

      {/* ━━━ 매출내역 탭 ━━━ */}
      {salesTab === 'list' && <>
      {/* 매출내역 추가 폼 */}
      {showAddForm && (
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>매출내역 추가</h3>
            <button className="btn-icon" onClick={resetForm}><X size={16} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <div>
              <label className="form-label">유형</label>
              <select className="form-input" value={formType} onChange={(e) => setFormType(e.target.value)} style={{ width: '100%' }}>
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {formType === '기타' && (
              <div><label className="form-label">상세내용</label>
                <input className="form-input" value={formTypeDetail} onChange={(e) => setFormTypeDetail(e.target.value)} style={{ width: '100%' }} placeholder="기타 상세" /></div>
            )}
            <div><label className="form-label">계약자명</label>
              <input className="form-input" value={formClientName} onChange={(e) => setFormClientName(e.target.value)} style={{ width: '100%' }} placeholder="계약자명" /></div>
            <div>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                입금자명
                <label style={{ fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={formDepositorDiff} onChange={(e) => setFormDepositorDiff(e.target.checked)} /> 계약자명과 다름
                </label>
              </label>
              {formDepositorDiff
                ? <input className="form-input" value={formDepositorName} onChange={(e) => setFormDepositorName(e.target.value)} style={{ width: '100%' }} placeholder="입금자명" />
                : <input className="form-input" value={formClientName} disabled style={{ width: '100%', background: '#f5f5f5' }} />}
            </div>
            <div><label className="form-label">금액 (부가세 포함)</label>
              <input className="form-input" value={toMoneyDisplay(formAmount)} onChange={(e) => setFormAmount(fromMoneyDisplay(e.target.value))} style={{ width: '100%' }} placeholder="금액" /></div>
            <div><label className="form-label">{getDateLabel(formType)}</label>
              <input className="form-input" type="date" value={formContractDate} onChange={(e) => setFormContractDate(e.target.value)} style={{ width: '100%' }} /></div>
          </div>

          {/* [6-1] 계약조건 기록 */}
          {formType === '계약' && (
            <div style={{ marginTop: 14, padding: 16, background: '#f8f9fa', borderRadius: 8, border: '1px solid #e8eaed' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 10, color: '#3c4043' }}>계약내용</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label className="form-label">감정가 %</label>
                  <input className="form-input" type="number" step="0.1" min="0" max="100" value={formAppraisalRate}
                    onChange={(e) => { const v = e.target.value; if (v === '' || /^\d+\.?\d{0,1}$/.test(v)) setFormAppraisalRate(v); }}
                    style={{ width: '100%' }} placeholder="예: 1.5" /></div>
                <div><label className="form-label">낙찰가 %</label>
                  <input className="form-input" type="number" step="0.1" min="0" max="100" value={formWinningRate}
                    onChange={(e) => { const v = e.target.value; if (v === '' || /^\d+\.?\d{0,1}$/.test(v)) setFormWinningRate(v); }}
                    style={{ width: '100%' }} placeholder="예: 2.0" /></div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleAdd}>등록</button>
            <button className="btn" onClick={resetForm}>취소</button>
          </div>
        </div>
      )}

      {/* 입금등록 폼 (회계) */}
      {showDepositForm && canModifyAccounting && (
        <div className="card" style={{ marginBottom: 20, padding: 20, border: '2px solid #1a73e8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#1a73e8' }}>입금등록 (회계 → 담당자)</h3>
            <button className="btn-icon" onClick={() => setShowDepositForm(false)}><X size={16} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <div><label className="form-label">입금자</label><input className="form-input" value={depDepositor} onChange={(e) => setDepDepositor(e.target.value)} style={{ width: '100%' }} /></div>
            <div><label className="form-label">금액</label><input className="form-input" value={toMoneyDisplay(depAmount)} onChange={(e) => setDepAmount(fromMoneyDisplay(e.target.value))} style={{ width: '100%' }} /></div>
            <div><label className="form-label">입금일자</label><input className="form-input" type="date" value={depDate} onChange={(e) => setDepDate(e.target.value)} style={{ width: '100%' }} /></div>
          </div>
          <div style={{ marginTop: 14 }}><button className="btn btn-primary" onClick={handleDepositCreate}>등록</button></div>
        </div>
      )}

      {/* 입금 등록 내역 */}
      {deposits.filter(d => d.status !== 'approved').length > 0 && (
        <div className="card" style={{ marginBottom: 20, padding: '16px 20px' }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 12, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={16} color="#1a73e8" /> 입금 등록 내역
            <span style={{ fontSize: '0.78rem', color: '#9aa0a6', fontWeight: 400 }}>({deposits.filter(d => d.status !== 'approved').length}건)</span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {deposits.filter(d => d.status !== 'approved').map(dep => {
              const dDay = Math.ceil((new Date(dep.deposit_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              const isClaiming = claimingId === dep.id;
              return (
                <div key={dep.id} style={{ padding: '12px 16px', borderRadius: 8, background: dep.status === 'claimed' ? '#f0fdf4' : '#eff6ff', border: dep.status === 'claimed' ? '1px solid #bbf7d0' : '1px solid #bfdbfe' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.9rem' }}>{dep.depositor}</strong>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{formatCurrency(dep.amount)}</span>
                      <span style={{ color: '#6b7280', fontSize: '0.78rem' }}>{dep.deposit_date}</span>
                      <span style={{ fontWeight: 700, fontSize: '0.78rem', color: dDay <= 0 ? '#d93025' : '#e65100', padding: '1px 6px', borderRadius: 4, background: dDay <= 0 ? '#fef2f2' : '#fffbeb' }}>D{dDay <= 0 ? '+' : '-'}{Math.abs(dDay)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {dep.status === 'pending' && (
                        <button className="btn btn-sm btn-primary" onClick={() => { setClaimingId(dep.id); setClaimType('계약'); setClaimClient(''); }}>내 건 등록</button>
                      )}
                      {dep.status === 'claimed' && (
                        <>
                          <span style={{ fontSize: '0.8rem', color: '#188038', fontWeight: 500 }}>클레임: {dep.claimed_by_name}</span>
                          {canApproveAccounting && <button className="btn btn-sm btn-success" onClick={() => handleDepositApprove(dep.id)}><CheckCircle size={13} /> 최종승인</button>}
                        </>
                      )}
                    </div>
                  </div>
                  {isClaiming && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div><label className="form-label" style={{ fontSize: '0.75rem' }}>유형</label>
                        <select className="form-input" value={claimType} onChange={(e) => setClaimType(e.target.value)} style={{ width: 100 }}>
                          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select></div>
                      <div><label className="form-label" style={{ fontSize: '0.75rem' }}>계약자명</label>
                        <input className="form-input" value={claimClient} onChange={(e) => setClaimClient(e.target.value)} placeholder="계약자명" /></div>
                      <button className="btn btn-sm btn-primary" onClick={() => handleClaim(dep.id)}>확인</button>
                      <button className="btn btn-sm" onClick={() => setClaimingId(null)}>취소</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 매출 목록 */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {[
                { key: 'contract_date', label: '일자' },
                { key: 'user_name', label: '담당자' },
                { key: 'type', label: '유형' },
                { key: 'client_name', label: '계약자명' },
                { key: 'amount', label: '금액' },
                { key: 'deposit_date', label: '입금일' },
                { key: 'contract_submitted', label: '계약서' },
                { key: 'status', label: '상태' },
              ].map(col => (
                <th key={col.key} onClick={() => toggleSort(col.key)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  {col.label} {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
              <th>액션</th>
            </tr>
          </thead>
          <tbody>
            {[...records].sort((a: any, b: any) => {
              const av = a[sortKey] ?? '';
              const bv = b[sortKey] ?? '';
              const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
              return sortDir === 'asc' ? cmp : -cmp;
            }).map((r) => {
              const st = STATUS_LABELS[r.status];
              const isRefunded = r.status === 'refunded';
              const isConfirming = confirmingId === r.id;
              return (
                <tr key={r.id} onClick={() => setDetailRecord(r)} className="clickable-row"
                  style={{ cursor: 'pointer', ...(isRefunded ? { opacity: 0.5, textDecoration: 'line-through', background: '#fafafa' } : {}) }}>
                  <td style={{ fontSize: '0.8rem' }}>{r.contract_date}</td>
                  <td>{r.user_name}</td>
                  <td><span style={{ fontSize: '0.8rem' }}>{r.type}</span>{r.type === '기타' && r.type_detail && <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}> ({r.type_detail})</span>}</td>
                  <td>
                    {r.client_name}
                    {r.depositor_different === 1 && r.depositor_name && <div style={{ fontSize: '0.72rem', color: '#e65100' }}>입금자: {r.depositor_name}</div>}
                  </td>
                  <td style={{ fontWeight: 600 }}>{formatCurrency(r.amount)}</td>
                  <td style={{ fontSize: '0.78rem', color: r.deposit_date ? '#188038' : '#9aa0a6' }}>{r.deposit_date || '-'}</td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
                    {r.contract_submitted && r.contract_not_approved ? (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ color: '#188038', fontSize: '0.75rem', fontWeight: 600 }}>제출</span>
                        {(isAccountant || isMaster) && (
                          <div><button style={{ fontSize: '0.55rem', color: '#9aa0a6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={(e) => { e.preventDefault(); if (confirm('계약서 제출 상태를 취소하시겠습니까?')) api.sales.contractCheck(r.id, { contract_submitted: 0, contract_not_submitted: 0, contract_not_reason: '', contract_not_approved: 0 }).then(() => load(true)); }}>취소</button></div>
                        )}
                      </div>
                    ) : r.contract_submitted && !r.contract_not_approved ? (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ color: '#1a73e8', fontSize: '0.72rem', fontWeight: 600 }}>확인 대기</span>
                        {canApproveAccounting && (
                          <button className="btn btn-sm" style={{ fontSize: '0.6rem', padding: '1px 4px', marginTop: 2, color: '#188038' }}
                            onClick={(e) => { e.preventDefault(); if (confirm('계약서 제출을 확인하시겠습니까?')) api.sales.contractNotApprove(r.id).then(() => load(true)); }}>
                            확인
                          </button>
                        )}
                      </div>
                    ) : r.contract_not_submitted && r.contract_not_approved ? (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ color: '#e65100', fontSize: '0.72rem', fontWeight: 600 }}>미제출</span>
                        {(isAccountant || isMaster) && (
                          <div><button style={{ fontSize: '0.55rem', color: '#9aa0a6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={(e) => { e.preventDefault(); if (confirm('미제출 승인을 취소하시겠습니까?')) api.sales.contractCheck(r.id, { contract_submitted: 0, contract_not_submitted: 0, contract_not_reason: '', contract_not_approved: 0 }).then(() => load(true)); }}>취소</button></div>
                        )}
                      </div>
                    ) : r.contract_not_submitted ? (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ color: '#d93025', fontSize: '0.72rem', fontWeight: 600 }}>미작성</span>
                        {r.contract_not_reason && (
                          <div style={{ fontSize: '0.65rem', color: '#5f6368', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.contract_not_reason}>
                            {r.contract_not_reason}
                          </div>
                        )}
                        {canApproveAccounting && (
                          <button className="btn btn-sm" style={{ fontSize: '0.6rem', padding: '1px 4px', marginTop: 2, color: '#188038' }}
                            onClick={(e) => { e.preventDefault(); if (confirm(`사유: ${r.contract_not_reason}\n\n승인하시겠습니까?`)) api.sales.contractNotApprove(r.id).then(() => load(true)); }}>
                            승인
                          </button>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                        <button className="btn btn-sm" style={{ fontSize: '0.65rem', padding: '1px 5px' }}
                          onClick={(e) => { e.preventDefault(); if (confirm('계약서를 제출하시겠습니까?')) api.sales.contractCheck(r.id, { contract_submitted: 1 }).then(() => load(true)); }}>제출</button>
                        <button className="btn btn-sm" style={{ fontSize: '0.65rem', padding: '1px 5px', color: '#d93025' }}
                          onClick={(e) => {
                            e.preventDefault();
                            const reason = prompt('미제출 사유를 입력하세요:');
                            if (reason) api.sales.contractCheck(r.id, { contract_not_submitted: 1, contract_not_reason: reason }).then(() => load(true));
                          }}>미작성</button>
                      </div>
                    )}
                  </td>
                  <td>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {/* 입금확인 (회계) */}
                      {r.status === 'pending' && canApproveAccounting && !isConfirming && (
                        <button className="btn btn-sm btn-success" onClick={() => { setConfirmingId(r.id); setConfirmDepositDate(new Date().toISOString().slice(0, 10)); }}>
                          <CheckCircle size={13} /> 입금확인
                        </button>
                      )}
                      {isConfirming && (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input type="date" className="form-input" value={confirmDepositDate} onChange={(e) => setConfirmDepositDate(e.target.value)} style={{ fontSize: '0.78rem', padding: '4px 6px' }} />
                          <button className="btn btn-sm btn-success" onClick={() => handleConfirm(r.id)}>확인</button>
                          <button className="btn btn-sm" onClick={() => setConfirmingId(null)}>취소</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {records.length === 0 && <tr><td colSpan={9} className="empty-state">매출 내역이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      </>}

      {/* 상세 팝업 */}
      {detailRecord && (
        <div className="modal-overlay" onClick={() => setDetailRecord(null)}>
          <div className="journal-popup" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="journal-popup-header">
              <h3 style={{ margin: 0 }}>매출 상세</h3>
              <button className="btn-close" onClick={() => setDetailRecord(null)}>×</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>유형</span><div style={{ fontWeight: 600 }}>{detailRecord.type}{detailRecord.type_detail ? ` (${detailRecord.type_detail})` : ''}</div></div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>상태</span><div><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600, background: STATUS_LABELS[detailRecord.status].bg, color: STATUS_LABELS[detailRecord.status].color }}>{STATUS_LABELS[detailRecord.status].label}</span></div></div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>계약자명</span><div style={{ fontWeight: 600 }}>{detailRecord.client_name}</div></div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>담당자</span><div>{detailRecord.user_name}</div></div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>금액</span><div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{formatCurrency(detailRecord.amount)}</div></div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>일자</span><div>{detailRecord.contract_date}</div></div>
                {/* 계약조건 */}
                {detailRecord.type === '계약' && (detailRecord.appraisal_rate > 0 || detailRecord.winning_rate > 0) && (
                  <>
                    <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>감정가 %</span><div style={{ fontWeight: 600 }}>{detailRecord.appraisal_rate}%</div></div>
                    <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>낙찰가 %</span><div style={{ fontWeight: 600 }}>{detailRecord.winning_rate}%</div></div>
                  </>
                )}
                {/* 계약서 제출 상태 */}
                <div>
                  <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>계약서</span>
                  <div>
                    {detailRecord.contract_submitted && detailRecord.contract_not_approved ? (
                      <span style={{ color: '#188038', fontWeight: 600 }}>제출</span>
                    ) : detailRecord.contract_submitted ? (
                      <div>
                        <span style={{ color: '#1a73e8', fontWeight: 600 }}>확인 대기</span>
                        {canApproveAccounting && (
                          <button className="btn btn-sm btn-primary" style={{ marginTop: 6, fontSize: '0.75rem' }}
                            onClick={() => { api.sales.contractNotApprove(detailRecord.id).then(() => { setDetailRecord(null); load(); }); }}>
                            제출 확인
                          </button>
                        )}
                      </div>
                    ) : detailRecord.contract_not_submitted && detailRecord.contract_not_approved ? (
                      <span style={{ color: '#e65100', fontWeight: 600 }}>미제출</span>
                    ) : detailRecord.contract_not_submitted ? (
                      <div>
                        <span style={{ color: '#d93025', fontWeight: 600 }}>미작성 (승인 대기)</span>
                        {detailRecord.contract_not_reason && (
                          <div style={{ fontSize: '0.78rem', color: '#5f6368', marginTop: 4, padding: '6px 10px', background: '#fff3e0', borderRadius: 6 }}>
                            사유: {detailRecord.contract_not_reason}
                          </div>
                        )}
                        {canApproveAccounting && (
                          <button className="btn btn-sm btn-primary" style={{ marginTop: 6, fontSize: '0.75rem' }}
                            onClick={() => { api.sales.contractNotApprove(detailRecord.id).then(() => { setDetailRecord(null); load(); }); }}>
                            미제출 사유 승인
                          </button>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: '#9aa0a6' }}>미확인</span>
                    )}
                  </div>
                </div>
                {detailRecord.depositor_different === 1 && detailRecord.depositor_name && (
                  <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>입금자</span><div style={{ color: '#e65100' }}>{detailRecord.depositor_name}</div></div>
                )}
                {detailRecord.deposit_date && (
                  <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>입금일</span><div style={{ color: '#188038' }}>{detailRecord.deposit_date}</div></div>
                )}
              </div>
              {/* 환불신청 버튼 (본인 건 + 확정매출만) */}
              {detailRecord.status === 'confirmed' && detailRecord.user_id === currentUser?.id && (
                <button className="btn btn-sm btn-danger" style={{ fontSize: '0.78rem' }}
                  onClick={async () => {
                    if (!confirm('환불을 신청하시겠습니까?\n회계 승인 후 처리됩니다.')) return;
                    try { await api.sales.refundRequest(detailRecord.id); setDetailRecord(null); load(); }
                    catch (err: any) { alert(err.message); }
                  }}>
                  <RotateCcw size={12} /> 환불신청
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
