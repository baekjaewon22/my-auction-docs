import { useState, useRef } from 'react';
import { useAuthStore } from '../store';
import { api } from '../api';
import { ROLE_LABELS, BRANCHES } from '../types';
import Select, { toOptions } from '../components/Select';
import { useDepartments } from '../hooks/useDepartments';
import { Trash2, Pencil } from 'lucide-react';

const SIG_KEY = 'myauction_saved_signature';

const BRANCH_OPTS = toOptions(BRANCHES);
import type { Role } from '../types';

export default function Profile() {
  const { user, loadUser } = useAuthStore();
  const { departments } = useDepartments();
  const DEPT_OPTS = toOptions(departments);
  const [phone, setPhone] = useState(user?.phone || '');
  const [branch, setBranch] = useState(user?.branch || '');
  const [department, setDepartment] = useState(user?.department || '');
  const [positionTitle, setPositionTitle] = useState(user?.position_title || '');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [savedSig, setSavedSig] = useState<string | null>(() => localStorage.getItem(SIG_KEY));
  const [showSigCanvas, setShowSigCanvas] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  if (!user) return null;

  // 서명 캔버스
  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    drawingRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawingRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d')!;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const endDraw = () => { drawingRef.current = false; };
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  const saveSig = async () => {
    if (!canvasRef.current) return;
    const data = canvasRef.current.toDataURL('image/png');
    localStorage.setItem(SIG_KEY, data);
    setSavedSig(data);
    setShowSigCanvas(false);
    if (user?.id) {
      try { await api.users.saveSignature(user.id, data); } catch { /* */ }
    }
    setMessage('서명이 저장되었습니다.');
  };
  const deleteSig = async () => {
    if (!confirm('저장된 서명을 삭제하시겠습니까?')) return;
    localStorage.removeItem(SIG_KEY);
    setSavedSig(null);
    if (user?.id) {
      try { await api.users.deleteSignature(user.id); } catch { /* */ }
    }
    setMessage('서명이 삭제되었습니다. 다음 서명 시 새로 등록해야 합니다.');
  };

  const handleSave = async () => {
    if (password && password !== passwordConfirm) {
      setMessage('비밀번호가 일치하지 않습니다.');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      const data: { phone?: string; branch?: string; department?: string; position_title?: string; password?: string } = {
        phone, branch, department, position_title: positionTitle,
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
            <label>직책 (시스템 권한)</label>
            <input type="text" value={ROLE_LABELS[user.role as Role]} disabled className="input-disabled" />
          </div>
        </div>

        <div className="profile-section">
          <h3>보직명 <span className="profile-editable-tag">수정 가능</span></h3>
          <div className="form-group">
            <label>보직명 <span style={{ color: '#9aa0a6', fontWeight: 400 }}>ex) 과장, 대리, 차장, 부장, 실장 등</span></label>
            <input type="text" value={positionTitle} onChange={(e) => setPositionTitle(e.target.value)} placeholder="보직명을 입력하세요" />
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
              <label>지사 {user.role === 'admin' && <span style={{ fontSize: '0.65rem', color: '#9aa0a6' }}>(대표만 변경 가능)</span>}</label>
              <Select
                options={BRANCH_OPTS}
                value={BRANCH_OPTS.find(o => o.value === branch) || null}
                onChange={(o: any) => setBranch(o?.value || '')}
                placeholder="미지정"
                isClearable
                isDisabled={user.role === 'admin'}
              />
            </div>
            <div className="form-group">
              <label>팀 {user.role === 'admin' && <span style={{ fontSize: '0.65rem', color: '#9aa0a6' }}>(대표만 변경 가능)</span>}</label>
              <Select
                options={DEPT_OPTS}
                value={DEPT_OPTS.find(o => o.value === department) || null}
                onChange={(o: any) => setDepartment(o?.value || '')}
                placeholder="미지정"
                isClearable
                isDisabled={user.role === 'admin'}
              />
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

        <div className="profile-section">
          <h3>서명 관리</h3>
          {savedSig ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: 8, background: '#fff' }}>
                <img src={savedSig} alt="저장된 서명" style={{ width: 200, height: 80, objectFit: 'contain' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" onClick={() => { setShowSigCanvas(true); setTimeout(() => clearCanvas(), 50); }}>
                  <Pencil size={13} /> 변경
                </button>
                <button className="btn btn-sm btn-danger" onClick={deleteSig}>
                  <Trash2 size={13} /> 삭제
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: '0.8rem', color: '#9aa0a6', marginBottom: 8 }}>저장된 서명이 없습니다. 서명을 등록하면 문서 서명 시 자동으로 사용됩니다.</p>
              <button className="btn btn-sm btn-primary" onClick={() => { setShowSigCanvas(true); setTimeout(() => clearCanvas(), 50); }}>
                서명 등록
              </button>
            </div>
          )}
          {showSigCanvas && (
            <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--gray-200)', borderRadius: 8, background: '#fafafa' }}>
              <p style={{ fontSize: '0.75rem', color: '#5f6368', marginBottom: 6 }}>아래 캔버스에 서명을 그려주세요.</p>
              <canvas
                ref={canvasRef}
                width={300}
                height={120}
                style={{ border: '1px solid var(--gray-300)', borderRadius: 6, background: '#fff', cursor: 'crosshair', touchAction: 'none' }}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-sm" onClick={clearCanvas}>초기화</button>
                <button className="btn btn-sm btn-primary" onClick={saveSig}>저장</button>
                <button className="btn btn-sm" onClick={() => setShowSigCanvas(false)}>취소</button>
              </div>
            </div>
          )}
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
