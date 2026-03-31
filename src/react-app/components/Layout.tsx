import { useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store';
import { ROLE_LABELS } from '../types';
import type { Role } from '../types';
import {
  LayoutDashboard, FileText, ClipboardList, CheckCircle,
  Users, UserCog, LogOut, CalendarDays, BarChart3,
  PanelLeftClose, PanelLeftOpen, UserPen
} from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };
  const isActive = (path: string) => location.pathname.startsWith(path);

  const role = (user?.role || 'member') as Role;
  const canApprove = ['master', 'ceo', 'admin', 'manager'].includes(role);
  const canApproveUsers = ['master', 'ceo', 'admin'].includes(role);
  const canManage = ['master', 'ceo'].includes(role);

  return (
    <div className={`app-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          {!collapsed ? (
            <>
              <h1 className="logo">마이옥션 오피스</h1>
              <span className="logo-sub">문서 관리 시스템</span>
            </>
          ) : (
            <h1 className="logo" style={{ fontSize: '0.9rem' }}>MA</h1>
          )}
        </div>

        <nav className="sidebar-nav">
          <Link to="/dashboard" className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`} title="대시보드">
            <LayoutDashboard size={18} /> {!collapsed && '대시보드'}
          </Link>
          <Link to="/documents" className={`nav-item ${isActive('/documents') ? 'active' : ''}`} title="내 문서">
            <FileText size={18} /> {!collapsed && '내 문서'}
          </Link>
          <Link to="/templates" className={`nav-item ${isActive('/templates') ? 'active' : ''}`} title="템플릿">
            <ClipboardList size={18} /> {!collapsed && '템플릿'}
          </Link>
          <Link to="/journal" className={`nav-item ${isActive('/journal') ? 'active' : ''}`} title="컨설턴트 일지">
            <CalendarDays size={18} /> {!collapsed && '컨설턴트 일지'}
          </Link>

          {canApprove && (
            <>
              <div className="nav-divider" />
              {!collapsed && <span className="nav-label">관리</span>}
              <Link to="/review" className={`nav-item ${isActive('/review') ? 'active' : ''}`} title="문서 승인">
                <CheckCircle size={18} /> {!collapsed && '문서 승인'}
              </Link>
              <Link to="/statistics" className={`nav-item ${isActive('/statistics') ? 'active' : ''}`} title="통계">
                <BarChart3 size={18} /> {!collapsed && '통계'}
              </Link>
            </>
          )}

          {canManage && (
            <Link to="/teams" className={`nav-item ${isActive('/teams') ? 'active' : ''}`} title="팀 관리">
              <Users size={18} /> {!collapsed && '팀 관리'}
            </Link>
          )}

          {canApproveUsers && (
            <Link to="/users" className={`nav-item ${isActive('/users') ? 'active' : ''}`} title="사용자 관리">
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
                  {ROLE_LABELS[role]}
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
            <button onClick={() => navigate('/profile')} className="btn-footer" title="내 정보 수정">
              <UserPen size={14} /> {!collapsed && '내 정보 수정'}
            </button>
            <button onClick={handleLogout} className="btn-footer" title="로그아웃">
              <LogOut size={14} /> {!collapsed && '로그아웃'}
            </button>
          </div>
          <button onClick={() => setCollapsed(!collapsed)} className="btn-collapse" title={collapsed ? '펼치기' : '접기'}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {!collapsed && <span>접기</span>}
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
