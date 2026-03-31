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
import Statistics from './pages/Statistics';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="page-loading">로딩중...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function TopRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role !== 'master' && user?.role !== 'ceo') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function ApproverRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'admin', 'manager'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'admin'];
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
          <Route
            path="statistics"
            element={
              <AdminRoute>
                <Statistics />
              </AdminRoute>
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
            path="users"
            element={
              <ApproverRoute>
                <UserManagement />
              </ApproverRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
