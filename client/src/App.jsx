import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { useI18n } from './i18n';
import Layout from './components/Layout';
import Logo from './components/Logo';
import { ErrorState } from './components/ui';
import { ForcePasswordPage, LoginPage, MfaEnrollPage, MfaVerifyPage, ResetPage } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import { StudentDetailPage, StudentsPage } from './pages/Students';
import ImportPage from './pages/Import';
import { GradeSheetPage, GradesPage } from './pages/Grades';
import { GradeOverviewPage, PortalPage, ReportsPage, StudentReportPage } from './pages/Reports';
import { AssignmentsPage, SectionsPage, SubjectsPage, TeachersPage, UsersPage, YearsPage } from './pages/Admin';
import { AccountPage, AuditPage, SettingsPage } from './pages/System';

function Guard({ perms, children }) {
  const { can } = useAuth();
  return can(...perms) ? children : <ErrorState error={{ status: 403, code: 'forbidden' }} />;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.school', 'grades.enter')) return <Dashboard />;
  if (can('self.grades', 'self.children')) return <Navigate to="/portal" replace />;
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
          <Route index element={<Home />} />
          <Route path="portal" element={<Guard perms={['self.grades', 'self.children']}><PortalPage /></Guard>} />
          <Route path="students" element={<Guard perms={['students.read']}><StudentsPage /></Guard>} />
          <Route path="students/import" element={<Guard perms={['students.import']}><ImportPage /></Guard>} />
          <Route path="students/:id" element={<StudentDetailPage />} />
          <Route path="teachers" element={<Guard perms={['teachers.read']}><TeachersPage /></Guard>} />
          <Route path="sections" element={<Guard perms={['academic.manage']}><SectionsPage /></Guard>} />
          <Route path="subjects" element={<Guard perms={['academic.manage']}><SubjectsPage /></Guard>} />
          <Route path="assignments" element={<Guard perms={['assignments.manage']}><AssignmentsPage /></Guard>} />
          <Route path="years" element={<Guard perms={['academic.manage']}><YearsPage /></Guard>} />
          <Route path="grades" element={<Guard perms={['grades.enter', 'grades.manage_all', 'grades.approve']}><GradesPage /></Guard>} />
          <Route path="grades/overview" element={<Guard perms={['grades.read_all', 'grades.enter']}><GradeOverviewPage /></Guard>} />
          <Route path="grades/sheet/:id" element={<GradeSheetPage />} />
          <Route path="reports" element={<Guard perms={['reports.school', 'reports.class']}><ReportsPage /></Guard>} />
          <Route path="reports/student/:id" element={<StudentReportPage />} />
          <Route path="users" element={<Guard perms={['users.manage', 'roles.manage']}><UsersPage /></Guard>} />
          <Route path="audit" element={<Guard perms={['audit.read']}><AuditPage /></Guard>} />
          <Route path="settings" element={<Guard perms={['system.settings']}><SettingsPage /></Guard>} />
          <Route path="account" element={<AccountPage />} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
