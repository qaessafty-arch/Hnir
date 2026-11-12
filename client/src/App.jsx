import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { useI18n } from './i18n';
import Layout from './components/Layout';
import Logo from './components/Logo';
import { ErrorState } from './components/ui';
import { ForcePasswordPage, LoginPage, MfaEnrollPage, MfaVerifyPage, ResetPage } from './pages/Auth';
import Home from './pages/Home';
import ApprovalsPage from './pages/Approvals';
import ResultsPage from './pages/Results';
import { SetupHub, StaffHub, SystemHub } from './pages/Hubs';
import { StudentDetailPage, StudentsPage } from './pages/Students';
import ImportPage from './pages/Import';
import { GradeSheetPage, GradesPage } from './pages/Grades';
import { PortalPage, StudentReportPage } from './pages/Reports';
import { AccountPage } from './pages/System';

function Guard({ perms, children }) {
  const { can } = useAuth();
  return can(...perms) ? children : <ErrorState error={{ status: 403, code: 'forbidden' }} />;
}

function Start() {
  const { can } = useAuth();
  if (can('dashboard.school', 'grades.enter')) return <Home />;
  if (can('self.grades')) return <Navigate to="/portal" replace />;
  return <Navigate to="/account" replace />;
}

function NotFound() {
  const { t } = useI18n();
  return <div className="card"><div className="empty"><h3>{t('notFound')}</h3></div></div>;
}

export default function App() {
  const { loading, user, mfaState } = useAuth();
  if (loading) return <div style={{ minBlockSize: '100vh', display: 'grid', placeItems: 'center' }}><Logo size={120} /></div>;
  if (!user) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/reset" element={<ResetPage />} />
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </BrowserRouter>
    );
  }
  if (mfaState === 'pending_verify') return <MfaVerifyPage />;
  if (mfaState === 'pending_enroll') return <MfaEnrollPage />;
  if (user.must_change_password) return <ForcePasswordPage />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Start />} />
          <Route path="portal" element={<Guard perms={['self.grades']}><PortalPage /></Guard>} />
          <Route path="approvals" element={<Guard perms={['grades.approve']}><ApprovalsPage /></Guard>} />
          <Route path="students" element={<Guard perms={['students.read']}><StudentsPage /></Guard>} />
          <Route path="students/import" element={<Guard perms={['students.import']}><ImportPage /></Guard>} />
          <Route path="students/:id" element={<StudentDetailPage />} />
          <Route path="grades" element={<Guard perms={['grades.enter', 'grades.manage_all', 'grades.approve']}><GradesPage /></Guard>} />
          <Route path="grades/sheet/:id" element={<GradeSheetPage />} />
          <Route path="results" element={<Guard perms={['reports.school', 'reports.class']}><ResultsPage /></Guard>} />
          <Route path="reports/student/:id" element={<StudentReportPage />} />
          <Route path="staff" element={<Guard perms={['teachers.read', 'users.manage', 'assignments.manage']}><StaffHub /></Guard>} />
          <Route path="setup" element={<Guard perms={['academic.manage']}><SetupHub /></Guard>} />
          <Route path="system" element={<Guard perms={['system.settings', 'audit.read']}><SystemHub /></Guard>} />
          {/* Old addresses keep working */}
          <Route path="reports" element={<Navigate to="/results?tab=classes" replace />} />
          <Route path="grades/overview" element={<Navigate to="/results?tab=grades" replace />} />
          <Route path="teachers" element={<Navigate to="/staff" replace />} />
          <Route path="users" element={<Navigate to="/staff?tab=accounts" replace />} />
          <Route path="assignments" element={<Navigate to="/staff?tab=assignments" replace />} />
          <Route path="years" element={<Navigate to="/setup" replace />} />
          <Route path="sections" element={<Navigate to="/setup?tab=classes" replace />} />
          <Route path="subjects" element={<Navigate to="/setup?tab=subjects" replace />} />
          <Route path="settings" element={<Navigate to="/system" replace />} />
          <Route path="audit" element={<Navigate to="/system?tab=audit" replace />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
