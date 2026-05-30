import { Link } from 'react-router-dom';
import { useAuthStore } from '../store';

const supportItems = [
  {
    to: '/accounting-session1',
    icon: '/emoji/management-support/ledger.svg',
    title: '원천자료 분류',
    desc: '통장·카드 원천자료를 업로드하고 분류합니다.',
  },
  {
    to: '/accounting',
    icon: '/emoji/management-support/ledger.svg',
    title: '회계장부',
    desc: '업무성과와 확정 장부를 관리합니다.',
  },
  {
    to: '/accounting-card-usage',
    icon: '/emoji/management-support/card-usage.svg',
    title: '신용카드 사용내역',
    desc: '회계장부 내 신용카드 사용내역과 담당자별 지출을 확인합니다.',
  },
  {
    to: '/accounting-session2/reports/check-card',
    icon: '/emoji/management-support/card-usage.svg',
    title: '체크카드 사용내역',
    desc: '분류엔진에서 정리한 체크카드 원천 내역을 확인합니다.',
  },
  {
    to: '/payroll',
    icon: '/emoji/management-support/payroll.svg',
    title: '급여정산',
    desc: '급여와 수익 정산 내역을 확인합니다.',
  },
  {
    to: '/finance-analytics',
    icon: '/emoji/management-support/analytics.svg',
    title: '회계분석',
    desc: '매출, 지출, 수익 흐름을 분석합니다.',
  },
  {
    to: '/accounting-session2/reports',
    icon: '/emoji/management-support/analytics.svg',
    title: '출력물',
    desc: '실적, 지출, 손익결산 출력물을 확인합니다.',
  },
  {
    to: '/phone-directory',
    icon: '/emoji/management-support/phone.svg',
    title: '전화번호부',
    desc: '직원 연락처와 소속 정보를 확인합니다.',
  },
  {
    to: '/admin-notes',
    icon: '/emoji/management-support/board.svg',
    title: '게시판',
    desc: '사내 공유 글과 요청 사항을 확인합니다.',
  },
  {
    to: '/archive?drive=1',
    icon: '/emoji/management-support/drive.svg',
    title: '드라이브',
    desc: '문서 보관함과 드라이브 연동을 확인합니다.',
  },
  {
    to: '/payroll-business-income',
    icon: '/emoji/management-support/tax.svg',
    title: '세무자료',
    desc: '사업소득신고 자료를 월별로 정리합니다.',
  },
  {
    to: '/accounting-staff',
    icon: '/emoji/management-support/staff.svg',
    title: '직원관리',
    desc: '직원 급여 기준과 회계 설정을 관리합니다.',
  },
];

function compactBranchName(value: unknown): string {
  return String(value || '').replace(/\s+/g, '').trim();
}

function isRestrictedAccountingAsstBranch(branch: unknown): boolean {
  const compact = compactBranchName(branch);
  return compact === '의정부' || compact === '의정부본사';
}

export default function ManagementSupport() {
  const { user } = useAuthStore();
  const role = user?.role || 'member';
  const label = user?.branch || user?.department || role;
  const isAsst = role === 'accountant_asst';
  const asstRestricted = isAsst && isRestrictedAccountingAsstBranch(user?.branch);
  const filteredItems = supportItems.filter((item) => {
    if (item.to === '/finance-analytics') return ['master', 'ceo', 'accountant'].includes(role);
    if (item.to === '/accounting-staff') return !isAsst;
    if (item.to === '/payroll' || item.to === '/payroll-business-income' || item.to.startsWith('/accounting-session2/reports')) {
      return !asstRestricted;
    }
    return true;
  });

  return (
    <div className="page management-support-page">
      <div className="page-header">
        <div>
          <h2>경영지원</h2>
          <p className="management-support-subtitle">{label} 업무 바로가기</p>
        </div>
      </div>

      <div className="management-support-grid">
        {filteredItems.map((item) => (
          <Link key={item.title} to={item.to} className="management-support-card">
            <span className="management-support-icon">
              <img src={item.icon} alt="" aria-hidden="true" />
            </span>
            <span className="management-support-title">{item.title}</span>
            <span className="management-support-desc">{item.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
