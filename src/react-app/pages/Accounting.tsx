import React, { useEffect, useState } from 'react';
import { api, setSourcePage } from '../api';
import { useAuthStore } from '../store';
import type { User, UserAccounting, SalesEvaluation, SalesRecord } from '../types';
import { ROLE_LABELS } from '../types';
import { useBranches } from '../hooks/useBranches';
import type { Role } from '../types';
import Select from '../components/Select';
import {
  BookOpenCheck, ChevronLeft, ChevronRight, CalendarDays, TrendingDown, TrendingUp, AlertTriangle,
  ArrowDownCircle, Plus, X, Pencil, RotateCcw, Users as UsersIcon
} from 'lucide-react';

const GRADE_OPTIONS = ['M1', 'M2', 'M3', 'M4'] as const;
// 직급 톤: 상위(M1) → 하위(M4) 순으로 강조 줄어듦. 색상 다양성 대신 같은 계열의 명도 차이로 표현
const GRADE_TONE: Record<string, 'success' | 'info' | 'warn' | 'danger'> = {
  M1: 'success', M2: 'info', M3: 'warn', M4: 'danger',
};

type ChipTone = 'success' | 'info' | 'warn' | 'danger' | 'mute';
const STATUS_LABELS: Record<string, { label: string; tone: ChipTone }> = {
  pending: { label: '입금신청', tone: 'warn' },
  card_pending: { label: '카드대기', tone: 'info' },
  confirmed: { label: '확정', tone: 'success' },
  refund_requested: { label: '환불신청', tone: 'danger' },
  refunded: { label: '환불완료', tone: 'mute' },
};

// 활동이력 작업별 톤
const AUDIT_ACTION_TONE: Record<string, ChipTone> = {
  update: 'info',
  delete: 'danger',
  status_change: 'success',
  refund_approve: 'warn',
  deposit_claim_approve: 'success',
  deposit_delete: 'danger',
  payment_method_change: 'info',
  memo_add: 'mute',
  memo_update: 'mute',
  memo_delete: 'danger',
};

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

const CARD_CANCEL_PATTERN = /(취소|승인취소|매출취소|사용취소|부분취소|환불|반품)/;
const CARD_USAGE_ITEMS: Record<string, string[]> = {
  세금: ['부가세', '소득세', '주민세', '지방세', '4대보험', '법인세', '세무수수료'],
  인건비: ['직원급여', '컨설턴트 실적급여', '사업소득', '성과금', '퇴직정산'],
  사무실관련: ['임대료', '관리비', '전기요금', '수도요금', '가스요금', '청소비', '보안비'],
  통신요금: ['LGU+유선전화', 'LGU+인터넷', '인터넷전화', '대표번호', '휴대폰요금', '문자통지료', '문자발송충전'],
  홈페이지: ['네이버', '다음', '구글', '카카오', '키워드광고(네이버)', '키워드광고(다음)', '키워드광고(구글)', '블로그', '서버/도메인'],
  영업비: ['식비', '식대', '유류비', '주차비', '출장비', '숙소비', '현장식대', '법원식대', '접대비'],
  고정비: ['복사기/프린터 렌탈', '정수기 렌탈', '공기청정기 렌탈', '카드단말기', '렌탈료', '구독료', '프로그램 사용료'],
  기타: ['기타', '수수료', '송금수수료', '잡비', '환불', '오입금정리'],
  명도: ['명도비용', '강제집행비', '노무비', '열쇠/철거', '운반비', '폐기물처리'],
  비품: ['비품', '문구류', '사무용품(온라인구매)', '커피녹차', '직원간식', '명함인쇄', '소모품'],
  사무기기: ['복사기', '프린터', '토너', '잉크', '수리비', '주변기기', '사무기기 렌탈'],
  우편료: ['우편료', '등기우편', 'DM우편', '송달료', '내용증명', '택배비'],
  화환: ['화환', '화분', '근조화환', '축하화환'],
};
const CARD_USAGE_CATEGORIES = Object.keys(CARD_USAGE_ITEMS);

function getCardUsageItems(category: string) {
  return CARD_USAGE_ITEMS[category] || [];
}

function normalizeCardUsageItem(category: string, item: string) {
  const trimmed = item.trim();
  if (!category || !trimmed) return trimmed;
  return getCardUsageItems(category).includes(trimmed) ? trimmed : trimmed;
}

function normalizeCardUploadAmount(rawValue: unknown, rowText: string): number {
  const raw = Number(String(rawValue ?? '0').replace(/[^0-9.-]/g, '')) || 0;
  if (raw === 0) return 0;
  return CARD_CANCEL_PATTERN.test(rowText) ? -Math.abs(raw) : Math.abs(raw);
}

function normalizeCardUploadDate(value: unknown): string {
  if (typeof value === 'number') {
    const d = new Date((value - 25569) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const raw = String(value || '').trim();
  const match = raw.match(/(\d{2,4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!match) return raw.slice(0, 10);
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  return `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

const BANK_CATEGORY_LABELS: Record<string, string> = {
  sales_match: '업무성과 매칭',
  card_settlement: '카드정산 후보',
  other_income: '기타수입 후보',
  expense: '지출 후보',
  unknown: '확인필요',
};

function parseBankAmount(value: unknown): number {
  return Math.abs(Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0);
}

function normalizeBankDate(value: unknown): string {
  if (typeof value === 'number') {
    const d = new Date((value - 25569) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const raw = String(value || '').trim();
  const match = raw.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return raw.slice(0, 10);
}

function classifyBankUploadRow(direction: 'income' | 'expense', counterparty: string, description: string): string {
  if (direction === 'expense') return 'expense';
  const text = `${counterparty} ${description}`.toLowerCase();
  const pgKeywords = ['카드', '헥토', '파이낸셜', '나이스', 'nice', '토스', 'toss', '이니시스', 'kg', 'kcp', '페이', 'pay', '스마트로', 'ksnet', '다날', '페이먼츠', 'pg'];
  if (pgKeywords.some(k => text.includes(k.toLowerCase()))) return 'card_settlement';
  return 'sales_match';
}

function getEvaluationPeriods(count: number = 3) {
  const periods: { start: string; end: string; label: string }[] = [];
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startMonth = month % 2 === 0 ? month - 1 : month;
  for (let i = 0; i < count; i++) {
    let m = startMonth - i * 2;
    let y = year;
    while (m <= 0) { m += 12; y--; }
    const endMonth = m + 1 > 12 ? 1 : m + 1;
    const endYear = m + 1 > 12 ? y + 1 : y;
    const lastDay = new Date(endYear, endMonth, 0).getDate();
    periods.push({
      start: `${y}-${String(m).padStart(2, '0')}-01`,
      end: `${endYear}-${String(endMonth).padStart(2, '0')}-${lastDay}`,
      label: `${y}년 ${m}~${endMonth}월`,
    });
  }
  return periods;
}

type AccountingMainTab = 'sales' | 'staff' | 'cardSettlement' | 'card' | 'bank' | 'auditlog';

export default function Accounting({ initialTab = 'sales' }: { initialTab?: AccountingMainTab }) {
  const { user: currentUser } = useAuthStore();
  const { branches: BRANCHES } = useBranches();
  const [mainTab, setMainTab] = useState<AccountingMainTab>(initialTab);

  // ━━ 공통 ━━
  const [users, setUsers] = useState<User[]>([]);
  const [accounts, setAccounts] = useState<UserAccounting[]>([]);
  const [loading, setLoading] = useState(true);
  // canModify: 수정 가능 (총무담당 + 총무보조 둘 다)
  // canApprove: 최종승인만 (총무담당만, 보조 불가)
  const canModify = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(currentUser?.role || '');
  const canApprove = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'].includes(currentUser?.role || '');
  const canViewAuditLog = currentUser?.role === 'master' || currentUser?.role === 'accountant';

  // ━━ 활동 이력 ━━
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditMonth, setAuditMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [auditAction, setAuditAction] = useState('');
  const [auditActor, setAuditActor] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const canEdit = canModify; // 하위 호환
  // 총무보조 급여 열람 제한 — 팀장·관리자급·이사·대표자
  const RESTRICTED_ROLES_FOR_ASST = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'manager'];
  const isRestrictedForViewer = (u: User | null) =>
    currentUser?.role === 'accountant_asst' && !!u && RESTRICTED_ROLES_FOR_ASST.includes(u.role as string);

  const isAccountantRole = ['master', 'accountant', 'accountant_asst'].includes(currentUser?.role || '');

  // ━━ 매출 전체 탭 ━━
  const [allSales, setAllSales] = useState<SalesRecord[]>([]);
  const [adminMemos, setAdminMemos] = useState<Record<string, { id: string; content: string }>>({});
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [filterMonthEnd, setFilterMonthEnd] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [editingMemo, setEditingMemo] = useState<string | null>(null);
  const [memoText, setMemoText] = useState('');
  const [confirmingId] = useState<string | null>(null);
  const [filterDirection, setFilterDirection] = useState<'' | 'income' | 'expense'>('');
  // 매출내역 추가 폼
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryAmount, setEntryAmount] = useState('');
  const [entryContent, setEntryContent] = useState('');
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryAssignee, setEntryAssignee] = useState('');
  const [entryDirection, setEntryDirection] = useState<'income' | 'expense'>('income');
  const [entryPaymentMethod, setEntryPaymentMethod] = useState<'카드' | '이체'>('이체');

  // ━━ 신용카드 사용내역 탭 ━━
  const [cardTxns, setCardTxns] = useState<any[]>([]);
  const [cardSelected, setCardSelected] = useState<Set<string>>(new Set());
  const toggleCardSelect = (id: string) => setCardSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const handleCardBulkDelete = async () => {
    if (cardSelected.size === 0) return;
    if (!confirm(`${cardSelected.size}건을 삭제하시겠습니까?`)) return;
    try { await api.card.bulkDelete([...cardSelected]); setCardSelected(new Set()); loadCard(); } catch (err: any) { alert(err.message); }
  };
  const [cardSummary, setCardSummary] = useState<{ by_branch: any[]; by_user: any[] }>({ by_branch: [], by_user: [] });
  const [cardMonth, setCardMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [cardFilterBranch, setCardFilterBranch] = useState('');
  const [cardFilterUser, setCardFilterUser] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewRows, setPreviewRows] = useState<any[] | null>(null);
  const [excelColumns, setExcelColumns] = useState<string[]>([]);
  const [cardLastUpload, setCardLastUpload] = useState<{ last_upload: string | null; count: number } | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [cardEditForm, setCardEditForm] = useState({ merchant_name: '', usage_category: '', usage_item: '', description: '' });

  // ━━ 거래내역 첨부 탭 ━━
  const [bankItems, setBankItems] = useState<any[]>([]);
  const [bankMonth, setBankMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [bankUploading, setBankUploading] = useState(false);
  const [bankMovingId, setBankMovingId] = useState<string | null>(null);
  const [bankMoveType, setBankMoveType] = useState('기타수입');
  const [bankMoveUser, setBankMoveUser] = useState('');
  const [bankSearch, setBankSearch] = useState('');
  const [cardSettlementSales, setCardSettlementSales] = useState<SalesRecord[]>([]);
  const [cardSettlementDeposits, setCardSettlementDeposits] = useState<any[]>([]);
  const [cardSettlementMonth, setCardSettlementMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [cardSettlementInputs, setCardSettlementInputs] = useState<Record<string, { staging_id: string; settlement_date: string; settlement_amount: string; note: string }>>({});

  useEffect(() => {
    setMainTab(initialTab);
  }, [initialTab]);

  const loadBank = async () => {
    try {
      const res = await api.accounting.staging(bankMonth);
      setBankItems(res.items || []);
    } catch { setBankItems([]); }
  };

  const loadCardSettlements = async () => {
    try {
      const res = await api.accounting.cardSettlements(cardSettlementMonth);
      setCardSettlementSales(res.pending_sales || []);
      setCardSettlementDeposits(res.settlement_deposits || []);
    } catch {
      setCardSettlementSales([]);
      setCardSettlementDeposits([]);
    }
  };

  // ━━ 직원 관리 탭 ━━
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [, setSelectedAccount] = useState<UserAccounting | null>(null);
  const [evaluations, setEvaluations] = useState<SalesEvaluation[]>([]);
  const [userSalesRecords, setUserSalesRecords] = useState<SalesRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [salaryInput, setSalaryInput] = useState('');
  const [gradeInput, setGradeInput] = useState('');
  const [payTypeInput, setPayTypeInput] = useState<'salary' | 'commission'>('salary');
  const [commRateInput, setCommRateInput] = useState('');
  const [posAllowInput, setPosAllowInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [salesSearchTerm, setSalesSearchTerm] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [usersRes, accountsRes] = await Promise.all([
        api.users.list(),
        api.accounting.list(),
      ]);
      setUsers(usersRes.users);
      setAccounts(accountsRes.accounts);
    } catch (err: any) { console.error(err); }
    finally { setLoading(false); }
  };

  const loadSales = async () => {
    try {
      const res = await api.sales.list({ month: filterMonth, month_end: filterMonthEnd || undefined, user_id: filterUser || undefined });
      setAllSales((res.records || []).filter((r: SalesRecord) => {
        if (r.status === 'pending') return false;
        // 카드결제 건은 정산일 적용 후에만 회계장부에 표시
        if (r.payment_type === '카드' && !r.card_deposit_date) return false;
        return true;
      }));
      // 총무 메모 로드
      if (canModify) {
        try {
          const mRes = await api.sales.memos({ related_type: 'sales' });
          const map: Record<string, { id: string; content: string }> = {};
          (mRes.memos || []).forEach((m: any) => { map[m.related_id] = { id: m.id, content: m.content }; });
          setAdminMemos(map);
        } catch { /* */ }
      }
    } catch { setAllSales([]); }
  };

  const loadCard = async () => {
    try {
      const [txRes, sumRes, lastRes] = await Promise.all([
        api.card.transactions({ month: cardMonth, branch: cardFilterBranch || undefined, user_id: cardFilterUser || undefined }),
        api.card.summary(cardMonth),
        api.card.lastUpload().catch(() => null),
      ]);
      setCardTxns(txRes.transactions || []);
      setCardSummary(sumRes);
      setCardLastUpload(lastRes);
    } catch { setCardTxns([]); }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws);
      if (json.length === 0) { alert('데이터가 없습니다.'); return; }

      const cols = Object.keys(json[0]);
      setExcelColumns(cols);
      console.log('엑셀 컬럼:', cols);
      console.log('첫 행:', json[0]);

      // 각 컬럼 역할 자동 추정 (키워드 매칭)
      const guess = (candidates: string[]) => cols.find(c => candidates.some(s => c.includes(s))) || '';
      const colCard = guess(['카드번호', '카드', 'card']);
      const colDate = guess(['이용일', '거래일', '일자', '날짜', '승인일', '이용일자', '거래일시']);
      const colMerchant = guess(['가맹점', '이용처', '상호', '가맹점명', '매출처', '적요', '내용', '거래내용', '취급점']);
      const colAmount = guess(['이용금액', '금액', '결제금액', '매출금액', '승인금액', '이용원금', '국내이용금액', '거래금액', '출금', '지급']);
      const colDesc = guess(['비고', '적요', '내용', '메모', '거래내용']);

      console.log('매칭된 컬럼:', { colCard, colDate, colMerchant, colAmount, colDesc });

      const rows = json.map((row: any) => {
        const allVals = cols.map(c => ({ key: c, val: String(row[c] ?? '') }));

        // 카드번호: 키 매칭 → 패턴 탐색 (****-****-****-**** 또는 숫자 4자리~16자리)
        let cardNum = '';
        if (colCard) {
          cardNum = String(row[colCard] || '').trim();
        }
        if (!cardNum) {
          // 모든 셀에서 카드번호 패턴 찾기
          for (const { val } of allVals) {
            if (/\d{4}[- *]+\d{2,4}[* ]*[- *]+[* ]*\d{0,4}[- *]+\d{4}/.test(val) || /^\d{4}-\d{2}\*{2}-\*{4}-\d{4}$/.test(val)) {
              cardNum = val.trim(); break;
            }
          }
        }

        // 날짜: 키 매칭 → 패턴 탐색
        let dateRaw = colDate ? String(row[colDate] || '') : '';
        if (!dateRaw) {
          for (const { val } of allVals) {
            if (/\d{2,4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(val)) { dateRaw = val; break; }
          }
        }
        const normalizedDate = normalizeCardUploadDate(dateRaw);

        // 가맹점
        const merchant = colMerchant ? String(row[colMerchant] || '') : '';

        // 금액: 키 매칭 → 없으면 숫자 큰 값 (음수 포함)
        let amountRaw = colAmount ? row[colAmount] : null;
        if (amountRaw === null || amountRaw === undefined || amountRaw === '') {
          for (const { key, val } of allVals) {
            const n = Number(val.replace(/[^0-9.-]/g, ''));
            if (Math.abs(n) >= 100 && !key.includes('번호') && !key.includes('잔액')) { amountRaw = val; break; }
          }
        }
        const rowText = allVals.map(({ key, val }) => key.includes('번호') ? '' : val).join(' ');
        const isCancellation = CARD_CANCEL_PATTERN.test(rowText);
        const amount = normalizeCardUploadAmount(amountRaw, rowText);

        // 비고
        const desc = colDesc && colDesc !== colMerchant ? String(row[colDesc] || '') : '';

        return { card_number: cardNum, transaction_date: normalizedDate, merchant_name: merchant, amount, description: desc, usage_category: '', usage_item: '', is_cancellation: isCancellation, raw_text: rowText };
      }).filter((r: any) => r.amount !== 0);

      if (rows.length === 0) { alert('유효한 금액 데이터가 없습니다.\n감지된 컬럼: ' + cols.join(', ')); return; }

      // 미리보기 표시
      setPreviewRows(rows);
    } catch (err: any) {
      alert('엑셀 파싱 실패: ' + (err.message || ''));
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmUpload = async () => {
    if (!previewRows) return;
    setUploading(true);
    try {
      const result = await api.card.upload(previewRows);
      alert(`${result.inserted}건 저장 완료`);
      setPreviewRows(null);
      loadCard();
    } catch (err: any) { alert(err.message); }
    finally { setUploading(false); }
  };

  const updatePreviewRow = (index: number, patch: Record<string, string>) => {
    setPreviewRows(prev => prev ? prev.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row, ...patch };
      if ('usage_category' in patch) next.usage_item = '';
      return next;
    }) : prev);
  };

  const startCardEdit = (txn: any) => {
    setEditingCardId(txn.id);
    setCardEditForm({
      merchant_name: txn.merchant_name || '',
      usage_category: txn.usage_category || '',
      usage_item: txn.usage_item || '',
      description: txn.description || '',
    });
  };

  const saveCardEdit = async (id: string) => {
    try {
      await api.card.updateTransaction(id, { ...cardEditForm, usage_item: normalizeCardUsageItem(cardEditForm.usage_category, cardEditForm.usage_item) });
      setEditingCardId(null);
      loadCard();
    } catch (err: any) {
      alert(err.message);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (mainTab === 'sales') loadSales(); }, [mainTab, filterMonth, filterMonthEnd, filterUser]);
  useEffect(() => { if (mainTab === 'card') loadCard(); }, [mainTab, cardMonth, cardFilterBranch, cardFilterUser]);
  useEffect(() => { if (mainTab === 'bank') loadBank(); }, [mainTab, bankMonth]);
  useEffect(() => { if (mainTab === 'cardSettlement') loadCardSettlements(); }, [mainTab, cardSettlementMonth]);
  // 페이지 진입 시 sourcePage='accounting' (모든 API 요청 헤더에 X-Source-Page 자동 첨부)
  useEffect(() => { setSourcePage('accounting'); }, []);

  useEffect(() => {
    if (mainTab !== 'auditlog' || !canViewAuditLog) return;
    (async () => {
      try {
        const res = await api.sales.activityLogs({
          month: auditMonth || undefined,
          action: auditAction || undefined,
          actor_id: auditActor || undefined,
          limit: 300,
          source_page: 'accounting',  // 회계장부 페이지 활동만 표시
        }) as any;
        setAuditLogs(res.logs || []);
      } catch { setAuditLogs([]); }
    })();
  }, [mainTab, auditMonth, auditAction, auditActor, canViewAuditLog]);

  // ━━ 매출 전체 탭 핸들러 ━━
  const handleRefundApprove = async (id: string) => {
    if (!confirm('환불을 승인하시겠습니까?')) return;
    try { await api.sales.refundApprove(id); loadSales(); }
    catch (err: any) { alert(err.message); }
  };

  const handleMemoSave = async (id: string) => {
    try { await api.sales.updateMemo(id, memoText); setEditingMemo(null); loadSales(); }
    catch (err: any) { alert(err.message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 매출 내역을 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.')) return;
    try { await api.sales.delete(id); loadSales(); }
    catch (err: any) { alert(err.message); }
  };

  const handlePaymentMethod = async (id: string, method: string) => {
    try { await api.sales.updatePaymentMethod(id, method); loadSales(); }
    catch (err: any) { alert(err.message); }
  };

  const handleAddEntry = async () => {
    if (!entryAmount) { alert('금액을 입력하세요.'); return; }
    try {
      await api.sales.createAccountingEntry({
        amount: Number(entryAmount), content: entryContent, date: entryDate, assignee_id: entryAssignee || '__all__', direction: entryDirection, payment_method: entryPaymentMethod,
      });
      setShowEntryForm(false); setEntryAmount(''); setEntryContent(''); setEntryAssignee(''); setEntryDirection('income'); setEntryPaymentMethod('이체');
      loadSales();
    } catch (err: any) { alert(err.message); }
  };

  const handleConfirmCardSettlement = async (record: SalesRecord) => {
    const input = cardSettlementInputs[record.id] || { staging_id: '', settlement_date: '', settlement_amount: '', note: '' };
    if (!input.settlement_date && !input.staging_id) {
      alert('정산일 또는 카드사 입금건을 선택하세요.');
      return;
    }
    if (!confirm(`${record.client_name || record.depositor_name} 카드 매출을 정산 확정하시겠습니까?`)) return;
    try {
      await api.accounting.confirmCardSettlement(record.id, {
        staging_id: input.staging_id || undefined,
        settlement_date: input.settlement_date || undefined,
        settlement_amount: input.settlement_amount ? Number(input.settlement_amount) : undefined,
        note: input.note || undefined,
      });
      setCardSettlementInputs(prev => {
        const next = { ...prev };
        delete next[record.id];
        return next;
      });
      loadCardSettlements();
      loadSales();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // ━━ 직원 관리 탭 핸들러 ━━
  const handleSelectUser = async (u: User) => {
    setSelectedUser(u);
    if (isRestrictedForViewer(u)) {
      setSelectedAccount(null); setEvaluations([]); setUserSalesRecords([]);
      setSalaryInput(''); setGradeInput(''); setPayTypeInput('salary');
      setCommRateInput(''); setPosAllowInput('0');
      return;
    }
    try {
      const [accRes, evalRes, salesRes] = await Promise.all([
        api.accounting.get(u.id),
        api.accounting.evaluations(u.id),
        api.sales.list({ user_id: u.id }),
      ]);
      setUserSalesRecords(salesRes.records || []);
      const acc = accRes.account;
      setSelectedAccount(acc);
      setSalaryInput(acc?.salary?.toString() || '');
      setGradeInput(acc?.grade || '');
      setPayTypeInput(acc?.pay_type || 'salary');
      setCommRateInput(acc?.commission_rate?.toString() || '');
      setPosAllowInput(acc?.position_allowance?.toString() || '0');
      setEvaluations(evalRes.evaluations);
    } catch {
      setSelectedAccount(null); setEvaluations([]); setUserSalesRecords([]);
    }
  };

  const handleSave = async () => {
    if (!selectedUser || !canEdit) return;
    if (isRestrictedForViewer(selectedUser)) {
      alert('해당 직원의 급여·회계 정보 수정 권한이 없습니다.');
      return;
    }
    setSaving(true);
    try {
      await api.accounting.update(selectedUser.id, {
        salary: payTypeInput === 'commission' ? 0 : (Number(salaryInput) || 0),
        grade: payTypeInput === 'commission' ? '' : gradeInput,
        position_allowance: Number(posAllowInput) || 0,
        pay_type: payTypeInput,
        commission_rate: Number(commRateInput) || 0,
      });
      load();
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  const handleGradeDemotion = async (userId: string, newGrade: string) => {
    if (!confirm(`직급을 ${newGrade}로 변경하시겠습니까?`)) return;
    try {
      await api.accounting.updateGrade(userId, newGrade);
      if (selectedUser) handleSelectUser(selectedUser);
      load();
    } catch (err: any) { alert(err.message); }
  };

  const handleEvaluate = async (periodStart: string, periodEnd: string) => {
    if (!confirm(`${periodStart} ~ ${periodEnd} 매출 평가를 실행하시겠습니까?`)) return;
    try {
      await api.accounting.evaluate(periodStart, periodEnd);
      alert('평가 완료');
      if (selectedUser) handleSelectUser(selectedUser);
    } catch (err: any) { alert(err.message); }
  };

  const calculatedStandardSales = Math.round((Number(salaryInput) || 0) * 1.3 * 4);

  // 필터
  const filteredMembers = filterBranch ? users.filter(u => u.branch === filterBranch) : users;
  const memberOpts = filteredMembers.map(u => ({ value: u.id, label: `${u.name} (${u.department || ''})` }));
  const branchOpts = BRANCHES.map(b => ({ value: b, label: b }));
  const filteredStaffUsers = users.filter(u =>
    (u.name.includes(searchTerm) || u.department?.includes(searchTerm) || u.branch?.includes(searchTerm))
    && !(currentUser?.role === 'accountant_asst' && RESTRICTED_ROLES_FOR_ASST.includes(u.role as string))
  );
  const getAccountForUser = (userId: string) => accounts.find(a => a.user_id === userId);

  // 매출 통계 + 수입/지출 필터
  const displaySales = (filterDirection ? allSales.filter(r => r.direction === filterDirection) : allSales).filter(r => {
    if (!salesSearchTerm) return true;
    const q = salesSearchTerm.toLowerCase();
    return (r.depositor_name || '').toLowerCase().includes(q) || (r.client_name || '').toLowerCase().includes(q) || (r.user_name || '').toLowerCase().includes(q) || (r.type_detail || '').toLowerCase().includes(q) || (r.memo || '').toLowerCase().includes(q);
  });
  const contractCount = displaySales.filter(r => r.type === '계약' && r.status !== 'refunded').length;
  const pendingTotal = displaySales.filter(r => r.status === 'pending').reduce((s, r) => s + r.amount, 0);
  const incomeTotal = allSales.filter(r => r.direction !== 'expense' && r.status === 'confirmed').reduce((s, r) => s + r.amount, 0);
  const expenseTotal = allSales.filter(r => r.direction === 'expense' && r.status === 'confirmed').reduce((s, r) => s + r.amount, 0);
  const displayBankItems = bankItems.filter((item: any) => {
    if (!bankSearch.trim()) return true;
    const q = bankSearch.trim().toLowerCase();
    return [item.depositor, item.counterparty, item.description, item.category, item.transaction_date]
      .some(v => String(v || '').toLowerCase().includes(q));
  });
  const bankSummary = bankItems.reduce((acc: Record<string, number>, item: any) => {
    const key = item.category || (item.direction === 'expense' ? 'expense' : 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  if (loading) return <div className="page-loading">로딩중...</div>;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 직원 상세 (직원 관리 탭에서 클릭)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (selectedUser) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setSelectedUser(null)}><ChevronLeft size={16} /> 목록</button>
            <BookOpenCheck size={24} /> {selectedUser.name} — 회계 정보
          </h2>
        </div>

        {/* 기본 정보 */}
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: '1rem' }}>직원 정보</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div><span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>이름</span><div style={{ fontWeight: 600 }}>{selectedUser.name}</div></div>
            <div><span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>역할</span><div>{ROLE_LABELS[selectedUser.role as Role]}</div></div>
            <div><span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>지사</span><div>{selectedUser.branch || '-'}</div></div>
            <div><span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>부서</span><div>{selectedUser.department || '-'}</div></div>
          </div>
        </div>

        {/* 급여 & 직급 */}
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: '1rem' }}>급여 및 직급 설정</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 20 }}>
            <div>
              <label className="form-label">정산유형</label>
              <select className="form-input" value={payTypeInput} onChange={(e) => setPayTypeInput(e.target.value as any)} disabled={!canEdit} style={{ width: '100%' }}>
                <option value="salary">급여제</option>
                <option value="commission">비율제</option>
              </select>
            </div>
            {payTypeInput === 'salary' ? (
              <>
                <div>
                  <label className="form-label">급여 (월급)</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input className="form-input" value={toMoneyDisplay(salaryInput)} onChange={(e) => setSalaryInput(fromMoneyDisplay(e.target.value))} disabled={!canEdit} style={{ flex: 1 }} />
                    <span style={{ fontSize: '0.85rem', color: '#9aa0a6' }}>원</span>
                  </div>
                </div>
                <div>
                  <label className="form-label">기준매출 (급여 x 1.3 x 4)</label>
                  <div style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: '1.05rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: calculatedStandardSales > 0 ? '#0f172a' : '#94a3b8' }}>
                    {calculatedStandardSales > 0 ? formatCurrency(calculatedStandardSales) : '-'}
                  </div>
                </div>
                <div>
                  <label className="form-label">직급단계</label>
                  <select className="form-input" value={gradeInput} onChange={(e) => setGradeInput(e.target.value)} disabled={!canEdit} style={{ width: '100%' }}>
                    <option value="">미지정</option>
                    {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <div>
                <label className="form-label">수수료율 (%)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="form-input" type="number" value={commRateInput} onChange={(e) => setCommRateInput(e.target.value)} disabled={!canEdit} style={{ flex: 1 }} />
                  <span style={{ fontSize: '0.85rem', color: '#9aa0a6' }}>%</span>
                </div>
              </div>
            )}
            <div>
              <label className="form-label">직책수당</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="form-input" value={toMoneyDisplay(posAllowInput)} onChange={(e) => setPosAllowInput(fromMoneyDisplay(e.target.value))} disabled={!canEdit} style={{ flex: 1 }} />
                <span style={{ fontSize: '0.85rem', color: '#9aa0a6' }}>원</span>
              </div>
            </div>
          </div>
          {canEdit && <div style={{ marginTop: 16 }}><button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '저장중...' : '저장'}</button></div>}
        </div>

        {/* 매출 평가 이력 */}
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>매출 평가 이력</h3>
            {canEdit && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {getEvaluationPeriods(3).map(p => <button key={p.start} className="btn btn-sm" onClick={() => handleEvaluate(p.start, p.end)}>{p.label} 평가</button>)}
            </div>}
          </div>
          {evaluations.length === 0 ? <div className="empty-state">매출 평가 기록이 없습니다.</div> : (
            <div className="table-wrapper"><table className="data-table"><thead><tr><th>기간</th><th>기준매출</th><th>실제매출</th><th>달성률</th><th>결과</th><th>연속미달</th></tr></thead><tbody>
              {evaluations.map(ev => {
                const rate = ev.standard_sales > 0 ? (ev.total_sales / ev.standard_sales * 100) : 0;
                const rowAccent = ev.consecutive_misses >= 3 ? '#b91c1c' : ev.met_target ? '#15803d' : '#b45309';
                return (<tr key={ev.id} style={{ boxShadow: `inset 3px 0 0 ${rowAccent}` }}>
                  <td style={{ fontSize: '0.82rem' }}>{ev.period_start} ~ {ev.period_end}</td>
                  <td>{formatCurrency(ev.standard_sales)}</td>
                  <td style={{ fontWeight: 700 }}>{formatCurrency(ev.total_sales)}</td>
                  <td><span className={rate >= 100 ? 'acc-amount-pos' : rate >= 70 ? '' : 'acc-amount-neg'} style={{ fontWeight: 700, color: rate >= 70 && rate < 100 ? '#b45309' : undefined }}>{rate.toFixed(1)}%</span></td>
                  <td>{ev.met_target ? <span className="acc-chip tone-success"><TrendingUp size={12} /> 달성</span> : <span className="acc-chip tone-danger"><TrendingDown size={12} /> 미달</span>}</td>
                  <td>{ev.consecutive_misses >= 3 ? <span className="acc-chip tone-danger"><AlertTriangle size={12} /> {ev.consecutive_misses}회</span> : ev.consecutive_misses > 0 ? <span className="acc-chip tone-warn">{ev.consecutive_misses}회</span> : <span style={{ color: '#94a3b8' }}>-</span>}</td>
                </tr>);
              })}
            </tbody></table></div>
          )}
        </div>

        {/* 강등 대상 */}
        {evaluations.some(ev => ev.consecutive_misses >= 3) && canEdit && (
          <div className="card" style={{ marginBottom: 20, padding: 20, borderLeft: '3px solid #b91c1c' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowDownCircle size={18} color="#b91c1c" /> 강등 대상
              <span className="acc-chip tone-danger" style={{ marginLeft: 4 }}>3회 연속 미달</span>
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              {GRADE_OPTIONS.filter(g => g !== gradeInput).map(g => <button key={g} className="btn btn-sm btn-danger" onClick={() => handleGradeDemotion(selectedUser.id, g)}>{g}로 변경</button>)}
            </div>
          </div>
        )}

        {/* 매출 내역 */}
        {userSalesRecords.length > 0 && (
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1rem' }}>매출 내역</h3>
            <div className="table-wrapper"><table className="data-table"><thead><tr><th>일자</th><th>유형</th><th>입금자명</th><th>금액</th><th>입금일</th><th>상태</th><th>메모</th></tr></thead><tbody>
              {userSalesRecords.map(r => {
                const isRefunded = r.status === 'refunded';
                const st = STATUS_LABELS[r.status];
                return (<tr key={r.id} style={isRefunded ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                  <td style={{ fontSize: '0.8rem' }}>{r.contract_date}</td><td>{r.type}</td><td>{r.depositor_name || r.client_name}</td>
                  <td style={{ fontWeight: 600 }}>{formatCurrency(r.amount)}</td>
                  <td style={{ fontSize: '0.78rem' }} className={r.deposit_date ? 'acc-amount-pos' : 'acc-amount-mute'}>{r.deposit_date || '-'}</td>
                  <td><span className={`acc-chip tone-${st.tone}`}>{st.label}</span></td>
                  <td style={{ fontSize: '0.72rem', color: '#64748b' }}>{r.memo || '-'}</td>
                </tr>);
              })}
            </tbody></table></div>
          </div>
        )}
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 메인 (탭 구조)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const TAB_LABELS: Record<AccountingMainTab, string> = {
    sales: '매출·지출 통합 내역입니다.',
    cardSettlement: '카드 매출의 정산 대기 건입니다.',
    staff: '직원별 급여·직급·평가를 관리합니다.',
    card: '신용카드 사용 내역입니다.',
    bank: '은행 거래내역 첨부 및 분류입니다.',
    auditlog: '총무·총무보조의 회계 활동 이력입니다.',
  };

  // 기간 네비게이터 (현재 탭의 month state 자동 매핑)
  const periodMonth = mainTab === 'sales' ? filterMonth
    : mainTab === 'card' ? cardMonth
    : mainTab === 'bank' ? bankMonth
    : mainTab === 'cardSettlement' ? cardSettlementMonth
    : mainTab === 'auditlog' ? auditMonth
    : '';
  const setPeriodMonth = (m: string) => {
    if (mainTab === 'sales') { setFilterMonth(m); setFilterMonthEnd(''); }
    else if (mainTab === 'card') setCardMonth(m);
    else if (mainTab === 'bank') setBankMonth(m);
    else if (mainTab === 'cardSettlement') setCardSettlementMonth(m);
    else if (mainTab === 'auditlog') setAuditMonth(m);
  };
  const shiftMonth = (delta: number) => {
    if (!periodMonth) {
      setPeriodMonth(new Date().toISOString().slice(0, 7));
      return;
    }
    const [y, m] = periodMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setPeriodMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const showPeriodNav = ['sales', 'card', 'bank', 'cardSettlement', 'auditlog'].includes(mainTab);
  const cardBranchOptions = Array.from(new Set([...BRANCHES, '본사 관리', '기타']));

  return (
    <div className="page">
      <header className="acc-hero">
        <div className="acc-hero-left">
          <h1>회계장부</h1>
          <span className="acc-hero-sub">{TAB_LABELS[mainTab]}</span>
        </div>
        <div className="acc-hero-actions">
          {mainTab === 'sales' && canEdit && (
            <button className="btn btn-primary" onClick={() => setShowEntryForm(true)}>
              <Plus size={14} /> 매출내역 추가
            </button>
          )}
        </div>
      </header>

      {/* 탭 */}
      <div className="premium-filter-bar" style={{ marginBottom: 14 }}>
        <button className={`premium-filter-btn ${mainTab === 'sales' ? 'active' : ''}`} onClick={() => setMainTab('sales')}>
          매출 전체
        </button>
        <button className={`premium-filter-btn ${mainTab === 'cardSettlement' ? 'active' : ''}`} onClick={() => setMainTab('cardSettlement')}>
          카드정산 대기 {cardSettlementSales.length > 0 && <span className="acc-chip acc-chip-sm tone-info" style={{ marginLeft: 6 }}>{cardSettlementSales.length}</span>}
        </button>
        <button className={`premium-filter-btn ${mainTab === 'staff' ? 'active' : ''}`} onClick={() => setMainTab('staff')}>
          <UsersIcon size={14} style={{ marginRight: 4 }} /> 직원 관리
        </button>
        <button className={`premium-filter-btn ${mainTab === 'card' ? 'active' : ''}`} onClick={() => setMainTab('card')}>
          신용카드 사용내역
        </button>
        <button className={`premium-filter-btn ${mainTab === 'bank' ? 'active' : ''}`} onClick={() => setMainTab('bank')}>
          거래내역 첨부 {bankItems.length > 0 && <span className="acc-chip acc-chip-sm tone-warn" style={{ marginLeft: 6 }}>{bankItems.length}</span>}
        </button>
        {canViewAuditLog && (
          <button className={`premium-filter-btn ${mainTab === 'auditlog' ? 'active' : ''}`} onClick={() => setMainTab('auditlog')}>
            활동 이력
          </button>
        )}
      </div>

      {/* 기간 네비게이터 (탭별 month state와 연동) */}
      {showPeriodNav && (
        <div className="acc-period">
          <div className="acc-period-inner">
            <button className="acc-period-arrow" onClick={() => shiftMonth(-1)} title="이전 달"><ChevronLeft size={18} /></button>
            <span className="acc-period-label">
              <CalendarDays size={14} />
              {periodMonth || '전체'}
            </span>
            <button className="acc-period-arrow" onClick={() => shiftMonth(1)} title="다음 달"><ChevronRight size={18} /></button>
            <button className="btn btn-sm" style={{ marginLeft: 6, fontSize: '0.72rem' }} onClick={() => setPeriodMonth('')}>전체</button>
          </div>
        </div>
      )}

      {/* KPI 카드 (sales 탭만) */}
      {mainTab === 'sales' && (
        <div className="acc-kpi-grid">
          <div className="acc-kpi-card">
            <span className="acc-kpi-label tone-neg">총 지출 금액</span>
            <div className="acc-kpi-value tone-neg">{expenseTotal.toLocaleString()}<span className="unit">원</span></div>
            <div className="acc-kpi-meta">{allSales.filter(r => r.direction === 'expense' && r.status === 'confirmed').length}건</div>
          </div>
          <div className="acc-kpi-card">
            <span className="acc-kpi-label">총 수입 금액</span>
            <div className="acc-kpi-value">{incomeTotal.toLocaleString()}<span className="unit">원</span></div>
            <div className="acc-kpi-meta">계약 {contractCount}건</div>
          </div>
          <div className="acc-kpi-card">
            <span className="acc-kpi-label">잔액 / 대기</span>
            <div className={`acc-kpi-value ${incomeTotal - expenseTotal < 0 ? 'tone-neg' : ''}`}>{(incomeTotal - expenseTotal).toLocaleString()}<span className="unit">원</span></div>
            <div className="acc-kpi-meta">대기 {pendingTotal.toLocaleString()}원</div>
          </div>
        </div>
      )}

      {/* ━━ 매출 전체 탭 ━━ */}
      {mainTab === 'sales' && (
        <>
          {/* 매출내역 추가 폼 */}
          {showEntryForm && canEdit && (
            <div className="card" style={{ marginBottom: 20, padding: 20, borderLeft: '3px solid #1a73e8' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>매출내역 추가</h3>
                <button className="btn-icon" onClick={() => setShowEntryForm(false)}><X size={16} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div>
                  <label className="form-label">구분</label>
                  <div className="acc-toggle-group" style={{ width: '100%' }}>
                    <button type="button" onClick={() => setEntryDirection('income')}
                      className={`acc-toggle ${entryDirection === 'income' ? 'active tone-pos' : ''}`}
                      style={{ flex: 1 }}>+ 수입</button>
                    <button type="button" onClick={() => setEntryDirection('expense')}
                      className={`acc-toggle ${entryDirection === 'expense' ? 'active tone-neg' : ''}`}
                      style={{ flex: 1 }}>− 지출</button>
                  </div>
                </div>
                <div>
                  <label className="form-label">결제수단</label>
                  <div className="acc-pay-toggle acc-pay-toggle-form" role="group" aria-label="결제 수단">
                    <span className="acc-pay-toggle-thumb" data-pos={entryPaymentMethod === '카드' ? 1 : 2} />
                    <button type="button" aria-pressed={entryPaymentMethod === '카드'} className={entryPaymentMethod === '카드' ? 'active' : ''} onClick={() => setEntryPaymentMethod('카드')}>카드</button>
                    <button type="button" aria-pressed={entryPaymentMethod === '이체'} className={entryPaymentMethod === '이체' ? 'active' : ''} onClick={() => setEntryPaymentMethod('이체')}>이체</button>
                  </div>
                </div>
                <div><label className="form-label">금액 (부가세 포함)</label><input className="form-input" value={toMoneyDisplay(entryAmount)} onChange={(e) => setEntryAmount(fromMoneyDisplay(e.target.value))} style={{ width: '100%' }} /></div>
                <div><label className="form-label">내용</label><input className="form-input" value={entryContent} onChange={(e) => setEntryContent(e.target.value)} style={{ width: '100%' }} placeholder="내용" /></div>
                <div><label className="form-label">일시</label><input className="form-input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} style={{ width: '100%' }} /></div>
                <div><label className="form-label">담당자</label>
                  <Select size="sm" options={[{ value: '__all__', label: '전체 (미지정)' }, ...users.map(u => ({ value: u.id, label: `${u.name} (${u.department || ''})` }))]}
                    value={entryAssignee === '__all__' ? { value: '__all__', label: '전체 (미지정)' } : users.map(u => ({ value: u.id, label: `${u.name} (${u.department || ''})` })).find(o => o.value === entryAssignee) || null}
                    onChange={(o: any) => setEntryAssignee(o?.value || '')} placeholder="담당자 선택" isSearchable /></div>
              </div>
              <div style={{ marginTop: 14 }}><button className="btn btn-primary" onClick={handleAddEntry}>등록</button></div>
            </div>
          )}

          {/* 필터 */}
          <div className="filter-bar" style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {filterMonthEnd && (
              <span className="acc-chip" style={{ background: '#fff' }}>범위: {filterMonth} ~ {filterMonthEnd} <button onClick={() => setFilterMonthEnd('')} style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={11} /></button></span>
            )}
            {!filterMonthEnd && (
              <input type="month" className="form-input" value={filterMonthEnd} onChange={(e) => setFilterMonthEnd(e.target.value)} style={{ width: 140, fontSize: '0.78rem' }} title="종료월 설정 시 범위 조회" placeholder="범위 종료월" />
            )}
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
            <div className="acc-toggle-group">
              <button className={`acc-toggle ${filterDirection === '' ? 'active' : ''}`} onClick={() => setFilterDirection('')}>전체</button>
              <button className={`acc-toggle ${filterDirection === 'income' ? 'active tone-pos' : ''}`} onClick={() => setFilterDirection('income')}>+ 수입</button>
              <button className={`acc-toggle ${filterDirection === 'expense' ? 'active tone-neg' : ''}`} onClick={() => setFilterDirection('expense')}>− 지출</button>
            </div>
            <input className="form-input" placeholder="입금자명, 계약자명, 담당자 검색" value={salesSearchTerm} onChange={(e) => setSalesSearchTerm(e.target.value)}
              style={{ width: 220, fontSize: '0.82rem', padding: '6px 10px', marginLeft: 'auto' }} />
          </div>

          {/* 매출 목록 */}
          <div className="table-wrapper">
            <table className="premium-table">
              <thead><tr><th></th><th>일자</th><th style={{ whiteSpace: 'nowrap' }}>담당자</th><th>유형</th><th>입금자명</th><th>금액</th><th>입금일</th><th style={{ whiteSpace: 'nowrap' }}>증빙</th><th>상태</th><th>액션</th></tr></thead>
              <tbody>
                {displaySales.map(r => {
                  const st = STATUS_LABELS[r.status];
                  const isRefunded = r.status === 'refunded';
                  const isConfirming = confirmingId === r.id;
                  return (
                    <tr key={r.id} style={isRefunded ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                      <td style={{ fontSize: '0.85rem', fontWeight: 700, textAlign: 'center' }} className={r.direction === 'expense' ? 'acc-amount-neg' : 'acc-amount-pos'}>
                        {r.direction === 'expense' ? '−' : '+'}
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>{r.contract_date}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.user_name}</td>
                      <td><span style={{ fontSize: '0.8rem' }}>{r.type}</span>{r.type === '기타' && r.type_detail && <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}> ({r.type_detail})</span>}</td>
                      <td>
                        {r.depositor_name || r.client_name}
                        {r.client_name && r.depositor_name && r.client_name !== r.depositor_name && (
                          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>계약자: {r.client_name}</div>
                        )}
                      </td>
                      <td className={r.direction === 'expense' ? 'acc-amount-neg' : 'acc-amount-pos'}>
                        {r.direction === 'expense' ? '−' : '+'}{formatCurrency(r.amount)}
                      </td>
                      <td style={{ fontSize: '0.78rem' }} className={r.deposit_date ? 'acc-amount-pos' : 'acc-amount-mute'}>{r.deposit_date || '-'}</td>
                      <td style={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                        {r.receipt_type ? (
                          <span className={`acc-chip acc-chip-sm tone-${r.receipt_type === '현금영수증' ? 'success' : 'warn'}`}>
                            {r.receipt_type === '현금영수증' ? '현금' : r.receipt_type}
                          </span>
                        ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                        {(r.tax_invoice_type || r.tax_invoice_date) && (
                          <div style={{ marginTop: 3, display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                            {r.tax_invoice_type && (
                              <span className={`acc-chip acc-chip-sm tone-${r.tax_invoice_type === '영수' ? 'success' : 'warn'}`}>
                                {r.tax_invoice_type}
                              </span>
                            )}
                            {r.tax_invoice_date && (
                              <span style={{ fontSize: '0.64rem', color: '#94a3b8' }}>{r.tax_invoice_date.slice(5)}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`acc-chip tone-${st.tone}`}>{st.label}</span>
                        {/* 카드/이체 슬라이드 토글 — payment_type(담당자 입력) 자동 반영
                            활성 세그먼트를 다시 클릭하면 해제됩니다. */}
                        {(() => {
                          const pm = r.payment_method || r.payment_type || '';
                          const pos = pm === '카드' ? 1 : pm === '이체' ? 2 : 0;
                          return (
                            <>
                              {canEdit && (
                                <div className="acc-pay-toggle" style={{ marginLeft: 6 }} role="group" aria-label="결제 수단">
                                  <span className="acc-pay-toggle-thumb" data-pos={pos} />
                                  <button type="button" aria-pressed={pos === 1} className={pos === 1 ? 'active' : ''} onClick={() => handlePaymentMethod(r.id, pm === '카드' ? '' : '카드')} title={pm === '카드' ? '해제' : '카드로 설정'}>카드</button>
                                  <button type="button" aria-pressed={pos === 2} className={pos === 2 ? 'active' : ''} onClick={() => handlePaymentMethod(r.id, pm === '이체' ? '' : '이체')} title={pm === '이체' ? '해제' : '이체로 설정'}>이체</button>
                                </div>
                              )}
                              {!canEdit && pm && (
                                <span className="acc-chip acc-chip-sm tone-mute" style={{ marginLeft: 6 }}>{pm}</span>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {r.status === 'refund_requested' && canApprove && (
                            <button className="btn btn-sm btn-danger" onClick={() => handleRefundApprove(r.id)}><RotateCcw size={13} /> 환불승인</button>
                          )}
                          {canEdit && !isConfirming && (
                            <button className="btn btn-sm" onClick={() => { setEditingMemo(r.id); setMemoText(r.memo); }}><Pencil size={12} /></button>
                          )}
                          {canEdit && !isConfirming && (
                            <button className="btn btn-sm btn-danger" onClick={() => handleDelete(r.id)} title="삭제" style={{ padding: '2px 6px' }}><X size={12} /></button>
                          )}
                        </div>
                        {editingMemo === r.id && (
                          <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                            <input className="form-input" value={memoText} onChange={(e) => setMemoText(e.target.value)} placeholder="회계 메모" style={{ flex: 1, fontSize: '0.8rem' }} />
                            <button className="btn btn-sm btn-primary" onClick={() => handleMemoSave(r.id)}>저장</button>
                            <button className="btn btn-sm" onClick={() => setEditingMemo(null)}>취소</button>
                          </div>
                        )}
                        {r.memo && editingMemo !== r.id && <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 4 }}>메모: {r.memo}</div>}
                        {/* 총무 메모 */}
                        {canModify && (
                          <div style={{ marginTop: 4 }}>
                            {adminMemos[r.id] ? (
                              <div className="admin-memo" style={{ padding: '6px 10px', fontSize: '0.75rem' }}>
                                {isAccountantRole ? (
                                  <input className="admin-memo-input" style={{ minHeight: 24, fontSize: '0.75rem', padding: '4px 6px' }}
                                    defaultValue={adminMemos[r.id].content}
                                    onBlur={async (e) => {
                                      const val = e.target.value.trim();
                                      if (val === adminMemos[r.id].content) return;
                                      if (val) await api.sales.updateAdminMemo(adminMemos[r.id].id, val);
                                      else await api.sales.deleteAdminMemo(adminMemos[r.id].id);
                                      loadSales();
                                    }} />
                                ) : (
                                  <span>{adminMemos[r.id].content}</span>
                                )}
                              </div>
                            ) : isAccountantRole ? (
                              <button className="btn btn-sm" style={{ fontSize: '0.65rem', padding: '2px 8px', color: '#64748b', border: '1px dashed #cbd5e1', background: '#fff' }}
                                onClick={async () => {
                                  const memo = prompt('총무 메모를 입력하세요:');
                                  if (memo?.trim()) {
                                    await api.sales.createAdminMemo({ related_type: 'sales', related_id: r.id, content: memo.trim() });
                                    loadSales();
                                  }
                                }}>+ 총무메모</button>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {displaySales.length === 0 && <tr><td colSpan={9} className="empty-state">내역이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ━━ 거래내역 첨부 탭 ━━ */}
      {mainTab === 'cardSettlement' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
              카드대기 <strong style={{ color: '#0f172a' }}>{cardSettlementSales.length}</strong>건 / 카드사 입금대기 <strong style={{ color: '#0f172a' }}>{cardSettlementDeposits.length}</strong>건
            </span>
            <button className="btn btn-sm" onClick={loadCardSettlements}>새로고침</button>
          </div>

          <div className="acc-note" style={{ marginBottom: 12 }}>
            카드대기 매출은 <strong>매출 원금</strong>으로 보관하고, 카드사 실제 입금액은 <strong>정산 입금액</strong>으로 별도 기록합니다.
            확정 시 차액은 카드수수료로 계산되어 매출 원금과 실입금액이 섞이지 않게 됩니다.
          </div>

          {cardSettlementDeposits.length > 0 && (
            <div className="card" style={{ padding: 14, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '0.9rem' }}>카드사 입금 대기</h4>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {cardSettlementDeposits.map((d: any) => (
                  <span key={d.id} className="acc-chip tone-info">
                    {d.transaction_date} {d.counterparty || d.depositor} {Number(d.amount || 0).toLocaleString()}원
                  </span>
                ))}
              </div>
            </div>
          )}

          {cardSettlementSales.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}>카드정산 대기 매출이 없습니다.</div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table" style={{ fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th style={{ width: '9%' }}>입금확인일</th>
                    <th style={{ width: '10%' }}>담당자</th>
                    <th>고객/입금자</th>
                    <th style={{ width: '12%', textAlign: 'right' }}>매출 원금</th>
                    <th style={{ width: '18%' }}>카드사 입금건</th>
                    <th style={{ width: '10%' }}>정산일</th>
                    <th style={{ width: '12%' }}>실입금액</th>
                    <th style={{ width: '12%' }}>수수료</th>
                    <th style={{ width: '8%' }}>처리</th>
                  </tr>
                </thead>
                <tbody>
                  {cardSettlementSales.map((r) => {
                    const input = cardSettlementInputs[r.id] || { staging_id: '', settlement_date: '', settlement_amount: '', note: '' };
                    const selectedDeposit = cardSettlementDeposits.find((d: any) => d.id === input.staging_id);
                    const net = Number(input.settlement_amount || selectedDeposit?.amount || 0);
                    const fee = net > 0 ? Math.max(Number(r.amount || 0) - net, 0) : 0;
                    return (
                      <tr key={r.id}>
                        <td>{r.deposit_date || '-'}</td>
                        <td>{r.user_name || '-'}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.client_name || '-'}</div>
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{r.depositor_name || '-'}</div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{Number(r.amount || 0).toLocaleString()}원</td>
                        <td>
                          <select className="form-input" value={input.staging_id} onChange={(e) => {
                            const d = cardSettlementDeposits.find((x: any) => x.id === e.target.value);
                            setCardSettlementInputs(prev => ({
                              ...prev,
                              [r.id]: {
                                ...input,
                                staging_id: e.target.value,
                                settlement_date: d?.transaction_date || input.settlement_date,
                                settlement_amount: d?.amount ? String(d.amount) : input.settlement_amount,
                              },
                            }));
                          }} style={{ width: '100%', fontSize: '0.75rem', padding: '4px 6px' }}>
                            <option value="">직접 입력</option>
                            {cardSettlementDeposits.map((d: any) => (
                              <option key={d.id} value={d.id}>{d.transaction_date} {Number(d.amount || 0).toLocaleString()}원</option>
                            ))}
                          </select>
                        </td>
                        <td><input type="date" className="form-input" value={input.settlement_date} onChange={(e) => setCardSettlementInputs(prev => ({ ...prev, [r.id]: { ...input, settlement_date: e.target.value } }))} style={{ width: '100%', fontSize: '0.75rem', padding: '4px 6px' }} /></td>
                        <td><input className="form-input" value={toMoneyDisplay(input.settlement_amount)} onChange={(e) => setCardSettlementInputs(prev => ({ ...prev, [r.id]: { ...input, settlement_amount: fromMoneyDisplay(e.target.value) } }))} style={{ width: '100%', fontSize: '0.75rem', padding: '4px 6px', textAlign: 'right' }} /></td>
                        <td style={{ textAlign: 'right' }} className={fee > 0 ? 'acc-amount-neg' : 'acc-amount-mute'}>{fee > 0 ? fee.toLocaleString() + '원' : '-'}</td>
                        <td><button className="btn btn-sm btn-primary" onClick={() => handleConfirmCardSettlement(r)}>확정</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {mainTab === 'bank' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="form-input" placeholder="입금자/내용/분류 검색" value={bankSearch} onChange={(e) => setBankSearch(e.target.value)} style={{ width: 240 }} />
              <span style={{ fontSize: '0.82rem', color: '#64748b' }}>대기 <strong style={{ color: '#0f172a' }}>{displayBankItems.length}</strong>건 / 전체 {bankItems.length}건</span>
            </div>
            <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Plus size={13} /> {bankUploading ? '업로드 중...' : '은행 엑셀 업로드'}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} disabled={bankUploading} onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBankUploading(true);
                try {
                  const XLSX = await import('xlsx');
                  const data = await file.arrayBuffer();
                  const wb = XLSX.read(data, { type: 'array' });
                  const ws = wb.Sheets[wb.SheetNames[0]];
                  const rawRows = XLSX.utils.sheet_to_json<any>(ws);
                  const rows = rawRows.map((r: any) => {
                    const txDate = normalizeBankDate(r['거래일시'] || r['거래일'] || r['거래일자'] || r['날짜'] || r['입금일'] || '');
                    const incomeAmount = parseBankAmount(r['입금액'] || r['입금']);
                    const expenseAmount = parseBankAmount(r['출금액'] || r['출금']);
                    const direction = expenseAmount > 0 && incomeAmount <= 0 ? 'expense' : 'income';
                    const amount = direction === 'expense' ? expenseAmount : incomeAmount;
                    const counterparty = String(r['내용'] || r['적요'] || r['거래점명'] || r['거래점'] || '').trim();
                    const purpose = String(r['설명'] || r['비고'] || r['분류'] || '').trim();
                    const descriptionParts = [r['적요'], r['분류'], r['설명'], r['비고'], r['비고2'], r['거래점명'], r['거래점'], r['카드번호']]
                      .map(v => String(v || '').trim())
                      .filter(Boolean);
                    const description = Array.from(new Set(descriptionParts)).join(' / ');
                    const category = classifyBankUploadRow(direction as 'income' | 'expense', counterparty, description);
                    return {
                      depositor: counterparty,
                      counterparty,
                      amount,
                      transaction_date: txDate,
                      description,
                      direction,
                      category,
                      purpose,
                      raw_json: JSON.stringify({
                        거래일시: r['거래일시'],
                        적요: r['적요'],
                        입금액: r['입금액'],
                        출금액: r['출금액'],
                        내용: r['내용'],
                        잔액: r[' 잔액 '] || r['잔액'],
                        거래점명: r['거래점명'] || r['거래점'],
                        카드번호: r['카드번호'],
                        분류: r['분류'],
                        설명: r['설명'],
                        비고: r['비고'],
                        비고2: r['비고2'],
                      }),
                    };
                  }).filter((r: any) => r.depositor && r.amount > 0 && r.transaction_date);

                  if (rows.length === 0) { alert('유효한 데이터가 없습니다.'); setBankUploading(false); e.target.value = ''; return; }
                  if (!confirm(`${rows.length}건 업로드하시겠습니까?\n(업무성과 중복 건은 자동 제외)`)) { setBankUploading(false); e.target.value = ''; return; }

                  const chunkSize = 10;
                  const summary = { inserted: 0, autoExpenses: 0, dupSales: 0, dupStaging: 0, skipped: [] as string[] };
                  for (let i = 0; i < rows.length; i += chunkSize) {
                    const res = await api.accounting.uploadBank(rows.slice(i, i + chunkSize));
                    summary.inserted += res.inserted || 0;
                    summary.autoExpenses += res.autoExpenses || 0;
                    summary.dupSales += res.dupSales || 0;
                    summary.dupStaging += res.dupStaging || 0;
                    if (res.skipped?.length) summary.skipped.push(...res.skipped);
                  }
                  let msg = `처리 완료:\n- 대기 등록: ${summary.inserted}건\n- 지출 자동등록: ${summary.autoExpenses}건\n- 업무성과 중복: ${summary.dupSales}건 (제외)\n- 기존 중복: ${summary.dupStaging}건 (제외)`;
                  if (summary.skipped.length > 0) msg += `\n- 누락: ${summary.skipped.length}건`;
                  alert(msg);
                  setBankMonth('');
                  loadBank();
                } catch (err: any) { alert('업로드 실패: ' + err.message); }
                finally { setBankUploading(false); e.target.value = ''; }
              }} />
            </label>
          </div>

          <div className="acc-note" style={{ marginBottom: 12 }}>
            엑셀 양식: 거래일시 / 적요 / 입금액 / 출금액 / 내용 / 잔액 / 거래점 / 카드번호 / 분류 / 설명 / 비고<br />
            입금은 업무성과 매칭·카드정산·기타수입 후보로 분류되고, 출금은 설명/비고 목적값으로 회계장부에 자동 등록됩니다. 카드/PG 정산은 신규 수입으로 추가하지 않습니다.
          </div>

          {bankItems.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {Object.entries(BANK_CATEGORY_LABELS).map(([key, label]) => (
                <span key={key} className="acc-chip">
                  {label} {bankSummary[key] || 0}건
                </span>
              ))}
            </div>
          )}

          {displayBankItems.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}>대기 중인 거래내역이 없습니다.</div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table" style={{ fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th style={{ width: '10%' }}>거래일</th>
                    <th style={{ width: '7%' }}>구분</th>
                    <th style={{ width: '16%' }}>거래처</th>
                    <th style={{ width: '14%', textAlign: 'right' }}>금액</th>
                    <th style={{ width: '13%' }}>자동분류</th>
                    <th>내용</th>
                    <th style={{ width: '22%' }}>처리</th>
                  </tr>
                </thead>
                <tbody>
                  {displayBankItems.map((item: any, i: number) => {
                    const catTone: ChipTone = item.category === 'card_settlement' ? 'info' : item.category === 'expense' ? 'danger' : item.category === 'sales_match' ? 'success' : 'mute';
                    return (
                    <tr key={item.id} style={{ background: i % 2 === 1 ? '#fafbfc' : undefined }}>
                      <td>{item.transaction_date}</td>
                      <td><span className={`acc-chip acc-chip-sm tone-${item.direction === 'expense' ? 'danger' : 'success'}`}>{item.direction === 'expense' ? '지출' : '수입'}</span></td>
                      <td style={{ fontWeight: 600 }}>{item.counterparty || item.depositor}</td>
                      <td style={{ textAlign: 'right' }} className={item.direction === 'expense' ? 'acc-amount-neg' : 'acc-amount-pos'}>{item.direction === 'expense' ? '−' : '+'}{Number(item.amount).toLocaleString()}원</td>
                      <td><span className={`acc-chip acc-chip-sm tone-${catTone}`}>{BANK_CATEGORY_LABELS[item.category] || '확인필요'}</span></td>
                      <td style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{item.description || '-'}</td>
                      <td>
                        {bankMovingId === item.id ? (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                            <select className="form-input" value={bankMoveType} onChange={(e) => setBankMoveType(e.target.value)}
                              style={{ fontSize: '0.72rem', padding: '2px 4px', width: 110 }}>
                              {item.direction === 'expense' ? (
                                <option value="지출">지출</option>
                              ) : (
                                <>
                                  <option value="기타수입">기타수입</option>
                                  <option value="업무성과매출">업무성과매출</option>
                                  <option value="카드정산">카드정산</option>
                                </>
                              )}
                            </select>
                            <select className="form-input" value={bankMoveUser} onChange={(e) => setBankMoveUser(e.target.value)}
                              style={{ fontSize: '0.72rem', padding: '2px 4px', width: 80 }}>
                              <option value="">담당자</option>
                              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                            <button className="btn btn-sm btn-primary" style={{ fontSize: '0.68rem', padding: '2px 6px' }}
                              onClick={async () => {
                                try {
                                  await api.accounting.stagingToSales(item.id, { type: bankMoveType, user_id: bankMoveUser || undefined, direction: item.direction === 'expense' ? 'expense' : 'income' });
                                  setBankMovingId(null); loadBank();
                                } catch (err: any) { alert(err.message); }
                              }}>이동</button>
                            <button className="btn btn-sm" style={{ fontSize: '0.68rem', padding: '2px 4px' }}
                              onClick={() => setBankMovingId(null)}>취소</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {item.category === 'card_settlement' ? (
                              <button className="btn btn-sm btn-primary" style={{ fontSize: '0.7rem', padding: '3px 8px' }}
                                onClick={async () => {
                                  if (!confirm('카드/PG 정산 입금으로 확인 처리합니다.\n신규 수입은 추가되지 않습니다.')) return;
                                  try { await api.accounting.stagingDelete(item.id); loadBank(); }
                                  catch (err: any) { alert(err.message); }
                                }}>
                                정산 확인
                              </button>
                            ) : (
                              <button className="btn btn-sm btn-primary" style={{ fontSize: '0.7rem', padding: '3px 8px' }}
                                onClick={() => { setBankMovingId(item.id); setBankMoveType(item.direction === 'expense' ? '지출' : '기타수입'); setBankMoveUser(''); }}>
                                {item.direction === 'expense' ? '지출 등록' : '기타수입 등록'}
                              </button>
                            )}
                            <button className="btn btn-sm" style={{ fontSize: '0.7rem', padding: '3px 6px', color: '#9aa0a6' }}
                              onClick={async () => {
                                if (!confirm(`"${item.depositor} ${Number(item.amount).toLocaleString()}원" 을 무시하시겠습니까?`)) return;
                                try { await api.accounting.stagingDelete(item.id); loadBank(); }
                                catch (err: any) { alert(err.message); }
                              }}>무시</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ━━ 직원 관리 탭 ━━ */}
      {mainTab === 'staff' && (
        <>
          <div style={{ marginBottom: 16 }}>
            <input type="text" className="form-input" placeholder="이름, 지사, 부서로 검색..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ maxWidth: 320 }} />
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>이름</th><th>역할</th><th>지사</th><th>부서</th><th>유형</th><th>급여/수수료</th><th>기준매출</th><th>직급</th></tr></thead>
              <tbody>
                {filteredStaffUsers.map(u => {
                  const acc = getAccountForUser(u.id);
                  const isComm = acc?.pay_type === 'commission';
                  return (
                    <tr key={u.id} onClick={() => handleSelectUser(u)} className="clickable-row" style={{ cursor: 'pointer' }}>
                      <td><strong>{u.name}</strong></td>
                      <td><span className={`role-badge role-${u.role}`}>{ROLE_LABELS[u.role as Role]}</span></td>
                      <td>{u.branch || '-'}</td>
                      <td>{u.department || '-'}</td>
                      <td><span className={`acc-chip acc-chip-sm ${isComm ? 'tone-info' : ''}`}>{isComm ? '비율제' : '급여제'}</span></td>
                      <td>{isComm ? <span style={{ fontWeight: 600, color: '#0f172a' }}>{acc?.commission_rate || 0}%</span> : acc?.salary ? formatCurrency(acc.salary) : <span style={{ color: '#94a3b8' }}>미설정</span>}</td>
                      <td>{!isComm && acc?.standard_sales ? formatCurrency(acc.standard_sales) : <span style={{ color: '#94a3b8' }}>-</span>}</td>
                      <td>{acc?.grade ? <span className={`acc-chip tone-${GRADE_TONE[acc.grade] || 'mute'}`}>{acc.grade}</span> : <span style={{ color: '#94a3b8' }}>-</span>}</td>
                    </tr>
                  );
                })}
                {filteredStaffUsers.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8', padding: 32 }}>검색 결과가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ━━ 신용카드 사용내역 탭 ━━ */}
      {mainTab === 'card' && (
        <>
          {/* 상단 액션바 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: '0.85rem', color: '#5f6368' }}>
              {cardTxns.length > 0 && <span>총 <strong>{cardTxns.length}</strong>건</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {canModify && cardTxns.length > 0 && (
                <button className="btn btn-sm btn-danger" style={{ fontSize: '0.75rem' }} onClick={async () => {
                  const scope = cardMonth ? `${cardMonth} 월` : '전체';
                  if (!confirm(`${scope} 신용카드 내역 ${cardTxns.length}건을 모두 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
                  try {
                    for (const t of cardTxns) await api.card.deleteTransaction(t.id);
                    loadCard();
                  } catch (err: any) { alert(err.message); }
                }}>전체 삭제 ({cardTxns.length}건)</button>
              )}
              {canModify && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Plus size={13} /> {uploading ? '업로드 중...' : '신용카드 엑셀 업로드'}
                    <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} style={{ display: 'none' }} disabled={uploading} />
                  </label>
                  {cardLastUpload?.last_upload && (
                    <div style={{ fontSize: '0.7rem', color: '#5f6368' }}>
                      최근 업로드: {cardLastUpload.last_upload.slice(0, 16).replace('T', ' ')}
                      {cardLastUpload.count > 0 && <span style={{ marginLeft: 4, color: '#9aa0a6' }}>({cardLastUpload.count}건)</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 필터 */}
          <div className="filter-bar" style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ minWidth: 110 }}>
              <Select size="sm" options={[{ value: '', label: '전체 지사' }, ...cardBranchOptions.map(b => ({ value: b, label: b }))]}
                value={cardBranchOptions.map(b => ({ value: b, label: b })).find(o => o.value === cardFilterBranch) || { value: '', label: '전체 지사' }}
                onChange={(o: any) => { setCardFilterBranch(o?.value || ''); setCardFilterUser(''); }} isClearable />
            </div>
            <div style={{ minWidth: 180 }}>
              {(() => {
                const filteredUsers = cardFilterBranch
                  ? users.filter(u => u.branch === cardFilterBranch)
                  : users;
                const opts = [{ value: '', label: '전체 담당자' }, ...filteredUsers.map(u => ({ value: u.id, label: `${u.name} (${u.department || ''})` }))];
                return (
                  <Select size="sm" options={opts}
                    value={opts.find(o => o.value === cardFilterUser) || { value: '', label: '전체 담당자' }}
                    onChange={(o: any) => setCardFilterUser(o?.value || '')} isClearable isSearchable />
                );
              })()}
            </div>
          </div>

          {/* 미리보기 (업로드 전 확인) */}
          {previewRows && (
            <div className="card" style={{ marginBottom: 16, padding: 20, borderLeft: '3px solid #1a73e8' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <h4 style={{ margin: 0, color: '#0f172a', fontSize: '0.95rem' }}>업로드 미리보기</h4>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{previewRows.length}건 감지됨</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm btn-primary" onClick={handleConfirmUpload} disabled={uploading}>
                    {uploading ? '저장 중...' : `${previewRows.length}건 저장`}
                  </button>
                  <button className="btn btn-sm" onClick={() => setPreviewRows(null)}>취소</button>
                </div>
              </div>
              {excelColumns.length > 0 && (
                <div className="acc-note" style={{ fontSize: '0.7rem', marginBottom: 10 }}>
                  감지된 컬럼: {excelColumns.join(' | ')}
                </div>
              )}
              <div className="table-wrapper" style={{ maxHeight: 280, overflow: 'auto' }}>
                <table className="data-table" style={{ fontSize: '0.8rem' }}>
                  <thead><tr><th>카드번호</th><th>일자</th><th>내용</th><th>분류</th><th>항목</th><th>금액</th><th>비고</th></tr></thead>
                  <tbody>
                    {previewRows.slice(0, 30).map((r, i) => (
                      <tr key={i} className={i % 2 === 1 ? 'stripe' : ''}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{r.card_number ? '****' + r.card_number.slice(-4) : <span className="acc-amount-neg">없음</span>}</td>
                        <td>{r.transaction_date}</td>
                        <td>
                          <input
                            className="form-input"
                            value={r.merchant_name || ''}
                            onChange={(e) => updatePreviewRow(i, { merchant_name: e.target.value })}
                            placeholder="내용"
                            style={{ minWidth: 150, fontSize: '0.75rem', padding: '5px 7px' }}
                          />
                        </td>
                        <td>
                          <select
                            className="form-input"
                            value={r.usage_category || ''}
                            onChange={(e) => updatePreviewRow(i, { usage_category: e.target.value })}
                            style={{ minWidth: 110, fontSize: '0.75rem', padding: '5px 7px' }}
                          >
                            <option value="">분류 선택</option>
                            {CARD_USAGE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                          </select>
                        </td>
                        <td>
                          <input
                            className="form-input"
                            value={r.usage_item || ''}
                            onChange={(e) => updatePreviewRow(i, { usage_item: e.target.value })}
                            placeholder="항목 선택/직접입력"
                            list={`card-preview-items-${i}`}
                            style={{ minWidth: 140, fontSize: '0.75rem', padding: '5px 7px' }}
                          />
                          <datalist id={`card-preview-items-${i}`}>
                            {getCardUsageItems(r.usage_category || '').map((item) => <option key={item} value={item} />)}
                          </datalist>
                        </td>
                        <td style={{ textAlign: 'right' }} className={Number(r.amount) < 0 ? 'acc-amount-pos' : 'acc-amount-neg'}>
                          {Number(r.amount) < 0 ? '+' : '−'}{Math.abs(Number(r.amount)).toLocaleString()}
                        </td>
                        <td>
                          <input
                            className="form-input"
                            value={r.description || ''}
                            onChange={(e) => updatePreviewRow(i, { description: e.target.value })}
                            placeholder="비고"
                            style={{ minWidth: 140, fontSize: '0.75rem', padding: '5px 7px' }}
                          />
                        </td>
                      </tr>
                    ))}
                    {previewRows.length > 30 && (
                      <tr><td colSpan={7} style={{ textAlign: 'center', color: '#94a3b8', padding: 8 }}>외 {previewRows.length - 30}건...</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 지사별 합산 카드 */}
          {cardSummary.by_branch.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(cardSummary.by_branch.length + 1, 4)}, 1fr)`, gap: 10, marginBottom: 16 }}>
              {cardSummary.by_branch.map((b: any) => {
                const active = cardFilterBranch === (b.branch || '기타');
                return (
                <div key={b.branch} className={`acc-stat-card ${active ? 'active' : ''}`}
                  onClick={() => {
                    const nextBranch = active ? '' : (b.branch || '기타');
                    setCardFilterBranch(nextBranch);
                    setCardFilterUser('');
                  }}>
                  <div className="acc-stat-label">{b.branch || '기타'}</div>
                  <div className="acc-stat-value">{Number(b.total || 0).toLocaleString()}<span className="unit">원</span></div>
                  <div className="acc-stat-meta">{b.count}건</div>
                </div>
                );
              })}
              <div className="acc-stat-card" style={{ cursor: 'default', background: '#fafbfc' }}>
                <div className="acc-stat-label">합계</div>
                <div className="acc-stat-value">
                  {cardSummary.by_branch.reduce((s: number, b: any) => s + Number(b.total || 0), 0).toLocaleString()}<span className="unit">원</span>
                </div>
                <div className="acc-stat-meta">{cardSummary.by_branch.reduce((s: number, b: any) => s + Number(b.count || 0), 0)}건</div>
              </div>
            </div>
          )}

          {/* 담당자별 사용금액 */}
          {cardSummary.by_user.length > 0 && (
            <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '0.85rem', color: '#0f172a', fontWeight: 600 }}>담당자별 사용금액</h4>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {cardSummary.by_user.filter((u: any) => !cardFilterBranch || (u.branch || '기타') === cardFilterBranch).map((u: any) => {
                  const active = cardFilterUser === u.user_id;
                  return (
                  <div key={u.user_id} onClick={() => setCardFilterUser(active ? '' : u.user_id)}
                    style={{ padding: '5px 11px', background: active ? '#0f172a' : '#f8fafc', color: active ? '#fff' : '#0f172a',
                      borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer', transition: 'all 0.15s', border: '1px solid', borderColor: active ? '#0f172a' : '#e2e8f0' }}>
                    <strong>{u.user_name}</strong>
                    <span style={{ marginLeft: 6, color: active ? '#cbd5e1' : '#64748b', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{Number(u.total || 0).toLocaleString()}원</span>
                    <span style={{ marginLeft: 4, opacity: 0.65, fontSize: '0.68rem' }}>{u.count}건</span>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 거래내역 테이블 */}
          <div className="table-wrapper">
            <table className="data-table" style={{ fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  {canApprove && <th style={{ width: 32 }}><input type="checkbox" checked={cardSelected.size > 0 && cardSelected.size === cardTxns.length} onChange={() => { if (cardSelected.size === cardTxns.length) setCardSelected(new Set()); else setCardSelected(new Set(cardTxns.map((t: any) => t.id))); }} /></th>}
                  <th style={{ width: '10%' }}>일자</th>
                  <th style={{ width: '12%' }}>카드번호</th>
                  <th style={{ width: '12%' }}>담당자</th>
                  <th style={{ width: '8%' }}>지사</th>
                  <th>내용</th>
                  <th style={{ width: '12%' }}>분류</th>
                  <th style={{ width: '12%' }}>항목</th>
                  <th style={{ width: '14%', textAlign: 'right' }}>금액</th>
                  <th style={{ width: '12%' }}>비고</th>
                  {canModify && <th style={{ width: '5%' }}></th>}
                </tr>
                {cardSelected.size > 0 && canApprove && (
                  <tr><td colSpan={canModify ? 12 : 11} style={{ background: '#fef2f2', borderLeft: '3px solid #b91c1c', padding: '6px 12px' }}>
                    <button className="btn btn-sm btn-danger" onClick={handleCardBulkDelete}>{cardSelected.size}건 선택 삭제</button>
                    <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setCardSelected(new Set())}>선택 해제</button>
                  </td></tr>
                )}
              </thead>
              <tbody>
                {cardTxns.map((t: any, i: number) => {
                  const amt = Number(t.amount || 0);
                  const isRefund = amt < 0;
                  const canEditHeadOfficeCard = canModify && (t.category || '') === '본사 관리';
                  const isEditingCard = editingCardId === t.id;
                  return (
                  <tr key={t.id} style={{ background: i % 2 === 1 ? '#fafbfc' : undefined, boxShadow: isRefund ? 'inset 3px 0 0 #15803d' : undefined }}>
                    {canApprove && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={cardSelected.has(t.id)} onChange={() => toggleCardSelect(t.id)} /></td>}
                    <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{t.transaction_date}</td>
                    <td style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#64748b' }}>
                      {t.card_number ? '****' + String(t.card_number).slice(-4) : '-'}
                    </td>
                    <td>
                      {t.user_name
                        ? <span style={{ fontWeight: 500 }}>{t.user_name}</span>
                        : <span style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>미매칭</span>}
                    </td>
                    <td>
                      <span className="acc-chip acc-chip-sm">{t.category}</span>
                    </td>
                    <td style={{ color: '#0f172a', minWidth: 170 }}>
                      {isEditingCard ? (
                        <input
                          className="form-input"
                          value={cardEditForm.merchant_name}
                          onChange={(e) => setCardEditForm(prev => ({ ...prev, merchant_name: e.target.value }))}
                          style={{ fontSize: '0.75rem', padding: '5px 7px' }}
                        />
                      ) : (t.merchant_name || '-')}
                    </td>
                    <td>
                      {isEditingCard ? (
                        <select
                          className="form-input"
                          value={cardEditForm.usage_category}
                          onChange={(e) => setCardEditForm(prev => ({ ...prev, usage_category: e.target.value, usage_item: '' }))}
                          style={{ minWidth: 108, fontSize: '0.75rem', padding: '5px 7px' }}
                        >
                          <option value="">분류 선택</option>
                          {CARD_USAGE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                        </select>
                      ) : (
                        t.usage_category ? <span className="acc-chip acc-chip-sm tone-info">{t.usage_category}</span> : <span style={{ color: '#cbd5e1', fontSize: '0.72rem' }}>미분류</span>
                      )}
                    </td>
                    <td>
                      {isEditingCard ? (
                        <>
                          <input
                            className="form-input"
                            value={cardEditForm.usage_item}
                            onChange={(e) => setCardEditForm(prev => ({ ...prev, usage_item: e.target.value }))}
                            list={`card-edit-items-${t.id}`}
                            placeholder="항목 선택/직접입력"
                            style={{ minWidth: 120, fontSize: '0.75rem', padding: '5px 7px' }}
                          />
                          <datalist id={`card-edit-items-${t.id}`}>
                            {getCardUsageItems(cardEditForm.usage_category).map((item) => <option key={item} value={item} />)}
                          </datalist>
                        </>
                      ) : (
                        t.usage_item ? <span className="acc-chip acc-chip-sm">{t.usage_item}</span> : <span style={{ color: '#cbd5e1', fontSize: '0.72rem' }}>-</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }} className={isRefund ? 'acc-amount-pos' : 'acc-amount-neg'}>
                      {isRefund ? '+' : '−'}{Math.abs(amt).toLocaleString()}원
                    </td>
                    <td style={{ fontSize: '0.72rem', color: '#94a3b8', minWidth: 140 }}>
                      {isEditingCard ? (
                        <input
                          className="form-input"
                          value={cardEditForm.description}
                          onChange={(e) => setCardEditForm(prev => ({ ...prev, description: e.target.value }))}
                          style={{ fontSize: '0.75rem', padding: '5px 7px' }}
                        />
                      ) : (t.description || '-')}
                    </td>
                    {canModify && (
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {isEditingCard ? (
                          <>
                            <button className="btn btn-sm btn-primary" style={{ padding: '4px 7px', fontSize: '0.7rem' }} onClick={() => saveCardEdit(t.id)}>저장</button>
                            <button className="btn btn-sm" style={{ padding: '4px 7px', fontSize: '0.7rem', marginLeft: 4 }} onClick={() => setEditingCardId(null)}>취소</button>
                          </>
                        ) : (
                          <>
                            {canEditHeadOfficeCard && (
                              <button className="btn btn-sm" style={{ padding: '4px 7px', fontSize: '0.7rem', marginRight: 4 }} onClick={() => startCardEdit(t)}>
                                수정
                              </button>
                            )}
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', padding: 2, borderRadius: 4, transition: 'color 0.15s' }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = '#b91c1c')}
                              onMouseLeave={(e) => (e.currentTarget.style.color = '#cbd5e1')}
                              onClick={async () => {
                                if (!confirm('이 건을 삭제하시겠습니까?')) return;
                                try { await api.card.deleteTransaction(t.id); loadCard(); } catch (err: any) { alert(err.message); }
                              }} title="삭제">
                              <X size={14} />
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                  );
                })}
                {cardTxns.length === 0 && (
                  <tr><td colSpan={canApprove ? (canModify ? 12 : 11) : (canModify ? 10 : 9)} style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>
                    {cardMonth ? `${cardMonth} 카드사용 내역이 없습니다.` : '카드사용 내역이 없습니다. 엑셀을 업로드하세요.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ━━ 활동 이력 탭 (회계 수정·삭제·상태변경 감사) ━━ */}
      {mainTab === 'auditlog' && canViewAuditLog && (() => {
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
        const actorOptions = Array.from(new Set(auditLogs.map((l: any) => l.actor_id + '|' + (l.actor_display_name || l.actor_name || '?'))))
          .map(s => { const [id, name] = s.split('|'); return { value: id, label: name }; });

        return (
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>활동 이력 (총무·총무보조)</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 10 }}>
              총무·총무보조의 회계 수정/삭제/상태변경 이력입니다. 총 <strong style={{ color: '#0f172a' }}>{auditLogs.length}</strong>건
            </div>
            {auditLogs.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>조회된 기록이 없습니다.</div>
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
                    {auditLogs.map((l: any) => {
                      const isOpen = expandedLogId === l.id;
                      return (
                        <React.Fragment key={l.id}>
                          <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedLogId(isOpen ? null : l.id)}>
                            <td style={{ whiteSpace: 'nowrap' }}>{(l.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{l.actor_display_name || l.actor_name || '?'}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{l.actor_role === 'accountant' ? '총무' : l.actor_role === 'accountant_asst' ? '총무보조' : l.actor_role}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span className={`acc-chip acc-chip-sm tone-${AUDIT_ACTION_TONE[l.action] || 'mute'}`}>
                                {ACTION_LABELS[l.action] || l.action}
                              </span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>{l.target_label}</td>
                            <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 400, color: '#475569' }}>{l.diff_summary}</td>
                          </tr>
                          {isOpen && (l.before_snapshot || l.after_snapshot) && (
                            <tr>
                              <td colSpan={6} style={{ background: '#f8fafc', padding: 12 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.75rem' }}>
                                  {l.before_snapshot && (
                                    <div>
                                      <div style={{ fontWeight: 600, marginBottom: 4, color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>변경 전</div>
                                      <pre style={{ margin: 0, padding: 10, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, overflow: 'auto', maxHeight: 300, fontSize: '0.72rem' }}>{(() => { try { return JSON.stringify(JSON.parse(l.before_snapshot), null, 2); } catch { return l.before_snapshot; } })()}</pre>
                                    </div>
                                  )}
                                  {l.after_snapshot && (
                                    <div>
                                      <div style={{ fontWeight: 600, marginBottom: 4, color: '#0f172a', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>변경 후</div>
                                      <pre style={{ margin: 0, padding: 10, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, overflow: 'auto', maxHeight: 300, fontSize: '0.72rem' }}>{(() => { try { return JSON.stringify(JSON.parse(l.after_snapshot), null, 2); } catch { return l.after_snapshot; } })()}</pre>
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
    </div>
  );
}
