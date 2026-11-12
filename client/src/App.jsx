import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { useI18n } from './i18n';
import Layout from './components/Layout';
import Logo from './components/Logo';
import { ErrorState } from './components/ui';
import { LoginPage, MfaEnrollPage, MfaVerifyPage } from './pages/Auth';
import Home from './pages/Home';
import ApprovalsPage from './pages/Approvals';
import ResultsPage from './pages/Results';
import { SetupHub, StaffHub, SystemHub } from './pages/Hubs';
import { StudentDetailPage, StudentsPage } from './pages/Students';
import ImportPage from './pages/Import';
import { GradeSheetPage, GradesPage } from './pages/Grades';
import { StudentReportPage } from './pages/Reports';
import StudentShell from './components/StudentShell';
import StudentHome from './pages/StudentHome';
import PrintReport from './pages/PrintReport';
import BehaviorPage from './pages/Behavior';
import { StaffWeeklyPage } from './pages/WeeklyCard';
import { AccountPage } from './pages/System';

function Guard({ perms, children }) {
  const { can } = useAuth();
  return can(...perms) ? children : <ErrorState error={{ status: 403, code: 'forbidden' }} />;
}

function Start() {
  const { can } = useAuth();
  if (can('dashboard.school', 'grades.enter')) return <Home />;
  if (can('self.grades')) return <StudentHome />;
  return <Navigate to="/account" replace />;
}

function WeeklyRoute() { const { id } = useParams(); return <StaffWeeklyPage id={id} />; }

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
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </BrowserRouter>
    );
  }
  if (mfaState === 'pending_verify') return <MfaVerifyPage />;
  if (mfaState === 'pending_enroll') return <MfaEnrollPage />;
  // Students get the school-header layout of the reference design (no admin sidebar).
  const studentOnly = user.permissions.every((p) => p === 'self.grades') && user.permissions.length > 0;
  if (studentOnly) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="print/report/:id" element={<PrintReport />} />
          <Route element={<StudentShell />}>
            <Route index element={<StudentHome />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    );
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="print/report/:id" element={<PrintReport />} />
        <Route element={<Layout />}>
          <Route index element={<Start />} />
          <Route path="portal" element={<Navigate to="/" replace />} />
          <Route path="approvals" element={<Guard perms={['grades.approve']}><ApprovalsPage /></Guard>} />
          <Route path="students" element={<Guard perms={['students.read']}><StudentsPage /></Guard>} />
          <Route path="students/import" element={<Guard perms={['students.import']}><ImportPage /></Guard>} />
          <Route path="students/:id" element={<StudentDetailPage />} />
          <Route path="students/:id/weekly" element={<WeeklyRoute />} />
          <Route path="grades/behavior" element={<Guard perms={['grades.enter', 'grades.manage_all']}><BehaviorPage /></Guard>} />
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
