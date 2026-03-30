import { useEffect, useState } from 'react';
import { api } from '../api';
import type { User } from '../types';
import { DEPARTMENTS } from '../types';
import { UserCheck, UserX } from 'lucide-react';

export default function PendingUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    api.users.pending().then((res) => setUsers(res.users)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (userId: string) => {
    const dept = departments[userId];
    if (!dept) {
      alert('팀을 선택해주세요.');
      return;
    }
    await api.users.approve(userId, dept);
    load();
  };

  const handleReject = async (userId: string) => {
    if (!confirm('가입을 거절하시겠습니까? 해당 계정은 삭제됩니다.')) return;
    await api.users.reject(userId);
    load();
  };

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2>가입 승인</h2>
        <p className="page-desc">승인 대기 중인 회원 {users.length}명</p>
      </div>

      {users.length === 0 ? (
        <div className="empty-state">승인 대기 중인 회원이 없습니다.</div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>전화번호</th>
                <th>이메일</th>
                <th>지사</th>
                <th>팀 배정</th>
                <th>가입일</th>
                <th>승인/거절</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td>{u.phone || '-'}</td>
                  <td>{u.email}</td>
                  <td>{u.branch || '-'}</td>
                  <td>
                    <select
                      className="role-select"
                      value={departments[u.id] || ''}
                      onChange={(e) => setDepartments({ ...departments, [u.id]: e.target.value })}
                    >
                      <option value="">팀 선택</option>
                      {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-success" onClick={() => handleApprove(u.id)}>
                        <UserCheck size={14} /> 승인
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleReject(u.id)}>
                        <UserX size={14} /> 거절
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
