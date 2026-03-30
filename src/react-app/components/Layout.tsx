import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store';
import { ROLE_LABELS } from '../types';
import type { Role } from '../types';
import {
  LayoutDashboard, FileText, ClipboardList, CheckCircle,
  Users, UserCog, Settings, LogOut, UserPlus, CalendarDays, BarChart3
} from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => { logout(); navigate('/login'); };
  const isActive = (path: string) => location.pathname.startsWith(path);

  const role = (user?.role || 'member') as Role;
  const canApprove = ['master', 'ceo', 'admin', 'manager'].includes(role);
  const canApproveUsers = ['master', 'ceo', 'admin'].includes(role);
  const canManage = ['master', 'ceo'].includes(role);

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">마이옥션 오피스</h1>
          <span className="logo-sub">문서 관리 시스템</span>
        </div>

        <nav className="sidebar-nav">
          <Link to="/dashboard" className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`}>
            <LayoutDashboard size={18} /> 대시보드
          </Link>
          <Link to="/documents" className={`nav-item ${isActive('/documents') ? 'active' : ''}`}>
            <FileText size={18} /> 내 문서
          </Link>
          <Link to="/templates" className={`nav-item ${isActive('/templates') ? 'active' : ''}`}>
            <ClipboardList size={18} /> 템플릿
          </Link>
          <Link to="/journal" className={`nav-item ${isActive('/journal') ? 'active' : ''}`}>
            <CalendarDays size={18} /> 컨설턴트 일지
          </Link>
          <Link to="/profile" className={`nav-item ${isActive('/profile') ? 'active' : ''}`}>
            <Settings size={18} /> 내 정보
          </Link>

          {canApprove && (
            <>
              <div className="nav-divider" />
              <span className="nav-label">관리</span>
              <Link to="/review" className={`nav-item ${isActive('/review') ? 'active' : ''}`}>
                <CheckCircle size={18} /> 문서 승인
              </Link>
              <Link to="/statistics" className={`nav-item ${isActive('/statistics') ? 'active' : ''}`}>
                <BarChart3 size={18} /> 통계
              </Link>
            </>
          )}

          {canApproveUsers && (
            <Link to="/pending" className={`nav-item ${isActive('/pending') ? 'active' : ''}`}>
              <UserPlus size={18} /> 가입 승인
            </Link>
          )}

          {canManage && (
            <>
              <Link to="/teams" className={`nav-item ${isActive('/teams') ? 'active' : ''}`}>
                <Users size={18} /> 팀 관리
              </Link>
              <Link to="/users" className={`nav-item ${isActive('/users') ? 'active' : ''}`}>
                <UserCog size={18} /> 사용자 관리
              </Link>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{user?.name?.charAt(0)}</div>
            <div className="user-details">
              <div className="user-name">{user?.name}</div>
              <div className="user-role">
                {ROLE_LABELS[role]}
                {user?.branch && ` · ${user.branch}`}
                {user?.department && ` · ${user.department}`}
              </div>
            </div>
          </div>
          <button onClick={handleLogout} className="btn-logout">
            <LogOut size={14} style={{ marginRight: 4 }} /> 로그아웃
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
