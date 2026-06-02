import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Phone, Printer } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';
import { ROLE_LABELS } from '../types';
import { CANONICAL_BRANCHES, normalizeBranchName } from '../lib/branchAliases';

const BRANCH_ORDER = [...CANONICAL_BRANCHES];
const POSITION_ORDER = ['대표이사', '부사장', '전무', '상무', '이사', '본부장', '지사장', '실장', '사무장', '부장', '차장', '과장', '팀장', '대리', '주임', '사원', '인턴', 'PD'];
const TEST_ACCOUNT_KEYWORDS = ['test', '테스트', 'dummy', 'sample', 'example', '임시'];
const SYSTEM_ACCOUNT_KEYWORDS = ['system', '시스템', 'administrator', '관리자계정', '어드민'];

function compareByKnownOrder(a: string, b: string, order: string[]) {
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  if (ai >= 0 && bi >= 0) return ai - bi;
  if (ai >= 0) return -1;
  if (bi >= 0) return 1;
  return a.localeCompare(b, 'ko');
}

function formatPhone(phone: string) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone || '-';
}

function isDirectoryVisibleUser(user: User) {
  const identity = `${user.name || ''} ${user.email || ''}`.toLowerCase();
  const isTestAccount = TEST_ACCOUNT_KEYWORDS.some((keyword) => identity.includes(keyword));
  const isSystemAccount = user.role === 'master' || SYSTEM_ACCOUNT_KEYWORDS.some((keyword) => identity.includes(keyword));

  return (
    user.role !== 'resigned' &&
    (user.login_type || 'employee') !== 'freelancer' &&
    !isSystemAccount &&
    !isTestAccount
  );
}

export default function PhoneDirectory() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    api.users.list()
      .then((res) => setUsers(res.users || []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const activeUsers = users.filter(isDirectoryVisibleUser);

    const branchMap = new Map<string, Map<string, User[]>>();
    activeUsers.forEach((user) => {
      const branch = normalizeBranchName(user.branch) || '미지정';
      const department = user.department || user.team_name || '미지정';
      if (!branchMap.has(branch)) branchMap.set(branch, new Map());
      const deptMap = branchMap.get(branch)!;
      if (!deptMap.has(department)) deptMap.set(department, []);
      deptMap.get(department)!.push(user);
    });

    return [...branchMap.entries()]
      .sort(([a], [b]) => compareByKnownOrder(a, b, BRANCH_ORDER))
      .map(([branch, deptMap]) => ({
        branch,
        departments: [...deptMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b, 'ko'))
          .map(([department, members]) => ({
            department,
            members: members.sort((a, b) => {
              const ap = a.position_title || ROLE_LABELS[a.role];
              const bp = b.position_title || ROLE_LABELS[b.role];
              const po = compareByKnownOrder(ap, bp, POSITION_ORDER);
              if (po !== 0) return po;
              return a.name.localeCompare(b.name, 'ko');
            }),
          })),
      }));
  }, [users]);

  const totalCount = grouped.reduce((sum, branch) => (
    sum + branch.departments.reduce((deptSum, dept) => deptSum + dept.members.length, 0)
  ), 0);

  const handleSavePng = async () => {
    if (!printRef.current) return;
    setSaving(true);
    try {
      const { default: html2canvas } = await import('html2canvas' as any);
      const canvas = await (html2canvas as any)(printRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
      });
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `전화번호부_${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    } catch {
      alert('PNG 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page phone-directory-page">
      <div className="page-header phone-directory-header">
        <div>
          <h2><Phone size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} /> 전화번호부</h2>
          <p className="phone-directory-subtitle">지사별 · 팀별 연락처 현황</p>
        </div>
        <div className="phone-directory-actions">
          <button className="btn btn-sm" onClick={handleSavePng} disabled={saving || loading}>
            <Download size={15} /> {saving ? '저장 중...' : 'PNG 저장'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => window.print()} disabled={loading}>
            <Printer size={15} /> 프린트
          </button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">로딩중...</div>
      ) : (
        <div ref={printRef} className="phone-directory-sheet">
          <div className="phone-directory-sheet-head">
            <div>
              <div className="phone-directory-title">마이옥션 전화번호부</div>
              <div className="phone-directory-date">{new Date().toLocaleDateString('ko-KR')}</div>
            </div>
            <div className="phone-directory-count">총 {totalCount}명</div>
          </div>

          {grouped.length === 0 ? (
            <div className="empty-state">표시할 연락처가 없습니다.</div>
          ) : (
            grouped.map((branch) => (
              <section key={branch.branch} className="phone-directory-branch">
                <div className="phone-directory-branch-title">{branch.branch}</div>
                {branch.departments.map((department) => (
                  <div key={`${branch.branch}-${department.department}`} className="phone-directory-team">
                    <div className="phone-directory-team-title">
                      <span>{department.department}</span>
                      <strong>{department.members.length}명</strong>
                    </div>
                    <table className="phone-directory-table">
                      <thead>
                        <tr>
                          <th>이름</th>
                          <th>직책</th>
                          <th>전화번호</th>
                        </tr>
                      </thead>
                      <tbody>
                        {department.members.map((member) => (
                          <tr key={member.id}>
                            <td>{member.name}</td>
                            <td>{member.position_title || ROLE_LABELS[member.role]}</td>
                            <td className="phone-directory-phone">{formatPhone(member.phone)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
