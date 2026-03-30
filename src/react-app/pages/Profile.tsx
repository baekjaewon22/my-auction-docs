import { useState } from 'react';
import { useAuthStore } from '../store';
import { api } from '../api';
import { ROLE_LABELS, BRANCHES, DEPARTMENTS } from '../types';
import type { Role } from '../types';

export default function Profile() {
  const { user, loadUser } = useAuthStore();
  const [phone, setPhone] = useState(user?.phone || '');
  const [branch, setBranch] = useState(user?.branch || '');
  const [department, setDepartment] = useState(user?.department || '');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  if (!user) return null;

  const handleSave = async () => {
    if (password && password !== passwordConfirm) {
      setMessage('비밀번호가 일치하지 않습니다.');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      const data: { phone?: string; branch?: string; department?: string; password?: string } = {
        phone, branch, department,
      };
      if (password) data.password = password;

      await api.users.update(user.id, data);
      await loadUser();
      setPassword('');
      setPasswordConfirm('');
      setMessage('저장되었습니다.');
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>내 정보</h2>
      </div>

      <div className="profile-card">
        <div className="profile-section">
          <h3>기본 정보 <span className="profile-readonly-tag">수정 불가</span></h3>
          <div className="form-row">
            <div className="form-group">
              <label>이름</label>
              <input type="text" value={user.name} disabled className="input-disabled" />
            </div>
            <div className="form-group">
              <label>이메일</label>
              <input type="text" value={user.email} disabled className="input-disabled" />
            </div>
          </div>
          <div className="form-group">
            <label>직책</label>
            <input type="text" value={ROLE_LABELS[user.role as Role]} disabled className="input-disabled" />
          </div>
        </div>

        <div className="profile-section">
          <h3>수정 가능 정보 <span className="profile-editable-tag">수정 가능</span></h3>
          <div className="form-group">
            <label>전화번호</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>지사</label>
              <select value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">미지정</option>
                {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>팀</label>
              <select value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="">미지정</option>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="profile-section">
          <h3>비밀번호 변경</h3>
          <div className="form-row">
            <div className="form-group">
              <label>새 비밀번호</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="변경 시에만 입력" />
            </div>
            <div className="form-group">
              <label>비밀번호 확인</label>
              <input type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} placeholder="비밀번호 확인" />
            </div>
          </div>
        </div>

        {message && (
          <div className={`alert ${message.includes('저장') ? 'alert-success' : 'alert-error'}`}>
            {message}
          </div>
        )}

        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '저장중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
