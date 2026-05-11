import { useEffect } from 'react';
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
import Cases from './pages/Cases';
import OrgChart from './pages/OrgChart';
import MeetingMinutes from './pages/MeetingMinutes';
// import Commissions from './pages/Commissions'; // 매출확인으로 통합됨
import Accounting from './pages/Accounting';
import Sales from './pages/Sales';
import Payroll from './pages/Payroll';
import LeavePage from './pages/Leave';
import PropertyReport from './pages/PropertyReport';
import FinanceAnalytics from './pages/FinanceAnalytics';
import AlimtalkLogs from './pages/AlimtalkLogs';
import AdminNotes from './pages/AdminNotes';
import Cooperation from './pages/Cooperation';
import RoomReservation from './pages/RoomReservation';
import ContractTracker from './pages/ContractTracker';
import LinkReview from './pages/LinkReview';
import Print from './pages/Print';

// 컨설턴트 계약관리 열람 가능: master/ceo/accountant/accountant_asst + 정민호 예외
const CONTRACT_TRACKER_EXTRA_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
function ContractTrackerRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'accountant', 'accountant_asst'];
  if (!user || (!allowed.includes(user.role) && !CONTRACT_TRACKER_EXTRA_IDS.includes(user.id))) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

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

function AccountingOrApproverRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'cc_ref', 'admin', 'manager', 'accountant', 'accountant_asst'];
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

// 조직도 열람 — 관리자+총무+총괄이사 허용 (일반 팀원 차단)
function OrgRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'accountant', 'accountant_asst'];
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
  const allowed = ['master', 'ceo', 'admin', 'accountant', 'accountant_asst'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function FinanceAnalyticsRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  // 회계분석은 cc_ref·총무보조 제외
  const allowed = ['master', 'ceo', 'admin', 'accountant'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  const { loadUser, loading } = useAuthStore();

  useEffect(() => {
    loadUser();
  }, []);

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* 인쇄 전용 (서버 Puppeteer가 접근) — 인증 불필요, printToken으로 데이터 조회 */}
        <Route path="/print/:docId" element={<Print />} />
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
          <Route path="cases" element={<Cases />} />
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
              <OrgRoute>
                <OrgChart />
              </OrgRoute>
            }
          />
          <Route
            path="users"
            element={
              <AccountingOrApproverRoute>
                <UserManagement />
              </AccountingOrApproverRoute>
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
              <FinanceAnalyticsRoute>
                <FinanceAnalytics />
              </FinanceAnalyticsRoute>
            }
          />
          <Route
            path="minutes"
            element={
              <PrivateRoute>
                <MeetingMinutes />
              </PrivateRoute>
            }
          />
          <Route
            path="alimtalk-logs"
            element={
              <AdminRoute>
                <AlimtalkLogs />
              </AdminRoute>
            }
          />
          <Route
            path="admin-notes"
            element={
              <PrivateRoute>
                <AdminNotes />
              </PrivateRoute>
            }
          />
          <Route
            path="cooperation"
            element={
              <PrivateRoute>
                <Cooperation />
              </PrivateRoute>
            }
          />
          <Route
            path="rooms"
            element={
              <PrivateRoute>
                <RoomReservation />
              </PrivateRoute>
            }
          />
          <Route
            path="contract-tracker"
            element={
              <ContractTrackerRoute>
                <ContractTracker />
              </ContractTrackerRoute>
            }
          />
          <Route
            path="link-review"
            element={
              <PrivateRoute>
                <LinkReview />
              </PrivateRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
