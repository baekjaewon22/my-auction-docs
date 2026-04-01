import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { api } from '../api';
import { BRANCHES } from '../types';
import Select, { toOptions } from '../components/Select';
import { Mail, CheckCircle } from 'lucide-react';

const BRANCH_OPTS = toOptions(BRANCHES);

const SAVED_CRED_KEY = 'myauction_saved_cred';

export default function Login() {
  // 저장된 아이디/비밀번호 불러오기
  const savedCred = (() => {
    try { const s = localStorage.getItem(SAVED_CRED_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
  })();

  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState(savedCred?.email || '');
  const [password, setPassword] = useState(savedCred?.password || '');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(!!savedCred);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  // 이메일 인증 상태
  const [verifyStep, setVerifyStep] = useState<'none' | 'sent' | 'verified'>('none');
  const [verifyCode, setVerifyCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // 인증코드 발송
  const handleSendCode = async () => {
    if (!email) { setError('이메일을 먼저 입력하세요.'); return; }
    setSendingCode(true); setError('');
    try {
      await api.auth.sendCode(email);
      setVerifyStep('sent');
      setSuccess('인증 코드가 발송되었습니다. 이메일을 확인해주세요.');
      // 60초 쿨다운
      setCooldown(60);
      const timer = setInterval(() => {
        setCooldown((prev) => { if (prev <= 1) { clearInterval(timer); return 0; } return prev - 1; });
      }, 1000);
    } catch (err: any) { setError(err.message); }
    finally { setSendingCode(false); }
  };

  // 인증코드 확인
  const handleVerifyCode = async () => {
    if (!verifyCode || verifyCode.length !== 6) { setError('6자리 인증 코드를 입력하세요.'); return; }
    setVerifying(true); setError('');
    try {
      await api.auth.verifyCode(email, verifyCode);
      setVerifyStep('verified');
      setSuccess('이메일 인증이 완료되었습니다.');
    } catch (err: any) { setError(err.message); }
    finally { setVerifying(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');

    if (isRegister) {
      // 이메일 인증은 선택사항 (도메인 등록 후 활성화 예정)
      if (password !== passwordConfirm) { setError('비밀번호가 일치하지 않습니다.'); return; }
    }

    setLoading(true);
    try {
      if (isRegister) {
        const res = await api.auth.register(email, password, name, phone, branch);
        setSuccess(res.message);
        setIsRegister(false);
        setPassword(''); setPasswordConfirm('');
        setVerifyStep('none'); setVerifyCode('');
      } else {
        // 아이디/비밀번호 저장
        if (rememberMe) {
          localStorage.setItem(SAVED_CRED_KEY, JSON.stringify({ email, password }));
        } else {
          localStorage.removeItem(SAVED_CRED_KEY);
        }
        await login(email, password);
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || '오류가 발생했습니다.');
    } finally { setLoading(false); }
  };

  const resetForm = () => {
    setIsRegister(!isRegister); setError(''); setSuccess('');
    setVerifyStep('none'); setVerifyCode('');
  };

  return (
    <div className="login-page">
      <div className="login-bg-shape login-bg-shape-1" />
      <div className="login-bg-shape login-bg-shape-2" />
      <div className="login-bg-shape login-bg-shape-3" />

      <div className="login-card">
        <div className="login-header">
          <img src="/logo.png" alt="My Auction" className="login-logo-img" />
          <h1 className="login-logo">
            <span className="login-logo-sub">office</span>
          </h1>
          <div className="login-divider" />
          <p className="login-subtitle">문서 관리 및 협업 시스템</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <h2>{isRegister ? '회원가입' : '로그인'}</h2>
          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          {isRegister && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>이름 *</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" required />
                </div>
                <div className="form-group">
                  <label>전화번호 *</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" required />
                </div>
              </div>
              <div className="form-group">
                <label>지사 *</label>
                <Select
                  options={BRANCH_OPTS}
                  value={BRANCH_OPTS.find(o => o.value === branch) || null}
                  onChange={(o: any) => setBranch(o?.value || '')}
                  placeholder="지사 선택"
                  isClearable
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label>이메일 *</label>
            <div className="email-verify-row">
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (verifyStep !== 'none') { setVerifyStep('none'); setVerifyCode(''); } }}
                placeholder="이메일을 입력하세요"
                required
                disabled={isRegister && verifyStep === 'verified'}
              />
              {isRegister && verifyStep !== 'verified' && (
                <button type="button" className="btn btn-sm btn-verify" onClick={handleSendCode} disabled={sendingCode || cooldown > 0}>
                  <Mail size={13} />
                  {sendingCode ? '발송중' : cooldown > 0 ? `${cooldown}초` : verifyStep === 'sent' ? '재발송' : '인증'}
                </button>
              )}
              {isRegister && verifyStep === 'verified' && (
                <span className="email-verified"><CheckCircle size={14} /> 인증완료</span>
              )}
            </div>
          </div>

          {/* 인증코드 입력 */}
          {isRegister && verifyStep === 'sent' && (
            <div className="form-group">
              <label>인증 코드 (6자리)</label>
              <div className="email-verify-row">
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="verify-code-input"
                />
                <button type="button" className="btn btn-sm btn-primary" onClick={handleVerifyCode} disabled={verifying || verifyCode.length !== 6}>
                  {verifying ? '확인중' : '확인'}
                </button>
              </div>
            </div>
          )}

          <div className="form-group">
            <label>비밀번호 *</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호를 입력하세요" required />
          </div>
          {isRegister && (
            <div className="form-group">
              <label>비밀번호 확인 *</label>
              <input type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} placeholder="비밀번호를 다시 입력하세요" required />
            </div>
          )}

          {!isRegister && (
            <label className="remember-me">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              아이디 / 비밀번호 저장
            </label>
          )}

          <button type="submit" className="btn btn-login" disabled={loading}>
            {loading ? '처리중...' : isRegister ? '가입 신청' : '로그인'}
          </button>

          <p className="login-toggle">
            {isRegister ? '이미 계정이 있으신가요?' : '계정이 없으신가요?'}{' '}
            <button type="button" className="btn-link-login" onClick={resetForm}>
              {isRegister ? '로그인' : '회원가입'}
            </button>
          </p>
        </form>
        <div className="login-footer">
          <span>&copy; 2025 My Auction. All rights reserved.</span>
        </div>
      </div>
    </div>
  );
}
