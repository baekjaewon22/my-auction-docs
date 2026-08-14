import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { User, SalesEvaluation } from '../types';
import { ROLE_LABELS, VISIBLE_ROLES } from '../types';
import { useBranches } from '../hooks/useBranches';
import type { Role } from '../types';
import Select, { toOptions } from '../components/Select';
import { Trash2, UserCheck, UserX, UserCog, ChevronLeft, TrendingDown, TrendingUp, AlertTriangle, ArrowDownCircle, KeyRound } from 'lucide-react';
import { normalizeBranchName, sameBranchName } from '../lib/branchAliases';

import { useDepartments } from '../hooks/useDepartments';
import { MIN_PASSWORD_LENGTH } from '../../shared/password-security';
import {
  canConvertEmployeeRoleToFreelancer,
  freelancerConversionBlockers,
  normalizeCommissionRate,
} from '../../shared/employment-conversion';
const ROLE_OPTS = [...VISIBLE_ROLES, 'resigned' as const].map((v) => ({ value: v, label: ROLE_LABELS[v] }));
// BRANCH_OPTS는 컴포넌트 내부에서 동적 생성
const POSITION_TITLES = ['대표이사', '부사장', '전무', '상무', '이사', '본부장', '지사장', '실장', '사무장', '부장', '차장', '과장', '팀장', '대리', '주임', '사원', '인턴', 'PD'];
const POSITION_OPTS = POSITION_TITLES.map((p) => ({ value: p, label: p }));

const GRADE_OPTIONS = ['M1', 'M2', 'M3', 'M4'] as const;
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

export default function UserManagement() {
  const { user: currentUser } = useAuthStore();
  const { departments: deptList } = useDepartments();
  const { branches: branchList } = useBranches();
  const DEPT_OPTS = toOptions(deptList);
  const BRANCH_OPTS = branchList.map(b => ({ value: b, label: b }));
  const [tab, setTab] = useState<'approved' | 'pending' | 'resigned'>('approved');
  const [users, setUsers] = useState<User[]>([]);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDepts, setPendingDepts] = useState<Record<string, string>>({});
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [myauctionIdInput, setMyauctionIdInput] = useState('');
  const [myauctionPwInput, setMyauctionPwInput] = useState('');
  const [reportPermissionInput, setReportPermissionInput] = useState<'basic' | 'special'>('basic');
  const [savingAuctionSettings, setSavingAuctionSettings] = useState(false);

  // 상세페이지 관련
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [salaryInput, setSalaryInput] = useState('');
  const [accountingEffectiveMonth, setAccountingEffectiveMonth] = useState(() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 7);
  });
  const [gradeInput, setGradeInput] = useState('');
  const [posAllowanceInput, setPosAllowanceInput] = useState('');
  const [cardNumbers, setCardNumbers] = useState<string[]>(['']);
  const [hireDateInput, setHireDateInput] = useState('');
  const [payType, setPayType] = useState<'salary' | 'commission'>('salary');
  const [commissionRate, setCommissionRate] = useState('');
  const [ssnInput, setSsnInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [previousEmployeeAccount, setPreviousEmployeeAccount] = useState<{
    salary: number;
    standard_sales: number;
    grade: '' | 'M1' | 'M2' | 'M3' | 'M4';
    position_allowance: number;
    effective_month?: string;
  } | null>(null);
  const [evaluations, setEvaluations] = useState<SalesEvaluation[]>([]);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  // 알림톡 수신 설정
  const [alimBranches, setAlimBranches] = useState<Set<string>>(new Set());
  const ALIM_BRANCHES = ['의정부본사', '서초지사', '대전지사', '부산지사'];

  const hierarchy: Record<string, number> = { master: 1, ceo: 2, cc_ref: 2, admin: 3, accountant: 3, accountant_asst: 4, manager: 4, member: 5 };
  const myLevel = hierarchy[currentUser?.role || ''] || 99;
  const canManagePending = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'].includes(currentUser?.role || '');
  // 회계 정보 편집 가능한 역할
  const canEditAccounting = ['master', 'ceo', 'accountant', 'accountant_asst'].includes(currentUser?.role || '');
  // 총무보조 정산 열람/수정 제한 — 팀장·관리자급·이사·대표자
  const RESTRICTED_ROLES_FOR_ASST = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'manager'];
  const isRestrictedForViewer = (targetUser: User | null) =>
    currentUser?.role === 'accountant_asst' && !!targetUser && RESTRICTED_ROLES_FOR_ASST.includes(targetUser.role as string);
  // 회계 정보 열람 가능한 역할
  const canViewAccounting = ['master', 'ceo', 'accountant', 'accountant_asst'].includes(currentUser?.role || '');
  // 입사기준일 편집 가능한 역할
  const canSetHireDate = ['master', 'ceo', 'cc_ref', 'accountant', 'accountant_asst'].includes(currentUser?.role || '');
  const canConvertEmploymentType = ['master', 'ceo', 'accountant'].includes(currentUser?.role || '');
  const canGrantReportPermission = currentUser?.role === 'master';

  const load = () => {
    setLoading(true);
    const promises: Promise<any>[] = [api.users.list()];
    if (canManagePending) promises.push(api.users.pending());
    Promise.all(promises)
      .then(([uRes, pRes]) => {
        setUsers(uRes.users);
        if (pRes) setPendingUsers(pRes.users);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const getAvailableRoles = () => {
    if (currentUser?.role === 'master') return ROLE_OPTS;
    if (currentUser?.role === 'ceo' || currentUser?.role === 'cc_ref') return ROLE_OPTS.filter((r) => ['cc_ref', 'admin', 'accountant', 'accountant_asst', 'manager', 'member', 'resigned'].includes(r.value));
    if (currentUser?.role === 'admin') return ROLE_OPTS.filter((r) => ['manager', 'member', 'resigned'].includes(r.value));
    if (currentUser?.role === 'accountant') return ROLE_OPTS.filter((r) => r.value === 'resigned');
    return [];
  };
  const availableRoles = getAvailableRoles();

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 계정을 퇴사 보관 처리하시겠습니까?\n로그인은 차단되지만 지난 일정, 급여, 성과, 문서 기록은 모두 유지됩니다.`)) return;
    try { await api.users.delete(id); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleApprove = async (id: string) => {
    await api.users.approve(id, pendingDepts[id] || '');
    load();
  };

  const handleReject = async (id: string) => {
    if (!confirm('가입을 거절하시겠습니까? 해당 계정은 삭제됩니다.')) return;
    await api.users.reject(id);
    load();
  };


  const handleHireDateSave = async (userId: string, hireDate: string) => {
    try {
      await api.leave.setHireDate(userId, hireDate);
      alert('입사기준일이 저장되었습니다. 연차가 자동 계산됩니다.');
      load();
    } catch (err: any) { alert(err.message); }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    let resignedAt = '';
    if (role === 'resigned') {
      const target = users.find((u) => u.id === userId) || pendingUsers.find((u) => u.id === userId);
      const defaultDate = (target?.resigned_at || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const input = window.prompt('퇴사일을 입력하세요. (YYYY-MM-DD)', defaultDate);
      if (input === null) return;
      resignedAt = input.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(resignedAt)) {
        alert('퇴사일은 YYYY-MM-DD 형식으로 입력해주세요.');
        return;
      }
    }
    try { await api.users.updateRole(userId, role, undefined, undefined, resignedAt); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleResignedDateChange = async (u: User) => {
    const defaultDate = (u.resigned_at || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const input = window.prompt(`${u.name}님의 퇴사일을 입력하세요. (YYYY-MM-DD)`, defaultDate);
    if (input === null) return;
    const resignedAt = input.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resignedAt)) {
      alert('퇴사일은 YYYY-MM-DD 형식으로 입력해주세요.');
      return;
    }
    try { await api.users.updateRole(u.id, 'resigned', undefined, undefined, resignedAt); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleProfileChange = async (userId: string, data: { position_title?: string; branch?: string; department?: string }) => {
    try { await api.users.update(userId, data); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleAuctionSettingsSave = async () => {
    if (!selectedUser) return;
    const myauctionId = myauctionIdInput.trim();
    const payload: {
      myauction_id: string;
      myauction_pw?: string;
      report_permission?: 'basic' | 'special';
    } = { myauction_id: myauctionId };

    if (myauctionPwInput.length > 0) {
      payload.myauction_pw = myauctionPwInput;
    }
    if (canGrantReportPermission) {
      payload.report_permission = reportPermissionInput;
    }

    setSavingAuctionSettings(true);
    try {
      await api.users.update(selectedUser.id, payload);
      const nextUser = {
        ...selectedUser,
        myauction_id: myauctionId,
        has_myauction_credentials: myauctionId && (myauctionPwInput.length > 0 || selectedUser.has_myauction_credentials) ? 1 : 0,
        report_permission: canGrantReportPermission ? reportPermissionInput : selectedUser.report_permission,
      };
      setSelectedUser(nextUser);
      setUsers(prev => prev.map(u => u.id === selectedUser.id ? nextUser : u));
      setMyauctionPwInput('');
      alert('자료 생성 설정이 저장되었습니다.');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingAuctionSettings(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!selectedUser || !isAdminPlus || selectedUser.id === currentUser?.id) return;
    const nextPassword = resetPasswordInput.trim();
    if (nextPassword.length < MIN_PASSWORD_LENGTH) {
      alert(`임시 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상으로 입력하세요.`);
      return;
    }
    if (!confirm(`${selectedUser.name}님의 비밀번호를 입력한 임시 비밀번호로 초기화하시겠습니까?`)) return;
    setResettingPassword(true);
    try {
      await api.users.update(selectedUser.id, { password: nextPassword });
      setResetPasswordInput('');
      alert('비밀번호가 초기화되었습니다.');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setResettingPassword(false);
    }
  };

  // ── 상세 페이지: 사용자 클릭 시 ──
  const handleSelectUser = async (u: User) => {
    setSelectedUser(u);
    setPreviousEmployeeAccount(null);
    setResetPasswordInput('');
    setMyauctionIdInput(u.myauction_id || '');
    setMyauctionPwInput('');
    setReportPermissionInput(u.report_permission || 'basic');
    setHireDateInput(u.hire_date || '');
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    setAccountingEffectiveMonth(kst.toISOString().slice(0, 7));
    // 알림톡 설정 로드
    try {
      const alimRes = await api.users.getAlimtalkSettings(u.id);
      setAlimBranches(new Set(alimRes.branches ? alimRes.branches.split(',').map(normalizeBranchName).filter(Boolean) : []));
    } catch { setAlimBranches(new Set()); }
    if (!canViewAccounting) return;
    // 총무보조 제한 대상: 회계 정보 로드 생략
    if (isRestrictedForViewer(u)) {
      setSalaryInput('');
      setGradeInput('');
      setPosAllowanceInput('0');
      setCardNumbers(['']);
      setPayType('salary');
      setCommissionRate('');
      setPreviousEmployeeAccount(null);
      setEvaluations([]);
      return;
    }
    try {
      const [accRes, evalRes] = await Promise.all([
        api.accounting.get(u.id),
        api.accounting.evaluations(u.id),
      ]);
      const acc = accRes.account;
      setPreviousEmployeeAccount(accRes.previous_employee_account);
      setSalaryInput(acc?.salary?.toString() || '');
      setGradeInput(acc?.grade || '');
      setPosAllowanceInput(acc?.position_allowance?.toString() || '0');
      setCardNumbers(u.card_number ? u.card_number.split(',').map((s: string) => s.trim()) : ['']);
      setPayType(acc?.pay_type || 'salary');
      setCommissionRate(acc?.commission_rate?.toString() || '');
      setSsnInput(acc?.ssn || '');
      setAddressInput(acc?.address || '');
      setEvaluations(evalRes.evaluations);
    } catch {
      setSalaryInput('');
      setGradeInput('');
      setPosAllowanceInput('0');
      setCardNumbers(['']);
      setPayType('salary');
      setCommissionRate('');
      setSsnInput('');
      setAddressInput('');
      setPreviousEmployeeAccount(null);
      setEvaluations([]);
    }
  };

  const handleSaveAccounting = async () => {
    if (!selectedUser || !canEditAccounting) return;
    if (isRestrictedForViewer(selectedUser)) {
      alert('해당 직원의 급여·회계 정보 수정 권한이 없습니다.');
      return;
    }
    setSaving(true);
    try {
      const result = await api.accounting.update(selectedUser.id, {
        salary: payType === 'commission' ? 0 : (Number(salaryInput) || 0),
        grade: payType === 'commission' ? '' : gradeInput,
        position_allowance: Number(posAllowanceInput) || 0,
        pay_type: payType,
        commission_rate: Number(commissionRate) || 0,
        ssn: ssnInput,
        address: addressInput,
        effective_month: accountingEffectiveMonth,
      });
      // 카드번호도 저장
      await api.card.updateUserCard(selectedUser.id, cardNumbers.filter(c => c.trim()).join(','));
      const recalculationNotice = result.recalculation_required_periods?.length
        ? `\n다시 계산·저장해야 하는 미확정 정산: ${result.recalculation_required_periods.join(', ')}`
        : '';
      alert(`${result.effective_month}부터 적용되도록 저장했습니다.${recalculationNotice}`);
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  const selectCommissionPayType = () => {
    setPayType('commission');
    if (normalizeCommissionRate(commissionRate) === null) {
      setCommissionRate('50');
    }
  };

  const handleConvertToEmployee = async () => {
    if (!selectedUser || !canConvertEmploymentType) return;
    if (selectedUser.login_type !== 'freelancer') {
      alert('이미 일반 계정입니다.');
      return;
    }
    if (payType !== 'salary') {
      alert('급여제로 전환한 뒤 급여 정보를 입력해주세요.');
      return;
    }
    const salary = Number(salaryInput) || 0;
    const positionAllowance = Number(posAllowanceInput) || 0;
    if (salary <= 0) {
      alert('정규직 전환에는 0보다 큰 급여가 필요합니다.');
      return;
    }
    if (positionAllowance < 0) {
      alert('직책수당은 0 이상으로 입력해주세요.');
      return;
    }
    if (gradeInput && !GRADE_OPTIONS.includes(gradeInput as any)) {
      alert('직급 값이 올바르지 않습니다.');
      return;
    }
    if (!confirm(`${selectedUser.name}님을 정규직 계정으로 전환하시겠습니까?\n전환 후 일반 로그인 계정으로 변경되고, 기존 개인 데이터와 전환 전 업무 역할을 이어서 사용합니다.`)) return;

    setConverting(true);
    try {
      const res = await api.users.convertToEmployee(selectedUser.id, {
        salary,
        grade: gradeInput,
        position_allowance: positionAllowance,
        effective_month: new Date().toISOString().slice(0, 7),
      });
      const nextUser = { ...selectedUser, ...res.user, login_type: 'employee' as const };
      setSelectedUser(nextUser);
      setUsers(prev => prev.map(u => u.id === selectedUser.id ? nextUser : u));
      setSalaryInput(String(res.account.salary || salary));
      setGradeInput(res.account.grade || gradeInput);
      setPosAllowanceInput(String(res.account.position_allowance || positionAllowance || 0));
      setPayType('salary');
      setCommissionRate('0');
      setSsnInput(res.account.ssn || ssnInput);
      setAddressInput(res.account.address || addressInput);
      setPreviousEmployeeAccount(null);
      alert('정규직 전환이 완료되었습니다. 기존 개인 데이터와 전환 전 업무 역할·급여 이력은 이어서 사용됩니다.');
    } catch (err: any) { alert(err.message); }
    finally { setConverting(false); }
  };

  const handleConvertToFreelancer = async () => {
    if (!selectedUser || !canConvertEmploymentType) return;
    if ((selectedUser.login_type || 'employee') !== 'employee') {
      alert('이미 프리랜서 계정입니다.');
      return;
    }
    if (!canConvertEmployeeRoleToFreelancer(selectedUser.role)) {
      alert('팀장·팀원 계정만 프리랜서로 전환할 수 있습니다. 명도팀·PD·사무장과 관리자 이상 계정은 일반 로그인을 유지합니다.');
      return;
    }
    if (payType !== 'commission') {
      alert('비율제로 전환한 뒤 지급 비율을 입력해주세요.');
      return;
    }
    const rate = normalizeCommissionRate(commissionRate);
    if (rate === null) {
      alert('비율은 0보다 크고 100 이하로 입력해주세요.');
      return;
    }
    const positionAllowance = Number(posAllowanceInput) || 0;
    if (positionAllowance < 0) {
      alert('직책수당은 0 이상으로 입력해주세요.');
      return;
    }

    setConverting(true);
    try {
      const preview = await api.users.freelancerConversionImpact(selectedUser.id);
      const blockers = freelancerConversionBlockers(preview.impact);

      const impact = preview.impact;
      const pendingWorkNotice = blockers.length > 0
        ? `\n전환과 함께 자동 처리\n`
          + `• 휴가 신청·취소 대기 ${impact.pending_leave_requests}건: 취소 처리\n`
          + `• 작성 중·제출 중인 일반 사내 문서 ${impact.active_non_myauction_documents}건: 취소/반려 처리\n`
          + `• 다른 직원 문서의 담당 결재 ${impact.pending_approval_steps}건: 일반 로그인 관리자에게 재배정\n`
          + `• 마이옥션 문서와 매출 미작성 알림은 그대로 유지\n`
        : '';
      const confirmed = confirm(
        `${selectedUser.name}님을 프리랜서 계정으로 전환하시겠습니까?\n\n`
        + `전환 후 변경\n`
        + `• 프리랜서 로그인과 비율제 ${rate}% 적용\n`
        + `• 급여·기준매출·직급은 0/미지정으로 전환\n`
        + `• 기존 업무 역할은 유지 (팀장은 프리랜서 팀 감독 범위 유지)\n`
        + `• 현재 로그인 세션은 종료되어 프리랜서로 다시 로그인 필요\n\n`
        + pendingWorkNotice
        + `삭제되지 않고 보존되는 기존 데이터\n`
        + `• 문서 ${impact.documents}건 (사내 문서 ${impact.non_myauction_documents}건은 관리자만 열람)\n`
        + `• 매출 ${impact.sales_records}건, 사건 ${impact.cases}건\n`
        + `• 연차 사용 ${impact.annual_leave_used}/${impact.annual_leave_total}일 및 휴가 이력\n`
        + `• 조직도 연결 ${impact.org_nodes}건\n\n`
        + `전환 월 이전 급여제 내역은 이력으로 보존됩니다.`,
      );
      if (!confirmed) return;

      const effectiveMonth = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
      const res = await api.users.convertToFreelancer(selectedUser.id, {
        commission_rate: rate,
        position_allowance: positionAllowance,
        ssn: ssnInput,
        address: addressInput,
        effective_month: effectiveMonth,
        resolve_pending_work: blockers.length > 0,
      });
      const nextUser = { ...selectedUser, ...res.user, login_type: 'freelancer' as const };
      setSelectedUser(nextUser);
      setUsers(prev => prev.map(u => u.id === selectedUser.id ? nextUser : u));
      setSalaryInput('0');
      setGradeInput('');
      setPosAllowanceInput(String(res.account.position_allowance || 0));
      setPayType('commission');
      setCommissionRate(String(res.account.commission_rate || rate));
      setSsnInput(res.account.ssn || '');
      setAddressInput(res.account.address || '');
      try {
        const refreshedAccounting = await api.accounting.get(nextUser.id);
        setPreviousEmployeeAccount(refreshedAccounting.previous_employee_account);
      } catch {
        const previousSalary = Number(salaryInput) || 0;
        setPreviousEmployeeAccount({
          salary: previousSalary,
          standard_sales: Math.round(previousSalary * 1.3 * 4),
          grade: (GRADE_OPTIONS.includes(gradeInput as any) ? gradeInput : '') as '' | 'M1' | 'M2' | 'M3' | 'M4',
          position_allowance: positionAllowance,
        });
      }
      const cleanupMessage = res.cleanup
        ? `\n자동 처리: 휴가 ${res.cleanup.cancelled_leave_requests}건 취소, 일반 문서 ${res.cleanup.cancelled_non_myauction_documents}건 취소, 결재 ${res.cleanup.reassigned_approval_steps}건 재배정${res.cleanup.reassigned_to ? ` (${res.cleanup.reassigned_to})` : ''}`
        : '';
      alert(`프리랜서 전환이 완료되었습니다. 기존 업무 역할과 데이터·전환 전 급여 이력은 보존됩니다.${cleanupMessage}`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setConverting(false);
    }
  };

  const handleGradeDemotion = async (userId: string, newGrade: string) => {
    if (!confirm(`직급을 ${newGrade}로 변경하시겠습니까?`)) return;
    try {
      await api.accounting.updateGrade(userId, newGrade);
      setGradeInput(newGrade);
      if (selectedUser) handleSelectUser(selectedUser);
    } catch (err: any) { alert(err.message); }
  };

  const handleEvaluate = async (periodStart: string, periodEnd: string) => {
    if (!confirm(`${periodStart} ~ ${periodEnd} 기간의 매출 평가를 실행하시겠습니까?`)) return;
    try {
      await api.accounting.evaluate(periodStart, periodEnd);
      alert('평가가 완료되었습니다.');
      if (selectedUser) handleSelectUser(selectedUser);
    } catch (err: any) { alert(err.message); }
  };

  const isAdminPlus = !!currentUser && ['master', 'ceo', 'cc_ref', 'admin'].includes(currentUser.role);
  const canEditPositionTitle = isAdminPlus || currentUser?.role === 'accountant';
  const canEditResignedDate = isAdminPlus || currentUser?.role === 'accountant';

  const calculatedStandardSales = Math.round((Number(salaryInput) || 0) * 1.3 * 4);

  // 평가 기간 생성
  const getEvaluationPeriods = (count: number = 3) => {
    const periods: { start: string; end: string; label: string }[] = [];
    const now = new Date();
    let year = now.getFullYear();
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
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 상세 페이지 (사용자 클릭 시)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (selectedUser) {
    const canEditAuctionSettings = selectedUser.id === currentUser?.id || ['master', 'ceo', 'cc_ref', 'admin'].includes(currentUser?.role || '');
    return (
      <div className="page">
        <div className="page-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setSelectedUser(null)} style={{ marginRight: 4 }}>
              <ChevronLeft size={16} /> 목록으로
            </button>
            <UserCog size={24} /> {selectedUser.name} 상세정보
          </h2>
        </div>

        {/* 기본 정보 카드 */}
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: '1rem', color: '#1a1a2e' }}>기본 정보</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            <div>
              <span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>이름</span>
              <div style={{ fontWeight: 600, fontSize: '1rem' }}>{selectedUser.name}</div>
            </div>
            <div>
              <span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>이메일</span>
              <div style={{ fontSize: '0.9rem' }}>{selectedUser.email}</div>
            </div>
            <div>
              <span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>역할</span>
              <div><span className={`role-badge role-${selectedUser.role}`}>{ROLE_LABELS[selectedUser.role as Role]}</span></div>
            </div>
            <div>
              <span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>보직</span>
              <div>{selectedUser.position_title || '-'}</div>
            </div>
            <div>
              <span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>지사</span>
              <div>{selectedUser.branch || '-'}</div>
            </div>
            <div>
              <span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>부서</span>
              <div>{selectedUser.department || '-'}</div>
            </div>
            <div>
              <span style={{ color: '#9aa0a6', fontSize: '0.8rem' }}>입사기준일</span>
              {canSetHireDate ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <input type="date" className="form-input" style={{ width: 150 }}
                    value={hireDateInput}
                    onChange={(e) => setHireDateInput(e.target.value)} />
                  <button className="btn btn-sm btn-primary"
                    disabled={hireDateInput === (selectedUser.hire_date || '')}
                    onClick={() => handleHireDateSave(selectedUser.id, hireDateInput)}>
                    저장
                  </button>
                </div>
              ) : (
                <div style={{ fontWeight: 600 }}>{selectedUser.hire_date || '-'}</div>
              )}
            </div>
          </div>
          {isAdminPlus && selectedUser.id !== currentUser?.id && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e8eaed' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 700, color: '#1a1a2e' }}>
                <KeyRound size={16} /> 비밀번호 초기화
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  className="form-input"
                  value={resetPasswordInput}
                  onChange={(e) => setResetPasswordInput(e.target.value)}
                  placeholder="임시 비밀번호 입력"
                  style={{ width: 220, maxWidth: '100%' }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={handlePasswordReset}
                  disabled={resettingPassword || resetPasswordInput.trim().length < MIN_PASSWORD_LENGTH}
                >
                  {resettingPassword ? '초기화 중...' : '비밀번호 초기화'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 자료 생성 설정 */}
        <div className="card" style={{ marginBottom: 20, padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: '1rem', color: '#1a1a2e' }}>자료 생성 설정</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>마이옥션 아이디</label>
              <input
                className="form-input"
                value={myauctionIdInput}
                onChange={(e) => setMyauctionIdInput(e.target.value)}
                disabled={!canEditAuctionSettings}
                placeholder="마이옥션 아이디"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>마이옥션 비밀번호</label>
              <input
                type="password"
                className="form-input"
                value={myauctionPwInput}
                onChange={(e) => setMyauctionPwInput(e.target.value)}
                disabled={!canEditAuctionSettings}
                placeholder={selectedUser.has_myauction_credentials ? '저장됨 - 변경 시에만 입력' : '마이옥션 비밀번호'}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '0.72rem', color: selectedUser.has_myauction_credentials ? '#188038' : '#9aa0a6', marginTop: 4 }}>
                {selectedUser.has_myauction_credentials ? '마이옥션 계정이 저장되어 있습니다.' : '저장된 마이옥션 계정이 없습니다.'}
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>자료 생성 권한</label>
              <select
                className="form-input"
                value={reportPermissionInput}
                onChange={(e) => setReportPermissionInput(e.target.value as 'basic' | 'special')}
                disabled={!canGrantReportPermission}
                style={{ width: '100%' }}
              >
                <option value="basic">basic - 브리핑자료</option>
                <option value="special">special - 브리핑자료 + 권리분석 보증서</option>
              </select>
              <div style={{ fontSize: '0.72rem', color: canGrantReportPermission ? '#5f6368' : '#9aa0a6', marginTop: 4 }}>
                권한 부여는 현재 마스터만 가능합니다.
              </div>
            </div>
          </div>
          {(canEditAuctionSettings || canGrantReportPermission) && (
            <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={handleAuctionSettingsSave} disabled={savingAuctionSettings}>
                {savingAuctionSettings ? '저장중...' : '자료 생성 설정 저장'}
              </button>
              {!canGrantReportPermission && (
                <span style={{ fontSize: '0.76rem', color: '#9aa0a6' }}>마이옥션 계정만 저장됩니다.</span>
              )}
            </div>
          )}
        </div>

        {/* 회계 정보 카드 (회계 열람 가능자만, 총무보조 제한 대상 제외) */}
        {canViewAccounting && isRestrictedForViewer(selectedUser) && (
          <div className="card" style={{ padding: 16, marginBottom: 16, background: '#fff8e1', borderLeft: '3px solid #f4d03f' }}>
            <div style={{ fontSize: '0.85rem', color: '#5f6368' }}>
              <strong style={{ color: '#e65100' }}>🔒 열람 제한</strong> — 해당 직원의 급여·회계 정보는 <strong>총무담당 이상</strong>만 조회할 수 있습니다.
            </div>
          </div>
        )}
        {canViewAccounting && !isRestrictedForViewer(selectedUser) && (
          <div className="card" style={{ marginBottom: 20, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#1a1a2e' }}>
                {payType === 'commission' ? '비율제 설정' : '급여 및 직급 설정'}
              </h3>
              {canEditAccounting && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '0.78rem', color: payType === 'salary' ? '#1a73e8' : '#9aa0a6', fontWeight: payType === 'salary' ? 700 : 400 }}>급여제</span>
                  <div onClick={() => payType === 'salary' ? selectCommissionPayType() : setPayType('salary')}
                    style={{ width: 44, height: 24, borderRadius: 12, background: payType === 'commission' ? '#7b1fa2' : '#dadce0', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                    <div style={{ width: 20, height: 20, borderRadius: 10, background: '#fff', position: 'absolute', top: 2, left: payType === 'commission' ? 22 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </div>
                  <span style={{ fontSize: '0.78rem', color: payType === 'commission' ? '#7b1fa2' : '#9aa0a6', fontWeight: payType === 'commission' ? 700 : 400 }}>비율제</span>
                </div>
              )}
            </div>

            {canEditAccounting && (
              <div style={{ marginBottom: 16, padding: 14, border: '1px solid #d2e3fc', borderRadius: 8, background: '#f8fbff' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: 6, color: '#174ea6' }}>
                  적용 시작월
                </label>
                <select
                  className="form-input"
                  value={accountingEffectiveMonth}
                  onChange={(e) => setAccountingEffectiveMonth(e.target.value)}
                  style={{ width: '100%', maxWidth: 260 }}
                >
                  {Array.from({ length: 24 }, (_, index) => {
                    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
                    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
                    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
                    return <option key={value} value={value}>{date.getUTCFullYear()}년 {date.getUTCMonth() + 1}월</option>;
                  })}
                </select>
                <div style={{ fontSize: '0.75rem', color: '#5f6368', marginTop: 6 }}>
                  선택한 월부터 급여·기준매출·직급·정산유형이 적용됩니다. 미확정 정산은 다시 계산 후 저장해야 하며, 확정된 정산은 먼저 확정취소해야 합니다.
                </div>
              </div>
            )}

            {selectedUser.login_type === 'freelancer' && (
              <div style={{ marginBottom: 16, padding: 14, border: '1px solid #e8eaed', borderRadius: 8, background: '#f8fbff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1a1a2e' }}>프리랜서 계정</div>
                    <div style={{ fontSize: '0.78rem', color: '#5f6368', marginTop: 4 }}>
                      급여제 정보 확인 후 정규직 전환을 실행하면 일반 로그인 계정으로 변경됩니다.
                    </div>
                  </div>
                  {canConvertEmploymentType && payType !== 'salary' && (
                    <button type="button" className="btn btn-sm" onClick={() => {
                      setPayType('salary');
                      if (previousEmployeeAccount) {
                        setSalaryInput(String(previousEmployeeAccount.salary || ''));
                        setGradeInput(previousEmployeeAccount.grade || '');
                        setPosAllowanceInput(String(previousEmployeeAccount.position_allowance || 0));
                      }
                    }}>
                      이전 급여정보 불러오기
                    </button>
                  )}
                </div>
              </div>
            )}

            {(selectedUser.login_type || 'employee') === 'employee'
              && canConvertEmployeeRoleToFreelancer(selectedUser.role) && (
              <div style={{ marginBottom: 16, padding: 14, border: '1px solid #e1bee7', borderRadius: 8, background: '#fcf7ff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#5b217a' }}>정규직 계정</div>
                    <div style={{ fontSize: '0.78rem', color: '#5f6368', marginTop: 4 }}>
                      비율제 정보 확인 후 프리랜서 전환을 실행합니다. 시스템 권한은 팀원으로 조정되며 기존 매출·문서·사건·연차 이력은 삭제되지 않습니다.
                    </div>
                  </div>
                  {canConvertEmploymentType && payType !== 'commission' && (
                    <button type="button" className="btn btn-sm" onClick={selectCommissionPayType}>
                      비율제 입력
                    </button>
                  )}
                </div>
              </div>
            )}

            {payType === 'salary' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 20 }}>
                {/* 급여 */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>급여 (월급)</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input className="form-input" value={toMoneyDisplay(salaryInput)}
                      onChange={(e) => setSalaryInput(fromMoneyDisplay(e.target.value))}
                      placeholder="급여 입력" disabled={!canEditAccounting} style={{ flex: 1 }} />
                    <span style={{ fontSize: '0.85rem', color: '#9aa0a6' }}>원</span>
                  </div>
                </div>
                {/* 기준매출 */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>기준매출 (급여 x 1.3 x 4)</label>
                  <div style={{ padding: '10px 14px', background: calculatedStandardSales > 0 ? '#e8f5e9' : '#f5f5f5', borderRadius: 8, fontSize: '1.1rem', fontWeight: 700, color: calculatedStandardSales > 0 ? '#188038' : '#9aa0a6' }}>
                    {calculatedStandardSales > 0 ? formatCurrency(calculatedStandardSales) : '-'}
                  </div>
                </div>
                {/* 직급 */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>직급단계</label>
                  <select className="form-input" value={gradeInput} onChange={(e) => setGradeInput(e.target.value)} disabled={!canEditAccounting} style={{ width: '100%' }}>
                    <option value="">미지정</option>
                    {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                {/* 직급수당 */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>직급수당</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input className="form-input" value={toMoneyDisplay(posAllowanceInput)}
                      onChange={(e) => setPosAllowanceInput(fromMoneyDisplay(e.target.value))}
                      disabled={!canEditAccounting} style={{ flex: 1 }} placeholder="0" />
                    <span style={{ fontSize: '0.85rem', color: '#9aa0a6' }}>원</span>
                  </div>
                </div>
                {/* 법인카드 */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>법인카드 번호</label>
                  {cardNumbers.map((cn, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                      <input className="form-input" value={cn}
                        onChange={(e) => setCardNumbers(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                        disabled={!canEditAccounting} style={{ flex: 1 }} placeholder={`카드${i + 1} 뒤 4자리`} />
                      {canEditAccounting && cardNumbers.length > 1 && (
                        <button type="button" style={{ background: 'none', border: 'none', color: '#d93025', cursor: 'pointer', fontSize: '1rem', padding: '0 4px' }}
                          onClick={() => setCardNumbers(prev => prev.filter((_, idx) => idx !== i))}>×</button>
                      )}
                    </div>
                  ))}
                  {canEditAccounting && (
                    <button type="button" className="btn btn-sm" style={{ fontSize: '0.72rem', marginTop: 2 }}
                      onClick={() => setCardNumbers(prev => [...prev, ''])}>+ 카드 추가</button>
                  )}
                </div>
              </div>
            ) : (
              /* 비율제 */
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#7b1fa2' }}>비율 (%)</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input className="form-input" type="number" step="0.1" min="0.1" max="100"
                      value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)}
                      disabled={!canEditAccounting} style={{ flex: 1 }} placeholder="기본 50" />
                    <span style={{ fontSize: '0.85rem', color: '#9aa0a6' }}>%</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#9aa0a6', marginTop: 4 }}>매출 대비 지급 비율</div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>직급수당</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input className="form-input" value={toMoneyDisplay(posAllowanceInput)}
                      onChange={(e) => setPosAllowanceInput(fromMoneyDisplay(e.target.value))}
                      disabled={!canEditAccounting} style={{ flex: 1 }} placeholder="0" />
                    <span style={{ fontSize: '0.85rem', color: '#9aa0a6' }}>원</span>
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>법인카드 번호</label>
                  {cardNumbers.map((cn, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                      <input className="form-input" value={cn}
                        onChange={(e) => setCardNumbers(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                        disabled={!canEditAccounting} style={{ flex: 1 }} placeholder={`카드${i + 1} 뒤 4자리`} />
                      {canEditAccounting && cardNumbers.length > 1 && (
                        <button type="button" style={{ background: 'none', border: 'none', color: '#d93025', cursor: 'pointer', fontSize: '1rem', padding: '0 4px' }}
                          onClick={() => setCardNumbers(prev => prev.filter((_, idx) => idx !== i))}>×</button>
                      )}
                    </div>
                  ))}
                  {canEditAccounting && (
                    <button type="button" className="btn btn-sm" style={{ fontSize: '0.72rem', marginTop: 2 }}
                      onClick={() => setCardNumbers(prev => [...prev, ''])}>+ 카드 추가</button>
                  )}
                </div>
                <div style={{ gridColumn: '1 / -1', paddingTop: 14, borderTop: '1px dashed #e0e0e0', marginTop: 4 }}>
                  <div style={{ fontSize: '0.78rem', color: '#7b1fa2', fontWeight: 700, marginBottom: 10 }}>
                    📋 사업소득신고용 정보 (세무사 제출)
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>주민등록번호</label>
                  <input className="form-input" value={ssnInput}
                    onChange={(e) => setSsnInput(e.target.value)}
                    disabled={!canEditAccounting} style={{ width: '100%' }}
                    placeholder="880101-1234567" maxLength={14} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>주소</label>
                  <input className="form-input" value={addressInput}
                    onChange={(e) => setAddressInput(e.target.value)}
                    disabled={!canEditAccounting} style={{ width: '100%' }}
                    placeholder="서울특별시 ..." />
                </div>
              </div>
            )}

            {canEditAccounting && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveAccounting}
                  disabled={saving || (selectedUser.login_type === 'freelancer' ? payType !== 'commission' : payType !== 'salary')}
                  title={selectedUser.login_type === 'freelancer' && payType !== 'commission'
                    ? '정규직 전환 버튼으로 변경해 주세요.'
                    : selectedUser.login_type !== 'freelancer' && payType !== 'salary'
                      ? '프리랜서 전환 버튼으로 변경해 주세요.'
                      : ''}
                >
                  {saving ? '저장중...' : '저장'}
                </button>
                {selectedUser.login_type === 'freelancer' && canConvertEmploymentType && (
                  <button className="btn btn-success" onClick={handleConvertToEmployee} disabled={converting || saving || payType !== 'salary'}>
                    {converting ? '전환중...' : '정규직 전환 저장'}
                  </button>
                )}
                {(selectedUser.login_type || 'employee') === 'employee'
                  && canConvertEmploymentType
                  && canConvertEmployeeRoleToFreelancer(selectedUser.role) && (
                  <button
                    className="btn"
                    style={{ background: '#7b1fa2', color: '#fff' }}
                    onClick={handleConvertToFreelancer}
                    disabled={converting || saving || payType !== 'commission'}
                  >
                    {converting ? '전환중...' : '프리랜서 전환 저장'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 알림톡 수신 설정 (선택된 사용자가 총무일 때만) */}
        {['accountant', 'accountant_asst'].includes(selectedUser.role) && ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(currentUser?.role || '') && (
          <div className="card" style={{ marginBottom: 20, padding: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', color: '#1a1a2e' }}>알림톡 수신 설정</h3>
            <p style={{ fontSize: '0.78rem', color: '#9aa0a6', margin: '0 0 14px' }}>지사별 알림톡 수신 여부를 설정합니다.</p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {ALIM_BRANCHES.map(branch => {
                const isOn = alimBranches.has(branch);
                return (
                  <div key={branch} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: 50, color: isOn ? '#1a1a2e' : '#9aa0a6' }}>{branch}</span>
                    <div onClick={async () => {
                      const next = new Set(alimBranches);
                      if (isOn) next.delete(branch); else next.add(branch);
                      setAlimBranches(next);
                      try {
                        await api.users.updateAlimtalkSettings(selectedUser!.id, [...next].join(','));
                      } catch (err: any) { alert(err.message); }
                    }}
                      style={{ width: 44, height: 24, borderRadius: 12, background: isOn ? '#1a73e8' : '#dadce0', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                      <div style={{ width: 20, height: 20, borderRadius: 10, background: '#fff', position: 'absolute', top: 2, left: isOn ? 22 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 매출 평가 이력 (회계 열람 가능자만) */}
        {canViewAccounting && (
          <div className="card" style={{ marginBottom: 20, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#1a1a2e' }}>매출 평가 이력 (2개월 단위)</h3>
              {canEditAccounting && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {getEvaluationPeriods(3).map((p) => (
                    <button key={p.start} className="btn btn-sm" onClick={() => handleEvaluate(p.start, p.end)}>
                      {p.label} 평가
                    </button>
                  ))}
                </div>
              )}
            </div>

            {evaluations.length === 0 ? (
              <div className="empty-state">매출 평가 기록이 없습니다.</div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>평가 기간</th>
                      <th>기준매출</th>
                      <th>실제매출</th>
                      <th>달성률</th>
                      <th>결과</th>
                      <th>연속 미달</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluations.map((ev) => {
                      const rate = ev.standard_sales > 0 ? (ev.total_sales / ev.standard_sales * 100) : 0;
                      return (
                        <tr key={ev.id} style={{ background: ev.consecutive_misses >= 3 ? '#fce4ec' : ev.met_target ? '#e8f5e9' : '#fff3e0' }}>
                          <td style={{ fontSize: '0.85rem' }}>{ev.period_start} ~ {ev.period_end}</td>
                          <td>{formatCurrency(ev.standard_sales)}</td>
                          <td style={{ fontWeight: 700 }}>{formatCurrency(ev.total_sales)}</td>
                          <td>
                            <span style={{ color: rate >= 100 ? '#188038' : rate >= 70 ? '#e65100' : '#d93025', fontWeight: 700 }}>
                              {rate.toFixed(1)}%
                            </span>
                          </td>
                          <td>
                            {ev.met_target ? (
                              <span style={{ color: '#188038', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <TrendingUp size={14} /> 달성
                              </span>
                            ) : (
                              <span style={{ color: '#d93025', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <TrendingDown size={14} /> 미달
                              </span>
                            )}
                          </td>
                          <td>
                            {ev.consecutive_misses >= 3 ? (
                              <span style={{ color: '#d93025', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <AlertTriangle size={14} /> {ev.consecutive_misses}회 — 강등 대상
                              </span>
                            ) : ev.consecutive_misses > 0 ? (
                              <span style={{ color: '#e65100', fontWeight: 600 }}>{ev.consecutive_misses}회</span>
                            ) : (
                              <span style={{ color: '#9aa0a6' }}>-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 강등 대상 경고 및 조치 */}
        {canEditAccounting && evaluations.some((ev) => ev.consecutive_misses >= 3) && (
          <div className="card" style={{ marginBottom: 20, padding: 20, border: '2px solid #d93025', background: '#fce4ec' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', color: '#d93025', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowDownCircle size={20} /> 강등 대상 알림
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: '#5f6368' }}>
              기준매출 미달 3회 연속입니다. 직급 강등 조치를 진행할 수 있습니다.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {GRADE_OPTIONS.filter((g) => g !== gradeInput).map((g) => (
                <button key={g} className="btn btn-sm btn-danger" onClick={() => handleGradeDemotion(selectedUser.id, g)}>
                  {g}로 변경
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 목록 페이지
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <div className="page">
      <div className="page-header">
        <h2><UserCog size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 사용자 관리</h2>
      </div>

      {/* Tabs + 검색 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
        <div className="filter-bar" style={{ marginBottom: 0 }}>
          <button className={`filter-btn ${tab === 'approved' ? 'active' : ''}`} onClick={() => setTab('approved')}>
            승인된 사용자 ({users.filter(u => u.role !== 'resigned').length})
          </button>
          {canManagePending && (
            <button className={`filter-btn ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
              가입 대기 {pendingUsers.length > 0 && <span className="pending-badge">{pendingUsers.length}</span>}
            </button>
          )}
          <button className={`filter-btn ${tab === 'resigned' ? 'active' : ''}`} onClick={() => setTab('resigned')} style={tab === 'resigned' ? { background: '#9aa0a6', color: '#fff' } : {}}>
            퇴사자 ({users.filter(u => u.role === 'resigned').length})
          </button>
        </div>
        {tab === 'approved' && (
          <input className="form-input" placeholder="이름, 이메일, 지사, 팀 검색" value={userSearchTerm} onChange={(e) => setUserSearchTerm(e.target.value)}
            style={{ width: 220, fontSize: '0.82rem', padding: '6px 10px' }} />
        )}
      </div>

      {/* ── 승인된 사용자 목록 ── */}
      {tab === 'approved' && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>이름</th><th>이메일</th><th>역할</th><th>보직</th><th>지사</th><th>팀</th><th>가입일</th><th></th></tr>
            </thead>
            <tbody>
              {users.filter((u) => u.role !== 'resigned').filter((u) => u.role !== 'master' || currentUser?.role === 'master').filter(u => {
                if (!userSearchTerm) return true;
                const q = userSearchTerm.toLowerCase();
                return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.branch || '').toLowerCase().includes(q) || (u.department || '').toLowerCase().includes(q) || (u.position_title || '').toLowerCase().includes(q);
              }).map((u) => {
                const isSameBranch = currentUser?.role !== 'admin' || sameBranchName(u.branch, currentUser?.branch);
                const canEdit = availableRoles.length > 0 && u.id !== currentUser?.id && isSameBranch;
                const targetLevel = hierarchy[u.role] || 99;
                const isHigher = targetLevel < myLevel || (targetLevel === myLevel && u.role !== 'cc_ref');
                const isAccountantRestrictedTarget = currentUser?.role === 'accountant' && ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(u.role as string);
                const canDel = isAdminPlus && canEdit && !isHigher;
                const canChangeRole = canEdit && !isHigher && !isAccountantRestrictedTarget;
                const canChangePosition = canEditPositionTitle && u.id !== currentUser?.id && !isAccountantRestrictedTarget;
                return (
                  <tr key={u.id} onClick={() => handleSelectUser(u)} className="clickable-row" style={{ cursor: 'pointer' }}>
                    <td><strong>{u.name}</strong>{(u as any).login_type === 'freelancer' && <span style={{ marginLeft: 6, fontSize: '0.65rem', background: '#7b1fa2', color: '#fff', padding: '1px 6px', borderRadius: 8 }}>프리랜서</span>}</td>
                    <td style={{ fontSize: '0.75rem' }}>{u.email}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canChangeRole ? (
                        <Select size="sm" options={availableRoles}
                          value={availableRoles.find((o) => o.value === u.role) || ROLE_OPTS.find((o) => o.value === u.role) || null}
                          onChange={(o: any) => o && handleRoleChange(u.id, o.value)}
                          placeholder="역할" />
                      ) : (
                        <span className={`role-badge role-${u.role}`}>{ROLE_LABELS[u.role as Role]}</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canChangePosition ? (
                        <Select size="sm" options={POSITION_OPTS}
                          value={POSITION_OPTS.find((o) => o.value === u.position_title) || (u.position_title ? { value: u.position_title, label: u.position_title } : null)}
                          onChange={(o: any) => handleProfileChange(u.id, { position_title: o?.value || '' })}
                          placeholder="보직" isClearable />
                      ) : (
                        <span>{u.position_title || '-'}</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {isAdminPlus && u.id !== currentUser?.id ? (
                        <Select size="sm" options={BRANCH_OPTS}
                          value={BRANCH_OPTS.find((o) => o.value === u.branch) || null}
                          onChange={(o: any) => handleProfileChange(u.id, { branch: o?.value || '' })}
                          placeholder="지사" isClearable />
                      ) : (
                        <span>{u.branch || '-'}</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {isAdminPlus && u.id !== currentUser?.id ? (
                        <Select size="sm" options={DEPT_OPTS}
                          value={DEPT_OPTS.find((o) => o.value === u.department) || null}
                          onChange={(o: any) => handleProfileChange(u.id, { department: o?.value || '' })}
                          placeholder="팀" isClearable />
                      ) : (
                        <span>{u.department || '-'}</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.72rem' }}>{u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}</td>
                    <td onClick={(e) => e.stopPropagation()}>{canDel && <button className="btn btn-sm btn-danger" onClick={() => handleDelete(u.id, u.name)}><Trash2 size={13} /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 퇴사자 목록 ── */}
      {tab === 'resigned' && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>이름</th><th>이메일</th><th>지사</th><th>팀</th><th>가입일</th><th>퇴사일</th><th>관리</th></tr></thead>
            <tbody>
              {users.filter(u => u.role === 'resigned').map(u => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td style={{ fontSize: '0.75rem' }}>{u.email}</td>
                  <td>{u.branch || '-'}</td>
                  <td>{u.department || '-'}</td>
                  <td style={{ fontSize: '0.72rem' }}>{u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}</td>
                  <td style={{ fontSize: '0.72rem' }}>{u.resigned_at ? new Date(u.resigned_at).toLocaleDateString('ko-KR') : '-'}</td>
                  <td>
                    {canEditResignedDate && <button className="btn btn-sm" style={{ marginRight: 6 }} onClick={() => handleResignedDateChange(u)}>퇴사일 수정</button>}
                    {isAdminPlus && (
                      <button className="btn btn-sm btn-success" onClick={async () => {
                        if (!confirm(`${u.name}님을 복직 처리하시겠습니까?`)) return;
                        try { await api.users.updateRole(u.id, 'member'); load(); } catch (err: any) { alert(err.message); }
                      }}><UserCheck size={13} /> 복직</button>
                    )}
                  </td>
                </tr>
              ))}
              {users.filter(u => u.role === 'resigned').length === 0 && (
                <tr><td colSpan={7} className="empty-state">퇴사자가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 가입 대기 목록 ── */}
      {tab === 'pending' && canManagePending && (
        pendingUsers.length === 0 ? (
          <div className="empty-state">승인 대기 중인 회원이 없습니다.</div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>이름</th><th>전화번호</th><th>이메일</th><th>지사</th><th>팀 배정</th><th>가입일</th><th>승인/거절</th></tr></thead>
              <tbody>
                {pendingUsers.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.name}</strong>{(u as any).login_type === 'freelancer' && <span style={{ marginLeft: 6, fontSize: '0.65rem', background: '#7b1fa2', color: '#fff', padding: '1px 6px', borderRadius: 8 }}>프리랜서</span>}</td>
                    <td>{u.phone || '-'}</td>
                    <td>{u.email}</td>
                    <td>{u.branch || '-'}</td>
                    <td>
                      <Select size="sm" options={DEPT_OPTS}
                        value={DEPT_OPTS.find((o) => o.value === (pendingDepts[u.id] || '')) || null}
                        onChange={(o: any) => setPendingDepts({ ...pendingDepts, [u.id]: o?.value || '' })}
                        placeholder="팀 선택" />
                    </td>
                    <td>{u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-success" onClick={() => handleApprove(u.id)}><UserCheck size={14} /> 승인</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleReject(u.id)}><UserX size={14} /> 거절</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

    </div>
  );
}
