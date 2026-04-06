import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DocumentList from './pages/DocumentList';
import DocumentEdit from './pages/DocumentEdit';
import TemplateList from './pages/TemplateList';
import TemplateEdit from './pages/TemplateEdit';
import ReviewList from './pages/ReviewList';
import TeamList from './pages/TeamList';
import UserManagement from './pages/UserManagement';
import Profile from './pages/Profile';
import Journal from './pages/Journal';
import ArchivePage from './pages/Archive';
import Statistics from './pages/Statistics';
import OrgChart from './pages/OrgChart';
import MeetingMinutes from './pages/MeetingMinutes';
import Commissions from './pages/Commissions';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="page-loading">로딩중...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function TopRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (!user || !['master', 'ceo', 'cc_ref', 'admin'].includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function ApproverRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'cc_ref', 'admin', 'manager'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function StatsRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'admin'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'cc_ref', 'admin'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function CeoRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'cc_ref'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// 중복 탭 감지
function useSingleTab() {
  const [isDuplicate, setIsDuplicate] = useState(false);

  useEffect(() => {
    const channel = new BroadcastChannel('myauction_tab');
    const tabId = Date.now().toString();

    // 새 탭이 열리면 기존 탭에게 알림
    channel.postMessage({ type: 'new_tab', tabId });

    channel.onmessage = (e) => {
      if (e.data.type === 'new_tab' && e.data.tabId !== tabId) {
        // 다른 탭이 열렸으니 그 탭에 응답
        channel.postMessage({ type: 'already_open', tabId });
      }
      if (e.data.type === 'already_open' && e.data.tabId !== tabId) {
        // 이미 열려있는 탭이 있음 → 이 탭이 중복
        setIsDuplicate(true);
      }
    };

    return () => channel.close();
  }, []);

  return isDuplicate;
}

export default function App() {
  const { loadUser, loading } = useAuthStore();
  const isDuplicate = useSingleTab();

  useEffect(() => {
    loadUser();
  }, []);

  if (isDuplicate) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem' }}>📋</div>
        <h2 style={{ margin: 0, color: '#1a1a2e' }}>이미 열려있는 탭이 있습니다</h2>
        <p style={{ color: '#666', fontSize: '0.9rem', margin: 0 }}>마이옥션 오피스는 하나의 탭에서만 사용할 수 있습니다.<br />기존 탭을 확인해주세요.</p>
        <button onClick={() => window.close()} style={{ padding: '8px 24px', borderRadius: 8, border: '1px solid #dadce0', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' }}>이 탭 닫기</button>
      </div>
    );
  }

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="documents" element={<DocumentList />} />
          <Route path="documents/:id" element={<DocumentEdit />} />
          <Route path="templates" element={<TemplateList />} />
          <Route path="journal" element={<Journal />} />
          <Route path="archive" element={<ArchivePage />} />
          <Route
            path="statistics"
            element={
              <StatsRoute>
                <Statistics />
              </StatsRoute>
            }
          />
          <Route path="profile" element={<Profile />} />
          <Route
            path="templates/:id"
            element={
              <PrivateRoute>
                <TemplateEdit />
              </PrivateRoute>
            }
          />
          <Route
            path="review"
            element={
              <ApproverRoute>
                <ReviewList />
              </ApproverRoute>
            }
          />
          <Route
            path="teams"
            element={
              <TopRoute>
                <TeamList />
              </TopRoute>
            }
          />
          <Route
            path="org"
            element={
              <AdminRoute>
                <OrgChart />
              </AdminRoute>
            }
          />
          <Route
            path="users"
            element={
              <ApproverRoute>
                <UserManagement />
              </ApproverRoute>
            }
          />
          <Route path="commissions" element={<PrivateRoute><Commissions /></PrivateRoute>} />
          <Route
            path="minutes"
            element={
              <CeoRoute>
                <MeetingMinutes />
              </CeoRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
