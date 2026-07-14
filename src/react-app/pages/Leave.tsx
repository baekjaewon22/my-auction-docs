import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { LeaveRequest, User } from '../types';
import Select from '../components/Select';
import {
  CalendarCheck, Plus, X, CheckCircle, XCircle, AlertTriangle,
  Calculator, Calendar, Eye
} from 'lucide-react';
import { findUserOption, groupUserOptions } from '../lib/userSelectOptions';
import { countLeaveBusinessDays, leaveYearsForRange, planSummerLeave } from '../../shared/leave-calendar';

type FormLeaveType = '연차' | '반차' | '시간차' | '특별휴가';

const FORM_LEAVE_TYPES: { value: FormLeaveType; label: string; desc: string; color: string }[] = [
  { value: '연차', label: '연차', desc: '8시간 사용', color: '#1a73e8' },
  { value: '반차', label: '반차', desc: '4시간 사용', color: '#e65100' },
  { value: '시간차', label: '시간차', desc: '시간 단위 사용', color: '#9aa0a6' },
  { value: '특별휴가', label: '특별휴가', desc: '경조사 등', color: '#7b1fa2' },
];

// 특별휴가 세부 유형
type SpecialLeaveSubtype = '특별유급휴가' | '여름휴가' | '무급휴가' | '기타';

const SPECIAL_LEAVE_ITEMS = [
  { label: '본인 결혼', days: 5 },
  { label: '부모/배우자부모/배우자/자녀 장례', days: 3 },
  { label: '조부모/배우자조부모/형제자매 장례', days: 1 },
  { label: '포상휴가', days: 1, noFamilyProof: true },
];

// 여름휴가 규정
const SUMMER_TOTAL_DAYS = 3;       // 연간 총 3일
const SUMMER_MAX_CHAIN = 2;         // 연차와 이어쓸 수 있는 최대 일수

function kstToday(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function currentKstYear(): number {
  return kstToday().getUTCFullYear();
}

function isSummerVacationWindowOpen(): boolean {
  const month = kstToday().getUTCMonth() + 1;
  return month >= 7 && month <= 8;
}

function isJulyOrAugustDate(value: string): boolean {
  const month = Number(String(value || '').slice(5, 7));
  return month === 7 || month === 8;
}

// 타입 색상 매핑 (목록 표시용)
function getTypeColor(leaveType: string): string {
  if (leaveType === '연차' || leaveType === '월차') return '#1a73e8';
  if (leaveType === '반차') return '#e65100';
  if (leaveType === '특별휴가') return '#7b1fa2';
  if (leaveType === '시간차') return '#9aa0a6';
  return '#5f6368';
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '승인대기', color: '#e65100', bg: '#fff3e0' },
  approved: { label: '승인완료', color: '#188038', bg: '#e8f5e9' },
  rejected: { label: '반려', color: '#d93025', bg: '#fce4ec' },
  cancelled: { label: '취소', color: '#9aa0a6', bg: '#f5f5f5' },
  cancel_requested: { label: '취소요청', color: '#d93025', bg: '#fff3e0' },
};

function formatCurrency(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

function formatLeaveHours(hours: number): string {
  const safeHours = Math.round((Number(hours || 0)) * 1000) / 1000;
  const sign = safeHours < 0 ? '-' : '';
  const absHours = Math.abs(safeHours);
  const days = Math.floor(absHours / 8);
  const rest = Math.round((absHours - days * 8) * 1000) / 1000;
  if (days > 0 && rest > 0) return `${sign}${days}일 ${rest}시간`;
  if (days > 0) return `${sign}${days}일`;
  return `${sign}${rest}시간`;
}

function balanceHours(balance: any, kind: 'total' | 'used' | 'remaining'): number {
  if (!balance) return 0;
  if (kind === 'total') return Number(balance.total_hours ?? ((balance.total_days || 0) + (balance.monthly_days || 0)) * 8);
  if (kind === 'used') return Number(balance.used_hours ?? ((balance.used_days || 0) + (balance.monthly_used || 0)) * 8);
  return Number(balance.total_remaining_hours ?? (balance.total_remaining || 0) * 8);
}

function requestHours(req: LeaveRequest): number {
  if (req.leave_type === '시간차') return Number(req.hours || 0);
  return Math.round(Number(req.days || 0) * 8 * 1000) / 1000;
}

function displayLeaveType(type: string): string {
  return type === '월차' ? '연차' : type;
}

function halfDayTimeRange(period?: string): string {
  if (period === '오전') return '09:00~13:00';
  if (period === '오후') return '14:00~18:00';
  return '';
}

export default function Leave() {
  const { user } = useAuthStore();
  const [balance, setBalance] = useState<any>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [pendingRequests, setPendingRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<'my' | 'approve' | 'refund' | 'manage'>('my');
  const [manageAll, setManageAll] = useState<LeaveRequest[]>([]);
  const [manageFilter, setManageFilter] = useState<{ status: string; month: string; userQuery: string }>({ status: '', month: '', userQuery: '' });

  // 폼
  const [formType, setFormType] = useState<FormLeaveType>('연차');
  const [formStartDate, setFormStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formEndDate, setFormEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [halfDayPeriod, setHalfDayPeriod] = useState<'오전' | '오후'>('오전');
  const [, setFormReason] = useState('');
  const [formUserId, setFormUserId] = useState('');
  const [formUserBalance, setFormUserBalance] = useState<any>(null);
  const [formUserRequests, setFormUserRequests] = useState<LeaveRequest[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 시간차 폼
  const [formHours, setFormHours] = useState(1);

  // 특별휴가 폼
  const [specialSubtype, setSpecialSubtype] = useState<SpecialLeaveSubtype>('특별유급휴가');
  const [specialItem, setSpecialItem] = useState(0); // SPECIAL_LEAVE_ITEMS index
  const [specialEtcReason, setSpecialEtcReason] = useState('');
  // 여름휴가 폼
  const [summerDays, setSummerDays] = useState(1); // 1~3 (잔여에 따라 제한)
  const [summerChain, setSummerChain] = useState(0); // 0/1/2 연차 연결
  const [summerChainPos, setSummerChainPos] = useState<'after' | 'before'>('after');
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set());
  const [holidayLoading, setHolidayLoading] = useState(true);
  const [holidayError, setHolidayError] = useState('');

  // 반려 사유
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const role = user?.role || 'member';
  const isApprover = ['master', 'ceo', 'cc_ref', 'admin', 'manager', 'accountant'].includes(role);
  const canViewSensitive = ['master', 'ceo', 'cc_ref'].includes(role);
  const canViewOthers = ['master', 'ceo', 'admin', 'accountant', 'accountant_asst'].includes(role);
  const canViewHourly = ['master', 'ceo', 'admin'].includes(role);
  const canManageAll = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role);
  const canRequestForOthers = role === 'master';
  const canManualAdjustLeave = role === 'master';
  const holidayYearsKey = leaveYearsForRange(formStartDate, formEndDate).join(',');

  useEffect(() => {
    const years = holidayYearsKey.split(',').filter(Boolean);
    if (years.length === 0) return;
    let cancelled = false;
    setHolidayLoading(true);
    setHolidayError('');
    Promise.all(years.map((year) => api.leave.holidays(year)))
      .then((results) => {
        if (cancelled) return;
        setHolidayDates(new Set(results.flatMap((result) => result.holidays || []).map((holiday) => holiday.holiday_date)));
      })
      .catch((err: any) => {
        if (cancelled) return;
        setHolidayDates(new Set());
        setHolidayError(err?.message || '공휴일 정보를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setHolidayLoading(false);
    });
    return () => { cancelled = true; };
  }, [holidayYearsKey]);

  // 담당자 열람 기능
  const [members, setMembers] = useState<User[]>([]);
  const memberOptions = groupUserOptions(members, m => ` (${m.department || m.branch || ''})`);
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [viewBalance, setViewBalance] = useState<any>(null);
  const [viewRequests, setViewRequests] = useState<LeaveRequest[]>([]);
  const [viewLoading, setViewLoading] = useState(false);

  useEffect(() => {
    if (canViewOthers) {
      // 총무보조는 팀장·관리자급·이사·대표자 목록에서 제외
      const RESTRICTED_ROLES_FOR_ASST = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'manager'];
      api.users.list().then(res => {
        const filtered = (res.users || []).filter((u: User) =>
          u.role !== 'master'
          && (u as any).login_type !== 'freelancer'
          && u.id !== user?.id
          && !(role === 'accountant_asst' && RESTRICTED_ROLES_FOR_ASST.includes(u.role as string))
        );
        // 퇴사자는 목록 하단으로
        setMembers([
          ...filtered.filter((u: User) => u.role !== 'resigned'),
          ...filtered.filter((u: User) => u.role === 'resigned'),
        ]);
      }).catch(() => {});
    }
  }, []);

  const loadViewUser = async (userId: string) => {
    setViewLoading(true);
    try {
      const [balRes, reqRes] = await Promise.all([
        api.leave.userLeave(userId),
        api.leave.listRequests({ user_id: userId } as any),
      ]);
      setViewBalance(balRes.leave);
      setViewRequests(reqRes.requests?.filter((r: any) => r.user_id === userId) || []);
    } catch (err: any) { console.error(err); }
    finally { setViewLoading(false); }
  };

  const loadFormUser = async (userId: string) => {
    if (!userId) {
      setFormUserBalance(null);
      setFormUserRequests([]);
      return;
    }
    try {
      const [balRes, reqRes] = await Promise.all([
        api.leave.userLeave(userId),
        api.leave.listRequests({ user_id: userId } as any),
      ]);
      setFormUserBalance(balRes.leave);
      setFormUserRequests(reqRes.requests?.filter((r: any) => r.user_id === userId) || []);
    } catch (err: any) {
      alert('담당자 휴가 정보를 불러오지 못했습니다: ' + err.message);
      setFormUserId('');
      setFormUserBalance(null);
      setFormUserRequests([]);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [balRes, reqRes] = await Promise.all([
        api.leave.me(),
        api.leave.listRequests(),
      ]);
      setBalance(balRes.leave);
      // 내 신청 내역: 본인 것만 필터
      setRequests((reqRes.requests || []).filter((r: any) => r.user_id === user?.id));

      if (isApprover) {
        const [pending, cancelReqs] = await Promise.all([
          api.leave.listRequests({ status: 'pending' }),
          api.leave.listRequests({ status: 'cancel_requested' }),
        ]);
        setPendingRequests([...pending.requests, ...cancelReqs.requests]);
      }
      if (canManageAll) {
        const all = await api.leave.listRequests();
        setManageAll(all.requests || []);
      }
    } catch (err: any) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async () => {
    const requestUserId = canRequestForOthers && formUserId ? formUserId : undefined;
    // 특별휴가만 사유 검증
    if (formType === '특별휴가') {
      if ((specialSubtype === '기타' || specialSubtype === '무급휴가') && !specialEtcReason.trim()) {
        alert(`${specialSubtype} 사유를 입력하세요.`); return;
      }
      if (specialSubtype === '여름휴가') {
        if (holidayLoading || holidayError) {
          alert(holidayError || '공휴일 정보를 확인하고 있습니다. 잠시 후 다시 신청해주세요.'); return;
        }
        if (!summerVacationOpen) {
          alert('여름 특별휴가는 매년 7~8월에만 신청할 수 있습니다. 9월부터는 사용이 불가합니다.'); return;
        }
        if (summerAlreadyRequested) {
          alert('여름 특별휴가는 인당 연 1회만 신청할 수 있습니다.'); return;
        }
        if (!isJulyOrAugustDate(formStartDate)) {
          alert('여름 특별휴가 시작일은 7~8월 안에서만 선택할 수 있습니다.'); return;
        }
        if (summerDays < 1 || summerDays > summerRemaining) {
          alert(`여름휴가 잔여일(${summerRemaining}일)을 초과할 수 없습니다.`); return;
        }
        if (summerChain < 0 || summerChain > SUMMER_MAX_CHAIN) {
          alert(`연차 연결은 최대 ${SUMMER_MAX_CHAIN}일까지 가능합니다.`); return;
        }
      }
    }

    // ━━━ 여름휴가 전용 제출 (서버 단일 트랜잭션) ━━━
    if (formType === '특별휴가' && specialSubtype === '여름휴가') {
      let plan;
      try {
        plan = planSummerLeave({
          startDate: formStartDate,
          summerDays,
          chainDays: summerChain,
          chainPosition: summerChainPos,
          holidays: holidayDates,
        });
      } catch (err: any) {
        alert(err?.message || '여름휴가 날짜를 계산할 수 없습니다.'); return;
      }
      const rangeDates = [plan.specialStartDate, plan.specialEndDate, plan.annualStartDate, plan.annualEndDate]
        .filter((date): date is string => Boolean(date));
      if (rangeDates.some(d => !isJulyOrAugustDate(d))) {
        alert('여름 특별휴가와 연결 연차는 모두 7~8월 안에서만 사용할 수 있습니다.'); return;
      }
      const summerReason = summerChain > 0
        ? `[여름휴가] ${summerDays}일 (연차 ${summerChain}일 연결 ${summerChainPos === 'after' ? '뒤' : '앞'})`
        : `[여름휴가] ${summerDays}일`;
      const annualReason = summerChain > 0 ? `[여름휴가 연결] ${summerChain}일` : '';

      setSubmitting(true);
      try {
        await api.leave.createSummerRequest({
          user_id: requestUserId,
          start_date: formStartDate,
          summer_days: summerDays,
          chain_days: summerChain,
          chain_position: summerChainPos,
          summer_reason: summerReason,
          annual_reason: annualReason,
          client_special_end_date: plan.specialEndDate,
          client_annual_start_date: plan.annualStartDate || undefined,
          client_annual_end_date: plan.annualEndDate || undefined,
        });
        setShowForm(false); setFormReason(''); setSpecialEtcReason('');
        setSummerChain(0); setSummerDays(1);
        if (requestUserId) loadFormUser(requestUserId);
        load();
      } catch (err: any) { alert(err.message); }
      finally { setSubmitting(false); }
      return;
    }

    // 사유 조합
    let reason = '';
    if (formType === '특별휴가') {
      if (specialSubtype === '특별유급휴가') {
        const item = SPECIAL_LEAVE_ITEMS[specialItem];
        reason = `[특별유급] ${item.label} (${item.days}일)${item.noFamilyProof ? '' : ' ※ 가족관계증명원 전제'}`;
      } else if (specialSubtype === '무급휴가') {
        reason = `[무급] ${specialEtcReason}`;
      } else {
        reason = `[기타] ${specialEtcReason}`;
      }
    }

    // 실제 전송하는 leave_type 결정
    let apiLeaveType: string;
    if (formType === '연차') {
      apiLeaveType = '연차';
    } else if (formType === '반차') {
      apiLeaveType = '반차';
    } else if (formType === '시간차') {
      apiLeaveType = '시간차';
    } else {
      apiLeaveType = '특별휴가';
    }

    // 차감시간
    const _hours = previewHours(); void _hours;

    setSubmitting(true);
    try {
      await api.leave.createRequest({
        user_id: requestUserId,
        leave_type: apiLeaveType,
        start_date: formStartDate,
        end_date: formType === '반차' || formType === '시간차' || (formType === '특별휴가' && specialSubtype === '특별유급휴가' && SPECIAL_LEAVE_ITEMS[specialItem].days === 1) ? formStartDate : formEndDate,
        hours: formType === '시간차' ? formHours : 8,
        half_day_period: formType === '반차' ? halfDayPeriod : '',
        reason,
      });
      setShowForm(false);
      setFormReason('');
      setSpecialEtcReason('');
      if (requestUserId) loadFormUser(requestUserId);
      load();
    } catch (err: any) { alert(err.message); }
    finally { setSubmitting(false); }
  };

  const handleApprove = async (id: string) => {
    if (!confirm('승인하시겠습니까?')) return;
    try { await api.leave.approveRequest(id); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) { alert('반려 사유를 입력하세요.'); return; }
    try { await api.leave.rejectRequest(id, rejectReason); setRejectingId(null); setRejectReason(''); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleCancel = async (id: string, status: string) => {
    if (status === 'approved') {
      if (!confirm('승인완료된 건입니다. 관리자에게 취소 요청을 하시겠습니까?')) return;
      // 승인된 건 → 취소요청 (관리자 확인 필요)
      try { await api.leave.cancelRequest(id); load(); }
      catch (err: any) { alert(err.message); }
    } else {
      if (!confirm('신청을 취소하시겠습니까?')) return;
      try { await api.leave.cancelRequest(id); load(); }
      catch (err: any) { alert(err.message); }
    }
  };

  // 취소요청 승인 (관리자)
  const handleCancelApprove = async (id: string) => {
    if (!confirm('취소 요청을 승인하시겠습니까? 차감된 연차가 복원됩니다.')) return;
    try { await api.leave.cancelApprove(id); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleManualAdjustLeave = async (field: 'total' | 'used', deltaDays: number) => {
    if (!viewUserId || !canManualAdjustLeave) return;
    const targetName = members.find(m => m.id === viewUserId)?.name || '선택 담당자';
    const label = field === 'total' ? '총 부여일수' : '사용일수';
    const sign = deltaDays > 0 ? '+' : '';
    if (!confirm(`${targetName}의 ${label}를 ${sign}${deltaDays}일 조정하시겠습니까?`)) return;
    try {
      const res = await api.leave.adjust(viewUserId, { field, delta_days: deltaDays });
      if (res.leave) setViewBalance(res.leave);
      await Promise.all([loadViewUser(viewUserId), load()]);
    } catch (err: any) {
      alert(err.message || '연차 조정에 실패했습니다.');
    }
  };

  // 여름휴가 — 올해 사용량 집계 (pending + approved)
  const summerSourceRequests = canRequestForOthers && formUserId ? formUserRequests : requests;
  const summerVacationOpen = isSummerVacationWindowOpen();
  const summerYear = currentKstYear();
  const summerActiveStatuses = ['pending', 'approved', 'cancel_requested'];
  const summerAlreadyRequested = summerSourceRequests.some(r =>
    r.leave_type === '특별휴가'
    && summerActiveStatuses.includes(r.status)
    && (r.reason || '').includes('[여름휴가]')
    && r.start_date >= `${summerYear}-01-01` && r.start_date <= `${summerYear}-12-31`
  );
  const summerUsed = (() => {
    return summerSourceRequests
      .filter(r => r.leave_type === '특별휴가' && summerActiveStatuses.includes(r.status)
        && (r.reason || '').includes('[여름휴가]')
        && r.start_date >= `${summerYear}-01-01` && r.start_date <= `${summerYear}-12-31`)
      .reduce((sum, r) => {
        const m = (r.reason || '').match(/\[여름휴가\].*?(\d+)일/);
        return sum + (m ? Number(m[1]) : Number(r.days || 0));
      }, 0);
  })();
  const summerRemaining = Math.max(0, SUMMER_TOTAL_DAYS - summerUsed);
  const summerBlocked = !summerVacationOpen || summerAlreadyRequested || summerRemaining === 0;

  // 차감시간 미리보기
  const previewHours = (): number => {
    if (formType === '반차') return 4;
    if (formType === '시간차') return Math.round(formHours * 1000) / 1000;
    if (formType === '특별휴가' && specialSubtype === '특별유급휴가') {
      return SPECIAL_LEAVE_ITEMS[specialItem].days * 8;
    }
    if (formType === '특별휴가' && specialSubtype === '여름휴가') {
      return summerDays * 8; // 여름휴가 자체는 연차 차감 없음, 이어붙인 연차는 별도 계산
    }
    return countLeaveBusinessDays(formStartDate, formEndDate, holidayDates) * 8;
  };

  const formatLeavePeriod = (req: LeaveRequest): string => {
    const dateText = req.start_date === req.end_date ? req.start_date : `${req.start_date} ~ ${req.end_date}`;
    if (req.leave_type !== '반차' || !req.half_day_period) return dateText;
    const timeRange = halfDayTimeRange(req.half_day_period);
    return `${dateText} ${req.half_day_period}${timeRange ? ` (${timeRange})` : ''}`;
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2><CalendarCheck size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 연차 관리</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {canViewOthers && (
            <div style={{ minWidth: 200 }}>
              <Select
                options={[{ value: '', label: '내 연차' }, ...memberOptions]}
                value={viewUserId ? findUserOption(memberOptions, viewUserId) : { value: '', label: '내 연차' }}
                onChange={(o: any) => {
                  const id = o?.value || null;
                  setViewUserId(id);
                  if (id) loadViewUser(id);
                  else { setViewBalance(null); setViewRequests([]); }
                }}
                placeholder="담당자 선택..."
                size="sm"
                isSearchable
              />
            </div>
          )}
          <button className="btn btn-primary" onClick={() => { setShowForm(true); if (!canRequestForOthers) { setFormUserId(''); setFormUserBalance(null); setFormUserRequests([]); } }}>
            <Plus size={14} /> 휴가 신청
          </button>
        </div>
      </div>

      {/* 담당자 연차 열람 모드 */}
      {viewUserId && canViewOthers && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Eye size={18} color="#7b1fa2" />
            <span style={{ fontWeight: 700, color: '#7b1fa2', fontSize: '1rem' }}>
              {members.find(m => m.id === viewUserId)?.name} 연차 현황
            </span>
            <button
              type="button"
              onClick={async () => {
                if (!viewUserId) return;
                if (!confirm('휴가 신청 이력 기준으로 사용일수를 재계산해서 정정합니다. 계속하시겠습니까?')) return;
                try {
                  const r = await api.leave.recalculate(viewUserId);
                  alert(
                    `재계산 완료\n\n` +
                    `사용일수: ${r.before.used_days} → ${r.after.used_days}\n` +
                    `월차사용: ${r.before.monthly_used} → ${r.after.monthly_used}`
                  );
                  loadViewUser(viewUserId);
                } catch (err: any) { alert('실패: ' + err.message); }
              }}
              style={{
                marginLeft: 'auto', padding: '4px 10px', fontSize: '0.72rem', fontWeight: 600,
                background: '#fff', border: '1px solid #e8eaed', borderRadius: 6,
                color: '#5f6368', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
              title="휴가 이력 기반으로 사용일수 정합성 재계산"
            >
              ↻ 사용일수 재계산
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!viewUserId) return;
                if (!confirm('입사일 기반으로 부여 일수·타입까지 모두 재초기화합니다.\n\n관리자가 수동 부여한 추가 일수가 있다면 사라질 수 있습니다.\n계속하시겠습니까?')) return;
                try {
                  const r = await api.leave.reinit(viewUserId);
                  const b = r.before, a = r.after;
                  alert(
                    `재초기화 완료\n\n` +
                    `타입: ${b?.leave_type || '-'} → ${a.leave_type}\n` +
                    `연차 부여: ${b?.total_days ?? 0} → ${a.total_days}\n` +
                    `월차 부여: ${b?.monthly_days ?? 0} → ${a.monthly_days}\n` +
                    `연차 사용: ${b?.used_days ?? 0} → ${a.used_days}\n` +
                    `월차 사용: ${b?.monthly_used ?? 0} → ${a.monthly_used}\n` +
                    `입사일: ${a.hire_date}`
                  );
                  loadViewUser(viewUserId);
                } catch (err: any) { alert('실패: ' + err.message); }
              }}
              style={{
                padding: '4px 10px', fontSize: '0.72rem', fontWeight: 600,
                background: '#fff8e1', border: '1px solid #ffd54f', borderRadius: 6,
                color: '#e65100', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
              title="입사일 기반 entitlement(부여일수·타입)까지 재초기화"
            >
              ⟳ 입사일 기반 재초기화
            </button>
          </div>

          {viewLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#9aa0a6' }}>로딩중...</div>
          ) : viewBalance ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
                <div className="card" style={{ padding: '14px 16px', borderLeft: '4px solid #7b1fa2' }}>
                  <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>연차 발생</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#7b1fa2' }}>{formatLeaveHours(balanceHours(viewBalance, 'total'))}</div>
                </div>
                <div className="card" style={{ padding: '14px 16px', borderLeft: '4px solid #d93025' }}>
                  <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>연차 사용</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#d93025' }}>{formatLeaveHours(balanceHours(viewBalance, 'used'))}</div>
                </div>
                <div className="card" style={{ padding: '14px 16px', borderLeft: '4px solid #188038' }}>
                  <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>연차 잔여</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#188038' }}>{formatLeaveHours(balanceHours(viewBalance, 'remaining'))}</div>
                </div>
                <div className="card" style={{ padding: '14px 16px', borderLeft: '4px solid #5f6368' }}>
                  <div style={{ fontSize: '0.72rem', color: '#5f6368', marginBottom: 4 }}>입사기준일</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#5f6368' }}>{viewBalance.hire_date || '-'}</div>
                </div>
              </div>

              {canManualAdjustLeave && (
                <div className="card" style={{ padding: 14, marginBottom: 16, border: '1px solid #e8eaed' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.86rem', color: '#202124' }}>마스터 수동 조정</strong>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.76rem', color: '#5f6368' }}>총 부여일수</span>
                      {[-1, -0.5, 0.5, 1].map(delta => (
                        <button key={`total-${delta}`} type="button" className="btn btn-sm" onClick={() => handleManualAdjustLeave('total', delta)}>
                          {delta > 0 ? '+' : ''}{delta}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.76rem', color: '#5f6368' }}>사용일수</span>
                      {[-1, -0.5, 0.5, 1].map(delta => (
                        <button key={`used-${delta}`} type="button" className="btn btn-sm" onClick={() => handleManualAdjustLeave('used', delta)}>
                          {delta > 0 ? '+' : ''}{delta}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 열람 대상 휴가 내역 */}
              {viewRequests.length > 0 && (
                <div className="card" style={{ padding: 16 }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>휴가 신청 내역</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {viewRequests.filter(req => canViewHourly || req.leave_type !== '시간차').map(req => {
                      const st = STATUS_MAP[req.status] || STATUS_MAP.pending;
                      return (
                        <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 8, fontSize: '0.82rem' }}>
                          <span style={{ background: getTypeColor(req.leave_type), color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600 }}>{displayLeaveType(req.leave_type)}</span>
                          <span style={{ color: '#202124' }}>{formatLeavePeriod(req)}</span>
                          <span style={{ color: '#5f6368' }}>({formatLeaveHours(requestHours(req))})</span>
                          <span style={{ background: st.bg, color: st.color, padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600 }}>{st.label}</span>
                          {req.reason && <span style={{ color: '#9aa0a6', fontSize: '0.75rem', flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.reason}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {viewRequests.length === 0 && (
                <div style={{ textAlign: 'center', color: '#9aa0a6', fontSize: '0.85rem', padding: 20 }}>휴가 신청 내역이 없습니다.</div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* 잔여 현황 카드 */}
      {balance && (
        <div className="leave-balance-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
          <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #1a73e8' }}>
            <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>연차 발생</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1a73e8' }}>{formatLeaveHours(balanceHours(balance, 'total'))}</div>
          </div>
          <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #d93025' }}>
            <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>연차 사용</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#d93025' }}>{formatLeaveHours(balanceHours(balance, 'used'))}</div>
          </div>
          <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #188038' }}>
            <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>연차 잔여</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#188038' }}>{formatLeaveHours(balanceHours(balance, 'remaining'))}</div>
          </div>
          {/* 예상환급금: 대표자 이상 + 회계만 */}
          {canViewSensitive && (
            <div className="card" style={{ padding: '16px 20px', borderLeft: '4px solid #7b1fa2' }}>
              <div style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 4 }}>예상 환급금</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#7b1fa2' }}>{formatCurrency(balance.refund_amount)}</div>
              <div style={{ fontSize: '0.7rem', color: '#9aa0a6', marginTop: 2 }}>월급÷209h×잔여시간</div>
            </div>
          )}
        </div>
      )}

      {/* 연차촉진 알림 */}
      {balance?.promotion_alert && (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 20, border: '1px solid #fbbc04', background: '#fffde7' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} color="#f9a825" />
            <strong style={{ color: '#e65100' }}>연차촉진제도 안내</strong>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: '#5f6368' }}>
            입사 6개월이 경과하여 연차촉진제도가 발동됩니다. 1년 미만 발생 연차의 미사용분은 입사 1년 시점에 환급 처리됩니다.
          </p>
        </div>
      )}

      {/* 근속 정보 */}
      {balance?.hire_date && (
        <div style={{ marginBottom: 20, fontSize: '0.82rem', color: '#5f6368', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>입사일: <strong>{balance.hire_date}</strong></span>
          <span>근속: <strong>{Math.floor(balance.months_since_hire / 12)}년 {balance.months_since_hire % 12}개월</strong></span>
          <span>유형: <strong style={{ color: balance.entitlement.type === 'monthly' ? '#188038' : '#1a73e8' }}>
            {balance.entitlement.type === 'monthly' ? '1년 미만 연차 발생 방식' : '선불 연차 방식 (1년 이상)'}
          </strong></span>
        </div>
      )}

      {/* 근무시간 안내 */}
      <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f8f9fa', borderRadius: 6, borderLeft: '3px solid #dadce0' }}>
        <p style={{ margin: 0, fontSize: '0.7rem', color: '#9aa0a6', lineHeight: 1.6 }}>
          임직원 여러분께 근무시간 관련하여 안내드립니다.
          본 회사는 정규 업무시간 외 추가 근무에 대해 별도의 연장근무수당을 지급하지 않고 있습니다. 이에 따라, 정해진 업무시간을 준수하여 주시기 바랍니다.
          다만, 담당 업무의 성과 향상을 위해 자율적으로 추가 근무를 하시는 부분에 대해서는 각자의 판단에 맡기겠습니다.
        </p>
      </div>

      {/* 탭 */}
      <div className="leave-tabs" style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e8eaed', marginBottom: 20 }}>
        <button onClick={() => setTab('my')} style={{ padding: '10px 20px', fontWeight: tab === 'my' ? 700 : 400, color: tab === 'my' ? '#1a73e8' : '#5f6368', background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: tab === 'my' ? '#1a73e8' : 'transparent', cursor: 'pointer', fontSize: '0.9rem' }}>
          <Calendar size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> 내 신청 내역
        </button>
        {isApprover && (
          <button onClick={() => setTab('approve')} style={{ padding: '10px 20px', fontWeight: tab === 'approve' ? 700 : 400, color: tab === 'approve' ? '#1a73e8' : '#5f6368', background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: tab === 'approve' ? '#1a73e8' : 'transparent', cursor: 'pointer', fontSize: '0.9rem', position: 'relative' }}>
            <CheckCircle size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> 승인 대기
            {pendingRequests.length > 0 && (
              <span style={{ position: 'absolute', top: 4, right: 4, background: '#d93025', color: '#fff', borderRadius: '50%', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700 }}>{pendingRequests.length}</span>
            )}
          </button>
        )}
        {canViewSensitive && (
          <button onClick={() => setTab('refund')} style={{ padding: '10px 20px', fontWeight: tab === 'refund' ? 700 : 400, color: tab === 'refund' ? '#1a73e8' : '#5f6368', background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: tab === 'refund' ? '#1a73e8' : 'transparent', cursor: 'pointer', fontSize: '0.9rem' }}>
            <Calculator size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> 환급 계산
          </button>
        )}
        {canManageAll && (
          <button onClick={() => setTab('manage')} style={{ padding: '10px 20px', fontWeight: tab === 'manage' ? 700 : 400, color: tab === 'manage' ? '#1a73e8' : '#5f6368', background: 'none', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: tab === 'manage' ? '#1a73e8' : 'transparent', cursor: 'pointer', fontSize: '0.9rem' }}>
            전체 휴가 관리
          </button>
        )}
      </div>

      {/* 휴가 신청 폼 */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="journal-form-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="journal-form-header">
              <h3>휴가 신청</h3>
              <button className="btn-close" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <div className="journal-form-body">
              {canRequestForOthers && (
                <div style={{ marginBottom: 16 }}>
                  <label className="form-label">담당자 선택</label>
                  <Select
                    options={[
                      { value: '', label: '본인' },
                      ...memberOptions,
                    ]}
                    value={formUserId
                      ? findUserOption(memberOptions, formUserId)
                      : { value: '', label: '본인' }}
                    onChange={async (opt) => {
                      const nextUserId = opt?.value || '';
                      setFormUserId(nextUserId);
                      await loadFormUser(nextUserId);
                    }}
                    placeholder="담당자 선택..."
                    size="sm"
                    isSearchable
                  />
                  {formUserId && formUserBalance && (
                    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: '#f8f9fa', color: '#5f6368', fontSize: '0.78rem' }}>
                      선택 담당자 잔여: <strong style={{ color: '#188038' }}>{formatLeaveHours(balanceHours(formUserBalance, 'remaining'))}</strong>
                    </div>
                  )}
                </div>
              )}

              {/* 휴가 유형 선택 */}
              <div style={{ marginBottom: 16 }}>
                <label className="form-label">휴가 유형</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {FORM_LEAVE_TYPES.filter(t => canViewHourly || t.value !== '시간차').map(t => (
                    <button key={t.value} type="button" onClick={() => { setFormType(t.value); setSpecialSubtype('특별유급휴가'); setSpecialItem(0); setSpecialEtcReason(''); }}
                      style={{ padding: '10px 6px', borderRadius: 8, border: formType === t.value ? `2px solid ${t.color}` : '1px solid #dadce0', background: formType === t.value ? t.color + '10' : '#fff', cursor: 'pointer', textAlign: 'center' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: formType === t.value ? t.color : '#202124' }}>{t.label}</div>
                      <div style={{ fontSize: '0.65rem', color: '#9aa0a6', marginTop: 2 }}>{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 특별휴가 세부 */}
              {formType === '특별휴가' && (
                <div style={{ marginBottom: 16 }}>
                  <label className="form-label">구분</label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    {(['특별유급휴가', '여름휴가', '무급휴가', '기타'] as SpecialLeaveSubtype[]).map(s => (
                      <button key={s} type="button" onClick={() => setSpecialSubtype(s)}
                        style={{ padding: '6px 14px', borderRadius: 6, border: specialSubtype === s ? '2px solid #7b1fa2' : '1px solid #dadce0', background: specialSubtype === s ? '#f3e5f5' : '#fff', cursor: 'pointer', fontWeight: specialSubtype === s ? 600 : 400, fontSize: '0.85rem', color: specialSubtype === s ? '#7b1fa2' : '#202124' }}>
                        {s}
                      </button>
                    ))}
                  </div>

                  {specialSubtype === '특별유급휴가' && (
                    <div>
                      {SPECIAL_LEAVE_ITEMS.map((item, idx) => (
                        <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 6, marginBottom: 4, cursor: 'pointer', background: specialItem === idx ? '#ede7f6' : '#fafafa', border: specialItem === idx ? '1px solid #ce93d8' : '1px solid #e8eaed' }}
                          onClick={() => setSpecialItem(idx)}>
                          <input type="radio" name="special-item" checked={specialItem === idx} onChange={() => setSpecialItem(idx)} style={{ marginTop: 2, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: '0.82rem', lineHeight: 1.4, wordBreak: 'keep-all' }}>{item.label}</span>
                          <span style={{ fontWeight: 600, color: '#7b1fa2', fontSize: '0.82rem', flexShrink: 0, whiteSpace: 'nowrap' }}>{item.days}일</span>
                        </label>
                      ))}
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: '#fff3e0', fontSize: '0.75rem', color: '#e65100', lineHeight: 1.4 }}>
                        ※ 가족관계증명원상의 기록을 전제로 합니다.
                      </div>
                    </div>
                  )}

                  {specialSubtype === '여름휴가' && (
                    <div style={{ background: '#fafafa', padding: 14, borderRadius: 8, border: '1px solid #e8eaed' }}>
                      <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fff3e0', fontSize: '0.8rem', color: '#e65100', marginBottom: 12, lineHeight: 1.5 }}>
                        · 연간 <strong>총 {SUMMER_TOTAL_DAYS}일</strong> · 올해 사용 <strong>{summerUsed}일</strong> · <strong style={{ color: '#188038' }}>잔여 {summerRemaining}일</strong><br/>
                        · 한번만 사용 가능하며 연차 {SUMMER_MAX_CHAIN}일까지 추가 가능<br/>
                        <span style={{ fontSize: '0.74rem', color: '#5f6368' }}>※ 여름 특별휴가는 매년 7~8월에만 신청 및 사용 가능합니다.</span>
                      </div>

                      {summerAlreadyRequested ? (
                        <div style={{ padding: 12, background: '#fce4ec', color: '#d93025', borderRadius: 6, fontSize: '0.85rem' }}>
                          올해 여름 특별휴가를 이미 신청 또는 사용했습니다. 인당 연 1회만 사용 가능합니다.
                        </div>
                      ) : !summerVacationOpen ? (
                        <div style={{ padding: 12, background: '#fce4ec', color: '#d93025', borderRadius: 6, fontSize: '0.85rem' }}>
                          현재는 신청 기간이 아닙니다. 여름 특별휴가는 매년 7~8월에만 신청할 수 있으며 9월부터는 사용이 불가합니다.
                        </div>
                      ) : summerRemaining === 0 ? (
                        <div style={{ padding: 12, background: '#fce4ec', color: '#d93025', borderRadius: 6, fontSize: '0.85rem' }}>
                          올해 여름휴가를 모두 사용하셨습니다.
                        </div>
                      ) : (
                        <>
                          <div style={{ marginBottom: 12 }}>
                            <label className="form-label">여름휴가 일수</label>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {Array.from({ length: summerRemaining }, (_, i) => i + 1).map(n => (
                                <button key={n} type="button" onClick={() => setSummerDays(n)}
                                  style={{ padding: '8px 16px', borderRadius: 6, border: summerDays === n ? '2px solid #7b1fa2' : '1px solid #dadce0', background: summerDays === n ? '#f3e5f5' : '#fff', cursor: 'pointer', fontWeight: summerDays === n ? 700 : 400, fontSize: '0.88rem' }}>
                                  {n}일
                                </button>
                              ))}
                            </div>
                          </div>

                          <div style={{ marginBottom: 12 }}>
                            <label className="form-label">연차 이어서 사용 (선택)</label>
                            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                              {[0, 1, 2].map(n => (
                                <button key={n} type="button" onClick={() => setSummerChain(n)}
                                  style={{ padding: '8px 16px', borderRadius: 6, border: summerChain === n ? '2px solid #1a73e8' : '1px solid #dadce0', background: summerChain === n ? '#e8f0fe' : '#fff', cursor: 'pointer', fontWeight: summerChain === n ? 700 : 400, fontSize: '0.88rem' }}>
                                  {n === 0 ? '없음' : `${n}일`}
                                </button>
                              ))}
                            </div>
                            {summerChain > 0 && (
                              <div style={{ display: 'flex', gap: 6 }}>
                                {(['before', 'after'] as const).map(p => (
                                  <button key={p} type="button" onClick={() => setSummerChainPos(p)}
                                    style={{ padding: '6px 12px', borderRadius: 6, border: summerChainPos === p ? '2px solid #1a73e8' : '1px solid #dadce0', background: summerChainPos === p ? '#e8f0fe' : '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: summerChainPos === p ? 600 : 400 }}>
                                    {p === 'before' ? '여름휴가 앞에' : '여름휴가 뒤에'}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div style={{ padding: '10px 12px', background: '#fff', border: '1px dashed #bdbdbd', borderRadius: 6, fontSize: '0.82rem', color: '#5f6368', lineHeight: 1.5 }}>
                            <strong>합계 {summerDays + summerChain}일 연속 휴가</strong><br/>
                            · 여름휴가 {summerDays}일 (특별유급, 연차 차감 없음)
                            {summerChain > 0 && <><br/>· 연차 {summerChain}일 ({summerChainPos === 'before' ? '앞에' : '뒤에'} 연결, 연차 차감)</>}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {specialSubtype === '무급휴가' && (
                    <div>
                      <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 6, background: '#fce4ec', fontSize: '0.75rem', color: '#d93025', lineHeight: 1.4 }}>
                        ※ 무급휴가는 연차에서 차감되지 않으며, 승인 시 급여에서 해당 시간만큼 공제됩니다.
                      </div>
                      <label className="form-label">사유</label>
                      <textarea className="form-input" value={specialEtcReason} onChange={(e) => setSpecialEtcReason(e.target.value)} rows={3} placeholder="무급휴가 사유를 입력하세요" style={{ width: '100%', resize: 'vertical' }} />
                    </div>
                  )}

                  {specialSubtype === '기타' && (
                    <div>
                      <label className="form-label">사유</label>
                      <textarea className="form-input" value={specialEtcReason} onChange={(e) => setSpecialEtcReason(e.target.value)} rows={3} placeholder="특별휴가 사유를 입력하세요" style={{ width: '100%', resize: 'vertical' }} />
                    </div>
                  )}
                </div>
              )}

              {/* 시간차: 시간 선택 */}
              {formType === '시간차' && (
                <div style={{ marginBottom: 16 }}>
                  <label className="form-label">사용 시간</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[1, 2, 3, 4, 5, 6, 7].map(h => (
                      <button key={h} type="button" onClick={() => setFormHours(h)}
                        style={{ padding: '8px 14px', borderRadius: 6, border: formHours === h ? '2px solid #5f6368' : '1px solid #dadce0', background: formHours === h ? '#f1f3f4' : '#fff', cursor: 'pointer', fontWeight: formHours === h ? 700 : 400, fontSize: '0.85rem' }}>
                        {h}시간 <span style={{ fontSize: '0.7rem', color: '#9aa0a6' }}>({(h / 8).toFixed(2)}일)</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {formType === '반차' && (
                <div style={{ marginBottom: 16 }}>
                  <label className="form-label">반차 구분</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {(['오전', '오후'] as const).map((period) => (
                      <button
                        key={period}
                        type="button"
                        onClick={() => setHalfDayPeriod(period)}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 8,
                          border: halfDayPeriod === period ? '2px solid #e65100' : '1px solid #dadce0',
                          background: halfDayPeriod === period ? '#fff3e0' : '#fff',
                          color: halfDayPeriod === period ? '#e65100' : '#202124',
                          fontWeight: halfDayPeriod === period ? 700 : 500,
                          cursor: 'pointer',
                        }}
                      >
                        {period} 반차 ({halfDayTimeRange(period)})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 날짜 */}
              {(() => {
                const isSummer = formType === '특별휴가' && specialSubtype === '여름휴가';
                const isOneDaySpecialPaid = formType === '특별휴가' && specialSubtype === '특별유급휴가' && SPECIAL_LEAVE_ITEMS[specialItem].days === 1;
                const singleDate = formType === '반차' || formType === '시간차' || isSummer || isOneDaySpecialPaid;
                const label = isSummer ? '시작일 (전체 연속 휴가의 첫날)'
                  : singleDate ? '날짜' : '시작일';
                return (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <div style={{ flex: 1 }}>
                      <label className="form-label">{label}</label>
                      <input type="date" className="form-input" value={formStartDate}
                        onChange={(e) => { setFormStartDate(e.target.value); if (singleDate) setFormEndDate(e.target.value); }}
                        style={{ width: '100%' }} />
                    </div>
                    {!singleDate && (
                      <div style={{ flex: 1 }}>
                        <label className="form-label">종료일</label>
                        <input type="date" className="form-input" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} min={formStartDate} style={{ width: '100%' }} />
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 차감 미리보기 */}
              <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f8f9fa', marginBottom: 16, fontSize: '0.85rem' }}>
                <span style={{ color: '#5f6368' }}>차감시간: </span>
                <strong style={{ color: '#d93025' }}>{formatLeaveHours(previewHours())}</strong>
                {holidayLoading && <span style={{ color: '#5f6368', marginLeft: 8, fontSize: '0.78rem' }}>공휴일 확인 중</span>}
                {holidayError && <span style={{ color: '#d93025', marginLeft: 8, fontSize: '0.78rem' }}>공휴일 확인 실패</span>}
                {formType === '특별휴가' && specialSubtype === '특별유급휴가' && (
                  <span style={{ color: '#7b1fa2', marginLeft: 8, fontSize: '0.78rem' }}>({SPECIAL_LEAVE_ITEMS[specialItem].label})</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={submitting || holidayLoading || Boolean(holidayError) || (formType === '특별휴가' && specialSubtype === '여름휴가' && summerBlocked)}
                  style={{ flex: 1 }}
                >
                  {submitting ? '제출중...' : '신청하기'}
                </button>
                <button className="btn" onClick={() => setShowForm(false)}>취소</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 내 신청 내역 */}
      {tab === 'my' && (
        <div>
          {requests.length === 0 ? (
            <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: '#9aa0a6' }}>
              휴가 신청 내역이 없습니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {requests.filter(req => canViewHourly || req.leave_type !== '시간차').map(req => {
                const st = STATUS_MAP[req.status];
                const typeColor = getTypeColor(req.leave_type);
                const canCancel = req.status === 'pending' || req.status === 'approved';
                return (
                  <div key={req.id} className="card" style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600, background: typeColor + '18', color: typeColor }}>{displayLeaveType(req.leave_type)}</span>
                        {req.leave_type === '특별휴가' && (req.reason?.startsWith('[무급]') || req.reason?.startsWith('[기타]')) && (
                          <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: '#fce4ec', color: '#d93025' }}>무급</span>
                        )}
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                          {formatLeavePeriod(req)}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#5f6368' }}>({formatLeaveHours(requestHours(req))})</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>
                        {canCancel && (
                          <button className="btn btn-sm" onClick={() => handleCancel(req.id, req.status)} style={{ fontSize: '0.75rem' }}>
                            {req.status === 'approved' ? '취소요청' : '취소'}
                          </button>
                        )}
                        {['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role) && (
                          <button className="btn btn-sm btn-danger" onClick={async () => {
                            if (!confirm(`이 휴가 신청을 삭제하시겠습니까?\n${req.status === 'approved' ? '승인된 건이므로 차감된 연차가 복원됩니다.' : ''}`)) return;
                            try { await api.leave.deleteRequest(req.id); load(); }
                            catch (err: any) { alert(err.message); }
                          }} style={{ fontSize: '0.7rem', padding: '2px 6px' }}>삭제</button>
                        )}
                      </div>
                    </div>
                    {req.reason && <div style={{ marginTop: 6, fontSize: '0.82rem', color: '#5f6368' }}>{req.reason}</div>}
                    {req.reject_reason && <div style={{ marginTop: 6, fontSize: '0.82rem', color: '#d93025' }}>반려 사유: {req.reject_reason}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 승인 대기 */}
      {tab === 'approve' && isApprover && (
        <div>
          {pendingRequests.length === 0 ? (
            <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: '#9aa0a6' }}>
              승인 대기 중인 신청이 없습니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pendingRequests.filter(req => canViewHourly || req.leave_type !== '시간차').map(req => {
                const typeColor = getTypeColor(req.leave_type);
                const isRejecting = rejectingId === req.id;
                return (
                  <div key={req.id} className="card" style={{ padding: '16px 20px', border: '1px solid #bfdbfe' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.9rem' }}>{req.user_name}</strong>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600, background: typeColor + '18', color: typeColor }}>{displayLeaveType(req.leave_type)}</span>
                        {req.leave_type === '특별휴가' && (req.reason?.startsWith('[무급]') || req.reason?.startsWith('[기타]')) && (
                          <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600, background: '#fce4ec', color: '#d93025' }}>무급</span>
                        )}
                        <span style={{ fontSize: '0.85rem' }}>
                          {formatLeavePeriod(req)}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#5f6368' }}>({formatLeaveHours(requestHours(req))})</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {req.status === 'cancel_requested' ? (
                          <>
                            <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, background: '#fce4ec', color: '#d93025' }}>취소요청</span>
                            <button className="btn btn-sm btn-danger" onClick={() => handleCancelApprove(req.id)}>
                              <CheckCircle size={13} /> 취소승인
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="btn btn-sm btn-success" onClick={() => handleApprove(req.id)}>
                              <CheckCircle size={13} /> 승인
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => setRejectingId(isRejecting ? null : req.id)}>
                              <XCircle size={13} /> 반려
                            </button>
                          </>
                        )}
                        {['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role) && (
                          <button className="btn btn-sm" onClick={async () => {
                            if (!confirm('이 신청을 삭제하시겠습니까?')) return;
                            try { await api.leave.deleteRequest(req.id); load(); }
                            catch (err: any) { alert(err.message); }
                          }} style={{ fontSize: '0.7rem', padding: '2px 6px', color: '#9aa0a6' }}>삭제</button>
                        )}
                      </div>
                    </div>
                    {req.reason && <div style={{ marginTop: 6, fontSize: '0.82rem', color: '#5f6368' }}>{req.reason}</div>}
                    {isRejecting && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>반려 사유</label>
                          <input className="form-input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="반려 사유" style={{ width: '100%' }} />
                        </div>
                        <button className="btn btn-sm btn-danger" onClick={() => handleReject(req.id)}>확인</button>
                        <button className="btn btn-sm" onClick={() => { setRejectingId(null); setRejectReason(''); }}>취소</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 환급 계산 - 대표자 이상 + 회계만 */}
      {tab === 'refund' && canViewSensitive && (
        <RefundCalc />
      )}

      {/* 전체 휴가 관리 — 관리자/회계 */}
      {tab === 'manage' && canManageAll && (() => {
        const typeColors: Record<string, string> = {
          '연차': '#1a73e8', '월차': '#1a73e8', '반차': '#7c4dff', '시간차': '#e65100', '특별휴가': '#d93025',
        };
        const statusLabels: Record<string, { label: string; bg: string; color: string }> = {
          'pending': { label: '대기', bg: '#fff3e0', color: '#e65100' },
          'approved': { label: '승인', bg: '#e8f5e9', color: '#188038' },
          'rejected': { label: '반려', bg: '#fce4ec', color: '#d93025' },
          'cancel_requested': { label: '취소요청', bg: '#fff8e1', color: '#f9ab00' },
          'cancelled': { label: '취소', bg: '#f5f5f5', color: '#5f6368' },
        };

        // 중복 감지: (user_id, 표시유형, start_date, 차감시간) 동일 건 2건+
        const dupSet = new Set<string>();
        const counter = new Map<string, number>();
        manageAll.forEach(r => {
          const k = `${r.user_id}|${displayLeaveType(r.leave_type)}|${r.start_date}|${r.half_day_period || ''}|${requestHours(r)}`;
          counter.set(k, (counter.get(k) || 0) + 1);
        });
        counter.forEach((cnt, k) => { if (cnt >= 2) dupSet.add(k); });
        const isDup = (r: any) => dupSet.has(`${r.user_id}|${displayLeaveType(r.leave_type)}|${r.start_date}|${r.half_day_period || ''}|${requestHours(r)}`);

        const RESTRICTED_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'manager'];
        let list = manageAll;
        if (role === 'accountant_asst') list = list.filter((r: any) => !RESTRICTED_ROLES.includes(r.user_role || ''));
        if (manageFilter.status) list = list.filter(r => r.status === manageFilter.status);
        if (manageFilter.month) list = list.filter(r => r.start_date.startsWith(manageFilter.month));
        if (manageFilter.userQuery) {
          const q = manageFilter.userQuery.toLowerCase();
          list = list.filter((r: any) => (r.user_name || '').toLowerCase().includes(q));
        }

        return (
          <div>
            <div className="card" style={{ padding: 14, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="form-input" placeholder="이름 검색" value={manageFilter.userQuery}
                  onChange={(e) => setManageFilter({ ...manageFilter, userQuery: e.target.value })}
                  style={{ width: 160, fontSize: '0.85rem' }} />
                <select className="form-input" value={manageFilter.status}
                  onChange={(e) => setManageFilter({ ...manageFilter, status: e.target.value })}
                  style={{ width: 130, fontSize: '0.85rem' }}>
                  <option value="">전체 상태</option>
                  <option value="pending">대기</option>
                  <option value="approved">승인</option>
                  <option value="rejected">반려</option>
                  <option value="cancel_requested">취소요청</option>
                  <option value="cancelled">취소</option>
                </select>
                <input type="month" className="form-input" value={manageFilter.month}
                  onChange={(e) => setManageFilter({ ...manageFilter, month: e.target.value })}
                  style={{ width: 140, fontSize: '0.85rem' }} />
                <button className="btn btn-sm" onClick={() => setManageFilter({ status: '', month: '', userQuery: '' })}>초기화</button>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: '0.8rem', color: '#5f6368' }}>총 {list.length}건{dupSet.size > 0 && <span style={{ color: '#d93025', marginLeft: 10 }}>⚠ 중복의심 {dupSet.size}쌍</span>}</span>
              </div>
            </div>

            <div className="table-wrapper">
              <table className="data-table" style={{ fontSize: '0.83rem' }}>
                <thead>
                  <tr>
                    <th>담당자</th>
                    <th>지사/부서</th>
                    <th>유형</th>
                    <th>기간</th>
                    <th>차감시간</th>
                    <th>상태</th>
                    <th>신청일</th>
                    <th>사유/반려사유</th>
                    <th>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((req: any) => (
                    <tr key={req.id} style={isDup(req) ? { background: '#fff3e0' } : {}}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {req.user_name || '-'}
                        {isDup(req) && <span style={{ fontSize: '0.66rem', padding: '1px 5px', borderRadius: 6, background: '#fce4ec', color: '#d93025', fontWeight: 700, marginLeft: 4 }}>중복</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.78rem', color: '#5f6368' }}>{req.branch}{req.department ? ' / ' + req.department : ''}</td>
                      <td><span style={{ color: typeColors[req.leave_type] || '#5f6368', fontWeight: 600 }}>{displayLeaveType(req.leave_type)}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatLeavePeriod(req)}</td>
                      <td>{formatLeaveHours(requestHours(req))}</td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, background: statusLabels[req.status]?.bg, color: statusLabels[req.status]?.color }}>
                          {statusLabels[req.status]?.label || req.status}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.75rem', color: '#5f6368' }}>{(req.created_at || '').slice(0, 10)}</td>
                      <td style={{ fontSize: '0.78rem', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {req.reason && <div>{req.reason}</div>}
                        {req.reject_reason && <div style={{ color: '#d93025' }}>반려: {req.reject_reason}</div>}
                      </td>
                      <td>
                        <button className="btn btn-sm btn-danger" style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                          onClick={async () => {
                            if (!confirm(`${req.user_name} ${displayLeaveType(req.leave_type)} ${formatLeavePeriod(req)} (${formatLeaveHours(requestHours(req))}) 삭제하시겠습니까?${req.status === 'approved' ? '\n승인된 건이므로 차감된 연차가 복원됩니다.' : ''}`)) return;
                            try { await api.leave.deleteRequest(req.id); load(); }
                            catch (err: any) { alert(err.message); }
                          }}>삭제</button>
                      </td>
                    </tr>
                  ))}
                  {list.length === 0 && <tr><td colSpan={9} className="empty-state">해당하는 휴가 내역이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// 환급 계산 컴포넌트
function RefundCalc() {
  const [members, setMembers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [refundData, setRefundData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.journal.members().then(res => {
      const filtered = (res.members || []).filter((m: any) => m.login_type !== 'freelancer' && m.role !== 'freelancer');
      // 퇴사자는 목록 하단으로
      setMembers([
        ...filtered.filter((m: any) => m.role !== 'resigned'),
        ...filtered.filter((m: any) => m.role === 'resigned'),
      ]);
    }).catch(() => {});
  }, []);

  const calculate = async () => {
    if (!selectedUser) { alert('대상자를 선택하세요.'); return; }
    setLoading(true);
    try {
      const data = await api.leave.refund(selectedUser);
      setRefundData(data);
    } catch (err: any) { alert(err.message); }
    finally { setLoading(false); }
  };
  const refundGroups = groupUserOptions(members, m => ` (${m.department || m.branch || ''})`);

  return (
    <div>
      <div className="card" style={{ padding: '20px', marginBottom: 16 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>
          <Calculator size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> 연차 환급 계산
        </h4>
        <p style={{ fontSize: '0.82rem', color: '#5f6368', margin: '0 0 16px' }}>
          환급 공식: <strong>월급 ÷ 209시간 × 잔여시간</strong>
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200 }}>
            <label className="form-label">대상자 선택</label>
            <select className="form-input" value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} style={{ width: '100%' }}>
              <option value="">선택...</option>
              {refundGroups.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={calculate} disabled={loading}>
            {loading ? '계산중...' : '환급금 계산'}
          </button>
        </div>
      </div>

      {refundData && (
        <div className="card" style={{ padding: '20px' }}>
          <h4 style={{ margin: '0 0 16px', fontSize: '0.95rem' }}>{refundData.user_name} 환급 내역</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#9aa0a6' }}>월급</div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{formatCurrency(refundData.salary)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#9aa0a6' }}>잔여시간</div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem', color: '#1a73e8' }}>{formatLeaveHours(refundData.remaining_hours ?? refundData.remaining_days * 8)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#9aa0a6' }}>1일 환급액</div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{formatCurrency(refundData.refund_per_day)}</div>
            </div>
            <div style={{ background: '#e8f5e9', padding: '12px 16px', borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: '#188038' }}>총 환급금액</div>
              <div style={{ fontWeight: 700, fontSize: '1.3rem', color: '#188038' }}>{formatCurrency(refundData.refund_total)}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: '0.78rem', color: '#9aa0a6' }}>
            계산식: {formatCurrency(refundData.salary)} ÷ 209h × {refundData.remaining_hours ?? refundData.remaining_days * 8}h = {formatCurrency(refundData.refund_total)}
          </div>
        </div>
      )}
    </div>
  );
}
