import { useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store';
import { ROLE_LABELS } from '../types';
import type { Role } from '../types';
import {
  LayoutDashboard, FileText, ClipboardList, CheckCircle,
  Users, UserCog, LogOut, CalendarDays, BarChart3,
  PanelLeftClose, PanelLeftOpen, UserPen, Menu, X, Archive, Network, BookOpen, DollarSign, BookOpenCheck, Receipt, CalendarCheck, PieChart, StickyNote, MessageSquare, DoorOpen, FileSignature, Briefcase,
  Scale, ExternalLink,
} from 'lucide-react';

// 명승 진단 바로가기 노출 페이지: 대시보드 + 마이페이지 하위 전부
const DIAGNOSIS_BOX_PATHS = ['/journal', '/sales', '/leave', '/rooms', '/contract-tracker'];
function shouldShowDiagnosisBox(pathname: string): boolean {
  if (pathname === '/' || pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return true;
  return DIAGNOSIS_BOX_PATHS.some(base => pathname === base || pathname.startsWith(base + '/'));
}

// 컨설턴트 계약관리: 대표/마스터/총무급 + 정민호 예외
const CONTRACT_TRACKER_EXTRA_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
const PAYROLL_EXTRA_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // 명승 진단 박스 펼침 상태 — 기본값 접힘, 사용자 선택은 localStorage 유지
  const [diagnosisOpen, setDiagnosisOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('diagnosisOpen') === '1'; } catch { return false; }
  });
  const toggleDiagnosis = (next: boolean) => {
    setDiagnosisOpen(next);
    try { localStorage.setItem('diagnosisOpen', next ? '1' : '0'); } catch { /* */ }
  };

  const handleLogout = () => { logout(); navigate('/login'); };
  const isActive = (path: string) => location.pathname.startsWith(path);
  const navTo = (path: string) => { navigate(path); setMobileOpen(false); };

  const role = (user?.role || 'member') as Role;
  const isFreelancer = (user as any)?.login_type === 'freelancer';
  const isSupport = role === 'support';
  const canApprove = !isFreelancer && ['master', 'ceo', 'cc_ref', 'admin', 'manager', 'support'].includes(role);
  const canApproveUsers = !isFreelancer && ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role);
  const canManage = !isFreelancer && ['master', 'ceo', 'cc_ref', 'admin'].includes(role);
  const canAccounting = !isFreelancer && !isSupport && ['master', 'ceo', 'accountant', 'accountant_asst'].includes(role);
  const canPayroll = canAccounting || PAYROLL_EXTRA_IDS.includes(user?.id || '');
  // 회계분석은 총무보조 제외 (cc_ref도 제외)
  const canFinanceAnalytics = !isFreelancer && !isSupport && (
    ['master', 'ceo', 'accountant'].includes(role) ||
    (role === 'admin' && user?.branch === '의정부')
  );
  const isAccountingOnly = !isFreelancer && ['accountant', 'accountant_asst'].includes(role);
  const isDirector = role === 'director';
  const canViewContractTracker = !isFreelancer && (
    ['master', 'ceo', 'accountant', 'accountant_asst'].includes(role) ||
    CONTRACT_TRACKER_EXTRA_IDS.includes(user?.id || '')
  );

  const sidebarContent = (
    <>
      <div className="sidebar-header">
        {!collapsed ? (
          <h1 className="logo" onClick={() => navTo('/')} style={{ cursor: 'pointer' }}>
            <img src="/logo2.png" alt="로고" className="sidebar-logo-img" />
            <span className="logo-text-group">
              <span>마이옥션 오피스</span>
              <span className="logo-sub">문서 관리 시스템</span>
            </span>
          </h1>
        ) : (
          <img src="/logo2.png" alt="로고" className="sidebar-logo-img-sm" onClick={() => navTo('/')} style={{ cursor: 'pointer' }} />
        )}
        <button className="mobile-close-btn" onClick={() => setMobileOpen(false)}>
          <X size={20} />
        </button>
      </div>

      <nav className="sidebar-nav">
        <Link to="/dashboard" className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`} title="대시보드" onClick={() => setMobileOpen(false)}>
          <LayoutDashboard size={18} /> {!collapsed && '대시보드'}
        </Link>

        {!isFreelancer && <div className="nav-divider" />}
        {!isFreelancer && !collapsed && <span className="nav-label">마이페이지</span>}
        <Link to="/admin-notes" className={`nav-item ${isActive('/admin-notes') ? 'active' : ''}`} title="사내 커뮤니티" onClick={() => setMobileOpen(false)}>
          <StickyNote size={18} /> {!collapsed && '사내 커뮤니티'}
        </Link>
        {!isAccountingOnly && !isFreelancer && !isDirector && !isSupport && (
          <Link to="/journal" className={`nav-item ${isActive('/journal') ? 'active' : ''}`} title="컨설턴트 일지" onClick={() => setMobileOpen(false)}>
            <CalendarDays size={18} /> {!collapsed && '컨설턴트 일지'}
          </Link>
        )}
        {!isSupport && (
          <Link to="/sales" className={`nav-item ${isActive('/sales') ? 'active' : ''}`} title="업무성과" onClick={() => setMobileOpen(false)}>
            <DollarSign size={18} /> {!collapsed && '업무성과'}
          </Link>
        )}
        {!isFreelancer && (
          <Link to="/leave" className={`nav-item ${isActive('/leave') ? 'active' : ''}`} title="연차관리" onClick={() => setMobileOpen(false)}>
            <CalendarCheck size={18} /> {!collapsed && '연차관리'}
          </Link>
        )}
        <Link to="/rooms" className={`nav-item ${isActive('/rooms') ? 'active' : ''}`} title="회의실 예약" onClick={() => setMobileOpen(false)}>
          <DoorOpen size={18} /> {!collapsed && '회의실 예약'}
        </Link>
        {canViewContractTracker && (
          <Link to="/contract-tracker" className={`nav-item ${isActive('/contract-tracker') ? 'active' : ''}`} title="컨설턴트 계약관리" onClick={() => setMobileOpen(false)}>
            <FileSignature size={18} /> {!collapsed && '컨설턴트 계약관리'}
          </Link>
        )}

        {!isFreelancer && <div className="nav-divider" />}
        {!isFreelancer && !collapsed && <span className="nav-label">문서</span>}
        {!isFreelancer && (
          <Link to="/documents" className={`nav-item ${isActive('/documents') ? 'active' : ''}`} title="내 문서" onClick={() => setMobileOpen(false)}>
            <FileText size={18} /> {!collapsed && '내 문서'}
          </Link>
        )}
        {!isFreelancer && (
          <Link to="/templates" className={`nav-item ${isActive('/templates') ? 'active' : ''}`} title="템플릿" onClick={() => setMobileOpen(false)}>
            <ClipboardList size={18} /> {!collapsed && '템플릿'}
          </Link>
        )}
        {!isFreelancer && (
          <Link to="/archive" className={`nav-item ${isActive('/archive') ? 'active' : ''}`} title="문서 보관함" onClick={() => setMobileOpen(false)}>
            <Archive size={18} /> {!collapsed && '문서 보관함'}
          </Link>
        )}

        {canApprove && (
          <>
            <div className="nav-divider" />
            {!collapsed && <span className="nav-label">관리</span>}
            <Link to="/review" className={`nav-item ${isActive('/review') ? 'active' : ''}`} title="문서 승인" onClick={() => setMobileOpen(false)}>
              <CheckCircle size={18} /> {!collapsed && '문서 승인'}
            </Link>
          </>
        )}

        {/* 통계: master/ceo/admin/director */}
        {['master', 'ceo', 'admin', 'director'].includes(role) && (
          <Link to="/statistics" className={`nav-item ${isActive('/statistics') ? 'active' : ''}`} title="통계" onClick={() => setMobileOpen(false)}>
            <BarChart3 size={18} /> {!collapsed && '통계'}
          </Link>
        )}

        {/* 명도 사건 (외부 수신): 관리자급 + 팀장 (본인 사건 조회) */}
        {['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst', 'manager', 'director'].includes(role) && (
          <Link to="/cases" className={`nav-item ${isActive('/cases') ? 'active' : ''}`} title="명도 사건" onClick={() => setMobileOpen(false)}>
            <Briefcase size={18} /> {!collapsed && '명도 사건'}
          </Link>
        )}

        {canManage && (
          <Link to="/teams" className={`nav-item ${isActive('/teams') ? 'active' : ''}`} title="부서관리" onClick={() => setMobileOpen(false)}>
            <Users size={18} /> {!collapsed && '부서관리'}
          </Link>
        )}

        {(canApproveUsers || isDirector) && (
          <Link to="/org" className={`nav-item ${isActive('/org') ? 'active' : ''}`} title="조직도" onClick={() => setMobileOpen(false)}>
            <Network size={18} /> {!collapsed && '조직도'}
          </Link>
        )}

        {canApproveUsers && !isDirector && (
          <Link to="/users" className={`nav-item ${isActive('/users') ? 'active' : ''}`} title="사용자 관리" onClick={() => setMobileOpen(false)}>
            <UserCog size={18} /> {!collapsed && '사용자 관리'}
          </Link>
        )}

        <Link to="/minutes" className={`nav-item ${isActive('/minutes') ? 'active' : ''}`} title="회의록" onClick={() => setMobileOpen(false)}>
          <BookOpen size={18} /> {!collapsed && '회의록'}
        </Link>

        {['master', 'accountant', 'admin'].includes(role) && (
          <Link to="/link-review" className={`nav-item ${isActive('/link-review') ? 'active' : ''}`} title="외근 link 검수" onClick={() => setMobileOpen(false)}>
            <Briefcase size={18} /> {!collapsed && '외근 link 검수'}
          </Link>
        )}
        {['master', 'ceo', 'cc_ref', 'admin'].includes(role) && (
          <Link to="/alimtalk-logs" className={`nav-item ${isActive('/alimtalk-logs') ? 'active' : ''}`} title="카카오 발송내역" onClick={() => setMobileOpen(false)}>
            <MessageSquare size={18} /> {!collapsed && '카카오 발송내역'}
          </Link>
        )}
        {(canAccounting || canPayroll) && (
          <>
            <div className="nav-divider" />
            {!collapsed && <span className="nav-label">회계</span>}
            {canAccounting && (
              <Link to="/accounting" className={`nav-item ${isActive('/accounting') ? 'active' : ''}`} title="회계장부" onClick={() => setMobileOpen(false)}>
                <BookOpenCheck size={18} /> {!collapsed && '회계장부'}
              </Link>
            )}
            <Link to="/payroll" className={`nav-item ${isActive('/payroll') ? 'active' : ''}`} title="급여정산" onClick={() => setMobileOpen(false)}>
              <Receipt size={18} /> {!collapsed && '급여정산'}
            </Link>
            {canFinanceAnalytics && (
              <Link to="/finance-analytics" className={`nav-item ${isActive('/finance-analytics') ? 'active' : ''}`} title="회계분석" onClick={() => setMobileOpen(false)}>
                <PieChart size={18} /> {!collapsed && '회계분석'}
              </Link>
            )}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        {!collapsed && (
          <div className="user-info">
            <div className="user-avatar">{user?.name?.charAt(0)}</div>
            <div className="user-details">
              <div className="user-name">{user?.name}</div>
              <div className="user-role">
                {user?.position_title || ROLE_LABELS[role]}
                {user?.branch && ` · ${user.branch}`}
                {user?.department && ` · ${user.department}`}
              </div>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="user-avatar" style={{ margin: '0 auto 8px' }}>{user?.name?.charAt(0)}</div>
        )}
        <div className="sidebar-footer-btns">
          <button onClick={() => navTo('/profile')} className="btn-footer" title="내 정보 수정">
            <UserPen size={14} /> {!collapsed && '내 정보 수정'}
          </button>
          <button onClick={handleLogout} className="btn-footer" title="로그아웃">
            <LogOut size={14} /> {!collapsed && '로그아웃'}
          </button>
        </div>
        <button onClick={() => setCollapsed(!collapsed)} className="btn-collapse desktop-only" title={collapsed ? '펼치기' : '접기'}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span>접기</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className={`app-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Mobile header */}
      <div className="mobile-header">
        <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)}>
          <Menu size={22} />
        </button>
        <span className="mobile-title">마이옥션 오피스</span>
        <div className="mobile-avatar" onClick={() => navTo('/profile')}>
          {user?.name?.charAt(0)}
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && <div className="mobile-overlay" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar */}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        {sidebarContent}
      </aside>

      <main className="main-content">
        <Outlet />
      </main>

      {/* 명승 진단 바로가기 — 대시보드 + 마이페이지 하위 전부 (접기/펼치기) */}
      {shouldShowDiagnosisBox(location.pathname) && (
        diagnosisOpen ? (
          <aside className="diagnosis-floating-box" aria-label="명승 진단 바로가기">
            <button
              type="button"
              className="diagnosis-collapse-btn"
              onClick={() => toggleDiagnosis(false)}
              aria-label="접기"
              title="접기"
            >
              <X size={12} />
            </button>
            <div className="diagnosis-floating-title">
              <ExternalLink size={11} />
              <span>명승</span>
            </div>
            <a
              href="https://www.lawitgo.com/diagnosis/?funnel=moffice"
              target="_blank"
              rel="noopener noreferrer"
              className="diagnosis-floating-link"
            >
              <Scale size={14} />
              <span>명도비/정액제</span>
            </a>
          </aside>
        ) : (
          <button
            type="button"
            className="diagnosis-floating-toggle"
            onClick={() => toggleDiagnosis(true)}
            aria-label="명승 진단 바로가기 펼치기"
            title="명승 진단"
          >
            <Scale size={18} />
          </button>
        )
      )}
    </div>
  );
}
