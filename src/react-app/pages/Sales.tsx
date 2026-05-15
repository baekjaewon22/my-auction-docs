import React, { useEffect, useState } from 'react';
import { api, setSourcePage } from '../api';
import { useAuthStore } from '../store';
import type { SalesRecord, DepositNotice } from '../types';
import { useBranches } from '../hooks/useBranches';
import Select from '../components/Select';
import {
  DollarSign, Plus, CheckCircle, RotateCcw, Clock, X, Upload, Activity, ChevronDown, ChevronUp, Trash2
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
  pending: { label: '입금신청', color: '#e65100', bg: '#fff3e0' },
  card_pending: { label: '카드대기', color: '#7b1fa2', bg: '#f3e5f5' },
  confirmed: { label: '확정매출', color: '#188038', bg: '#e8f5e9' },
  refund_requested: { label: '환불신청', color: '#d93025', bg: '#fce4ec' },
  refunded: { label: '환불완료', color: '#9aa0a6', bg: '#f5f5f5' },
};

function formatPhone(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length < 4) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

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

function contractCustomerKey(r: SalesRecord): string {
  const phone = (r.client_phone || '').replace(/\D/g, '');
  if (!phone || !r.client_name) return `row:${r.id}`;
  return `${r.client_name.trim().toLowerCase()}|${phone}`;
}

function calculateContractCount(rows: SalesRecord[]): number {
  const grouped = new Map<string, number>();
  rows
    .filter(r => r.type === '계약' && r.status === 'confirmed' && !r.exclude_from_count)
    .forEach(r => {
      const key = contractCustomerKey(r);
      grouped.set(key, (grouped.get(key) || 0) + (r.amount || 0));
    });
  return [...grouped.values()].reduce((sum, amount) => sum + (amount >= 2200000 ? 2 : 1), 0);
}

function isMissingAction(r: SalesRecord): boolean {
  if (r.status === 'refunded') return false;
  if (r.payment_type === '카드') return !r.card_deposit_date;
  if (r.payment_type === '이체' || r.payment_type === '현금') return !r.tax_invoice_date;
  return false;
}

const CONFIRM_WAITING_STATUSES = ['pending', 'card_pending', 'refund_requested'];

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
  const [filterStatus, setFilterStatus] = useState('');
  const [showBranchSummary, setShowBranchSummary] = useState(false);
  const [filterBranch, setFilterBranch] = useState(() => {
    // 총괄이사는 대전 디폴트
    if (currentUser?.role === 'director') return '대전';
    return '';
  });
  const [branchDefaultApplied, setBranchDefaultApplied] = useState(false);

  // 총무 담당/보조: 알림톡 설정(담당 지사)의 첫 번째 지사를 기본 필터로 적용
  // race condition 방지 — 사용자가 이미 지사를 선택했으면 덮어쓰지 않음
  useEffect(() => {
    if (branchDefaultApplied) return;
    if (!currentUser?.id) return;
    if (!['accountant', 'accountant_asst'].includes(currentUser.role || '')) return;
    api.users.getAlimtalkSettings(currentUser.id).then(res => {
      setFilterBranch(prev => {
        if (prev) return prev; // 사용자 수동 선택 우선
        const branches = (res.branches || '').split(',').filter(Boolean);
        if (branches.length > 0) return branches[0];
        if (currentUser.branch) return currentUser.branch;
        return prev;
      });
      setBranchDefaultApplied(true);
    }).catch(() => {
      setFilterBranch(prev => {
        if (prev) return prev;
        if (currentUser.branch) return currentUser.branch;
        return prev;
      });
      setBranchDefaultApplied(true);
    });
  }, [currentUser?.id]);
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [filterMonthEnd, setFilterMonthEnd] = useState('');

  // 입금확인 시 입금일자
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmDepositDate, setConfirmDepositDate] = useState(() => new Date().toISOString().slice(0, 10));
  // 총무메모 hover popup (총무급만)
  const [adminMemosMap, setAdminMemosMap] = useState<Record<string, string>>({});
  const [hoveredMemoRow, setHoveredMemoRow] = useState<{ id: string; x: number; y: number } | null>(null);
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
  const [rankingData, setRankingData] = useState<Array<{ user_name: string; eff_branch: string; position: string; count: number; total_amount: number }>>([]);
  const [settleDate, setSettleDate] = useState('');
  const [invoiceDrafts, setInvoiceDrafts] = useState<Record<string, string>>({});
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
  const [salesTab, setSalesTab] = useState<'list' | 'activity' | 'myungdo' | 'upload' | 'auditlog'>('list');
  // 명도계약 (외부 명승 사건 — 매출 시스템과 분리, 표시만)
  const [myungdoCases, setMyungdoCases] = useState<any[]>([]);
  const [myungdoLoading, setMyungdoLoading] = useState(false);
  const [activityEntries, setActivityEntries] = useState<JournalEntry[]>([]);
  const [activityBranch, setActivityBranch] = useState('');
  const [activityUser, setActivityUser] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [activityPage, setActivityPage] = useState(0);
  const ACTIVITY_PAGE_SIZE = 20;
  // 활동 로그 (총무/총무보조의 수정·삭제·상태변경 감사)
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditMonth, setAuditMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [auditAction, setAuditAction] = useState<string>('');
  const [auditActor, setAuditActor] = useState<string>('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const role = currentUser?.role || 'member';
  const isAccountant = ['accountant', 'accountant_asst'].includes(role);
  const isMaster = role === 'master' || role === 'accountant' || role === 'accountant_asst'; // 총무/총무보조 = master 동급 (유형변경/확인취소)
  const canModifyAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role); // 수정 권한
  const canApproveAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role); // 입금확인/결제확인
  const canDepositUpload = ['master', 'accountant', 'accountant_asst'].includes(role); // 입금등록/엑셀업로드 (총무 전용)
  const canDeleteAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role); // 삭제/유형변경 (총무보조 로그 강제)
  const canViewAuditLog = role === 'master' || role === 'accountant'; // 활동 로그 조회 (총무보조 제외)
  // const canViewAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role); // 열람 (현재 미사용)
  const isDirector = role === 'director';
  const isAdminPlus = ['master', 'ceo', 'cc_ref', 'admin'].includes(role);
  const isManager = role === 'manager';
  const showUserFilter = isAdminPlus || isAccountant || isManager || isDirector;

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const salesRes = await api.sales.list({ month: filterMonth, month_end: filterMonthEnd || undefined, user_id: filterUser || undefined });
      setRecords(salesRes.records);
      // 총무급이면 총무메모 맵 로드 (row hover 팝업용)
      if (isAccountant || isMaster) {
        try {
          const mRes = await api.sales.memos({ related_type: 'sales' });
          const map: Record<string, string> = {};
          (mRes.memos || []).forEach((m: any) => { if (m.related_id && m.content) map[m.related_id] = m.content; });
          setAdminMemosMap(map);
        } catch { /* */ }
      }
      // 입금등록: 모든 담당자가 볼 수 있어야 함 (본인이 claim 가능하도록)
      try {
        const depRes = await api.sales.deposits();
        setDeposits(depRes.deposits || []);
      } catch { /* */ }
      if (showUserFilter) {
        const memRes = await api.journal.members();
        setMembers(memRes.members || []);
      }
      // 랭킹 집계: 전 직원 열람 가능 (개인 레코드 노출 아님)
      try {
        const year = new Date().getFullYear();
        const startMonth = rankingYearly
          ? `${year}-01`
          : `${year}-${String(rankingPeriodIdx * 2 + 1).padStart(2, '0')}`;
        const endMonth = rankingYearly
          ? `${year}-12`
          : `${year}-${String(rankingPeriodIdx * 2 + 2).padStart(2, '0')}`;
        const rk = await api.sales.ranking(startMonth, endMonth);
        setRankingData(rk.ranking || []);
      } catch { setRankingData([]); }
      // 관리자/총괄이사용 원본 레코드 (상단 계약건수 카드 집계 소스)
      if (isAdminPlus || isDirector) {
        try {
          const year = new Date().getFullYear();
          if (rankingYearly) {
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

  useEffect(() => { load(); }, [filterMonth, filterMonthEnd, filterUser, rankingYearly, rankingPeriodIdx]);

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
    // [6-1] 계약 타입이면 감정가%/낙찰가% 및 전화번호 필수
    if (formType === '계약') {
      if (!formAppraisalRate || !formWinningRate) { alert('감정가 %와 낙찰가 %를 모두 입력하세요.'); return; }
      const phoneDigits = (formPhone || '').replace(/\D/g, '');
      if (phoneDigits.length < 10) { alert('계약자 전화번호를 입력하세요. (중복 확인용 필수)'); return; }
      // 중복 계약 경고 (같은 이름 + 같은 전화번호)
      const dup = records.find(r => r.type === '계약' && r.client_name === formClientName && (r.client_phone || '').replace(/\D/g, '') === phoneDigits);
      if (dup) {
        if (!confirm(`동일한 고객(${formClientName}, ${formPhone})의 기존 계약이 있습니다.\n\n■ 기존 계약일: ${dup.contract_date}\n■ 기존 금액: ${dup.amount.toLocaleString()}원\n\n중복 계약으로 등록하시겠습니까?\n(필요 시 등록 후 상세에서 '계약 미포함' 체크)`)) return;
      }
    }

    // [6-2] 낙찰 타입: 동일 고객의 기존 계약 찾기 → 계약시 설정한 수수료율과 비교
    let rateDeviationReason = '';
    if (formType === '낙찰' && formClientName) {
      const priorContract = records.find(r =>
        r.type === '계약' && r.client_name === formClientName &&
        (r.appraisal_rate > 0 || r.winning_rate > 0)
      );
      if (priorContract) {
        const confirmMatch = confirm(
          `해당 고객(${formClientName})의 계약 조건이 있습니다.\n\n` +
          `■ 계약 시 약정 수수료율\n` +
          `  - 감정가: ${priorContract.appraisal_rate}%\n` +
          `  - 낙찰가: ${priorContract.winning_rate}%\n\n` +
          `실제 낙찰 수수료가 위 조건과 일치합니까?\n\n` +
          `[확인] 일치 — 그대로 저장\n[취소] 불일치 — 사유 입력`
        );
        if (!confirmMatch) {
          const reason = prompt(`계약 조건과 실제 수수료가 다른 사유를 입력하세요:\n(감정가 ${priorContract.appraisal_rate}% / 낙찰가 ${priorContract.winning_rate}%)`);
          if (!reason || !reason.trim()) { alert('사유 미입력으로 저장 취소됨.'); return; }
          rateDeviationReason = `[수수료변동사유] ${reason.trim()}`;
        }
      }
    }
    try {
      const rawAmount = Number(fromMoneyDisplay(formAmount)) || 0;
      const proxyCost = formType === '매수신청대리' ? (Number(fromMoneyDisplay(formProxyCost)) || 0) : 0;
      const proxyProfit = rawAmount - proxyCost; // 매수신청대리: 수익금액 (음수 가능)
      const finalAmount = formType === '매수신청대리' ? Math.abs(proxyProfit) : rawAmount;
      const finalDirection = formType === '매수신청대리' && proxyProfit < 0 ? 'expense' : undefined;
      await api.sales.create({
        type: formType, type_detail: formType === '기타' ? formTypeDetail : (formType === '매수신청대리' ? `대리비용 ${proxyCost.toLocaleString()}원 / 수익 ${proxyProfit >= 0 ? '' : '-'}${Math.abs(proxyProfit).toLocaleString()}원` : rateDeviationReason),
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

  // 명도계약 fetch — 매출 합계와 무관, 표시 전용
  useEffect(() => {
    if (salesTab !== 'myungdo') return;
    setMyungdoLoading(true);
    api.cases.list({ limit: 500 })
      .then((r: any) => setMyungdoCases(r.cases || []))
      .catch(() => setMyungdoCases([]))
      .finally(() => setMyungdoLoading(false));
  }, [salesTab]);
  // 페이지 진입 시 sourcePage='sales' (모든 API 요청 헤더에 X-Source-Page 자동 첨부)
  useEffect(() => { setSourcePage('sales'); }, []);

  useEffect(() => {
    if (salesTab !== 'auditlog' || !canViewAuditLog) return;
    (async () => {
      try {
        const res = await api.sales.activityLogs({
          month: auditMonth || undefined,
          action: auditAction || undefined,
          actor_id: auditActor || undefined,
          limit: 300,
          source_page: 'sales',  // 업무성과 페이지 활동만 표시
        }) as any;
        setAuditLogs(res.logs || []);
      } catch { setAuditLogs([]); }
    })();
  }, [salesTab, auditMonth, auditAction, auditActor, canViewAuditLog]);

  const resignedWithSales = new Set(records.filter(r => r.user_id).map(r => r.user_id));
  const filteredMembers = (filterBranch ? members.filter(m => m.branch === filterBranch) : members)
    .filter(m => m.role !== 'master')
    .filter(m => (m.role as string) !== 'resigned' || resignedWithSales.has(m.id));
  const memberOpts = filteredMembers.map(m => ({ value: m.id, label: `${m.name} (${m.department})${(m.role as string) === 'resigned' ? ' [퇴사]' : ''}` }));
  const branchOpts = BRANCHES.map(b => ({ value: b, label: b }));

  // 지사 + 유형 + 담당자 + 상태 필터 적용된 records
  // 지사 집계는 attribution_branch(매출 귀속 지사)가 있으면 그걸 우선 사용
  const effectiveBranch = (r: SalesRecord) => r.attribution_branch || r.branch;
  let branchRecords = filterBranch ? records.filter(r => effectiveBranch(r) === filterBranch) : records;
  if (filterUser) branchRecords = branchRecords.filter(r => r.user_id === filterUser);
  if (filterType) branchRecords = branchRecords.filter(r => r.type === filterType);
  if (filterStatus === 'confirm_waiting') branchRecords = branchRecords.filter(r => CONFIRM_WAITING_STATUSES.includes(r.status));
  else if (filterStatus === 'missing_action') branchRecords = branchRecords.filter(isMissingAction);
  else if (filterStatus) branchRecords = branchRecords.filter(r => r.status === filterStatus);

  // 동명이인 중복 감지: (이름 + 전화번호)가 allRecords에서 2건+인 경우
  const duplicateKeys = new Set<string>();
  const dupCounter = new Map<string, number>();
  allRecords.forEach(r => {
    if (!r.client_name || !r.client_phone) return;
    const key = `${r.client_name}|${r.client_phone}`;
    dupCounter.set(key, (dupCounter.get(key) || 0) + 1);
  });
  dupCounter.forEach((cnt, k) => { if (cnt >= 2) duplicateKeys.add(k); });
  const isDuplicate = (r: SalesRecord) => !!(r.client_name && r.client_phone && duplicateKeys.has(`${r.client_name}|${r.client_phone}`));

  // 계약건수: 2개월 기준 (랭킹 데이터 활용), 220만원 이상이면 2건으로 카운트, exclude_from_count=1은 제외
  const contractCountSource = rankingRecords.length > 0 ? rankingRecords : branchRecords;
  let contractCountFiltered = filterBranch
    ? contractCountSource.filter(r => r.branch === filterBranch)
    : contractCountSource;
  if (filterUser) contractCountFiltered = contractCountFiltered.filter(r => r.user_id === filterUser);
  const contractCount = calculateContractCount(contractCountFiltered);
  // 확정매출/카드대기/입금신청: 공급가액 기준 (÷1.1)
  const toSupply = (amount: number) => Math.round(amount / 1.1);
  const confirmedTotal = branchRecords.filter(r => r.status === 'confirmed').reduce((sum, r) => sum + toSupply(r.amount), 0);
  const cardPendingTotal = branchRecords.filter(r => r.status === 'card_pending').reduce((sum, r) => sum + toSupply(r.amount), 0);
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
          {canDepositUpload && (
            <button className="btn btn-sm" onClick={() => setShowDepositForm(true)}>입금등록</button>
          )}
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="sales-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #1a73e8' }}>
          <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>계약건수 <span style={{ fontSize: '0.65rem', color: '#9aa0a6' }}>({rankingYearly ? `${new Date().getFullYear()}년` : `${rankingPeriodIdx * 2 + 1}~${rankingPeriodIdx * 2 + 2}월`})</span></div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1a73e8' }}>{contractCount}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>건</span></div>
        </div>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #188038' }}>
          <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>확정매출</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#188038' }}>{formatCurrency(confirmedTotal)}</div>
        </div>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #7b1fa2' }}>
          <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>카드대기</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#7b1fa2' }}>{formatCurrency(cardPendingTotal)}</div>
        </div>
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #e65100' }}>
          <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>입금신청</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#e65100' }}>{formatCurrency(pendingTotal)}</div>
        </div>
      </div>
      {/* 지사별 요약 (전체 지사 선택 시) */}
      {!filterBranch && (isAdminPlus || isAccountant || isDirector) && (() => {
        const allRecs = filterType ? records.filter(r => r.type === filterType) : records;
        if (filterStatus) return null;
        const branchSet = [...new Set(allRecs.map(r => effectiveBranch(r)).filter(Boolean))].sort();
        if (branchSet.length <= 1) return null;
        return (
          <div className="card" style={{ padding: 0, marginBottom: 20, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', cursor: 'pointer', background: '#f8f9fa' }}
              onClick={() => setShowBranchSummary(!showBranchSummary)}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#3c4043' }}>지사별 현황</span>
              {showBranchSummary ? <ChevronUp size={16} color="#5f6368" /> : <ChevronDown size={16} color="#5f6368" />}
            </div>
            {showBranchSummary && (
              <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e8eaed', color: '#5f6368' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>지사</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600, color: '#188038' }}>확정매출</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600, color: '#7b1fa2' }}>카드대기</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600, color: '#e65100' }}>입금신청</th>
                  </tr>
                </thead>
                <tbody>
                  {branchSet.map(b => {
                    const br = allRecs.filter(r => effectiveBranch(r) === b);
                    const c = br.filter(r => r.status === 'confirmed').reduce((s, r) => s + toSupply(r.amount), 0);
                    const cp = br.filter(r => r.status === 'card_pending').reduce((s, r) => s + toSupply(r.amount), 0);
                    const p = br.filter(r => r.status === 'pending').reduce((s, r) => s + toSupply(r.amount), 0);
                    return (
                      <tr key={b} style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }} onClick={() => setFilterBranch(b)}>
                        <td style={{ padding: '6px 8px', fontWeight: 600 }}>{b}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#188038', fontWeight: 600 }}>{formatCurrency(c)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#7b1fa2', fontWeight: 600 }}>{cp > 0 ? formatCurrency(cp) : '-'}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#e65100', fontWeight: 600 }}>{p > 0 ? formatCurrency(p) : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}

      {/* 전체 지사 개인별 계약건수 랭킹 (전 직원 열람) */}
      {(() => {
        // 서버 집계 결과 사용 — 개인 매출 레코드는 노출하지 않음
        const sorted = rankingData.map(r => ({
          name: r.user_name || '미확인',
          branch: r.eff_branch || '',
          position: r.position || '',
          count: r.count,
          totalAmount: r.total_amount,
        }));
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
      <div className="filter-bar sales-filter-bar" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="month" className="form-input" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={{ width: 140 }} title="시작월" />
          <span style={{ color: '#9aa0a6' }}>~</span>
          <input type="month" className="form-input" value={filterMonthEnd} onChange={(e) => setFilterMonthEnd(e.target.value)} style={{ width: 140 }} title="종료월 (비워두면 단일월)" placeholder="종료월" />
        </div>
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
        <div style={{ minWidth: 110 }}>
          <Select size="sm" options={[
            { value: '', label: '전체 상태' },
            { value: 'confirm_waiting', label: '확인대기' },
            { value: 'confirmed', label: '확정매출' },
            { value: 'card_pending', label: '카드대기' },
            { value: 'pending', label: '입금신청' },
            { value: 'refund_requested', label: '환불신청' },
            { value: 'refunded', label: '환불완료' },
            { value: 'missing_action', label: '미작성 액션' },
          ]}
            value={[
              { value: 'confirm_waiting', label: '확인대기' },
              { value: 'confirmed', label: '확정매출' },
              { value: 'card_pending', label: '카드대기' },
              { value: 'pending', label: '입금신청' },
              { value: 'refund_requested', label: '환불신청' },
              { value: 'refunded', label: '환불완료' },
              { value: 'missing_action', label: '미작성 액션' },
            ].find(o => o.value === filterStatus) || { value: '', label: '전체 상태' }}
            onChange={(o: any) => setFilterStatus(o?.value || '')} placeholder="상태" isClearable />
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
          <button className={`premium-filter-btn ${salesTab === 'myungdo' ? 'active' : ''}`} onClick={() => setSalesTab('myungdo')} title="외부 명승 사건 (매출 합계와 별개)">
            명도계약
          </button>
          {canDepositUpload && (
            <button className={`premium-filter-btn ${salesTab === 'upload' ? 'active' : ''}`} onClick={() => setSalesTab('upload')}>
              <Upload size={14} style={{ marginRight: 4 }} /> 엑셀 업로드
            </button>
          )}
          {canViewAuditLog && (
            <button className={`premium-filter-btn ${salesTab === 'auditlog' ? 'active' : ''}`} onClick={() => setSalesTab('auditlog')}>
              활동 이력
            </button>
          )}
        </div>
        {(salesTab === 'list' || salesTab === 'activity') && (
          <input className="form-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="계약자, 담당자, 입금자, 번호 검색" style={{ width: 220, fontSize: '0.82rem', padding: '6px 10px' }} />
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
          const totalAmount = clientSales.filter(r => r.status === 'confirmed' || r.status === 'card_pending').reduce((s, r) => s + r.amount, 0);
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

      {/* ━━━ 명도계약 탭 (외부 명승 사건 — 매출 합계와 분리, 담당자별 그룹화) ━━━ */}
      {salesTab === 'myungdo' && (() => {
        // 조정 금액 계산: 정액제 -150,000 / 실비제 ÷1.1 (부가세 제외)
        const adjustedFeeOf = (r: any) => r.fee_type === 'fixed'
          ? Math.max(0, (r.fee_amount || 0) - 150_000)
          : Math.round((r.fee_amount || 0) / 1.1);

        // 권한별 가시 범위 — 일반 직원은 본인 컨설턴트로 등록된 사건만
        const myId = currentUser?.id;
        const role = currentUser?.role || '';
        const adminPlus = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst', 'director', 'manager'].includes(role);
        let scopedCases = myungdoCases;
        if (!adminPlus && myId) {
          scopedCases = myungdoCases.filter((r: any) => r.consultant_user_id === myId);
        }

        // 검색/지사 필터
        const filtered = scopedCases.filter((r: any) => {
          if (filterUser && r.consultant_user_id !== filterUser) return false;
          if (filterBranch && r.consultant_branch !== filterBranch) return false;
          if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const hay = `${r.consultant_name || ''} ${r.client_name || ''} ${r.manager_name || ''} ${r.external_id || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

        // 담당자(컨설턴트) 별 그룹화
        const byConsultant = new Map<string, { id: string | null; name: string; position: string | null; branch: string | null; department: string | null; rows: any[]; totalRaw: number; totalAdjusted: number }>();
        filtered.forEach((r: any) => {
          const key = r.consultant_user_id || `name:${r.consultant_name || '미지정'}`;
          if (!byConsultant.has(key)) {
            byConsultant.set(key, {
              id: r.consultant_user_id || null,
              name: r.consultant_name || '미지정',
              position: r.consultant_position || null,
              branch: r.consultant_branch || null,
              department: r.consultant_department || null,
              rows: [], totalRaw: 0, totalAdjusted: 0,
            });
          }
          const g = byConsultant.get(key)!;
          g.rows.push(r);
          g.totalRaw += r.fee_amount || 0;
          g.totalAdjusted += adjustedFeeOf(r);
        });
        const groups = Array.from(byConsultant.values()).sort((a, b) => b.totalAdjusted - a.totalAdjusted);

        const totalCases = filtered.length;
        const totalRawSum = filtered.reduce((s: number, r: any) => s + (r.fee_amount || 0), 0);
        const totalAdjustedSum = filtered.reduce((s: number, r: any) => s + adjustedFeeOf(r), 0);

        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, color: '#5f6368' }}>표시 사건</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1a73e8' }}>{totalCases}건</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, color: '#5f6368' }}>수임료 원본 합계</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#5f6368' }}>{formatCurrency(totalRawSum)}</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, color: '#5f6368' }}>성과금 산정 매출 (조정 후)</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#188038' }}>{formatCurrency(totalAdjustedSum)}</div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, color: '#5f6368' }}>담당자 수</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#7b1fa2' }}>{groups.length}명</div>
              </div>
            </div>
            {myungdoLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#5f6368' }}>로딩중...</div>
            ) : groups.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#9aa0a6' }}>표시할 명도 사건이 없습니다.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {groups.map((g) => (
                  <details key={g.id || g.name} className="card" style={{ padding: 10 }} open={groups.length <= 3}>
                    <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                        <strong style={{ fontSize: 14 }}>{g.name}</strong>
                        {g.position && <span style={{ fontSize: 11, color: '#5f6368' }}>{g.position}</span>}
                        {g.branch && <span style={{ fontSize: 11, color: '#9aa0a6' }}>{g.branch}{g.department ? '·' + g.department : ''}</span>}
                        {!g.id && <span style={{ fontSize: 10, color: '#d93025' }}>(미매칭)</span>}
                      </span>
                      <span style={{ fontSize: 12 }}>
                        <span style={{ marginRight: 14, color: '#5f6368' }}>{g.rows.length}건</span>
                        <span style={{ marginRight: 14, color: '#5f6368' }}>원본 {formatCurrency(g.totalRaw)}</span>
                        <strong style={{ color: '#188038' }}>조정 {formatCurrency(g.totalAdjusted)}</strong>
                      </span>
                    </summary>
                    <div className="table-wrapper" style={{ marginTop: 8 }}>
                      <table className="data-table" style={{ fontSize: '0.78rem' }}>
                        <thead>
                          <tr>
                            <th>등록일</th>
                            <th>구간</th>
                            <th>위임인</th>
                            <th>담당자 (명도팀)</th>
                            <th>유형</th>
                            <th style={{ textAlign: 'right' }}>수임료(원본)</th>
                            <th style={{ textAlign: 'right' }}>조정 후 (성과금기준)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((r: any) => (
                            <tr key={r.id}>
                              <td style={{ fontSize: 11 }}>{(r.registered_at || '').slice(0, 10)}</td>
                              <td style={{ fontSize: 11, color: '#5f6368' }}>{r.bimonthly_period?.replace('_', '~')}</td>
                              <td>{r.client_name}</td>
                              <td style={{ fontSize: 11, color: '#5f6368' }}>{r.manager_name}{r.manager_branch ? ' · ' + r.manager_branch : ''}</td>
                              <td>
                                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, background: r.fee_type === 'fixed' ? '#e8f0fe' : '#fff3e0', color: r.fee_type === 'fixed' ? '#1a73e8' : '#e65100' }}>
                                  {r.fee_type === 'fixed' ? '정액' : '실비'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right', color: '#5f6368' }}>{formatCurrency(r.fee_amount)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700, color: '#188038' }}>{formatCurrency(adjustedFeeOf(r))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </>
        );
      })()}

      {/* ━━━ 엑셀 업로드 탭 [6-4] ━━━ */}
      {salesTab === 'upload' && canDepositUpload && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '1rem' }}>매출 엑셀 업로드 (실적표)</h3>

          {/* 양식 안내 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.85rem', color: '#3c4043', fontWeight: 600, marginBottom: 8 }}>열 구성 (A~S)</div>
            <div className="table-wrapper" style={{ fontSize: '0.75rem' }}>
              <table className="data-table" style={{ fontSize: '0.75rem' }}>
                <thead>
                  <tr>
                    <th>열</th><th>내용</th><th>처리</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>A</td><td>날짜</td><td>환불일자(환불건만 사용)</td></tr>
                  <tr><td>B</td><td>지사</td><td>본사→의정부, 강남지사→서초, 대전→대전, 부산→부산</td></tr>
                  <tr><td>C</td><td>담당자</td><td>이름으로 사용자 매칭</td></tr>
                  <tr><td>D</td><td>고객명</td><td>입금자명 매칭에 사용</td></tr>
                  <tr><td>E</td><td>전화번호</td><td>고객 전화번호</td></tr>
                  <tr><td>F</td><td>무시</td><td>—</td></tr>
                  <tr><td>G</td><td>계약유형</td><td>컨설팅계약→계약, 낙찰수수료→낙찰, 권리분석의뢰→권리분석보증서, 매수신청대리, 중개수수료→중개, 그 외→기타</td></tr>
                  <tr><td>H</td><td>계약일</td><td>contract_date (없으면 L열 입금일로 대체)</td></tr>
                  <tr><td>I</td><td>매출액(VAT포함)</td><td style={{ color: '#d93025' }}>음수면 전달 환불 공제로 처리</td></tr>
                  <tr><td>J</td><td>실수익</td><td>무시</td></tr>
                  <tr><td>K</td><td>결제일</td><td>카드 결제건의 고객 결제일 (참고용)</td></tr>
                  <tr><td>L</td><td><strong>입금일</strong></td><td><strong>이체→deposit_date, 카드→card_deposit_date</strong></td></tr>
                  <tr><td>M</td><td>증빙</td><td>"현금영수증" 포함 시 receipt_type 자동 설정</td></tr>
                  <tr><td>N</td><td>결제방식</td><td>카드/이체</td></tr>
                  <tr><td>S</td><td>비고</td><td>010-****-**** → 현금영수증 번호</td></tr>
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#3c4043', marginTop: 10, lineHeight: 1.6, background: '#fffbe6', padding: '10px 12px', borderRadius: 6, border: '1px solid #f4d03f' }}>
              <strong>환불 판별 (3가지 중 하나라도 해당 시 환불 처리):</strong><br />
              1) L 또는 M열에 <strong>"환불"</strong> 또는 <strong>"카드취소"</strong> 텍스트<br />
              2) 셀이 <span style={{ color: '#d93025', fontWeight: 700 }}>빨간색</span>으로 표시됨<br />
              3) I열 매출액이 <strong>음수</strong> (전달 환불 공제)<br />
              <br />
              <strong style={{ color: '#1a73e8' }}>환불 매칭:</strong> 기존 매출에서 <strong>고객명 + 금액 + 결제방식</strong> 일치건을 찾아 status=환불완료로 업데이트. 매칭 실패 또는 다건 매칭 시 스킵됩니다.<br />
              <strong style={{ color: '#d93025' }}>※ 알림톡은 일괄 업로드 시 발송되지 않습니다.</strong>
            </div>
          </div>

          {/* 파일 업로드 */}
          <input type="file" accept=".xlsx,.xls" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const XLSX = await import('xlsx');
              const data = await file.arrayBuffer();
              const wb = XLSX.read(data, { type: 'array', cellStyles: true });
              const ws = wb.Sheets[wb.SheetNames[0]];
              if (!ws || !ws['!ref']) { alert('데이터가 없습니다.'); return; }
              const range = XLSX.utils.decode_range(ws['!ref']);

              // 셀 값/색상 읽기 헬퍼
              const getCell = (col: string, row: number): any => ws[col + row];
              const getCellValue = (col: string, row: number): any => {
                const cell = getCell(col, row);
                return cell?.v ?? '';
              };
              const isRedCell = (col: string, row: number): boolean => {
                const cell = getCell(col, row);
                if (!cell?.s) return false;
                // 글자색 빨강 체크
                const fg = cell.s.color || cell.s.fgColor;
                const rgb = fg?.rgb || '';
                if (typeof rgb === 'string') {
                  const hex = rgb.toUpperCase().replace('#', '').slice(-6);
                  // FF RRGGBB 또는 RRGGBB
                  if (/^[0-9A-F]{6}$/.test(hex)) {
                    const r = parseInt(hex.slice(0, 2), 16);
                    const g = parseInt(hex.slice(2, 4), 16);
                    const b = parseInt(hex.slice(4, 6), 16);
                    // 빨강 계열: R 높고 G, B 낮음
                    if (r >= 180 && g <= 100 && b <= 100) return true;
                  }
                }
                return false;
              };

              // 날짜 정규화 헬퍼
              const normD = (v: any): string => {
                if (v === null || v === undefined || v === '') return '';
                if (typeof v === 'number') {
                  const d = new Date((v - 25569) * 86400000);
                  return d.toISOString().slice(0, 10);
                }
                return String(v).trim().slice(0, 10);
              };
              const isDateLike = (v: any): boolean => {
                if (v === null || v === undefined || v === '') return false;
                if (typeof v === 'number') return v > 1 && v < 100000;
                return /^\d{4}-\d{2}-\d{2}/.test(String(v));
              };

              const payloadRecords: any[] = [];
              for (let r = range.s.r + 1; r <= range.e.r; r++) {  // 헤더 스킵
                const rowNo = r + 1;  // 엑셀은 1-based
                const dateA = getCellValue('A', rowNo);
                const branchB = String(getCellValue('B', rowNo) || '').trim();
                const nameC = String(getCellValue('C', rowNo) || '').trim();
                const clientD = String(getCellValue('D', rowNo) || '').trim();
                const phoneE = String(getCellValue('E', rowNo) || '').trim();
                const typeG = String(getCellValue('G', rowNo) || '').trim();
                const dateH = getCellValue('H', rowNo);
                const amountI = getCellValue('I', rowNo);
                const dateK = getCellValue('K', rowNo);
                const dateL = getCellValue('L', rowNo);  // L = 입금일 (모든 행에 채워짐)
                const evidM = String(getCellValue('M', rowNo) || '').trim();
                const payN = String(getCellValue('N', rowNo) || '').trim();
                const memoS = String(getCellValue('S', rowNo) || '').trim();

                // 완전 빈 행 스킵 (고객명·금액·담당자 모두 없음)
                if (!clientD && !amountI && !nameC) continue;

                // 환불 텍스트 감지 — L 또는 M열에 환불/카드취소 (L이 날짜면 무시, 텍스트만 검사)
                const lStr = typeof dateL === 'string' ? dateL : '';
                const mText = evidM;
                let refundMark: 'refund' | 'card_cancel' | '' = '';
                if (/카드취소/.test(lStr) || /카드취소/.test(mText)) refundMark = 'card_cancel';
                else if (/환불/.test(lStr) || /환불/.test(mText)) refundMark = 'refund';

                // 빨간색 셀 감지 (I, L, M, N열 또는 D(고객명) 중 하나라도 빨강이면 환불)
                const hasRed = isRedCell('I', rowNo) || isRedCell('L', rowNo) || isRedCell('M', rowNo) || isRedCell('N', rowNo) || isRedCell('D', rowNo);

                // L열 입금일은 날짜인 경우만 사용
                const depositL = isDateLike(dateL) ? normD(dateL) : '';

                payloadRecords.push({
                  row_no: rowNo,
                  date_a: normD(dateA),
                  branch_raw: branchB,
                  user_name: nameC,
                  client_name: clientD,
                  client_phone: phoneE,
                  type_raw: typeG,
                  contract_date: normD(dateH),
                  amount: Number(String(amountI ?? 0).replace(/[^0-9.\-]/g, '')) || 0,
                  pay_date: normD(dateK),          // K열 카드 고객결제일
                  card_approve_date: depositL,     // L열 입금일 (★ 모든 결제건 공통)
                  evidence_raw: evidM,
                  payment_raw: payN,
                  memo_s: memoS,
                  refund_mark: refundMark,
                  has_red_color: hasRed,
                });
              }

              if (payloadRecords.length === 0) { alert('업로드할 행이 없습니다.'); return; }

              const refundRows = payloadRecords.filter(r => r.refund_mark || r.has_red_color || r.amount < 0);
              const normalRows = payloadRecords.length - refundRows.length;

              let msg = `총 ${payloadRecords.length}개 행 분석 완료\n`;
              msg += `• 일반 매출: ${normalRows}건\n`;
              msg += `• 환불/취소 의심 건: ${refundRows.length}건\n\n`;
              msg += '업로드하시겠습니까?';
              if (!confirm(msg)) return;

              const res = await api.sales.bulkImport(payloadRecords) as any;
              let resultMsg = `✓ 신규 매출 등록: ${res.count}건\n`;
              if (res.refund_count > 0) resultMsg += `✓ 환불 처리: ${res.refund_count}건\n`;
              if (res.skip_counts) {
                const sc = res.skip_counts;
                const detail = [];
                if (sc.no_client) detail.push(`고객명 없음(빈행): ${sc.no_client}`);
                if (sc.zero_amount) detail.push(`금액 0: ${sc.zero_amount}`);
                if (sc.duplicate) detail.push(`중복: ${sc.duplicate}`);
                if (sc.no_origin) detail.push(`환불 원본 없음: ${sc.no_origin}`);
                if (sc.multi_match) detail.push(`다건매칭: ${sc.multi_match}`);
                if (detail.length) resultMsg += `\n▶ 스킵 유형별: ${detail.join(' / ')}`;
              }
              if (res.skipped?.length > 0) {
                resultMsg += `\n\n⚠ 상세 스킵 ${res.skipped.length}건:\n${res.skipped.slice(0, 30).join('\n')}`;
                if (res.skipped.length > 30) resultMsg += `\n... 외 ${res.skipped.length - 30}건`;
              }
              alert(resultMsg);
              setSalesTab('list');
              load();
            } catch (err: any) { alert('업로드 실패: ' + err.message); }
            e.target.value = '';
          }} />
        </div>
      )}

      {/* ━━━ 활동 로그 탭 (수정·삭제·상태변경 감사 이력) ━━━ */}
      {salesTab === 'auditlog' && canViewAuditLog && (() => {
        const ACTION_LABELS: Record<string, string> = {
          update: '수정',
          delete: '삭제',
          status_change: '상태변경',
          refund_approve: '환불승인',
          deposit_claim_approve: '입금신청승인',
          deposit_delete: '입금등록삭제',
          payment_method_change: '결제방법변경',
          memo_add: '메모추가',
          memo_update: '메모수정',
          memo_delete: '메모삭제',
        };
        const ACTION_COLOR: Record<string, string> = {
          update: '#1a73e8', delete: '#d93025', status_change: '#188038',
          refund_approve: '#f9ab00', deposit_claim_approve: '#188038',
          deposit_delete: '#d93025', payment_method_change: '#1a73e8',
          memo_add: '#9333ea', memo_update: '#9333ea', memo_delete: '#d93025',
        };
        const actorOptions = Array.from(new Set(auditLogs.map(l => l.actor_id + '|' + (l.actor_display_name || l.actor_name || '?'))))
          .map(s => { const [id, name] = s.split('|'); return { value: id, label: name }; });

        return (
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>활동 이력 (총무·총무보조)</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="month" className="form-input" value={auditMonth}
                  onChange={(e) => setAuditMonth(e.target.value)}
                  style={{ width: 130, fontSize: '0.82rem', padding: '6px 10px' }} />
                <select className="form-input" value={auditAction} onChange={(e) => setAuditAction(e.target.value)}
                  style={{ width: 140, fontSize: '0.82rem', padding: '6px 10px' }}>
                  <option value="">전체 작업</option>
                  {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select className="form-input" value={auditActor} onChange={(e) => setAuditActor(e.target.value)}
                  style={{ width: 140, fontSize: '0.82rem', padding: '6px 10px' }}>
                  <option value="">전체 작업자</option>
                  {actorOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button className="btn btn-sm" onClick={() => { setAuditAction(''); setAuditActor(''); }}>초기화</button>
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#9aa0a6', marginBottom: 10 }}>
              총무·총무보조의 매출 수정/삭제/상태변경 이력입니다. 총 {auditLogs.length}건
            </div>
            {auditLogs.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: '#9aa0a6', fontSize: '0.85rem' }}>조회된 기록이 없습니다.</div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table" style={{ fontSize: '0.82rem' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 140, whiteSpace: 'nowrap' }}>일시</th>
                      <th style={{ width: 100, whiteSpace: 'nowrap' }}>작업자</th>
                      <th style={{ width: 90, whiteSpace: 'nowrap' }}>역할</th>
                      <th style={{ width: 110, whiteSpace: 'nowrap' }}>작업</th>
                      <th style={{ minWidth: 180 }}>대상</th>
                      <th>변경 내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((l) => {
                      const isOpen = expandedLogId === l.id;
                      return (
                        <React.Fragment key={l.id}>
                          <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedLogId(isOpen ? null : l.id)}>
                            <td style={{ whiteSpace: 'nowrap' }}>{(l.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{l.actor_display_name || l.actor_name || '?'}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{l.actor_role === 'accountant' ? '총무' : l.actor_role === 'accountant_asst' ? '총무보조' : l.actor_role}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 4, background: (ACTION_COLOR[l.action] || '#5f6368') + '22', color: ACTION_COLOR[l.action] || '#5f6368', fontWeight: 600 }}>
                                {ACTION_LABELS[l.action] || l.action}
                              </span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>{l.target_label}</td>
                            <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 400, color: '#3c4043' }}>{l.diff_summary}</td>
                          </tr>
                          {isOpen && (l.before_snapshot || l.after_snapshot) && (
                            <tr>
                              <td colSpan={6} style={{ background: '#f8f9fa', padding: 12 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.75rem' }}>
                                  {l.before_snapshot && (
                                    <div>
                                      <div style={{ fontWeight: 600, marginBottom: 4, color: '#d93025' }}>변경 전</div>
                                      <pre style={{ margin: 0, padding: 8, background: '#fff', border: '1px solid #e8eaed', borderRadius: 4, overflow: 'auto', maxHeight: 300, fontSize: '0.72rem' }}>{(() => { try { return JSON.stringify(JSON.parse(l.before_snapshot), null, 2); } catch { return l.before_snapshot; } })()}</pre>
                                    </div>
                                  )}
                                  {l.after_snapshot && (
                                    <div>
                                      <div style={{ fontWeight: 600, marginBottom: 4, color: '#188038' }}>변경 후</div>
                                      <pre style={{ margin: 0, padding: 8, background: '#fff', border: '1px solid #e8eaed', borderRadius: 4, overflow: 'auto', maxHeight: 300, fontSize: '0.72rem' }}>{(() => { try { return JSON.stringify(JSON.parse(l.after_snapshot), null, 2); } catch { return l.after_snapshot; } })()}</pre>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

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
              <input className="form-input" value={formClientName} onChange={(e) => setFormClientName(e.target.value)} style={{ width: '100%' }} placeholder="계약자명" />
              {formType === '낙찰' && formClientName && (() => {
                const prior = records.find(r => r.type === '계약' && r.client_name === formClientName && (r.appraisal_rate > 0 || r.winning_rate > 0));
                return prior ? (
                  <div style={{ marginTop: 4, padding: '4px 8px', background: '#fff8e1', borderRadius: 4, fontSize: '0.72rem', color: '#7b5e00' }}>
                    📋 계약 조건: 감정가 {prior.appraisal_rate}% / 낙찰가 {prior.winning_rate}%
                  </div>
                ) : null;
              })()}
            </div>
            {formType === '계약' && (
              <div><label className="form-label">전화번호 <span style={{ color: '#d93025' }}>*</span> <span style={{ fontSize: '0.7rem', color: '#9aa0a6', fontWeight: 400 }}>(동명이인/중복 방지, 필수)</span></label>
                <input className="form-input" value={formPhone} inputMode="tel"
                  onChange={(e) => setFormPhone(formatPhone(e.target.value))}
                  style={{ width: '100%' }} placeholder="010-0000-0000" maxLength={13} /></div>
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

      {/* 입금등록 폼 (총무 전용) */}
      {showDepositForm && canDepositUpload && (
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
      {(() => {
        // 표시 필터:
        //  - pending: 전체 공지 (모두 노출)
        //  - claimed: 클레임한 본인(claimed_by === currentUser) 또는 총무/master만 노출
        //  - approved: 숨김
        const visibleDeposits = deposits.filter(d => {
          if (d.status === 'approved') return false;
          if (d.status === 'claimed') {
            return d.claimed_by === currentUser?.id || canDepositUpload;
          }
          return true; // pending
        });
        if (visibleDeposits.length === 0) return null;
        return (
        <div className="card" style={{ marginBottom: 20, padding: '16px 20px' }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 12, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={16} color="#1a73e8" /> 입금 등록 내역
            <span style={{ fontSize: '0.78rem', color: '#9aa0a6', fontWeight: 400 }}>({visibleDeposits.length}건)</span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {visibleDeposits.map(dep => {
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
                      {canDepositUpload && (
                        <button className="btn btn-sm btn-danger" style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                          onClick={async () => {
                            if (!confirm(`입금등록 "${dep.depositor} ${formatCurrency(dep.amount)}"을(를) 삭제하시겠습니까?${dep.status === 'claimed' ? '\n\n※ 담당자가 클레임한 건입니다. 삭제해도 매출은 유지됩니다.' : ''}`)) return;
                            try { await api.sales.deleteDeposit(dep.id); load(true); } catch (err: any) { alert(err.message); }
                          }}>
                          <Trash2 size={12} /> 삭제
                        </button>
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
        );
      })()}

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
                { key: 'payment_type', label: '결제' },
                { key: 'deposit_date', label: '결제일' },
                { key: 'contract_submitted', label: '계약서/물건보고서' },
                { key: 'status', label: '상태' },
              ].map(col => (
                <th key={col.key} onClick={() => toggleSort(col.key)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  {col.label} {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
              <th style={{ whiteSpace: 'nowrap' }}>액션</th>
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
              const qDigits = q.replace(/\D/g, '');
              const phoneDigits = (r.client_phone || '').replace(/\D/g, '');
              return (r.client_name || '').toLowerCase().includes(q)
                || (r.user_name || '').toLowerCase().includes(q)
                || (r.depositor_name || '').toLowerCase().includes(q)
                || (qDigits && phoneDigits.includes(qDigits));
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
                  onMouseEnter={(e) => { if ((isAccountant || isMaster) && adminMemosMap[r.id]) setHoveredMemoRow({ id: r.id, x: e.clientX, y: e.clientY }); }}
                  onMouseMove={(e) => { if (hoveredMemoRow && hoveredMemoRow.id === r.id) setHoveredMemoRow({ id: r.id, x: e.clientX, y: e.clientY }); }}
                  onMouseLeave={() => { if (hoveredMemoRow && hoveredMemoRow.id === r.id) setHoveredMemoRow(null); }}
                  style={{ cursor: 'pointer', ...(isRefunded ? { color: '#d93025', textDecoration: 'line-through', background: '#fef7f6' } : r.type === '낙찰' ? { background: '#f3f0ff' } : r.type === '계약' ? { background: '#f0f7ff' } : {}) }}>
                  {canDeleteAccounting && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>}
                  <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{r.contract_date}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.user_name}</td>
                  <td style={{ whiteSpace: 'nowrap', maxWidth: 110 }}>
                    <div style={{ fontSize: '0.78rem' }}>{r.type}</div>
                    {r.type === '기타' && r.type_detail && (
                      <div style={{ color: '#9aa0a6', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.type_detail}>
                        {r.type_detail}
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.client_name + (r.client_phone ? ' / ' + r.client_phone : '') + (r.depositor_different === 1 && r.depositor_name ? ' / 입금자: ' + r.depositor_name : '')}>
                    {r.client_name}
                    {isDuplicate(r) && <span style={{ fontSize: '0.66rem', padding: '0 4px', borderRadius: 6, background: '#fce4ec', color: '#d93025', fontWeight: 700, marginLeft: 4 }}>중복</span>}
                    {r.exclude_from_count ? <span style={{ fontSize: '0.66rem', padding: '0 4px', borderRadius: 6, background: '#f5f5f5', color: '#5f6368', marginLeft: 3 }}>미포함</span> : null}
                    {r.depositor_different === 1 && r.depositor_name && <span style={{ fontSize: '0.7rem', color: '#e65100', marginLeft: 4 }}>({r.depositor_name})</span>}
                  </td>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCurrency(r.amount)}</td>
                  <td style={{ fontSize: '0.72rem', whiteSpace: 'nowrap', textAlign: 'center' }}>
                    {r.payment_type ? (
                      <span style={{ padding: '1px 6px', borderRadius: 6, fontWeight: 600,
                        background: r.payment_type === '카드' ? '#f3e5f5' : '#e8f0fe',
                        color: r.payment_type === '카드' ? '#7b1fa2' : '#1a73e8' }}>
                        {r.payment_type}
                      </span>
                    ) : <span style={{ color: '#dadce0' }}>-</span>}
                  </td>
                  <td style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', color: r.deposit_date ? '#188038' : '#9aa0a6' }}>{r.deposit_date || '-'}</td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
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
                        {r.contract_not_reason && (
                          <div style={{ fontSize: '0.65rem', color: '#5f6368', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.contract_not_reason}>
                            {r.contract_not_reason}
                          </div>
                        )}
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
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>{st.label}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {/* 입금확인/결제확인 (회계) */}
                      {r.status === 'pending' && canApproveAccounting && !isConfirming && (
                        <button className="btn btn-sm btn-success" onClick={() => { setConfirmingId(r.id); setConfirmDepositDate(new Date().toISOString().slice(0, 10)); }}>
                          <CheckCircle size={13} /> 결제확인
                        </button>
                      )}
                      {isConfirming && (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input type="date" className="form-input" min="2020-01-01" max="2099-12-31" value={confirmDepositDate} onChange={(e) => setConfirmDepositDate(e.target.value)} style={{ fontSize: '0.78rem', padding: '4px 6px' }} />
                          <button className="btn btn-sm btn-success" onClick={() => handleConfirm(r.id)}>확인</button>
                          <button className="btn btn-sm" onClick={() => setConfirmingId(null)}>취소</button>
                        </div>
                      )}
                      {/* 세금계산서/현금영수증 발행 기록 (이체/현금 — 총무 메모용) */}
                      {r.payment_type === '이체' && r.status !== 'refunded' && canApproveAccounting && (() => {
                        const taxType = r.tax_invoice_type || '';
                        const taxDate = r.tax_invoice_date || '';
                        const isSet = !!taxDate;
                        const canEditInvoice = role === 'master' || role === 'accountant' || role === 'accountant_asst';
                        const draft = invoiceDrafts[r.id] ?? '';
                        return (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.68rem', color: '#5f6368', whiteSpace: 'nowrap' }}>증빙</span>
                            {isSet ? (
                              <>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#188038', padding: '2px 6px', background: '#e8f5e9', borderRadius: 6 }}>{taxDate}</span>
                                {canEditInvoice && (
                                  <button className="btn btn-sm" style={{ fontSize: '0.6rem', padding: '1px 4px', color: '#9aa0a6' }}
                                    onClick={async () => {
                                      if (!confirm('증빙일자를 초기화하시겠습니까?')) return;
                                      try { await api.sales.update(r.id, { tax_invoice_date: '' }); load(true); } catch (err: any) { alert(err.message); }
                                    }}>초기화</button>
                                )}
                              </>
                            ) : (
                              <>
                                <input type="date" className="form-input" value={draft}
                                  min="2020-01-01" max="2099-12-31"
                                  onChange={(e) => setInvoiceDrafts(p => ({ ...p, [r.id]: e.target.value }))}
                                  style={{ fontSize: '0.72rem', padding: '3px 5px', width: 120 }} />
                                <button className="btn btn-sm btn-primary" style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                                  onClick={async () => {
                                    if (!draft) { alert('증빙일자를 선택하세요.'); return; }
                                    const [y] = draft.split('-');
                                    if (!y || y.length !== 4 || Number(y) < 2020 || Number(y) > 2099) { alert('증빙일자 년도는 4자리(2020~2099)로 입력하세요.'); return; }
                                    try {
                                      await api.sales.update(r.id, { tax_invoice_date: draft });
                                      setInvoiceDrafts(p => { const n = { ...p }; delete n[r.id]; return n; });
                                      load(true);
                                    } catch (err: any) { alert(err.message); }
                                  }}>확인</button>
                              </>
                            )}
                            <button className="btn btn-sm" style={{ fontSize: '0.65rem', padding: '2px 6px',
                              background: taxType === '영수' ? '#e8f5e9' : '#fff',
                              color: taxType === '영수' ? '#188038' : '#5f6368',
                              fontWeight: taxType === '영수' ? 700 : 400,
                              border: taxType === '영수' ? '1px solid #81c784' : '1px solid #dadce0' }}
                              onClick={async () => {
                                const next = taxType === '영수' ? '' : '영수';
                                try { await api.sales.update(r.id, { tax_invoice_type: next }); load(true); } catch (err: any) { alert(err.message); }
                              }}>영수</button>
                            <button className="btn btn-sm" style={{ fontSize: '0.65rem', padding: '2px 6px',
                              background: taxType === '계산' ? '#fff3e0' : '#fff',
                              color: taxType === '계산' ? '#e65100' : '#5f6368',
                              fontWeight: taxType === '계산' ? 700 : 400,
                              border: taxType === '계산' ? '1px solid #ffb74d' : '1px solid #dadce0' }}
                              onClick={async () => {
                                const next = taxType === '계산' ? '' : '계산';
                                try { await api.sales.update(r.id, { tax_invoice_type: next }); load(true); } catch (err: any) { alert(err.message); }
                              }}>계산</button>
                          </div>
                        );
                      })()}
                      {/* 카드결제 정산일 (총무 — 결제확인 후 입력) */}
                      {(r.status === 'card_pending' || (r.status === 'confirmed' && r.payment_type === '카드')) && (() => {
                        const settled = !!r.card_deposit_date;
                        const canEditSettle = role === 'master' || role === 'accountant' || role === 'accountant_asst';
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
                                  min="2020-01-01" max="2099-12-31"
                                  onFocus={() => setSettleDate('')}
                                  onChange={(e) => setSettleDate(e.target.value)}
                                  style={{ fontSize: '0.72rem', padding: '3px 5px', width: 120 }} />
                                <button className="btn btn-sm btn-primary" style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                                  onClick={async () => {
                                    if (!settleDate) { alert('정산일을 선택하세요.'); return; }
                                    // 년도 4자리 검증
                                    const [y] = settleDate.split('-');
                                    if (!y || y.length !== 4 || Number(y) < 2020 || Number(y) > 2099) { alert('정산일 년도는 4자리(2020~2099)로 입력하세요.'); return; }
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
          const sorted = [...branchRecords].filter(r => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            const qDigits = q.replace(/\D/g, '');
            const phoneDigits = (r.client_phone || '').replace(/\D/g, '');
            return (r.client_name || '').toLowerCase().includes(q)
              || (r.user_name || '').toLowerCase().includes(q)
              || (r.depositor_name || '').toLowerCase().includes(q)
              || (qDigits && phoneDigits.includes(qDigits));
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
              <div key={r.id} className="sales-card" style={isRefunded ? { color: '#d93025', background: '#fef7f6', borderLeft: '3px solid #d93025' } : r.type === '낙찰' ? { borderLeft: '3px solid #7c4dff' } : r.type === '계약' ? { borderLeft: '3px solid #1a73e8' } : {}}>
                <div className="sales-card-header" onClick={() => toggleExpand(r.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{r.client_name}</span>
                      {isDuplicate(r) && <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 8, background: '#fce4ec', color: '#d93025', fontWeight: 700 }}>중복</span>}
                      {r.exclude_from_count ? <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 8, background: '#f5f5f5', color: '#5f6368' }}>미포함</span> : null}
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
                            <span style={{ color: '#e65100', fontWeight: 600 }} title={r.contract_not_reason || ''}>미제출{r.contract_not_reason ? ` (${r.contract_not_reason})` : ''}</span>
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
        <div className="modal-overlay" onClick={(e) => {
          // 팝업 밖 클릭 시 닫기 방지 (의도치 않은 저장 누락 방지)
          e.stopPropagation();
        }}>
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
                <div>
                  <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>계약자명</span>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {detailRecord.client_name}
                    {isDuplicate(detailRecord) && (
                      <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 8, background: '#fce4ec', color: '#d93025', fontWeight: 700 }}>중복</span>
                    )}
                  </div>
                </div>
                <div>
                  <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>전화번호 <span style={{ fontSize: '0.65rem', color: '#9aa0a6', fontWeight: 400 }}>(동명이인 방지)</span></span>
                  <div style={{ fontWeight: 500, fontFamily: 'monospace' }}>{detailRecord.client_phone || <span style={{ color: '#9aa0a6' }}>-</span>}</div>
                </div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>담당자</span><div>{detailRecord.user_name}</div></div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>금액</span><div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{formatCurrency(detailRecord.amount)}</div></div>
                <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>일자</span><div>{detailRecord.contract_date}</div></div>
                {/* 중복 계약: 계약 미포함 체크박스 (계약 타입만) */}
                {detailRecord.type === '계약' && isDuplicate(detailRecord) && canModifyAccounting && (
                  <div style={{ gridColumn: '1 / -1', background: '#fff8e1', border: '1px solid #f4d03f', borderRadius: 6, padding: '8px 10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', cursor: 'pointer' }}>
                      <input type="checkbox"
                        checked={!!detailRecord.exclude_from_count}
                        onChange={async (e) => {
                          const checked = e.target.checked;
                          try {
                            await api.sales.updateExcludeCount(detailRecord.id, checked);
                            setDetailRecord({ ...detailRecord, exclude_from_count: checked ? 1 : 0 } as any);
                            load(true);
                          } catch (err: any) { alert(err.message); }
                        }} />
                      <span>계약 미포함 (갯수 카운트 제외)</span>
                      <span style={{ fontSize: '0.72rem', color: '#9aa0a6' }}>※ 매출·실적 집계는 유지</span>
                    </label>
                  </div>
                )}
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
                      <div>
                        <span style={{ color: '#e65100', fontWeight: 600 }}>미제출</span>
                        {detailRecord.contract_not_reason && (
                          <div style={{ fontSize: '0.78rem', color: '#5f6368', marginTop: 4, padding: '6px 10px', background: '#fff3e0', borderRadius: 6 }}>
                            사유: {detailRecord.contract_not_reason}
                          </div>
                        )}
                      </div>
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
                {(detailRecord.payment_type || canApproveAccounting || isMaster) && (
                  <div>
                    <span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>결제방식 {!detailRecord.payment_type && <span style={{ color: '#d93025', fontSize: '0.68rem' }}>(미입력)</span>}</span>
                    {(isMaster || canApproveAccounting) ? (
                      <select className="form-input" defaultValue={detailRecord.payment_type || ''} style={{ width: '100%', fontSize: '0.9rem', fontWeight: 600, marginTop: 2 }}
                        onChange={async (e) => {
                          if (!e.target.value) return;
                          try { await api.sales.update(detailRecord.id, { payment_type: e.target.value }); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                        }}>
                        <option value="">선택</option>
                        <option value="이체">이체</option>
                        <option value="카드">카드</option>
                      </select>
                    ) : (
                      <div>{detailRecord.payment_type || '-'}</div>
                    )}
                  </div>
                )}
                {detailRecord.receipt_type && (
                  <div><span style={{ color: '#9aa0a6', fontSize: '0.75rem' }}>지출증빙</span><div>{detailRecord.receipt_type}{detailRecord.receipt_phone ? ` (${detailRecord.receipt_phone})` : ''}</div></div>
                )}
                {detailRecord.payment_type === '카드' && (() => {
                  const settled = !!detailRecord.card_deposit_date;
                  const canEditSettle = role === 'master' || role === 'accountant' || role === 'accountant_asst';
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
              {/* 전화번호 수정 (본인/마스터/총무담당/총무보조 — 확정 매출도 가능) */}
              {(['계약', '낙찰', '권리분석보증서'].includes(detailRecord.type as string)) && (detailRecord.user_id === currentUser?.id || ['master', 'accountant', 'accountant_asst'].includes(role)) && (
                <div style={{ borderTop: '1px solid #e8eaed', paddingTop: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: '0.78rem', color: '#3c4043', fontWeight: 600, marginBottom: 8 }}>
                    전화번호 <span style={{ fontSize: '0.7rem', color: '#9aa0a6', fontWeight: 400 }}>(언제든 수정 가능)</span>
                  </div>
                  <input className="form-input" defaultValue={detailRecord.client_phone || ''}
                    style={{ width: '100%', fontSize: '0.82rem' }} placeholder="010-XXXX-XXXX"
                    onBlur={async (e) => {
                      const val = e.target.value.trim();
                      if (val !== (detailRecord.client_phone || '')) {
                        try { await api.sales.updatePhone(detailRecord.id, val); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
                      }
                    }} />
                </div>
              )}
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
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>결제일</label>
                      <input className="form-input" type="date" defaultValue={detailRecord.deposit_date || ''}
                        style={{ width: '100%', fontSize: '0.82rem' }}
                        onBlur={async (e) => {
                          const val = e.target.value;
                          if (val && val !== detailRecord.deposit_date) {
                            try { await api.sales.update(detailRecord.id, { deposit_date: val }); setDetailRecord(null); load(true); } catch (err: any) { alert(err.message); }
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
                    {(detailRecord.type as string) === '매수신청대리' && (
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

              {/* 확인 취소 (총무담당/master — confirmed/card_pending → pending) */}
              {(detailRecord.status === 'confirmed' || detailRecord.status === 'card_pending') && isMaster && (
                <button className="btn btn-sm" style={{ fontSize: '0.78rem', marginBottom: 12, color: '#e65100', border: '1px solid #e65100' }}
                  onClick={async () => {
                    if (!confirm('결제확인을 취소하고 입금신청 상태로 되돌리시겠습니까?')) return;
                    try { await api.sales.unconfirm(detailRecord.id); setDetailRecord(null); load(); }
                    catch (err: any) { alert(err.message); }
                  }}>
                  <RotateCcw size={12} /> 확인 취소 (전단계로)
                </button>
              )}
              {/* 환불신청 버튼 (본인 건 또는 마스터/총무담당 + 확정매출만) */}
              {(detailRecord.status === 'confirmed' || detailRecord.status === 'card_pending') && (detailRecord.user_id === currentUser?.id || isMaster) && (
                <button className="btn btn-sm btn-danger" style={{ fontSize: '0.78rem', marginBottom: 12 }}
                  onClick={async () => {
                    if (!confirm('환불을 신청하시겠습니까?\n회계 승인 후 처리됩니다.')) return;
                    try { await api.sales.refundRequest(detailRecord.id); setDetailRecord(null); load(); }
                    catch (err: any) { alert(err.message); }
                  }}>
                  <RotateCcw size={12} /> 환불신청
                </button>
              )}
              {/* 환불승인 버튼 (환불신청 상태 + 관리자/회계) — 회계장부와 동일 동작 */}
              {detailRecord.status === 'refund_requested' && canApproveAccounting && (
                <button className="btn btn-sm btn-danger" style={{ fontSize: '0.78rem', marginBottom: 12 }}
                  onClick={async () => {
                    if (!confirm('환불을 승인하시겠습니까?\n승인 즉시 환불완료 처리되며 취소할 수 없습니다.')) return;
                    try { await api.sales.refundApprove(detailRecord.id); setDetailRecord(null); load(); }
                    catch (err: any) { alert(err.message); }
                  }}>
                  <RotateCcw size={12} /> 환불승인
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
      {/* 총무메모 hover 팝업 */}
      {hoveredMemoRow && adminMemosMap[hoveredMemoRow.id] && (
        <div style={{
          position: 'fixed', top: hoveredMemoRow.y + 14, left: hoveredMemoRow.x + 14, zIndex: 9999,
          background: '#fffde7', padding: '8px 12px', borderRadius: 6, border: '1px solid #fbc02d',
          fontSize: '0.78rem', maxWidth: 320, whiteSpace: 'pre-wrap',
          boxShadow: '0 2px 10px rgba(0,0,0,0.18)', pointerEvents: 'none',
        }}>
          <div style={{ fontSize: '0.66rem', color: '#6d4c00', fontWeight: 700, marginBottom: 3 }}>총무메모</div>
          {adminMemosMap[hoveredMemoRow.id]}
        </div>
      )}
    </div>
  );
}
