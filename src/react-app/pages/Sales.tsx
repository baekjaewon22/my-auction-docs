import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { SalesRecord, DepositNotice } from '../types';
import { useBranches } from '../hooks/useBranches';
import Select from '../components/Select';
import {
  DollarSign, Plus, CheckCircle, RotateCcw, Clock, X, Upload, Activity, ChevronDown, ChevronUp
} from 'lucide-react';
import type { JournalEntry } from '../journal/types';

const TYPE_OPTIONS = [
  { value: '계약', label: '계약' },
  { value: '낙찰', label: '낙찰' },
  { value: '중개', label: '중개' },
  { value: '권리분석보증서', label: '권리분석보증서' },
  { value: '매수신청대리', label: '매수신청대리' },
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
  return '계약일';
}

function getDocLabel(type: string): string {
  if (type === '낙찰') return '물건분석보고서';
  return '계약서';
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
  const { branches: BRANCHES } = useBranches();
  const [records, setRecords] = useState<SalesRecord[]>([]);
  const [deposits, setDeposits] = useState<DepositNotice[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string; role: string; branch: string; department: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDepositForm, setShowDepositForm] = useState(false);
  const [filterUser, setFilterUser] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterBranch, setFilterBranch] = useState(() => {
    // 총무 담당/보조는 본인 지사를 디폴트로
    if (['accountant', 'accountant_asst'].includes(currentUser?.role || '') && currentUser?.branch) {
      return currentUser.branch;
    }
    // 총괄이사는 대전 디폴트
    if (currentUser?.role === 'director') return '대전';
    return '';
  });
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));

  // 입금확인 시 입금일자
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmDepositDate, setConfirmDepositDate] = useState(() => new Date().toISOString().slice(0, 10));
  // 상세 팝업
  const [detailRecord, setDetailRecord] = useState<SalesRecord | null>(null);
  const openDetail = async (r: SalesRecord) => {
    // 총무/관리자면 admin_memos도 로드
    if (isAccountant || isMaster) {
      try {
        const res = await api.sales.memos({ related_type: 'sales', related_id: r.id });
        const memo = res.memos?.[0];
        setDetailRecord({ ...r, _adminMemo: memo?.content || '', _adminMemoId: memo?.id || '' } as any);
      } catch { setDetailRecord(r); }
    } else {
      setDetailRecord(r);
    }
  };

  // 폼
  const [formType, setFormType] = useState('계약');
  const [formTypeDetail, setFormTypeDetail] = useState('');
  const [formClientName, setFormClientName] = useState('');
  const [formDepositorDiff, setFormDepositorDiff] = useState(false);
  const [formDepositorName, setFormDepositorName] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formContractDate, setFormContractDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formPhone, setFormPhone] = useState('');
  // [6-1] 수수료 계산 (계약 타입만) - 감정가%, 낙찰가%
  const [formAppraisalRate, setFormAppraisalRate] = useState('');
  const [formWinningRate, setFormWinningRate] = useState('');
  // 매수신청대리비용
  const [formProxyCost, setFormProxyCost] = useState('');
  // 결제방식 / 지출증빙
  const [formPaymentType, setFormPaymentType] = useState<'이체' | '카드'>('이체');
  const [formReceiptType, setFormReceiptType] = useState<'' | '현금영수증' | '세금계산서'>('');
  const [formReceiptPhone, setFormReceiptPhone] = useState('');

  // 입금등록 폼
  const [depDepositor, setDepDepositor] = useState('');
  const [depAmount, setDepAmount] = useState('');
  const [depDate, setDepDate] = useState(() => new Date().toISOString().slice(0, 10));

  // 다중선택 삭제
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => {
    if (selectedIds.size === records.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(records.map(r => r.id)));
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size}건을 삭제하시겠습니까?`)) return;
    try {
      for (const id of selectedIds) await api.sales.delete(id);
      setSelectedIds(new Set());
      load();
    } catch (err: any) { alert(err.message); }
  };

  // 랭킹 모드: 2달 단위(기본) vs 연간
  const [rankingYearly, setRankingYearly] = useState(false);
  const [rankingRecords, setRankingRecords] = useState<SalesRecord[]>([]);
  const [settleDate, setSettleDate] = useState('');
  // 2개월 기간 선택 (1-2, 3-4, 5-6, 7-8, 9-10, 11-12)
  const [rankingPeriodIdx, setRankingPeriodIdx] = useState(() => {
    const mo = new Date().getMonth() + 1;
    return Math.floor((mo - 1) / 2); // 0=1-2월, 1=3-4월, ...
  });

  // 정렬
  const [sortKey, setSortKey] = useState<string>('contract_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // 모바일 펼쳐보기
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // 클레임 폼
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimType, setClaimType] = useState('계약');
  const [claimClient, setClaimClient] = useState('');

  // [6-3] 활동내역
  const [salesTab, setSalesTab] = useState<'list' | 'activity' | 'upload'>('list');
  const [activityEntries, setActivityEntries] = useState<JournalEntry[]>([]);
  const [activityBranch, setActivityBranch] = useState('');
  const [activityUser, setActivityUser] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [activityPage, setActivityPage] = useState(0);
  const ACTIVITY_PAGE_SIZE = 20;

  const role = currentUser?.role || 'member';
  const isAccountant = ['accountant', 'accountant_asst'].includes(role);
  const isMaster = role === 'master' || role === 'accountant'; // 총무담당 = master 동급 (유형변경/확인취소)
  const canModifyAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role); // 수정 권한
  const canApproveAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role); // 입금확인/결제확인
  const canDeleteAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'].includes(role); // 삭제/유형변경 (보조 제외)
  const canViewAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role); // 열람
  const isDirector = role === 'director';
  const isAdminPlus = ['master', 'ceo', 'cc_ref', 'admin'].includes(role);
  const isManager = role === 'manager';
  const showUserFilter = isAdminPlus || isAccountant || isManager || isDirector;

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const salesRes = await api.sales.list({ month: filterMonth, user_id: filterUser || undefined });
      setRecords(salesRes.records);
      if (canViewAccounting) {
        const depRes = await api.sales.deposits();
        setDeposits(depRes.deposits || []);
      }
      if (showUserFilter) {
        const memRes = await api.journal.members();
        setMembers(memRes.members || []);
      }
      // 랭킹용: 2달 단위 or 연간 전체 데이터
      if (isAdminPlus || isDirector) {
        try {
          const year = new Date().getFullYear();
          if (rankingYearly) {
            // 연간: 2달씩 6개 분기 병렬 조회 (정산일 기준)
            const periods = Array.from({ length: 6 }, (_, i) => {
              const m = i * 2 + 1;
              return [`${year}-${String(m).padStart(2, '0')}`, `${year}-${String(m + 1).padStart(2, '0')}`];
            });
            const results = await Promise.all(
              periods.flat().map(m => api.sales.list({ month: m, date_mode: 'settle' }))
            );
            const all = results.flatMap(r => r.records || []);
            setRankingRecords(all);
          } else {
            // 선택된 2개월 기간 (정산일 기준)
            const pStart = rankingPeriodIdx * 2 + 1;
            const startMonth = `${year}-${String(pStart).padStart(2, '0')}`;
            const endMonth = `${year}-${String(pStart + 1).padStart(2, '0')}`;
            const [m1, m2] = await Promise.all([
              api.sales.list({ month: startMonth, date_mode: 'settle' }),
              api.sales.list({ month: endMonth, date_mode: 'settle' }),
            ]);
            setRankingRecords([...m1.records, ...m2.records]);
          }
        } catch { setRankingRecords([]); }
      }
    } catch (err: any) { console.error(err); }
    finally { if (!silent) setLoading(false); }
  };

  useEffect(() => { load(); }, [filterMonth, filterUser, rankingYearly, rankingPeriodIdx]);

  const resetForm = () => {
    setFormType('계약'); setFormTypeDetail(''); setFormClientName('');
    setFormDepositorDiff(false); setFormDepositorName('');
    setFormAmount(''); setFormContractDate(new Date().toISOString().slice(0, 10));
    setFormAppraisalRate(''); setFormWinningRate('');
    setFormPhone('');
    setFormProxyCost('');
    setFormPaymentType('이체'); setFormReceiptType(''); setFormReceiptPhone('');
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
      const rawAmount = Number(fromMoneyDisplay(formAmount)) || 0;
      const proxyCost = formType === '매수신청대리' ? (Number(fromMoneyDisplay(formProxyCost)) || 0) : 0;
      const proxyProfit = rawAmount - proxyCost; // 매수신청대리: 수익금액 (음수 가능)
      const finalAmount = formType === '매수신청대리' ? Math.abs(proxyProfit) : rawAmount;
      const finalDirection = formType === '매수신청대리' && proxyProfit < 0 ? 'expense' : undefined;
      await api.sales.create({
        type: formType, type_detail: formType === '기타' ? formTypeDetail : (formType === '매수신청대리' ? `대리비용 ${proxyCost.toLocaleString()}원 / 수익 ${proxyProfit >= 0 ? '' : '-'}${Math.abs(proxyProfit).toLocaleString()}원` : ''),
        client_name: formClientName, depositor_name: formDepositorDiff ? formDepositorName : '',
        depositor_different: formDepositorDiff, amount: finalAmount,
        contract_date: formContractDate,
        direction: finalDirection,
        payment_type: formPaymentType,
        receipt_type: formPaymentType === '이체' ? formReceiptType : '',
        receipt_phone: formReceiptType === '현금영수증' ? formReceiptPhone : '',
        proxy_cost: proxyCost,
        ...(formType === '계약' ? {
          appraisal_rate: Number(formAppraisalRate),
          winning_rate: Number(formWinningRate),
          client_phone: formPhone,
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

  const filteredMembers = (filterBranch ? members.filter(m => m.branch === filterBranch) : members).filter(m => m.role !== 'master');
  const memberOpts = filteredMembers.map(m => ({ value: m.id, label: `${m.name} (${m.department})` }));
  const branchOpts = BRANCHES.map(b => ({ value: b, label: b }));

  // 지사 + 유형 필터 적용된 records
  let branchRecords = filterBranch ? records.filter(r => r.branch === filterBranch) : records;
  if (filterType) branchRecords = branchRecords.filter(r => r.type === filterType);

  // 계약건수: 2개월 기준 (랭킹 데이터 활용), 220만원 이상이면 2건으로 카운트
  const contractCountSource = rankingRecords.length > 0 ? rankingRecords : branchRecords;
  const contractCountFiltered = filterBranch
    ? contractCountSource.filter(r => r.branch === filterBranch)
    : contractCountSource;
  const contractCount = contractCountFiltered.filter(r => r.type === '계약' && r.status !== 'refunded')
    .reduce((sum, r) => sum + (r.amount >= 2200000 ? 2 : 1), 0);
  // 확정매출/입금대기: 공급가액 기준 (÷1.1)
  const toSupply = (amount: number) => Math.round(amount / 1.1);
  const confirmedTotal = branchRecords.filter(r => r.status === 'confirmed').reduce((sum, r) => sum + toSupply(r.amount), 0);
  const pendingTotal = branchRecords.filter(r => r.status === 'pending').reduce((sum, r) => sum + toSupply(r.amount), 0);

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
          <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>계약건수 <span style={{ fontSize: '0.65rem', color: '#9aa0a6' }}>({rankingYearly ? `${new Date().getFullYear()}년` : `${rankingPeriodIdx * 2 + 1}~${rankingPeriodIdx * 2 + 2}월`})</span></div>
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

      {/* 전체 지사 개인별 계약건수 랭킹 (관리자만) */}
      {(isAdminPlus || isDirector) && (() => {
        const contractRecords = (rankingRecords.length > 0 ? rankingRecords : records).filter(r => r.type === '계약' && r.status !== 'refunded');
        // 개인별 집계 — user_name 기반 (퇴사자/미가입자 포함)
        const userMap: Record<string, { name: string; branch: string; position: string; count: number; totalAmount: number }> = {};
        contractRecords.forEach(r => {
          const name = r.user_name || '미확인';
          const key = `${name}_${r.branch || ''}`; // 동명이인 방지: 이름+지사
          if (!userMap[key]) {
            const m = members.find(mm => mm.id === r.user_id);
            userMap[key] = {
              name,
              branch: r.branch || m?.branch || '',
              position: (m as any)?.position_title || '',
              count: 0,
              totalAmount: 0,
            };
          }
          userMap[key].count += r.amount >= 2200000 ? 2 : 1;
          userMap[key].totalAmount += r.amount || 0;
        });
        // 정렬: 1차 건수, 2차 계약금액
        const sorted = Object.values(userMap).sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount);
        // 동률 처리: 건수+금액 모두 같으면 같은 순위
        const ranking = sorted.map((u, idx) => {
          let rank = idx + 1;
          if (idx > 0) {
            const prev = sorted[idx - 1];
            if (prev.count === u.count && prev.totalAmount === u.totalAmount) {
              rank = (sorted as any)[idx - 1]._rank;
            }
          }
          (u as any)._rank = rank;
          return { ...u, rank };
        });
        if (ranking.length === 0) return null;
        const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
        const medalBg = ['linear-gradient(135deg, #fff9e6 0%, #fff3cd 100%)', 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)', 'linear-gradient(135deg, #fdf0e6 0%, #f5e6d3 100%)'];
        const medalBorder = ['#ffd700', '#c0c0c0', '#cd7f32'];
        const yr = new Date().getFullYear();
        const ps = rankingPeriodIdx * 2 + 1;
        const periodLabel = rankingYearly
          ? `${yr}년 전체`
          : `${yr}년 ${ps}~${ps + 1}월`;
        return (
          <div className="sales-ranking" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#3c4043' }}>계약건수 랭킹</div>
              {!rankingYearly ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button onClick={() => setRankingPeriodIdx(Math.max(0, rankingPeriodIdx - 1))}
                    disabled={rankingPeriodIdx === 0}
                    style={{ background: 'none', border: 'none', cursor: rankingPeriodIdx === 0 ? 'default' : 'pointer', fontSize: '0.82rem', color: rankingPeriodIdx === 0 ? '#dadce0' : '#5f6368', padding: '2px 4px' }}>◀</button>
                  <span style={{ fontSize: '0.75rem', color: '#1a73e8', fontWeight: 600, padding: '3px 10px', background: '#e8f0fe', borderRadius: 8, minWidth: 80, textAlign: 'center' }}>{periodLabel}</span>
                  <button onClick={() => setRankingPeriodIdx(Math.min(5, rankingPeriodIdx + 1))}
                    disabled={rankingPeriodIdx === 5}
                    style={{ background: 'none', border: 'none', cursor: rankingPeriodIdx === 5 ? 'default' : 'pointer', fontSize: '0.82rem', color: rankingPeriodIdx === 5 ? '#dadce0' : '#5f6368', padding: '2px 4px' }}>▶</button>
                </div>
              ) : (
                <span style={{ fontSize: '0.72rem', color: '#7b1fa2', fontWeight: 600, padding: '3px 10px', background: '#f3e5f5', borderRadius: 8 }}>{periodLabel}</span>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                <span style={{ fontSize: '0.72rem', color: !rankingYearly ? '#1a73e8' : '#9aa0a6', fontWeight: !rankingYearly ? 600 : 400 }}>2달</span>
                <div onClick={() => setRankingYearly(!rankingYearly)}
                  style={{ width: 36, height: 20, borderRadius: 10, background: rankingYearly ? '#7b1fa2' : '#dadce0', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: rankingYearly ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </div>
                <span style={{ fontSize: '0.72rem', color: rankingYearly ? '#7b1fa2' : '#9aa0a6', fontWeight: rankingYearly ? 600 : 400 }}>{yr}년</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {ranking.filter(u => u.rank <= 3).map((u, idx) => {
                const ri = u.rank - 1; // 메달 색상용 (0-based)
                const isMedal = true;
                return (
                <div key={idx} style={{
                  padding: '10px 16px', borderRadius: 10, minWidth: 160,
                  background: isMedal ? medalBg[ri] || medalBg[2] : '#fff',
                  border: `1.5px solid ${isMedal ? medalBorder[ri] || medalBorder[2] : '#e8eaed'}`,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isMedal ? medalColors[ri] || medalColors[2] : '#e8eaed',
                    color: isMedal ? '#fff' : '#5f6368', fontWeight: 800, fontSize: '0.82rem',
                    boxShadow: isMedal ? '0 2px 4px rgba(0,0,0,0.15)' : 'none',
                  }}>{u.rank}</div>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1a1a2e' }}>
                      {u.name} {u.position && <span style={{ fontSize: '0.7rem', fontWeight: 400, color: '#5f6368' }}>{u.position}</span>}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#9aa0a6' }}>{u.branch} · {u.totalAmount.toLocaleString()}원</div>
                  </div>
                  <div style={{ marginLeft: 'auto', fontSize: '1.1rem', fontWeight: 700, color: isMedal ? medalBorder[ri] || medalBorder[2] : '#1a73e8' }}>
                    {u.count}<span style={{ fontSize: '0.7rem', fontWeight: 400 }}>건</span>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 필터 */}
      <div className="filter-bar" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="month" className="form-input" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={{ width: 160 }} />
        {/* 지사 필터: 관리자/총무만 (팀장/총괄이사는 본인 섹터 고정) */}
        {(isAdminPlus || isAccountant) && (
          <div style={{ minWidth: 120 }}>
            <Select size="sm" options={[{ value: '', label: '전체 지사' }, ...branchOpts]}
              value={branchOpts.find(o => o.value === filterBranch) || { value: '', label: '전체 지사' }}
              onChange={(o: any) => { setFilterBranch(o?.value || ''); setFilterUser(''); }} placeholder="지사" isClearable />
          </div>
        )}
        {/* 총괄이사: 대전/부산만 선택 */}
        {isDirector && (
          <div style={{ minWidth: 120 }}>
            <Select size="sm" options={[{ value: '', label: '대전/부산' }, { value: '대전', label: '대전' }, { value: '부산', label: '부산' }]}
              value={[{ value: '대전', label: '대전' }, { value: '부산', label: '부산' }].find(o => o.value === filterBranch) || { value: '', label: '대전/부산' }}
              onChange={(o: any) => { setFilterBranch(o?.value || ''); setFilterUser(''); }} placeholder="지사" isClearable />
          </div>
        )}
        {/* 담당자 필터: 관리자/총무/총괄이사/팀장 */}
        {showUserFilter && (
          <div style={{ minWidth: 200 }}>
            <Select size="sm" options={[{ value: '', label: '전체 담당자' }, ...memberOpts]}
              value={memberOpts.find(o => o.value === filterUser) || { value: '', label: '전체 담당자' }}
              onChange={(o: any) => setFilterUser(o?.value || '')} placeholder="담당자" isClearable />
          </div>
        )}
        <div style={{ minWidth: 110 }}>
          <Select size="sm" options={[{ value: '', label: '전체 유형' }, ...TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label }))]}
            value={TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label })).find(o => o.value === filterType) || { value: '', label: '전체 유형' }}
            onChange={(o: any) => setFilterType(o?.value || '')} placeholder="유형" isClearable />
        </div>
      </div>

      {/* 탭 + 검색 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div className="premium-filter-bar" style={{ marginBottom: 0 }}>
          <button className={`premium-filter-btn ${salesTab === 'list' ? 'active' : ''}`} onClick={() => setSalesTab('list')}>매출내역</button>
          {(isAdminPlus || isAccountant || isDirector || isManager) && (
            <button className={`premium-filter-btn ${salesTab === 'activity' ? 'active' : ''}`} onClick={() => setSalesTab('activity')}>
              <Activity size={14} style={{ marginRight: 4 }} /> 활동내역
            </button>
          )}
          {canModifyAccounting && (
            <button className={`premium-filter-btn ${salesTab === 'upload' ? 'active' : ''}`} onClick={() => setSalesTab('upload')}>
              <Upload size={14} style={{ marginRight: 4 }} /> 엑셀 업로드
            </button>
          )}
        </div>
        {(salesTab === 'list' || salesTab === 'activity') && (
          <input className="form-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="계약자명, 담당자 검색" style={{ width: 200, fontSize: '0.82rem', padding: '6px 10px' }} />
        )}
      </div>

      {/* ━━━ 활동내역 탭 [6-3] ━━━ */}
      {salesTab === 'activity' && (() => {
        // 지사+담당자 필터 적용된 계약자 목록
        let userSales = allRecords;
        let userJournals = activityEntries;
        if (activityBranch) { userSales = userSales.filter(r => r.branch === activityBranch); userJournals = userJournals.filter(e => e.branch === activityBranch); }
        if (activityUser) { userSales = userSales.filter(r => r.user_id === activityUser); userJournals = userJournals.filter(e => e.user_id === activityUser); }
        // 검색 필터
        const sq = searchQuery.toLowerCase();
        const clientList = [...new Set(userSales.map(r => r.client_name).filter(Boolean))]
          .filter(name => !sq || name.toLowerCase().includes(sq) || userSales.some(r => r.client_name === name && (r.user_name || '').toLowerCase().includes(sq)))
          .map(name => {
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
            {/* 지사 + 담당자 선택 */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 140 }}>
                <label className="form-label">지사</label>
                <Select size="sm" options={[{ value: '', label: '전체 지사' }, ...branchOpts]}
                  value={branchOpts.find(o => o.value === activityBranch) || { value: '', label: '전체 지사' }}
                  onChange={(o: any) => { setActivityBranch(o?.value || ''); setActivityUser(''); setActivityPage(0); }}
                  placeholder="지사" isClearable />
              </div>
              <div style={{ minWidth: 260 }}>
                <label className="form-label">담당자</label>
                {(() => {
                  const opts = activityBranch ? memberOpts.filter(o => members.find(m => m.id === o.value && m.branch === activityBranch)) : memberOpts;
                  return (
                    <Select options={[{ value: '', label: '전체 담당자' }, ...opts]}
                      value={opts.find(o => o.value === activityUser) || { value: '', label: '전체 담당자' }}
                      onChange={(o: any) => { setActivityUser(o?.value || ''); setActivityPage(0); }}
                      placeholder="담당자 선택" isSearchable />
                  );
                })()}
              </div>
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
              매출항목: 계약 / 낙찰 / 중개 / 매수신청대리 / 기타 / <span style={{ color: '#d93025' }}>계약환불 / 낙찰환불</span><br />
              입금액: 부가세 포함 금액 (숫자 또는 콤마 포함 가능)<br />
              <span style={{ color: '#d93025' }}>환불 항목은 동일 고객명이어도 삭제하지 않고 별도 환불 건으로 등록됩니다.</span>
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

              const refundCount = valid.filter(r => r.type === '계약환불' || r.type === '낙찰환불').length;
              const res = await api.sales.bulkImport(valid) as any;
              let resultMsg = `${res.count}건이 등록되었습니다.`;
              if (refundCount > 0) resultMsg += ` (환불 ${refundCount}건 포함)`;
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
            {formType === '계약' && (
              <div><label className="form-label">전화번호 <span style={{ fontSize: '0.7rem', color: '#9aa0a6', fontWeight: 400 }}>동명이인 방지</span></label>
                <input className="form-input" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} style={{ width: '100%' }} placeholder="010-0000-0000" /></div>
            )}
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

          {/* 매수신청대리 비용 */}
          {formType === '매수신청대리' && (() => {
            const amt = Number(fromMoneyDisplay(formAmount)) || 0;
            const cost = Number(fromMoneyDisplay(formProxyCost)) || 0;
            const profit = amt - cost;
            return (
              <div style={{ marginTop: 14, padding: 16, background: '#f0f4ff', borderRadius: 8, border: '1px solid #c8d6e5' }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 10, color: '#3c4043' }}>매수신청대리비용</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
                  <div>
                    <label className="form-label">대리비용 (담당자 지급금액)</label>
                    <input className="form-input" value={toMoneyDisplay(formProxyCost)} onChange={(e) => setFormProxyCost(fromMoneyDisplay(e.target.value))} style={{ width: '100%' }} placeholder="대리비용" />
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <div style={{ fontSize: '0.75rem', color: '#9aa0a6', marginBottom: 4 }}>담당자 수익금액</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: profit >= 0 ? '#188038' : '#d93025' }}>
                      {profit >= 0 ? formatCurrency(profit) : '-' + formatCurrency(Math.abs(profit))}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#9aa0a6', marginTop: 4 }}>
                      매수신청대리비용 - 대리비용
                    </div>
                    {profit < 0 && (
                      <div style={{ fontSize: '0.7rem', color: '#d93025', marginTop: 4, fontWeight: 600 }}>
                        회계장부에 지출로 기재됩니다
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

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

          {/* 결제방식 / 지출증빙 */}
          <div style={{ marginTop: 14, padding: 16, background: '#f0f4ff', borderRadius: 8, border: '1px solid #c8d6e5' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 10, color: '#3c4043' }}>결제 정보</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div>
                <label className="form-label">결제방식</label>
                <select className="form-input" value={formPaymentType} onChange={(e) => setFormPaymentType(e.target.value as any)} style={{ width: '100%' }}>
                  <option value="이체">이체</option>
                  <option value="카드">카드</option>
                </select>
              </div>
              {formPaymentType === '이체' && (
                <div>
                  <label className="form-label">지출증빙</label>
                  <select className="form-input" value={formReceiptType} onChange={(e) => setFormReceiptType(e.target.value as any)} style={{ width: '100%' }}>
                    <option value="">선택</option>
                    <option value="현금영수증">현금영수증</option>
                    <option value="세금계산서">세금계산서</option>
                  </select>
                </div>
              )}
              {formPaymentType === '이체' && formReceiptType === '현금영수증' && (
                <div>
                  <label className="form-label">현금영수증 전화번호</label>
                  <input className="form-input" value={formReceiptPhone} onChange={(e) => setFormReceiptPhone(e.target.value)} style={{ width: '100%' }} placeholder="010-0000-0000" />
                </div>
              )}
            </div>
            {formPaymentType === '이체' && formReceiptType === '세금계산서' && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: '#fff3e0', borderRadius: 6, fontSize: '0.78rem', color: '#e65100', border: '1px solid #ffcc80' }}>
                총무담당자님에게 카카오톡으로 세금계산서를 발송해주세요.
              </div>
            )}
          </div>

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

      {/* 매출 목록 (데스크톱) */}
      <div className="table-wrapper sales-desktop-table">
        <table className="premium-table">
          <thead>
            <tr>
              {canDeleteAccounting && <th style={{ width: 32 }}><input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === records.length} onChange={toggleSelectAll} /></th>}
              {[
                { key: 'contract_date', label: '일자' },
                { key: 'user_name', label: '담당자' },
                { key: 'type', label: '유형' },
                { key: 'client_name', label: '계약자명' },
                { key: 'amount', label: '금액' },
                { key: 'deposit_date', label: '결제일' },
                { key: 'contract_submitted', label: '계약서/물건보고서' },
                { key: 'status', label: '상태' },
              ].map(col => (
                <th key={col.key} onClick={() => toggleSort(col.key)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  {col.label} {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
              <th>액션</th>
            </tr>
            {selectedIds.size > 0 && canApproveAccounting && (
              <tr><td colSpan={10} style={{ background: '#fce4ec', padding: '6px 12px' }}>
                <button className="btn btn-sm btn-danger" onClick={handleBulkDelete}>{selectedIds.size}건 선택 삭제</button>
                <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setSelectedIds(new Set())}>선택 해제</button>
              </td></tr>
            )}
          </thead>
          <tbody>
            {[...branchRecords].filter(r => {
              if (!searchQuery) return true;
              const q = searchQuery.toLowerCase();
              return (r.client_name || '').toLowerCase().includes(q) || (r.user_name || '').toLowerCase().includes(q);
            }).sort((a: any, b: any) => {
              const av = a[sortKey] ?? '';
              const bv = b[sortKey] ?? '';
              const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
              return sortDir === 'asc' ? cmp : -cmp;
            }).map((r) => {
              const st = STATUS_LABELS[r.status];
              const isRefunded = r.status === 'refunded';
              const isConfirming = confirmingId === r.id;
              return (
                <tr key={r.id} onClick={() => openDetail(r)} className="clickable-row"
                  style={{ cursor: 'pointer', ...(isRefunded ? { opacity: 0.5, textDecoration: 'line-through', background: '#fafafa' } : r.type === '낙찰' ? { background: '#f3f0ff' } : r.type === '계약' ? { background: '#f0f7ff' } : {}) }}>
                  {canDeleteAccounting && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>}
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
                    {r.type !== '계약' && r.type !== '낙찰' ? (
                      <span style={{ color: '#9aa0a6', fontSize: '0.7rem' }}>-</span>
                    ) : r.contract_submitted && r.contract_not_approved ? (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ color: '#188038', fontSize: '0.75rem', fontWeight: 600 }}>등록</span>
                        {(isAccountant || isMaster) && (
                          <div><button style={{ fontSize: '0.55rem', color: '#9aa0a6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={(e) => { e.preventDefault(); if (confirm(`${getDocLabel(r.type)} 제출 상태를 취소하시겠습니까?`)) api.sales.contractCheck(r.id, { contract_submitted: 0, contract_not_submitted: 0, contract_not_reason: '', contract_not_approved: 0 }).then(() => load(true)); }}>취소</button></div>
                        )}
                      </div>
                    ) : r.contract_submitted && !r.contract_not_approved ? (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ color: '#1a73e8', fontSize: '0.72rem', fontWeight: 600 }}>확인 대기</span>
                        {canApproveAccounting && (
                          <button className="btn btn-sm" style={{ fontSize: '0.6rem', padding: '1px 4px', marginTop: 2, color: '#188038' }}
                            onClick={(e) => { e.preventDefault(); if (confirm('마이옥션 CRM+에 등록된지 확인하셨나요?')) api.sales.contractNotApprove(r.id).then(() => load(true)); }}>
                            확인
                          </button>
                        )}
                      </div>
                    ) : r.contract_not_submitted && r.contract_not_approved ? (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ color: '#e65100', fontSize: '0.72rem', fontWeight: 600 }}>미제출</span>
                        {(isAccountant || isMaster) && (
                          <div><button style={{ fontSize: '0.55rem', color: '#9aa0a6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={(e) => { e.preventDefault(); if (confirm(`${getDocLabel(r.type)} 미제출 승인을 취소하시겠습니까?`)) api.sales.contractCheck(r.id, { contract_submitted: 0, contract_not_submitted: 0, contract_not_reason: '', contract_not_approved: 0 }).then(() => load(true)); }}>취소</button></div>
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
                          onClick={(e) => { e.preventDefault(); if (confirm(`마이옥션 CRM+에 ${r.type === '낙찰' ? '물건분석 보고서를' : '컨설팅계약서를'} 업로드 하셨습니까?\n업로드 한 경우에만 확인을 눌러주세요.`)) api.sales.contractCheck(r.id, { contract_submitted: 1 }).then(() => load(true)); }}>등록</button>
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
                      {/* 입금확인/결제확인 (회계) */}
                      {r.status === 'pending' && canApproveAccounting && !isConfirming && (
                        <button className="btn btn-sm btn-success" onClick={() => { setConfirmingId(r.id); setConfirmDepositDate(new Date().toISOString().slice(0, 10)); }}>
                          <CheckCircle size={13} /> 결제확인
                        </button>
                      )}
                      {isConfirming && (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input type="date" className="form-input" value={confirmDepositDate} onChange={(e) => setConfirmDepositDate(e.target.value)} style={{ fontSize: '0.78rem', padding: '4px 6px' }} />
                          <button className="btn btn-sm btn-success" onClick={() => handleConfirm(r.id)}>확인</button>
                          <button className="btn btn-sm" onClick={() => setConfirmingId(null)}>취소</button>
                        </div>
                      )}
                      {/* 카드결제 정산일 (총무 — 확정 후 입력) */}
                      {r.status === 'confirmed' && r.payment_type === '카드' && (() => {
                        const settled = !!r.card_deposit_date;
                        const canEditSettle = role === 'master' || role === 'accountant'; // 총무담당만 수정 가능
                        const canSetSettle = canApproveAccounting && !settled; // 미적용 시 총무급 적용 가능
                        return (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.68rem', color: '#5f6368', whiteSpace: 'nowrap' }}>정산일</span>
                            {settled ? (
                              <>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#188038', padding: '2px 6px', background: '#e8f5e9', borderRadius: 6 }}>{r.card_deposit_date}</span>
                                {canEditSettle && (
                                  <button className="btn btn-sm" style={{ fontSize: '0.6rem', padding: '1px 4px', color: '#9aa0a6' }}
                                    onClick={async () => {
                                      if (!confirm('정산일을 초기화하시겠습니까?')) return;
                                      try { await api.sales.update(r.id, { card_deposit_date: '' }); load(true); } catch (err: any) { alert(err.message); }
                                    }}>초기화</button>
                                )}
                              </>
                            ) : canSetSettle ? (
                              <>
                                <input type="date" className="form-input" value={settleDate}
                                  onFocus={() => setSettleDate('')}
                                  onChange={(e) => setSettleDate(e.target.value)}
                                  style={{ fontSize: '0.72rem', padding: '3px 5px', width: 120 }} />
                                <button className="btn btn-sm btn-primary" style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                                  onClick={async () => {
                                    if (!settleDate) { alert('정산일을 선택하세요.'); return; }
                                    try { await api.sales.update(r.id, { card_deposit_date: settleDate }); setSettleDate(''); load(true); } catch (err: any) { alert(err.message); }
                                  }}>적용</button>
                              </>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: '#9aa0a6' }}>미등록</span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}
            {branchRecords.length === 0 && <tr><td colSpan={canDeleteAccounting ? 11 : 10} className="empty-state">매출 내역이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 매출 목록 (모바일 카드) */}
      <div className="sales-mobile-cards">
        {(() => {
          const sorted = [...records].filter(r => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            return (r.client_name || '').toLowerCase().includes(q) || (r.user_name || '').toLowerCase().includes(q);
          }).sort((a: any, b: any) => {
            const av = a[sortKey] ?? '';
            const bv = b[sortKey] ?? '';
            const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
            return sortDir === 'asc' ? cmp : -cmp;
          });
          if (sorted.length === 0) return <div className="empty-state">매출 내역이 없습니다.</div>;
          return sorted.map((r) => {
            const st = STATUS_LABELS[r.status];
            const isRefunded = r.status === 'refunded';
            const expanded = expandedIds.has(r.id);
            return (
              <div key={r.id} className="sales-card" style={isRefunded ? { opacity: 0.5 } : r.type === '낙찰' ? { borderLeft: '3px solid #7c4dff' } : r.type === '계약' ? { borderLeft: '3px solid #1a73e8' } : {}}>
                <div className="sales-card-header" onClick={() => toggleExpand(r.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{r.client_name}</span>
                      <span style={{ fontSize: '0.72rem', padding: '1px 6px', borderRadius: 8, background: st.bg, color: st.color, fontWeight: 600 }}>{st.label}</span>
                      <span style={{ fontSize: '0.72rem', padding: '1px 6px', borderRadius: 8, background: '#f3f4f6', color: '#5f6368' }}>{r.type}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.78rem', color: '#5f6368' }}>
                      <span style={{ fontWeight: 700, color: '#1a2744', fontSize: '0.88rem' }}>{formatCurrency(r.amount)}</span>
                      <span>{r.contract_date}</span>
                      <span>{r.user_name}</span>
                    </div>
                  </div>
                  <div style={{ color: '#9aa0a6', flexShrink: 0 }}>
                    {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </div>
                {expanded && (
                  <div className="sales-card-body">
                    {r.depositor_different === 1 && r.depositor_name && (
                      <div className="sales-card-row">
                        <span className="sales-card-label">입금자</span>
                        <span style={{ color: '#e65100' }}>{r.depositor_name}</span>
                      </div>
                    )}
                    <div className="sales-card-row">
                      <span className="sales-card-label">결제일</span>
                      <span style={{ color: r.deposit_date ? '#188038' : '#9aa0a6' }}>{r.deposit_date || '-'}</span>
                    </div>
                    {r.type === '계약' && (r.appraisal_rate > 0 || r.winning_rate > 0) && (
                      <div className="sales-card-row">
                        <span className="sales-card-label">감정가/낙찰가</span>
                        <span>{r.appraisal_rate}% / {r.winning_rate}%</span>
                      </div>
                    )}
                    {(r.type === '계약' || r.type === '낙찰') && (
                      <div className="sales-card-row">
                        <span className="sales-card-label">{getDocLabel(r.type)}</span>
                        <span>
                          {r.contract_submitted && r.contract_not_approved ? (
                            <span style={{ color: '#188038', fontWeight: 600 }}>등록</span>
                          ) : r.contract_submitted ? (
                            <span style={{ color: '#1a73e8', fontWeight: 600 }}>확인 대기</span>
                          ) : r.contract_not_submitted && r.contract_not_approved ? (
                            <span style={{ color: '#e65100', fontWeight: 600 }}>미제출</span>
                          ) : r.contract_not_submitted ? (
                            <span style={{ color: '#d93025', fontWeight: 600 }}>미작성</span>
                          ) : (
                            <span style={{ color: '#9aa0a6' }}>미확인</span>
                          )}
                        </span>
                      </div>
                    )}
                    {r.type === '기타' && r.type_detail && (
                      <div className="sales-card-row">
                        <span className="sales-card-label">상세</span>
                        <span>{r.type_detail}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => openDetail(r)} style={{ fontSize: '0.75rem' }}>상세보기</button>
                      {r.status === 'pending' && canApproveAccounting && (
                        <button className="btn btn-sm btn-success" style={{ fontSize: '0.75rem' }} onClick={() => { setConfirmingId(r.id); setConfirmDepositDate(new Date().toISOString().slice(0, 10)); }}>
                          <CheckCircle size={12} /> 결제확인
                        </button>
                      )}
                    </div>
                    {confirmingId === r.id && (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 6 }}>
                        <input type="date" className="form-input" value={confirmDepositDate} onChange={(e) => setConfirmDepositDate(e.target.value)} style={{ fontSize: '0.78rem', padding: '4px 6px', flex: 1 }} />
                        <button className="btn btn-sm btn-success" onClick={() => handleConfirm(r.id)}>확인</button>
                        <button className="btn btn-sm" onClick={() => setConfirmingId(null)}>취소</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          });
        })()}
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
                <div>
                  <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>유형</span>
                  {isMaster ? (
                    <select className="form-input" defaultValue={detailRecord.type} style={{ width: '100%', fontSize: '0.9rem', fontWeight: 600, marginTop: 2 }}
                      onChange={async (e) => {
                        try { await api.sales.update(detailRecord.id, { type: e.target.value }); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                      }}>
                      {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <div style={{ fontWeight: 600 }}>{detailRecord.type}{detailRecord.type_detail ? ` (${detailRecord.type_detail})` : ''}</div>
                  )}
                </div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>상태</span><div><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600, background: STATUS_LABELS[detailRecord.status].bg, color: STATUS_LABELS[detailRecord.status].color }}>{STATUS_LABELS[detailRecord.status].label}</span></div></div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>계약자명</span><div style={{ fontWeight: 600 }}>{detailRecord.client_name}</div></div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>담당자</span><div>{detailRecord.user_name}</div></div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>금액</span><div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{formatCurrency(detailRecord.amount)}</div></div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>일자</span><div>{detailRecord.contract_date}</div></div>
                {/* 계약조건 — 감정가/낙찰가 (인라인 수정) */}
                {detailRecord.type === '계약' && (
                  <>
                    <div>
                      <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>감정가 %</span>
                      {canModifyAccounting ? (
                        <input className="form-input" type="number" step="0.1"
                          defaultValue={detailRecord.appraisal_rate || ''}
                          style={{ width: '100%', fontSize: '0.9rem', fontWeight: 600, marginTop: 2 }}
                          placeholder="예: 1.5"
                          onBlur={async (e) => {
                            const val = Number(e.target.value) || 0;
                            if (val !== detailRecord.appraisal_rate) {
                              try { await api.sales.update(detailRecord.id, { appraisal_rate: val } as any); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                            }
                          }} />
                      ) : (
                        <div style={{ fontWeight: 600 }}>{detailRecord.appraisal_rate ? detailRecord.appraisal_rate + '%' : '-'}</div>
                      )}
                    </div>
                    <div>
                      <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>낙찰가 %</span>
                      {canModifyAccounting ? (
                        <input className="form-input" type="number" step="0.1"
                          defaultValue={detailRecord.winning_rate || ''}
                          style={{ width: '100%', fontSize: '0.9rem', fontWeight: 600, marginTop: 2 }}
                          placeholder="예: 2.0"
                          onBlur={async (e) => {
                            const val = Number(e.target.value) || 0;
                            if (val !== detailRecord.winning_rate) {
                              try { await api.sales.update(detailRecord.id, { winning_rate: val } as any); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                            }
                          }} />
                      ) : (
                        <div style={{ fontWeight: 600 }}>{detailRecord.winning_rate ? detailRecord.winning_rate + '%' : '-'}</div>
                      )}
                    </div>
                  </>
                )}
                {/* 서류 제출 상태 */}
                {(detailRecord.type === '계약' || detailRecord.type === '낙찰') && <div>
                  <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>{getDocLabel(detailRecord.type)}</span>
                  <div>
                    {detailRecord.contract_submitted && detailRecord.contract_not_approved ? (
                      <span style={{ color: '#188038', fontWeight: 600 }}>등록</span>
                    ) : detailRecord.contract_submitted ? (
                      <div>
                        <span style={{ color: '#1a73e8', fontWeight: 600 }}>확인 대기</span>
                        {canApproveAccounting && (
                          <button className="btn btn-sm btn-primary" style={{ marginTop: 6, fontSize: '0.75rem' }}
                            onClick={() => { if (confirm('마이옥션 CRM+에 등록된지 확인하셨나요?')) api.sales.contractNotApprove(detailRecord.id).then(() => { setDetailRecord(null); load(); }); }}>
                            등록 확인
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
                </div>}
                {detailRecord.depositor_different === 1 && detailRecord.depositor_name && (
                  <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>입금자</span><div style={{ color: '#e65100' }}>{detailRecord.depositor_name}</div></div>
                )}
                {detailRecord.deposit_date && (
                  <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>결제일</span><div style={{ color: '#188038' }}>{detailRecord.deposit_date}</div></div>
                )}
                {detailRecord.payment_type && (
                  <div>
                    <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>결제방식</span>
                    {isMaster ? (
                      <select className="form-input" defaultValue={detailRecord.payment_type} style={{ width: '100%', fontSize: '0.9rem', fontWeight: 600, marginTop: 2 }}
                        onChange={async (e) => {
                          try { await api.sales.update(detailRecord.id, { payment_type: e.target.value }); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                        }}>
                        <option value="이체">이체</option>
                        <option value="카드">카드</option>
                      </select>
                    ) : (
                      <div>{detailRecord.payment_type}</div>
                    )}
                  </div>
                )}
                {detailRecord.receipt_type && (
                  <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>지출증빙</span><div>{detailRecord.receipt_type}{detailRecord.receipt_phone ? ` (${detailRecord.receipt_phone})` : ''}</div></div>
                )}
                {detailRecord.payment_type === '카드' && (() => {
                  const settled = !!detailRecord.card_deposit_date;
                  const canEditSettle = role === 'master' || role === 'accountant';
                  return (
                    <div>
                      <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>카드 정산일</span>
                      {settled ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <span style={{ fontWeight: 600, color: '#188038' }}>{detailRecord.card_deposit_date}</span>
                          <span style={{ fontSize: '0.68rem', color: '#188038', padding: '1px 6px', background: '#e8f5e9', borderRadius: 6 }}>적용완료</span>
                          {canEditSettle && (
                            <button className="btn btn-sm" style={{ fontSize: '0.65rem', padding: '1px 4px', color: '#9aa0a6' }}
                              onClick={async () => {
                                if (!confirm('정산일을 초기화하시겠습니까?')) return;
                                try { await api.sales.update(detailRecord.id, { card_deposit_date: '' }); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                              }}>초기화</button>
                          )}
                        </div>
                      ) : canApproveAccounting ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                          <input type="date" className="form-input" value={settleDate}
                            onChange={(e) => setSettleDate(e.target.value)} style={{ fontSize: '0.82rem' }} />
                          <button className="btn btn-sm btn-primary" style={{ fontSize: '0.75rem' }}
                            onClick={async () => {
                              if (!settleDate) { alert('정산일을 선택하세요.'); return; }
                              try { await api.sales.update(detailRecord.id, { card_deposit_date: settleDate }); setSettleDate(''); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                            }}>적용</button>
                        </div>
                      ) : (
                        <div style={{ color: '#9aa0a6' }}>미등록</div>
                      )}
                    </div>
                  );
                })()}
              </div>
              {/* 수정 영역 (본인 pending건 또는 관리자/총무) */}
              {((detailRecord.user_id === currentUser?.id && detailRecord.status === 'pending') || canModifyAccounting) && (
                <div style={{ borderTop: '1px solid #e8eaed', paddingTop: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: '0.78rem', color: '#3c4043', fontWeight: 600, marginBottom: 8 }}>내역 수정</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>금액 (부가세포함)</label>
                      <input className="form-input" defaultValue={detailRecord.amount ? detailRecord.amount.toLocaleString() : ''}
                        style={{ width: '100%', fontSize: '0.82rem' }} placeholder="금액 입력"
                        onBlur={async (e) => {
                          const val = Number(e.target.value.replace(/[^0-9]/g, '')) || 0;
                          if (val !== detailRecord.amount) {
                            try { await api.sales.update(detailRecord.id, { amount: val }); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                          }
                        }} />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>입금자명</label>
                      <input className="form-input" defaultValue={detailRecord.depositor_name || ''}
                        style={{ width: '100%', fontSize: '0.82rem' }} placeholder="입금자명 (계약자와 다를 때)"
                        onBlur={async (e) => {
                          const val = e.target.value.trim();
                          if (val !== (detailRecord.depositor_name || '')) {
                            try { await api.sales.update(detailRecord.id, { depositor_name: val, depositor_different: val ? true : false }); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                          }
                        }} />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>계약자명</label>
                      <input className="form-input" defaultValue={detailRecord.client_name || ''}
                        style={{ width: '100%', fontSize: '0.82rem' }} placeholder="계약자명"
                        onBlur={async (e) => {
                          const val = e.target.value.trim();
                          if (val && val !== detailRecord.client_name) {
                            try { await api.sales.update(detailRecord.id, { client_name: val }); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                          }
                        }} />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>일자</label>
                      <input className="form-input" type="date" defaultValue={detailRecord.contract_date || ''}
                        style={{ width: '100%', fontSize: '0.82rem' }}
                        onBlur={async (e) => {
                          const val = e.target.value;
                          if (val && val !== detailRecord.contract_date) {
                            try { await api.sales.update(detailRecord.id, { contract_date: val }); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                          }
                        }} />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>결제방식</label>
                      <select className="form-input" defaultValue={detailRecord.payment_type || '이체'}
                        style={{ width: '100%', fontSize: '0.82rem' }}
                        onChange={async (e) => {
                          const val = e.target.value;
                          if (val !== (detailRecord.payment_type || '')) {
                            try { await api.sales.update(detailRecord.id, { payment_type: val }); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                          }
                        }}>
                        <option value="이체">이체</option>
                        <option value="카드">카드</option>
                      </select>
                    </div>
                    {detailRecord.type === '매수신청대리' && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label className="form-label" style={{ fontSize: '0.72rem' }}>대리비용 (담당자 지급금액)</label>
                        <input className="form-input" defaultValue={detailRecord.proxy_cost ? detailRecord.proxy_cost.toLocaleString() : '0'}
                          style={{ width: '100%', fontSize: '0.82rem' }} placeholder="대리비용"
                          onBlur={async (e) => {
                            const val = Number(e.target.value.replace(/[^0-9]/g, '')) || 0;
                            if (val !== (detailRecord.proxy_cost || 0)) {
                              try { await api.sales.update(detailRecord.id, { proxy_cost: val } as any); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                            }
                          }} />
                        <div style={{ fontSize: '0.72rem', color: '#9aa0a6', marginTop: 4 }}>수익 = 매출금액({formatCurrency(detailRecord.amount)}) - 대리비용</div>
                      </div>
                    )}
                    {detailRecord.type === '계약' && (
                      <>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.72rem' }}>감정가 %</label>
                          <input className="form-input" type="number" step="0.1" defaultValue={detailRecord.appraisal_rate || ''}
                            style={{ width: '100%', fontSize: '0.82rem' }} placeholder="예: 1.5"
                            onBlur={async (e) => {
                              const val = Number(e.target.value) || 0;
                              if (val !== detailRecord.appraisal_rate) {
                                try { await api.sales.update(detailRecord.id, { appraisal_rate: val } as any); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                              }
                            }} />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.72rem' }}>낙찰가 %</label>
                          <input className="form-input" type="number" step="0.1" defaultValue={detailRecord.winning_rate || ''}
                            style={{ width: '100%', fontSize: '0.82rem' }} placeholder="예: 2.0"
                            onBlur={async (e) => {
                              const val = Number(e.target.value) || 0;
                              if (val !== detailRecord.winning_rate) {
                                try { await api.sales.update(detailRecord.id, { winning_rate: val } as any); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                              }
                            }} />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* 확인 취소 (총무담당/master — confirmed → pending) */}
              {detailRecord.status === 'confirmed' && isMaster && (
                <button className="btn btn-sm" style={{ fontSize: '0.78rem', marginBottom: 12, color: '#e65100', border: '1px solid #e65100' }}
                  onClick={async () => {
                    if (!confirm('입금확인을 취소하고 입금대기 상태로 되돌리시겠습니까?')) return;
                    try { await api.sales.unconfirm(detailRecord.id); setDetailRecord(null); load(); }
                    catch (err: any) { alert(err.message); }
                  }}>
                  <RotateCcw size={12} /> 확인 취소 (전단계로)
                </button>
              )}
              {/* 환불신청 버튼 (본인 건 또는 마스터/총무담당 + 확정매출만) */}
              {detailRecord.status === 'confirmed' && (detailRecord.user_id === currentUser?.id || isMaster) && (
                <button className="btn btn-sm btn-danger" style={{ fontSize: '0.78rem', marginBottom: 12 }}
                  onClick={async () => {
                    if (!confirm('환불을 신청하시겠습니까?\n회계 승인 후 처리됩니다.')) return;
                    try { await api.sales.refundRequest(detailRecord.id); setDetailRecord(null); load(); }
                    catch (err: any) { alert(err.message); }
                  }}>
                  <RotateCcw size={12} /> 환불신청
                </button>
              )}
              {/* 메모 */}
              <div style={{ borderTop: '1px solid #e8eaed', paddingTop: 12 }}>
                <div style={{ fontSize: '0.78rem', color: '#9aa0a6', marginBottom: 6 }}>메모</div>
                <textarea
                  className="form-input"
                  defaultValue={detailRecord.memo || ''}
                  placeholder="메모 입력..."
                  rows={2}
                  style={{ width: '100%', resize: 'vertical', fontSize: '0.82rem' }}
                  onBlur={async (e) => {
                    const val = e.target.value.trim();
                    if (val !== (detailRecord.memo || '')) {
                      try { await api.sales.updateMemo(detailRecord.id, val); load(true); }
                      catch { /* */ }
                    }
                  }}
                />
              </div>
              {/* 총무 메모 (총무/관리자만 표시) */}
              {(isAccountant || isMaster) && (() => {
                const canWrite = isAccountant || isMaster;
                return (
                  <div style={{ marginTop: 12 }}>
                    <div className="admin-memo" style={{ marginTop: 8 }}>
                      <textarea
                        className="admin-memo-input"
                        defaultValue={(detailRecord as any)._adminMemo || ''}
                        placeholder={canWrite ? '총무 메모 작성...' : '총무 메모 없음'}
                        rows={2}
                        readOnly={!canWrite}
                        onBlur={async (e) => {
                          if (!canWrite) return;
                          const val = e.target.value.trim();
                          const prev = (detailRecord as any)._adminMemo || '';
                          if (val === prev) return;
                          try {
                            if ((detailRecord as any)._adminMemoId) {
                              if (val) await api.sales.updateAdminMemo((detailRecord as any)._adminMemoId, val);
                              else await api.sales.deleteAdminMemo((detailRecord as any)._adminMemoId);
                            } else if (val) {
                              await api.sales.createAdminMemo({ related_type: 'sales', related_id: detailRecord.id, content: val });
                            }
                            load(true);
                          } catch { /* */ }
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
