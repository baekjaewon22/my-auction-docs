import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuthStore } from '../store';
import type { User } from '../types';
import { ROLE_LABELS, BRANCHES, DEPARTMENTS } from '../types';
import Select, { toOptions } from '../components/Select';
import { Trash2 } from 'lucide-react';

const BRANCH_OPTS = toOptions(BRANCHES);
const DEPT_OPTS = toOptions(DEPARTMENTS);

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

  const handleDelete = async (userId: string, userName: string) => {
    if (!confirm(`"${userName}" 계정을 삭제하시겠습니까?\n관련된 문서, 일지, 서명이 모두 삭제됩니다.`)) return;
    try {
      await api.users.delete(userId);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const hierarchy: Record<string, number> = { master: 1, ceo: 2, admin: 3, manager: 4, member: 5 };
  const myLevel = hierarchy[currentUser?.role || ''] || 99;

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
              <th>삭제</th>
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
                      <Select
                        size="sm"
                        options={(() => {
                          const opts = availableRoles.map(r => ({ value: r, label: ROLE_LABELS[r as keyof typeof ROLE_LABELS] }));
                          if (!availableRoles.includes(u.role)) {
                            opts.unshift({ value: u.role, label: ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] });
                          }
                          return opts;
                        })()}
                        value={{ value: u.role, label: ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] }}
                        onChange={(o: any) => handleUpdate(u.id, o?.value || u.role, u.branch, u.department)}
                      />
                    ) : (
                      <span className={`role-badge role-${u.role}`}>
                        {ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]}
                      </span>
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <Select
                        size="sm"
                        options={BRANCH_OPTS}
                        value={BRANCH_OPTS.find(o => o.value === u.branch) || null}
                        onChange={(o: any) => handleUpdate(u.id, u.role, o?.value || '', u.department)}
                        placeholder="미지정"
                        isClearable
                      />
                    ) : (
                      u.branch || '-'
                    )}
                  </td>
                  <td>
                    {canEdit && ['manager', 'member'].includes(u.role) ? (
                      <Select
                        size="sm"
                        options={DEPT_OPTS}
                        value={DEPT_OPTS.find(o => o.value === u.department) || null}
                        onChange={(o: any) => handleUpdate(u.id, u.role, u.branch, o?.value || '')}
                        placeholder="미지정"
                        isClearable
                      />
                    ) : (
                      u.department || '-'
                    )}
                  </td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}</td>
                  <td>
                    {canEdit && !isHigherOrEqual && (hierarchy[u.role] || 99) > myLevel && (
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(u.id, u.name)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
