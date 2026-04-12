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
// import Commissions from './pages/Commissions'; // 매출확인으로 통합됨
import Accounting from './pages/Accounting';
import Sales from './pages/Sales';
import Payroll from './pages/Payroll';
import LeavePage from './pages/Leave';
import PropertyReport from './pages/PropertyReport';
import FinanceAnalytics from './pages/FinanceAnalytics';

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


function NonAccountingRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (!user || ['accountant', 'accountant_asst'].includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AccountingRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// 중복 탭 감지
function useSingleTab() {
  const [isDuplicate, setIsDuplicate] = useState(false);

  useEffect(() => {
    const channel = new BroadcastChannel('myauction_tab');
    const tabId = Date.now().toString() + Math.random();
    let ready = false;

    // 잠시 대기 후 새 탭 알림 (새로고침 시 이전 채널이 닫힐 시간 확보)
    const timer = setTimeout(() => {
      ready = true;
      channel.postMessage({ type: 'new_tab', tabId });
    }, 300);

    channel.onmessage = (e) => {
      if (e.data.type === 'new_tab' && e.data.tabId !== tabId && ready) {
        channel.postMessage({ type: 'already_open', tabId });
      }
      if (e.data.type === 'already_open' && e.data.tabId !== tabId) {
        setIsDuplicate(true);
      }
    };

    return () => { clearTimeout(timer); channel.close(); };
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
          <Route path="property-report" element={<PropertyReport />} />
          <Route path="property-report/:id" element={<PropertyReport />} />
          <Route path="templates" element={<TemplateList />} />
          <Route path="journal" element={<NonAccountingRoute><Journal /></NonAccountingRoute>} />
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
          {/* commissions 라우트 제거 — 매출확인으로 통합 */}
          <Route path="sales" element={<PrivateRoute><Sales /></PrivateRoute>} />
          <Route path="leave" element={<PrivateRoute><LeavePage /></PrivateRoute>} />
          <Route
            path="payroll"
            element={
              <AccountingRoute>
                <Payroll />
              </AccountingRoute>
            }
          />
          <Route
            path="accounting"
            element={
              <AccountingRoute>
                <Accounting />
              </AccountingRoute>
            }
          />
          <Route
            path="finance-analytics"
            element={
              <AccountingRoute>
                <FinanceAnalytics />
              </AccountingRoute>
            }
          />
          <Route
            path="minutes"
            element={
              <AdminRoute>
                <MeetingMinutes />
              </AdminRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
