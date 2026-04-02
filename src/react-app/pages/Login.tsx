import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { api } from '../api';
import { BRANCHES } from '../types';
import Select, { toOptions } from '../components/Select';
import { ChevronDown, ChevronUp } from 'lucide-react';

const BRANCH_OPTS = toOptions(BRANCHES);
const SAVED_CRED_KEY = 'myauction_saved_cred';

const PRIVACY_POLICY = `주식회사 마이옥션(이하 "회사")은 개인정보보호법, 정보통신망 이용촉진 및 정보보호 등에 관한 법률 등 관련 법령에 따라 이용자의 개인정보를 보호하고 있습니다.

1. 수집하는 개인정보 항목
 - 필수항목: 이름, 이메일, 비밀번호, 전화번호
 - 선택항목: 소속 지사

2. 개인정보의 수집 및 이용 목적
 - 회원 가입 및 본인 확인
 - 사내 문서 관리 및 결재 시스템 운영
 - 일지 관리 및 업무 통계 제공
 - 서비스 이용에 관한 공지사항 전달

3. 개인정보의 보유 및 이용 기간
 - 회원 탈퇴 시까지 보유하며, 탈퇴 즉시 파기합니다.
 - 단, 관련 법령에 따라 보존할 필요가 있는 경우 해당 기간 동안 보관합니다.
   · 계약 또는 청약철회에 관한 기록: 5년
   · 접속 로그 기록: 3개월

4. 개인정보의 제3자 제공
 - 회사는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다.
 - 다만, 법령에 의하여 요구되는 경우에는 예외로 합니다.

5. 개인정보의 파기 절차 및 방법
 - 전자적 파일: 복구 불가능한 방법으로 영구 삭제
 - 종이 문서: 분쇄기를 이용하여 파기

6. 개인정보 보호책임자
 - 성명: 이재성
 - 직책: 관리이사
 - 연락처: 1544-6542

7. 개인정보 처리 위탁
 - 서비스 운영을 위해 Cloudflare(클라우드 인프라)에 데이터 처리를 위탁하고 있습니다.

8. 이용자의 권리
 - 이용자는 언제든지 자신의 개인정보를 조회, 수정, 삭제할 수 있습니다.
 - 프로필 페이지에서 직접 수정하거나, 관리자에게 요청할 수 있습니다.`;

const TERMS_OF_SERVICE = `주식회사 마이옥션 사내 오피스 시스템 이용약관

제1조 (목적)
본 약관은 주식회사 마이옥션(이하 "회사")이 제공하는 사내 오피스 시스템(이하 "서비스")의 이용 조건 및 절차에 관한 사항을 규정합니다.

제2조 (이용 자격)
서비스는 회사 소속 임직원만 이용할 수 있으며, 가입 후 관리자 승인을 받아야 합니다.

제3조 (서비스 내용)
 - 문서 작성, 결재, 보관
 - 컨설턴트 일지 관리
 - 조직도 및 인원 관리
 - 연차/근태 관리

제4조 (이용자의 의무)
 1. 타인의 계정을 도용하지 않습니다.
 2. 업무 외 목적으로 서비스를 이용하지 않습니다.
 3. 회사 기밀 정보를 외부에 유출하지 않습니다.
 4. 허위 정보를 등록하지 않습니다.

제5조 (서비스 중단)
회사는 시스템 점검, 장애 등 불가피한 사유로 서비스를 일시 중단할 수 있습니다.

제6조 (면책)
회사는 천재지변, 시스템 장애 등 불가항력으로 인한 서비스 중단에 대해 책임을 지지 않습니다.

제7조 (분쟁 해결)
본 약관에 관한 분쟁은 회사 소재지 관할 법원에서 해결합니다.`;

export default function Login() {
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
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');

    if (isRegister) {
      if (!agreePrivacy || !agreeTerms) { setError('개인정보 처리방침 및 이용약관에 동의해주세요.'); return; }
      if (password !== passwordConfirm) { setError('비밀번호가 일치하지 않습니다.'); return; }
    }

    setLoading(true);
    try {
      if (isRegister) {
        const res = await api.auth.register(email, password, name, phone, branch);
        setSuccess(res.message);
        setIsRegister(false);
        setPassword(''); setPasswordConfirm('');


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
    setAgreePrivacy(false); setAgreeTerms(false);
    setShowPrivacy(false); setShowTerms(false);
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
                <label>지사</label>
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
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일을 입력하세요"
              required
            />
          </div>

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

          {isRegister && (
            <div className="agree-section">
              {/* 전체 동의 */}
              <label className="agree-all">
                <input type="checkbox" checked={agreePrivacy && agreeTerms}
                  onChange={(e) => { setAgreePrivacy(e.target.checked); setAgreeTerms(e.target.checked); }} />
                <span>전체 동의</span>
              </label>

              {/* 개인정보 처리방침 */}
              <div className="agree-item">
                <label className="agree-check">
                  <input type="checkbox" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
                  <span>[필수] 개인정보 처리방침 동의</span>
                </label>
                <button type="button" className="agree-toggle" onClick={() => setShowPrivacy(!showPrivacy)}>
                  {showPrivacy ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              {showPrivacy && (
                <div className="agree-content">{PRIVACY_POLICY}</div>
              )}

              {/* 이용약관 */}
              <div className="agree-item">
                <label className="agree-check">
                  <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                  <span>[필수] 서비스 이용약관 동의</span>
                </label>
                <button type="button" className="agree-toggle" onClick={() => setShowTerms(!showTerms)}>
                  {showTerms ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              {showTerms && (
                <div className="agree-content">{TERMS_OF_SERVICE}</div>
              )}
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
