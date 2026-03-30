import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { User } from '../types';
import { ROLE_LABELS, BRANCHES, DEPARTMENTS } from '../types';

export default function UserList() {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.users.list().then((res) => setUsers(res.users)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleUpdate = async (userId: string, role: string, branch: string, department: string) => {
    try {
      await api.users.updateRole(userId, role, branch, department);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // 현재 사용자 역할에 따라 설정 가능한 역할 목록
  const getAvailableRoles = () => {
    if (currentUser?.role === 'master') return ['master', 'ceo', 'admin', 'manager', 'member'];
    if (currentUser?.role === 'ceo') return ['admin', 'manager', 'member'];
    if (currentUser?.role === 'admin') return ['manager', 'member'];
    return [];
  };

  const availableRoles = getAvailableRoles();
  const canChangeRole = availableRoles.length > 0;

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2>사용자 관리</h2>
        <p className="page-desc">
          {currentUser?.role === 'master' && '모든 등급을 설정할 수 있습니다.'}
          {currentUser?.role === 'ceo' && '관리자/팀장/팀원 등급을 설정할 수 있습니다.'}
          {currentUser?.role === 'admin' && '팀장/팀원 직책만 변경할 수 있습니다.'}
        </p>
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>이름</th>
              <th>전화번호</th>
              <th>이메일</th>
              <th>역할</th>
              <th>지사</th>
              <th>팀</th>
              <th>가입일</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const canEdit = canChangeRole && u.id !== currentUser?.id;
              // Can't change roles higher than or equal to own role (except master)
              const isHigherOrEqual = !['master'].includes(currentUser?.role || '') && ['master', 'ceo'].includes(u.role);

              return (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td>{u.phone || '-'}</td>
                  <td>{u.email}</td>
                  <td>
                    {canEdit && !isHigherOrEqual ? (
                      <select
                        value={u.role}
                        onChange={(e) => handleUpdate(u.id, e.target.value, u.branch, u.department)}
                        className="role-select"
                      >
                        {/* Show current role even if not in available list */}
                        {!availableRoles.includes(u.role) && (
                          <option value={u.role}>{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]}</option>
                        )}
                        {availableRoles.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r as keyof typeof ROLE_LABELS]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`role-badge role-${u.role}`}>
                        {ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]}
                      </span>
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <select
                        value={u.branch}
                        onChange={(e) => handleUpdate(u.id, u.role, e.target.value, u.department)}
                        className="role-select"
                      >
                        <option value="">미지정</option>
                        {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    ) : (
                      u.branch || '-'
                    )}
                  </td>
                  <td>
                    {canEdit && ['manager', 'member'].includes(u.role) ? (
                      <select
                        value={u.department}
                        onChange={(e) => handleUpdate(u.id, u.role, u.branch, e.target.value)}
                        className="role-select"
                      >
                        <option value="">미지정</option>
                        {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    ) : (
                      u.department || '-'
                    )}
                  </td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
