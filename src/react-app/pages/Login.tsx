import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { api } from '../api';
import Select, { toOptions } from '../components/Select';
import { useBranches } from '../hooks/useBranches';
import { ChevronDown, ChevronUp } from 'lucide-react';
const SAVED_CRED_KEY = 'myauction_saved_cred';

// ━━━ 일반(임직원) 개인정보 처리방침 ━━━
const PRIVACY_POLICY = `(주)엘앤씨부동산중개법인 (사업자등록번호: 127-86-29704, 이하 "회사")은 개인정보보호법, 정보통신망 이용촉진 및 정보보호 등에 관한 법률 등 관련 법령에 따라 이용자의 개인정보를 보호하고 있습니다.

1. 수집하는 개인정보 항목
 - 필수항목: 이름, 이메일, 비밀번호, 전화번호
 - 선택항목: 소속 지사, 부서

2. 개인정보의 수집 및 이용 목적
 - 회원 가입 및 본인 확인
 - 사내 문서 관리 및 전자결재 시스템 운영
 - 컨설턴트 일지 관리 및 현장 출퇴근 기록
 - 업무성과(매출) 관리 및 수수료 정산
 - 연차/월차/반차/시간차/특별휴가 관리
 - 급여정산 및 회계장부 처리
 - 조직도 및 인사 관리
 - 회의록 작성 및 공유
 - 통계 분석 및 업무 효율화
 - 서비스 이용에 관한 공지사항 전달

3. 개인정보의 보유 및 이용 기간
 - 회원 탈퇴 시까지 보유하며, 탈퇴 즉시 파기합니다.
 - 단, 관련 법령에 따라 보존할 필요가 있는 경우 해당 기간 동안 보관합니다.
   · 계약 또는 청약철회에 관한 기록: 5년
   · 대금결제 및 재화 등의 공급에 관한 기록: 5년
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
 - 프로필 페이지에서 직접 수정하거나, 관리자에게 요청할 수 있습니다.

상호명: (주)엘앤씨부동산중개법인
사업자등록번호: 127-86-29704`;

// ━━━ 일반(임직원) 이용약관 ━━━
const TERMS_OF_SERVICE = `(주)엘앤씨부동산중개법인 사내 오피스 시스템 이용약관

제1조 (목적)
본 약관은 (주)엘앤씨부동산중개법인(사업자등록번호: 127-86-29704, 이하 "회사")이 제공하는 사내 오피스 시스템 "마이옥션 오피스"(이하 "서비스")의 이용 조건 및 절차에 관한 사항을 규정합니다.

제2조 (이용 자격)
서비스는 회사 소속 임직원만 이용할 수 있으며, 가입 후 관리자 승인을 받아야 합니다.

제3조 (서비스 내용)
 1. 문서 관리: 문서 작성, 전자결재(승인/반려), 템플릿, 문서 보관함
 2. 컨설턴트 일지: 일정 등록, 현장 출퇴근 체크, 일정공백 알림
 3. 업무성과: 매출 등록/관리, 활동내역 조회, 계약서/물건분석보고서 제출 확인, 엑셀 일괄 업로드
 4. 연차관리: 연차/월차/반차/시간차/특별휴가 신청 및 승인, 잔여일수 조회
 5. 급여정산: 급여제/비율제 정산, 추가공제, 회사수익 분석
 6. 회계장부: 입출금 관리, 카드 승인/취소, 입금알림 매칭
 7. 조직도 및 인사관리: 조직 구조, 사용자 승인/역할 변경
 8. 통계: 근태분석, 현장출퇴근 지표, 매출 통계
 9. 회의록: 텍스트 변환, AI 회의록 생성, 공유 기능
 10. 팀/지사 관리: 팀 생성/삭제, 지사 추가/삭제

제4조 (이용자의 의무)
 1. 타인의 계정을 도용하지 않습니다.
 2. 업무 외 목적으로 서비스를 이용하지 않습니다.
 3. 회사 기밀 정보를 외부에 유출하지 않습니다.
 4. 허위 정보를 등록하지 않습니다.
 5. 전자서명을 타인에게 위임하지 않습니다.

제5조 (서비스 중단)
회사는 시스템 점검, 장애 등 불가피한 사유로 서비스를 일시 중단할 수 있습니다.

제6조 (면책)
회사는 천재지변, 시스템 장애 등 불가항력으로 인한 서비스 중단에 대해 책임을 지지 않습니다.

제7조 (분쟁 해결)
본 약관에 관한 분쟁은 회사 소재지 관할 법원에서 해결합니다.

상호명: (주)엘앤씨부동산중개법인
사업자등록번호: 127-86-29704`;

// ━━━ 프리랜서 개인정보 처리방침 ━━━
const FREELANCER_PRIVACY_POLICY = `(주)엘앤씨부동산중개법인 (사업자등록번호: 127-86-29704, 이하 "회사")은 개인정보보호법, 정보통신망 이용촉진 및 정보보호 등에 관한 법률 등 관련 법령에 따라 프리랜서 이용자의 개인정보를 보호하고 있습니다.

1. 수집하는 개인정보 항목
 - 필수항목: 이름, 이메일, 비밀번호, 전화번호
 - 선택항목: 소속 지사

2. 개인정보의 수집 및 이용 목적
 - 프리랜서 계정 등록 및 본인 확인
 - 업무성과(매출) 등록 및 수수료 정산
 - 계약서/물건분석보고서 제출 관리
 - 서비스 이용에 관한 공지사항 전달

3. 개인정보의 보유 및 이용 기간
 - 계약 해지 또는 계정 탈퇴 시까지 보유하며, 이후 즉시 파기합니다.
 - 단, 관련 법령에 따라 보존할 필요가 있는 경우 해당 기간 동안 보관합니다.
   · 계약 또는 청약철회에 관한 기록: 5년
   · 대금결제 및 재화 등의 공급에 관한 기록: 5년
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
 - 프로필 페이지에서 직접 수정하거나, 관리자에게 요청할 수 있습니다.

상호명: (주)엘앤씨부동산중개법인
사업자등록번호: 127-86-29704`;

// ━━━ 프리랜서 이용약관 ━━━
const FREELANCER_TERMS = `(주)엘앤씨부동산중개법인 프리랜서 업무 시스템 이용약관

제1조 (목적)
본 약관은 (주)엘앤씨부동산중개법인(사업자등록번호: 127-86-29704, 이하 "회사")이 제공하는 프리랜서 전용 업무 시스템(이하 "서비스")의 이용 조건 및 절차에 관한 사항을 규정합니다.

제2조 (이용 자격)
서비스는 회사와 프리랜서 계약을 체결한 자만 이용할 수 있으며, 가입 후 관리자 승인을 받아야 합니다.

제3조 (서비스 내용)
 1. 대시보드: 업무 현황 확인
 2. 업무성과: 매출 등록/관리, 계약서/물건분석보고서 제출 확인

제4조 (프리랜서의 의무)
 1. 타인의 계정을 도용하지 않습니다.
 2. 업무 외 목적으로 서비스를 이용하지 않습니다.
 3. 회사 기밀 정보를 외부에 유출하지 않습니다.
 4. 허위 매출 정보를 등록하지 않습니다.
 5. 계약서 및 보고서를 성실히 제출합니다.

제5조 (계약 해지)
회사 또는 프리랜서는 상호 합의 또는 계약 조건에 따라 이용을 해지할 수 있으며, 해지 시 계정은 비활성화됩니다.

제6조 (수수료 정산)
프리랜서의 매출 수수료는 회사와 체결한 개별 계약 조건에 따라 정산됩니다.

제7조 (서비스 중단)
회사는 시스템 점검, 장애 등 불가피한 사유로 서비스를 일시 중단할 수 있습니다.

제8조 (면책)
회사는 천재지변, 시스템 장애 등 불가항력으로 인한 서비스 중단에 대해 책임을 지지 않습니다.

제9조 (분쟁 해결)
본 약관에 관한 분쟁은 회사 소재지 관할 법원에서 해결합니다.

상호명: (주)엘앤씨부동산중개법인
사업자등록번호: 127-86-29704`;

export default function Login() {
  const { branches } = useBranches();
  const BRANCH_OPTS = toOptions(branches);
  const savedCred = (() => {
    try { const s = localStorage.getItem(SAVED_CRED_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
  })();

  const [loginType, setLoginType] = useState<'employee' | 'freelancer'>('employee');
  const isFreelancer = loginType === 'freelancer';
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
        const res = await api.auth.register(email, password, name, phone, branch, loginType);
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
        await login(email, password, loginType);
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
    <div className="login-page" style={isFreelancer ? { background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' } : undefined}>
      {!isFreelancer && <>
        <div className="login-bg-shape login-bg-shape-1" />
        <div className="login-bg-shape login-bg-shape-2" />
        <div className="login-bg-shape login-bg-shape-3" />
      </>}

      <div className="login-card" style={isFreelancer ? { border: '2px solid #7b1fa2', boxShadow: '0 8px 32px rgba(123,31,162,0.2)' } : undefined}>
        <div className="login-header">
          <img src="/logo.png" alt="My Auction" className="login-logo-img" />
          <h1 className="login-logo">
            <span className="login-logo-sub">{isFreelancer ? 'freelancer' : 'office'}</span>
          </h1>
          <div className="login-divider" style={isFreelancer ? { background: 'linear-gradient(90deg, transparent, #7b1fa2, transparent)' } : undefined} />
          <p className="login-subtitle" style={isFreelancer ? { color: '#7b1fa2' } : undefined}>
            {isFreelancer ? '프리랜서 전용 업무 시스템' : '문서 관리 및 협업 시스템'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>{isRegister ? '회원가입' : '로그인'}</h2>
            {/* 로그인 타입 슬라이드 토글 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.78rem', fontWeight: loginType === 'employee' ? 700 : 400, color: loginType === 'employee' ? '#1a73e8' : '#9aa0a6', transition: 'all 0.2s' }}>일반</span>
              <div onClick={() => { setLoginType(isFreelancer ? 'employee' : 'freelancer'); setIsRegister(false); setError(''); setSuccess(''); }}
                style={{ width: 46, height: 24, borderRadius: 12, background: isFreelancer ? '#7b1fa2' : '#dadce0', cursor: 'pointer', position: 'relative', transition: 'background 0.3s' }}>
                <div style={{ width: 20, height: 20, borderRadius: 10, background: '#fff', position: 'absolute', top: 2, left: isFreelancer ? 24 : 2, transition: 'left 0.3s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
              </div>
              <span style={{ fontSize: '0.78rem', fontWeight: isFreelancer ? 700 : 400, color: isFreelancer ? '#ce93d8' : '#9aa0a6', transition: 'all 0.2s' }}>프리랜서</span>
            </div>
          </div>
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
                <div className="agree-content">{isFreelancer ? FREELANCER_PRIVACY_POLICY : PRIVACY_POLICY}</div>
              )}

              {/* 이용약관 */}
              <div className="agree-item">
                <label className="agree-check">
                  <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                  <span>[필수] {isFreelancer ? '프리랜서 업무 시스템' : '서비스'} 이용약관 동의</span>
                </label>
                <button type="button" className="agree-toggle" onClick={() => setShowTerms(!showTerms)}>
                  {showTerms ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              {showTerms && (
                <div className="agree-content">{isFreelancer ? FREELANCER_TERMS : TERMS_OF_SERVICE}</div>
              )}
            </div>
          )}

          {!isRegister && (
            <label className="remember-me">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              아이디 / 비밀번호 저장
            </label>
          )}

          <button type="submit" className="btn btn-login" disabled={loading}
            style={isFreelancer ? { background: '#7b1fa2' } : undefined}>
            {loading ? '처리중...' : isRegister ? '가입 신청' : isFreelancer ? '프리랜서 로그인' : '로그인'}
          </button>

          <p className="login-toggle">
            {isRegister ? '이미 계정이 있으신가요?' : '계정이 없으신가요?'}{' '}
            <button type="button" className="btn-link-login" onClick={resetForm}>
              {isRegister ? '로그인' : '회원가입'}
            </button>
          </p>
        </form>
        <div className="login-footer">
          <span>(주)엘앤씨부동산중개법인 | 사업자등록번호: 127-86-29704</span>
          <span>&copy; 2025 My Auction. All rights reserved.</span>
        </div>
      </div>
    </div>
  );
}
