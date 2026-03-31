import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { User } from '../types';
import { ROLE_LABELS, BRANCHES, DEPARTMENTS } from '../types';
import type { Role } from '../types';
import Select, { toOptions } from '../components/Select';
import { Trash2, UserCheck, UserX, UserCog } from 'lucide-react';

const BRANCH_OPTS = toOptions(BRANCHES);
const DEPT_OPTS = toOptions(DEPARTMENTS);
const ROLE_OPTS = Object.entries(ROLE_LABELS).map(([v, l]) => ({ value: v, label: l }));

export default function UserManagement() {
  const { user: currentUser } = useAuthStore();
  const [tab, setTab] = useState<'approved' | 'pending'>('approved');
  const [users, setUsers] = useState<User[]>([]);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDepts, setPendingDepts] = useState<Record<string, string>>({});

  const hierarchy: Record<string, number> = { master: 1, ceo: 2, admin: 3, manager: 4, member: 5 };
  const myLevel = hierarchy[currentUser?.role || ''] || 99;
  const canManagePending = ['master', 'ceo', 'admin'].includes(currentUser?.role || '');

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
    if (currentUser?.role === 'ceo') return ROLE_OPTS.filter((r) => ['admin', 'manager', 'member'].includes(r.value));
    if (currentUser?.role === 'admin') return ROLE_OPTS.filter((r) => ['manager', 'member'].includes(r.value));
    return [];
  };
  const availableRoles = getAvailableRoles();

  const handleRoleUpdate = async (id: string, role: string, branch: string, dept: string) => {
    try { await api.users.updateRole(id, role, branch, dept); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 계정을 삭제하시겠습니까?\n관련된 문서, 일지, 서명이 모두 삭제됩니다.`)) return;
    try { await api.users.delete(id); load(); }
    catch (err: any) { alert(err.message); }
  };

  const handleApprove = async (id: string) => {
    if (!pendingDepts[id]) { alert('팀을 선택해주세요.'); return; }
    await api.users.approve(id, pendingDepts[id]);
    load();
  };

  const handleReject = async (id: string) => {
    if (!confirm('가입을 거절하시겠습니까? 해당 계정은 삭제됩니다.')) return;
    await api.users.reject(id);
    load();
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2><UserCog size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 사용자 관리</h2>
      </div>

      {canManagePending && (
        <div className="filter-bar" style={{ marginBottom: 20 }}>
          <button className={`filter-btn ${tab === 'approved' ? 'active' : ''}`} onClick={() => setTab('approved')}>
            승인된 사용자 ({users.length})
          </button>
          <button className={`filter-btn ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
            가입 대기 {pendingUsers.length > 0 && <span className="pending-badge">{pendingUsers.length}</span>}
          </button>
        </div>
      )}

      {tab === 'approved' && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>이름</th><th>전화번호</th><th>이메일</th><th>역할</th><th>지사</th><th>팀</th><th>가입일</th><th></th></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const canEdit = availableRoles.length > 0 && u.id !== currentUser?.id;
                const targetLevel = hierarchy[u.role] || 99;
                const isHigher = targetLevel <= myLevel;
                const canDel = canEdit && !isHigher;
                return (
                  <tr key={u.id}>
                    <td><strong>{u.name}</strong></td>
                    <td>{u.phone || '-'}</td>
                    <td>{u.email}</td>
                    <td>
                      {canEdit && !isHigher ? (
                        <Select size="sm"
                          options={!availableRoles.find((r) => r.value === u.role) ? [{ value: u.role, label: ROLE_LABELS[u.role as Role] }, ...availableRoles] : availableRoles}
                          value={{ value: u.role, label: ROLE_LABELS[u.role as Role] }}
                          onChange={(o: any) => handleRoleUpdate(u.id, o.value, u.branch, u.department)} />
                      ) : (
                        <span className={`role-badge role-${u.role}`}>{ROLE_LABELS[u.role as Role]}</span>
                      )}
                    </td>
                    <td>
                      {canEdit ? (
                        <Select size="sm" options={BRANCH_OPTS} value={BRANCH_OPTS.find((o) => o.value === u.branch) || null}
                          onChange={(o: any) => handleRoleUpdate(u.id, u.role, o?.value || '', u.department)} placeholder="미지정" isClearable />
                      ) : (u.branch || '-')}
                    </td>
                    <td>
                      {canEdit && ['manager', 'member'].includes(u.role) ? (
                        <Select size="sm" options={DEPT_OPTS} value={DEPT_OPTS.find((o) => o.value === u.department) || null}
                          onChange={(o: any) => handleRoleUpdate(u.id, u.role, u.branch, o?.value || '')} placeholder="미지정" isClearable />
                      ) : (u.department || '-')}
                    </td>
                    <td>{u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}</td>
                    <td>{canDel && <button className="btn btn-sm btn-danger" onClick={() => handleDelete(u.id, u.name)}><Trash2 size={13} /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'pending' && canManagePending && (
        pendingUsers.length === 0 ? (
          <div className="empty-state">승인 대기 중인 회원이 없습니다.</div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>이름</th><th>전화번호</th><th>이메일</th><th>지사</th><th>팀 배정</th><th>가입일</th><th>승인/거절</th></tr>
              </thead>
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
