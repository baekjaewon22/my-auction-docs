import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { User, SalesEvaluation } from '../types';
import { ROLE_LABELS, VISIBLE_ROLES } from '../types';
import { useBranches } from '../hooks/useBranches';
import type { Role } from '../types';
import Select, { toOptions } from '../components/Select';
import { Trash2, UserCheck, UserX, UserCog, ChevronLeft, TrendingDown, TrendingUp, AlertTriangle, ArrowDownCircle } from 'lucide-react';

import { useDepartments } from '../hooks/useDepartments';
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

  // 상세페이지 관련
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [salaryInput, setSalaryInput] = useState('');
  const [gradeInput, setGradeInput] = useState('');
  const [posAllowanceInput, setPosAllowanceInput] = useState('');
  const [cardNumbers, setCardNumbers] = useState<string[]>(['']);
  const [hireDateInput, setHireDateInput] = useState('');
  const [payType, setPayType] = useState<'salary' | 'commission'>('salary');
  const [commissionRate, setCommissionRate] = useState('');
  const [ssnInput, setSsnInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [evaluations, setEvaluations] = useState<SalesEvaluation[]>([]);
  const [saving, setSaving] = useState(false);
  // 알림톡 수신 설정
  const [alimBranches, setAlimBranches] = useState<Set<string>>(new Set());
  const ALIM_BRANCHES = ['의정부', '서초', '대전', '부산'];

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
    return [];
  };
  const availableRoles = getAvailableRoles();

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 계정을 삭제하시겠습니까?\n관련된 문서, 일지, 서명이 모두 삭제됩니다.`)) return;
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
    try { await api.users.updateRole(userId, role); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleProfileChange = async (userId: string, data: { position_title?: string; branch?: string; department?: string }) => {
    try { await api.users.update(userId, data); load(); }
    catch (err: any) { alert(err.message); }
  };

  // ── 상세 페이지: 사용자 클릭 시 ──
  const handleSelectUser = async (u: User) => {
    setSelectedUser(u);
    setHireDateInput(u.hire_date || '');
    // 알림톡 설정 로드
    try {
      const alimRes = await api.users.getAlimtalkSettings(u.id);
      setAlimBranches(new Set(alimRes.branches ? alimRes.branches.split(',') : []));
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
      setEvaluations([]);
      return;
    }
    try {
      const [accRes, evalRes] = await Promise.all([
        api.accounting.get(u.id),
        api.accounting.evaluations(u.id),
      ]);
      const acc = accRes.account;
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
      await api.accounting.update(selectedUser.id, {
        salary: payType === 'commission' ? 0 : (Number(salaryInput) || 0),
        grade: payType === 'commission' ? '' : gradeInput,
        position_allowance: Number(posAllowanceInput) || 0,
        pay_type: payType,
        commission_rate: Number(commissionRate) || 0,
        ssn: payType === 'commission' ? ssnInput : '',
        address: payType === 'commission' ? addressInput : '',
      });
      // 카드번호도 저장
      await api.card.updateUserCard(selectedUser.id, cardNumbers.filter(c => c.trim()).join(','));
      alert('저장되었습니다.');
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
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
                  <div onClick={() => setPayType(payType === 'salary' ? 'commission' : 'salary')}
                    style={{ width: 44, height: 24, borderRadius: 12, background: payType === 'commission' ? '#7b1fa2' : '#dadce0', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
                    <div style={{ width: 20, height: 20, borderRadius: 10, background: '#fff', position: 'absolute', top: 2, left: payType === 'commission' ? 22 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </div>
                  <span style={{ fontSize: '0.78rem', color: payType === 'commission' ? '#7b1fa2' : '#9aa0a6', fontWeight: payType === 'commission' ? 700 : 400 }}>비율제</span>
                </div>
              )}
            </div>

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
                    <input className="form-input" type="number" step="0.1" min="0" max="100"
                      value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)}
                      disabled={!canEditAccounting} style={{ flex: 1 }} placeholder="예: 30" />
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
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-primary" onClick={handleSaveAccounting} disabled={saving}>
                  {saving ? '저장중...' : '저장'}
                </button>
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
                const isSameBranch = currentUser?.role !== 'admin' || u.branch === currentUser?.branch;
                const canEdit = availableRoles.length > 0 && u.id !== currentUser?.id && isSameBranch;
                const targetLevel = hierarchy[u.role] || 99;
                const isHigher = targetLevel < myLevel || (targetLevel === myLevel && u.role !== 'cc_ref');
                const canDel = canEdit && !isHigher;
                const canChangeRole = canEdit && !isHigher;
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
                      {isAdminPlus && u.id !== currentUser?.id ? (
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
            <thead><tr><th>이름</th><th>이메일</th><th>지사</th><th>팀</th><th>가입일</th><th>복직</th></tr></thead>
            <tbody>
              {users.filter(u => u.role === 'resigned').map(u => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td style={{ fontSize: '0.75rem' }}>{u.email}</td>
                  <td>{u.branch || '-'}</td>
                  <td>{u.department || '-'}</td>
                  <td style={{ fontSize: '0.72rem' }}>{u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}</td>
                  <td>
                    <button className="btn btn-sm btn-success" onClick={async () => {
                      if (!confirm(`${u.name}님을 복직 처리하시겠습니까?`)) return;
                      try { await api.users.updateRole(u.id, 'member'); load(); } catch (err: any) { alert(err.message); }
                    }}><UserCheck size={13} /> 복직</button>
                  </td>
                </tr>
              ))}
              {users.filter(u => u.role === 'resigned').length === 0 && (
                <tr><td colSpan={6} className="empty-state">퇴사자가 없습니다.</td></tr>
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
