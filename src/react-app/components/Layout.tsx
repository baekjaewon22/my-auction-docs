import { useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store';
import { ROLE_LABELS } from '../types';
import type { Role } from '../types';
import {
  LayoutDashboard, FileText, ClipboardList, CheckCircle,
  Users, UserCog, LogOut, CalendarDays, BarChart3,
  PanelLeftClose, PanelLeftOpen, UserPen, Menu, X, Archive
} from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };
  const isActive = (path: string) => location.pathname.startsWith(path);
  const navTo = (path: string) => { navigate(path); setMobileOpen(false); };

  const role = (user?.role || 'member') as Role;
  const canApprove = ['master', 'ceo', 'admin', 'manager'].includes(role);
  const canApproveUsers = ['master', 'ceo', 'admin'].includes(role);
  const canManage = ['master', 'ceo'].includes(role);

  const sidebarContent = (
    <>
      <div className="sidebar-header">
        {!collapsed ? (
          <>
            <h1 className="logo">
              <img src="/logo2.png" alt="로고" className="sidebar-logo-img" />
              <span className="logo-text-group">
                <span>마이옥션 오피스</span>
                <span className="logo-sub">문서 관리 시스템</span>
              </span>
            </h1>
          </>
        ) : (
          <img src="/logo2.png" alt="로고" className="sidebar-logo-img-sm" />
        )}
        <button className="mobile-close-btn" onClick={() => setMobileOpen(false)}>
          <X size={20} />
        </button>
      </div>

      <nav className="sidebar-nav">
        <Link to="/dashboard" className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`} title="대시보드" onClick={() => setMobileOpen(false)}>
          <LayoutDashboard size={18} /> {!collapsed && '대시보드'}
        </Link>
        <Link to="/documents" className={`nav-item ${isActive('/documents') ? 'active' : ''}`} title="내 문서" onClick={() => setMobileOpen(false)}>
          <FileText size={18} /> {!collapsed && '내 문서'}
        </Link>
        <Link to="/templates" className={`nav-item ${isActive('/templates') ? 'active' : ''}`} title="템플릿" onClick={() => setMobileOpen(false)}>
          <ClipboardList size={18} /> {!collapsed && '템플릿'}
        </Link>
        <Link to="/journal" className={`nav-item ${isActive('/journal') ? 'active' : ''}`} title="컨설턴트 일지" onClick={() => setMobileOpen(false)}>
          <CalendarDays size={18} /> {!collapsed && '컨설턴트 일지'}
        </Link>
        <Link to="/archive" className={`nav-item ${isActive('/archive') ? 'active' : ''}`} title="문서 보관함" onClick={() => setMobileOpen(false)}>
          <Archive size={18} /> {!collapsed && '문서 보관함'}
        </Link>

        {canApprove && (
          <>
            <div className="nav-divider" />
            {!collapsed && <span className="nav-label">관리</span>}
            <Link to="/review" className={`nav-item ${isActive('/review') ? 'active' : ''}`} title="문서 승인" onClick={() => setMobileOpen(false)}>
              <CheckCircle size={18} /> {!collapsed && '문서 승인'}
            </Link>
          </>
        )}

        {/* 통계: 관리자(admin) 이상만 - 팀장 이하는 메뉴 자체 숨김 */}
        {canApproveUsers && (
          <Link to="/statistics" className={`nav-item ${isActive('/statistics') ? 'active' : ''}`} title="통계" onClick={() => setMobileOpen(false)}>
            <BarChart3 size={18} /> {!collapsed && '통계'}
          </Link>
        )}

        {canManage && (
          <Link to="/teams" className={`nav-item ${isActive('/teams') ? 'active' : ''}`} title="팀 관리" onClick={() => setMobileOpen(false)}>
            <Users size={18} /> {!collapsed && '팀 관리'}
          </Link>
        )}

        {canApproveUsers && (
          <Link to="/users" className={`nav-item ${isActive('/users') ? 'active' : ''}`} title="사용자 관리" onClick={() => setMobileOpen(false)}>
            <UserCog size={18} /> {!collapsed && '사용자 관리'}
          </Link>
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
    </div>
  );
}
