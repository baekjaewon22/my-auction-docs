import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { User, SalesEvaluation } from '../types';
import { ROLE_LABELS, VISIBLE_ROLES, BRANCHES } from '../types';
import type { Role } from '../types';
import Select, { toOptions } from '../components/Select';
import { Trash2, UserCheck, UserX, UserCog, ChevronLeft, TrendingDown, TrendingUp, AlertTriangle, ArrowDownCircle } from 'lucide-react';

import { useDepartments } from '../hooks/useDepartments';
const ROLE_OPTS = VISIBLE_ROLES.map((v) => ({ value: v, label: ROLE_LABELS[v] }));
const BRANCH_OPTS = BRANCHES.map((b) => ({ value: b, label: b }));
const POSITION_TITLES = ['대표이사', '부사장', '전무', '상무', '이사', '본부장', '지사장', '실장', '부장', '차장', '과장', '팀장', '대리', '주임', '사원', '인턴'];
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
  const DEPT_OPTS = toOptions(deptList);
  const [tab, setTab] = useState<'approved' | 'pending'>('approved');
  const [users, setUsers] = useState<User[]>([]);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDepts, setPendingDepts] = useState<Record<string, string>>({});

  // 상세페이지 관련
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [salaryInput, setSalaryInput] = useState('');
  const [gradeInput, setGradeInput] = useState('');
  const [posAllowanceInput, setPosAllowanceInput] = useState('');
  const [cardNumberInput, setCardNumberInput] = useState('');
  const [hireDateInput, setHireDateInput] = useState('');
  const [evaluations, setEvaluations] = useState<SalesEvaluation[]>([]);
  const [saving, setSaving] = useState(false);

  const hierarchy: Record<string, number> = { master: 1, ceo: 2, cc_ref: 2, admin: 3, accountant: 3, accountant_asst: 4, manager: 4, member: 5 };
  const myLevel = hierarchy[currentUser?.role || ''] || 99;
  const canManagePending = ['master', 'ceo', 'cc_ref', 'admin'].includes(currentUser?.role || '');
  // 회계 정보 편집 가능한 역할 (총무보조는 조회만)
  const canEditAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'].includes(currentUser?.role || '');
  // 회계 정보 열람 가능한 역할
  const canViewAccounting = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(currentUser?.role || '');
  // 입사기준일 편집 가능한 역할 (대표 + 회계)
  const canSetHireDate = ['master', 'ceo', 'cc_ref', 'accountant'].includes(currentUser?.role || '');

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
    if (currentUser?.role === 'ceo' || currentUser?.role === 'cc_ref') return ROLE_OPTS.filter((r) => ['cc_ref', 'admin', 'accountant', 'accountant_asst', 'manager', 'member'].includes(r.value));
    if (currentUser?.role === 'admin') return ROLE_OPTS.filter((r) => ['manager', 'member'].includes(r.value));
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
    if (!canViewAccounting) return;
    try {
      const [accRes, evalRes] = await Promise.all([
        api.accounting.get(u.id),
        api.accounting.evaluations(u.id),
      ]);
      const acc = accRes.account;
      setSalaryInput(acc?.salary?.toString() || '');
      setGradeInput(acc?.grade || '');
      setPosAllowanceInput(acc?.position_allowance?.toString() || '0');
      setCardNumberInput(u.card_number || '');
      setEvaluations(evalRes.evaluations);
    } catch {
      setSalaryInput('');
      setGradeInput('');
      setPosAllowanceInput('0');
      setCardNumberInput('');
      setEvaluations([]);
    }
  };

  const handleSaveAccounting = async () => {
    if (!selectedUser || !canEditAccounting) return;
    setSaving(true);
    try {
      await api.accounting.update(selectedUser.id, {
        salary: Number(salaryInput) || 0,
        grade: gradeInput,
        position_allowance: Number(posAllowanceInput) || 0,
      });
      // 카드번호도 저장
      await api.card.updateUserCard(selectedUser.id, cardNumberInput);
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

        {/* 회계 정보 카드 (회계 열람 가능자만) */}
        {canViewAccounting && (
          <div className="card" style={{ marginBottom: 20, padding: 20 }}>
            <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: '1rem', color: '#1a1a2e' }}>급여 및 직급 설정</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 20 }}>

              {/* 급여 */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>급여 (월급)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="form-input"
                    value={toMoneyDisplay(salaryInput)}
                    onChange={(e) => setSalaryInput(fromMoneyDisplay(e.target.value))}
                    placeholder="급여 입력"
                    disabled={!canEditAccounting}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: '0.85rem', color: '#9aa0a6' }}>원</span>
                </div>
              </div>

              {/* 기준매출 산출 */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>기준매출 (급여 x 1.3 x 4)</label>
                <div style={{
                  padding: '10px 14px',
                  background: calculatedStandardSales > 0 ? '#e8f5e9' : '#f5f5f5',
                  borderRadius: 8,
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  color: calculatedStandardSales > 0 ? '#188038' : '#9aa0a6',
                }}>
                  {calculatedStandardSales > 0 ? formatCurrency(calculatedStandardSales) : '-'}
                </div>
                {calculatedStandardSales > 0 && (
                  <div style={{ fontSize: '0.75rem', color: '#9aa0a6', marginTop: 4 }}>
                    2개월간 달성해야 하는 금액 조건
                  </div>
                )}
              </div>

              {/* 직급 선택 */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>직급단계</label>
                <select
                  className="form-input"
                  value={gradeInput}
                  onChange={(e) => setGradeInput(e.target.value)}
                  disabled={!canEditAccounting}
                  style={{ width: '100%' }}
                >
                  <option value="">미지정</option>
                  {GRADE_OPTIONS.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                <div style={{ fontSize: '0.75rem', color: '#9aa0a6', marginTop: 4 }}>
                  직급단계는 역할/보직과 별개입니다
                </div>
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

              {/* 법인카드 번호 */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: '#3c4043' }}>법인카드 번호</label>
                <input className="form-input" value={cardNumberInput}
                  onChange={(e) => setCardNumberInput(e.target.value)}
                  disabled={!canEditAccounting} style={{ width: '100%' }}
                  placeholder="뒤 4자리 (예: 5900)" />
                <div style={{ fontSize: '0.72rem', color: '#9aa0a6', marginTop: 4 }}>
                  카드번호 뒤 4자리 입력 → 엑셀 업로드 시 자동 매칭
                </div>
              </div>
            </div>

            {canEditAccounting && (
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-primary" onClick={handleSaveAccounting} disabled={saving}>
                  {saving ? '저장중...' : '저장'}
                </button>
              </div>
            )}
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

      {/* Tabs */}
      <div className="filter-bar" style={{ marginBottom: 20 }}>
        <button className={`filter-btn ${tab === 'approved' ? 'active' : ''}`} onClick={() => setTab('approved')}>
          승인된 사용자 ({users.length})
        </button>
        {canManagePending && (
          <button className={`filter-btn ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
            가입 대기 {pendingUsers.length > 0 && <span className="pending-badge">{pendingUsers.length}</span>}
          </button>
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
              {users.filter((u) => u.role !== 'master' || currentUser?.role === 'master').map((u) => {
                const isSameBranch = currentUser?.role !== 'admin' || u.branch === currentUser?.branch;
                const canEdit = availableRoles.length > 0 && u.id !== currentUser?.id && isSameBranch;
                const targetLevel = hierarchy[u.role] || 99;
                const isHigher = targetLevel < myLevel || (targetLevel === myLevel && u.role !== 'cc_ref');
                const canDel = canEdit && !isHigher;
                const canChangeRole = canEdit && !isHigher;
                return (
                  <tr key={u.id} onClick={() => handleSelectUser(u)} className="clickable-row" style={{ cursor: 'pointer' }}>
                    <td><strong>{u.name}</strong></td>
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
                    <td><strong>{u.name}</strong></td>
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
