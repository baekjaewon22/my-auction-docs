import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store';
import { api } from './api';
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
import PhoneDirectory from './pages/PhoneDirectory';
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
import MissingDocuments from './pages/MissingDocuments';
import Payroll from './pages/Payroll';
import LeavePage from './pages/Leave';
import PropertyReport from './pages/PropertyReport';
import FinanceAnalytics from './pages/FinanceAnalytics';
import ManagementSupport from './pages/ManagementSupport';
import HolidaySettings from './pages/HolidaySettings';
import {
  AccountingAuditReport,
  AccountingBankUpload,
  AccountingCheckCardReport,
  AccountingCheckCardUpload,
  AccountingClassificationEngine,
  AccountingExpenseLedgerReport,
  AccountingForecastReport,
  AccountingLaborCostReport,
  AccountingProfitLossReport,
  AccountingReportsHub,
  AccountingSalesLedgerReport,
  AccountingSessionHome,
  AccountingSessionRules,
  AccountingSessionTwo,
  AccountingTaxReport,
} from './pages/AccountingSessionOne';
import AlimtalkLogs from './pages/AlimtalkLogs';
import AdminNotes from './pages/AdminNotes';
import RoomReservation from './pages/RoomReservation';
import ContractTracker from './pages/ContractTracker';
import LinkReview from './pages/LinkReview';
import Print from './pages/Print';
import FreelancerBidHistory from './pages/FreelancerBidHistory';
import BriefingMaterials from './pages/BriefingMaterials';
import RightsAnalysisGuarantee from './pages/RightsAnalysisGuarantee';
import AutomationDiagnosticsAdmin from './pages/AutomationDiagnosticsAdmin';
import { X } from 'lucide-react';
import { canUseBusinessAutomation } from '../shared/automation-access';

// 컨설턴트 계약관리 열람 가능: master/ceo/accountant/accountant_asst + 정민호 예외
const CONTRACT_TRACKER_EXTRA_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
const PAYROLL_EXTRA_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
const PROFIT_LOSS_EXTRA_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
const LABOR_COST_EXTRA_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
const openedAnnouncementPopupIds = new Set<string>();

function escapePopupHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openAnnouncementWindow(popup: any): boolean {
  const id = String(popup?.id || '');
  if (!id || openedAnnouncementPopupIds.has(id)) return true;

  const popupWindow = window.open('', `announcement-popup-${id}`, 'width=520,height=560,left=120,top=90,resizable=yes,scrollbars=yes');
  if (!popupWindow) return false;

  openedAnnouncementPopupIds.add(id);
  const dismissDays = Math.max(1, Number(popup.dismiss_days || 7));
  const origin = escapePopupHtml(window.location.origin);
  const title = escapePopupHtml(popup.title || '공지사항');
  const contentHtml = String(popup.content || '')
    .split('\n')
    .map((line) => line.trim()
      ? `<p>${escapePopupHtml(line)}</p>`
      : '<div class="gap"></div>')
    .join('');

  popupWindow.document.open();
  popupWindow.document.write(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f8fb; color: #172033; }
    .wrap { min-height: 100vh; padding: 22px; display: flex; align-items: stretch; }
    .card { width: 100%; background: #fff; border: 1px solid #d8dee8; box-shadow: 0 10px 26px rgba(18, 31, 56, .12); border-radius: 8px; display: flex; flex-direction: column; }
    .head { padding: 20px 22px 14px; border-bottom: 1px solid #e7ebf1; }
    .kicker { display: block; font-size: 12px; font-weight: 700; color: #1a73e8; margin-bottom: 7px; }
    h1 { margin: 0; font-size: 20px; line-height: 1.35; letter-spacing: 0; color: #101828; }
    .body { padding: 18px 22px 14px; flex: 1; overflow: auto; }
    p { margin: 0 0 11px; font-size: 14px; line-height: 1.75; color: #334155; word-break: keep-all; }
    .gap { height: 8px; }
    .foot { padding: 14px 22px 18px; border-top: 1px solid #e7ebf1; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    label { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: #475569; user-select: none; }
    input { width: 15px; height: 15px; }
    button { border: 0; border-radius: 6px; padding: 8px 15px; background: #1a73e8; color: #fff; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="card">
      <div class="head">
        <span class="kicker">공지사항</span>
        <h1>${title}</h1>
      </div>
      <div class="body">${contentHtml}</div>
      <div class="foot">
        <label><input id="hide-week" type="checkbox" /> 일주일간 보지않기</label>
        <button id="close-button" type="button">확인</button>
      </div>
    </section>
  </div>
  <script>
    document.getElementById('close-button').addEventListener('click', function () {
      if (document.getElementById('hide-week').checked) {
        localStorage.setItem('announcement-popup-dismiss-until:${escapePopupHtml(id)}', String(Date.now() + ${dismissDays} * 86400000));
        if (window.opener) {
          window.opener.postMessage({ type: 'announcement-popup-dismissed', id: '${escapePopupHtml(id)}' }, '${origin}');
        }
      }
      window.close();
    });
  </script>
</body>
</html>`);
  popupWindow.document.close();
  popupWindow.focus();
  return true;
}

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

function MasterRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="page-loading">로딩중...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'master') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function TopRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (!user || !['master', 'ceo', 'cc_ref', 'admin'].includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function MissingDocumentsRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'manager', 'accountant', 'accountant_asst'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function BidHistoryRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (!user || (user as any).login_type === 'freelancer' || !['master', 'ceo', 'cc_ref', 'admin'].includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function ApproverRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'cc_ref', 'admin', 'manager', 'accountant'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function FreelancerRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'];
  if (!user || ((user as any).login_type !== 'freelancer' && !allowed.includes(user.role))) {
    return <Navigate to="/dashboard" replace />;
  }
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
  const allowed = ['master', 'ceo', 'accountant', 'accountant_asst'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function PayrollRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'accountant', 'accountant_asst'];
  if (!user || (!allowed.includes(user.role) && !PAYROLL_EXTRA_IDS.includes(user.id))) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function ManagementSupportRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'accountant', 'accountant_asst'];
  if (!user || (!allowed.includes(user.role) && !PAYROLL_EXTRA_IDS.includes(user.id))) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function ManagementSupportHomeRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'admin', 'accountant', 'accountant_asst'];
  if (!user || (!allowed.includes(user.role) && !PAYROLL_EXTRA_IDS.includes(user.id))) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function HolidaySettingsRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'admin', 'accountant'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function ProfitLossReportRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'accountant', 'accountant_asst'];
  if (!user || (!allowed.includes(user.role) && !PROFIT_LOSS_EXTRA_IDS.includes(user.id))) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function ForecastReportRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'accountant'];
  if (!user || (!allowed.includes(user.role) && !PROFIT_LOSS_EXTRA_IDS.includes(user.id))) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function LaborCostReportRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'accountant'];
  if (!user || (!allowed.includes(user.role) && !LABOR_COST_EXTRA_IDS.includes(user.id))) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function TaxMaterialsRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const allowed = ['master', 'ceo', 'accountant'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function CooperationRedirect() {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  query.set('tab', 'cooperation');
  return <Navigate to={`/admin-notes?${query.toString()}`} replace />;
}

function BidHistoryRedirect() {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  query.set('section', 'briefing_schedule');
  return <Navigate to={`/bid-history?${query.toString()}`} replace />;
}

function FinanceAnalyticsRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  // 회계분석은 cc_ref·총무보조 제외
  const allowed = ['master', 'ceo', 'admin', 'accountant'];
  if (!user || !allowed.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function BusinessAutomationRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  if (loading) return <div className="page-loading">로딩중...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!canUseBusinessAutomation(user)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AnnouncementPopupGate() {
  const { user } = useAuthStore();
  const location = useLocation();
  const [fallbackPopup, setFallbackPopup] = useState<any | null>(null);
  const [hideForWeek, setHideForWeek] = useState(false);
  const popupTestMode = import.meta.env.DEV && new URLSearchParams(location.search).get('popupTest') === '1';

  const clearFallbackIfDismissed = (id: string) => {
    const dismissUntil = Number(localStorage.getItem(`announcement-popup-dismiss-until:${id}`) || 0);
    if (dismissUntil && dismissUntil >= Date.now()) {
      setFallbackPopup((current: any | null) => (String(current?.id || '') === id ? null : current));
      setHideForWeek(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setFallbackPopup(null);
      setHideForWeek(false);
      return;
    }
    if (location.pathname.startsWith('/login') || location.pathname.startsWith('/print')) return;

    let alive = true;
    api.announcementPopups.active()
      .then((res) => {
        if (!alive) return;
        const activePopup = res.popup;
        if (!activePopup) {
          setFallbackPopup(null);
          return;
        }
        const dismissUntil = Number(localStorage.getItem(`announcement-popup-dismiss-until:${activePopup.id}`) || 0);
        if (popupTestMode || !dismissUntil || dismissUntil < Date.now()) {
          const opened = openAnnouncementWindow(activePopup);
          setFallbackPopup(opened && !popupTestMode ? null : activePopup);
        } else {
          setFallbackPopup(null);
        }
      })
      .catch(() => {});

    return () => { alive = false; };
  }, [user?.id, popupTestMode]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'announcement-popup-dismissed' && event.data?.id) {
        clearFallbackIfDismissed(String(event.data.id));
      }
    };
    const onStorage = (event: StorageEvent) => {
      const prefix = 'announcement-popup-dismiss-until:';
      if (event.key?.startsWith(prefix)) {
        clearFallbackIfDismissed(event.key.slice(prefix.length));
      }
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const closePopup = () => {
    if (fallbackPopup && hideForWeek) {
      const days = Math.max(1, Number(fallbackPopup.dismiss_days || 7));
      localStorage.setItem(`announcement-popup-dismiss-until:${fallbackPopup.id}`, String(Date.now() + days * 86400000));
    }
    setFallbackPopup(null);
    setHideForWeek(false);
  };

  if (!fallbackPopup) return null;

  return (
    <div className="announcement-popup-floating" role="status">
      <section className="announcement-popup-card announcement-popup-card-floating" aria-labelledby="announcement-popup-title">
        <div className="announcement-popup-head">
          <div>
            <span className="announcement-popup-kicker">공지사항</span>
            <h3 id="announcement-popup-title">{fallbackPopup.title}</h3>
          </div>
          <button className="announcement-popup-close" type="button" onClick={closePopup} aria-label="공지 닫기">
            <X size={18} />
          </button>
        </div>
        <div className="announcement-popup-body">
          {String(fallbackPopup.content || '').split('\n').map((line: string, index: number) => (
            line.trim() ? <p key={index}>{line}</p> : <div key={index} className="announcement-popup-gap" />
          ))}
        </div>
        <div className="announcement-popup-foot">
          <label className="announcement-popup-check">
            <input
              type="checkbox"
              checked={hideForWeek}
              onChange={(event) => setHideForWeek(event.target.checked)}
            />
            <span>일주일간 보지않기</span>
          </label>
          {import.meta.env.DEV && (
            <button className="btn btn-sm" type="button" onClick={() => openAnnouncementWindow(fallbackPopup)}>새창 열기</button>
          )}
          <button className="btn btn-primary btn-sm" type="button" onClick={closePopup}>확인</button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const { loadUser, loading } = useAuthStore();

  useEffect(() => {
    loadUser();
  }, []);

  if (loading) return <div className="page-loading">로딩중...</div>;

  return (
    <BrowserRouter>
      <AnnouncementPopupGate />
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
            path="freelancer-bids"
            element={
              <FreelancerRoute>
                <FreelancerBidHistory />
              </FreelancerRoute>
            }
          />
          <Route
            path="bid-history"
            element={
              <BidHistoryRoute>
                <AdminNotes mode="bid_history" />
              </BidHistoryRoute>
            }
          />
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
          <Route
            path="phone-directory"
            element={
              <ManagementSupportRoute>
                <PhoneDirectory />
              </ManagementSupportRoute>
            }
          />
          {/* commissions 라우트 제거 — 매출확인으로 통합 */}
          <Route path="sales" element={<PrivateRoute><Sales /></PrivateRoute>} />
          <Route
            path="missing-documents"
            element={
              <MissingDocumentsRoute>
                <MissingDocuments />
              </MissingDocumentsRoute>
            }
          />
          <Route path="leave" element={<PrivateRoute><LeavePage /></PrivateRoute>} />
          <Route
            path="payroll"
            element={
              <PayrollRoute>
                <Payroll requireBranchSelection />
              </PayrollRoute>
            }
          />
          <Route
            path="payroll-business-income"
            element={
              <TaxMaterialsRoute>
                <Payroll initialTab="business_income" />
              </TaxMaterialsRoute>
            }
          />
          <Route
            path="payroll-employee-bonus"
            element={
              <PayrollRoute>
                <Payroll initialTab="employee_bonus" />
              </PayrollRoute>
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
            path="accounting-card-usage"
            element={
              <AccountingRoute>
                <Accounting initialTab="card" />
              </AccountingRoute>
            }
          />
          <Route
            path="accounting-staff"
            element={
              <AccountingRoute>
                <Accounting initialTab="staff" />
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
            path="management-support"
            element={
              <ManagementSupportHomeRoute>
                <ManagementSupport />
              </ManagementSupportHomeRoute>
            }
          />
          <Route
            path="management-support/holidays"
            element={
              <HolidaySettingsRoute>
                <HolidaySettings />
              </HolidaySettingsRoute>
            }
          />
          <Route
            path="accounting-session1"
            element={
              <ManagementSupportRoute>
                <AccountingSessionHome />
              </ManagementSupportRoute>
            }
          />
          <Route
            path="accounting-session1/bank"
            element={
              <ManagementSupportRoute>
                <AccountingBankUpload />
              </ManagementSupportRoute>
            }
          />
          <Route
            path="accounting-session1/check-card"
            element={
              <ManagementSupportRoute>
                <AccountingCheckCardUpload />
              </ManagementSupportRoute>
            }
          />
          <Route
            path="accounting-session1/engine"
            element={
              <ManagementSupportRoute>
                <AccountingClassificationEngine />
              </ManagementSupportRoute>
            }
          />
          <Route
            path="accounting-session1/rules"
            element={
              <ManagementSupportRoute>
                <AccountingSessionRules />
              </ManagementSupportRoute>
            }
          />
          <Route
            path="accounting-session2"
            element={
              <ManagementSupportRoute>
                <AccountingSessionTwo />
              </ManagementSupportRoute>
            }
          />
          <Route
            path="accounting-session2/review"
            element={
              <ManagementSupportRoute>
                <AccountingSessionTwo />
              </ManagementSupportRoute>
            }
          />
          <Route
            path="accounting-session2/reports"
            element={
              <ManagementSupportRoute>
                <AccountingReportsHub />
              </ManagementSupportRoute>
            }
          />
          <Route
            path="accounting-session2/reports/sales"
            element={
              <ManagementSupportRoute>
                <AccountingSalesLedgerReport />
              </ManagementSupportRoute>
            }
          />
          <Route
            path="accounting-session2/reports/expense"
            element={
              <ManagementSupportRoute>
                <AccountingExpenseLedgerReport />
              </ManagementSupportRoute>
            }
          />
          <Route
            path="accounting-session2/reports/profit-loss"
            element={
              <ProfitLossReportRoute>
                <AccountingProfitLossReport />
              </ProfitLossReportRoute>
            }
          />
          <Route
            path="accounting-session2/reports/forecast"
            element={
              <ForecastReportRoute>
                <AccountingForecastReport />
              </ForecastReportRoute>
            }
          />
          <Route
            path="accounting-session2/reports/labor-cost"
            element={
              <LaborCostReportRoute>
                <AccountingLaborCostReport />
              </LaborCostReportRoute>
            }
          />
          <Route
            path="accounting-session2/reports/check-card"
            element={
              <ManagementSupportRoute>
                <AccountingCheckCardReport />
              </ManagementSupportRoute>
            }
          />
          <Route
            path="accounting-session2/reports/tax"
            element={
              <TaxMaterialsRoute>
                <AccountingTaxReport />
              </TaxMaterialsRoute>
            }
          />
          <Route
            path="accounting-session2/reports/audit"
            element={
              <ManagementSupportRoute>
                <AccountingAuditReport />
              </ManagementSupportRoute>
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
                <CooperationRedirect />
              </PrivateRoute>
            }
          />
          <Route path="bid-schedule" element={<BidHistoryRoute><BidHistoryRedirect /></BidHistoryRoute>} />
          <Route
            path="rooms"
            element={
              <PrivateRoute>
                <RoomReservation />
              </PrivateRoute>
            }
          />
          <Route
            path="briefing-materials"
            element={
              <BusinessAutomationRoute>
                <BriefingMaterials />
              </BusinessAutomationRoute>
            }
          />
          <Route
            path="rights-analysis-guarantee"
            element={
              <MasterRoute>
                <RightsAnalysisGuarantee />
              </MasterRoute>
            }
          />
          <Route
            path="automation-diagnostics"
            element={
              <MasterRoute>
                <AutomationDiagnosticsAdmin />
              </MasterRoute>
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
