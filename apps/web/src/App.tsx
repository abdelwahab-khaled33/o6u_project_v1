import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import type { Role } from '@exam/shared';
import Layout from './components/Layout';
import { Spinner } from './components/ui/Spinner';
import { useAuth } from './hooks/useAuth';
import ChangePasswordPage from './pages/ChangePasswordPage';
import LoginPage from './pages/LoginPage';
import { RolePlaceholderPage } from './pages/RolePlaceholderPage';
import DoctorLayout from './pages/doctor/DoctorLayout';
import { DoctorQuestionBankPage } from './pages/doctor/DoctorQuestionBankPage';
import { DoctorExamsPage } from './pages/doctor/DoctorExamsPage';
import { ExamWizard } from './pages/doctor/ExamWizard';
import AdminLayout from './pages/admin/AdminLayout';
import { AdminExamsPage } from './pages/admin/AdminExamsPage';
import { AdminImportPage } from './pages/admin/AdminImportPage';
import { AdminPermissionsPage } from './pages/admin/AdminPermissionsPage';
import { AdminSectionsPage } from './pages/admin/AdminSectionsPage';
import { AdminSubjectsPage } from './pages/admin/AdminSubjectsPage';
import { AdminTermResetPage } from './pages/admin/AdminTermResetPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';

const roleHomes: Record<Role, string> = { admin: '/admin', doctor: '/doctor', ta: '/ta', student: '/student' };

function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={roleHomes[user.role]} replace />;
  return <Outlet />;
}

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? roleHomes[user.role] : '/login'} replace />;
}

function NotFoundPage() {
  return <main className="not-found"><h1>Page not found</h1><p>The address does not match a page in Exam Platform.</p></main>;
}

function ExamWizardRoute() {
  const { examId } = useParams();
  return <ExamWizard examId={examId} />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><Spinner label="Loading application" />Loading…</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={roleHomes[user.role]} replace /> : <LoginPage />} />
      <Route element={<RequireRole roles={['admin', 'doctor', 'ta', 'student']} />}>
        <Route element={<Layout />}>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/account/change-password" element={<ChangePasswordPage />} />
          <Route element={<RequireRole roles={['admin']} />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="users" replace />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="import" element={<AdminImportPage />} />
              <Route path="subjects" element={<AdminSubjectsPage />} />
              <Route path="sections" element={<AdminSectionsPage />} />
              <Route path="exams" element={<AdminExamsPage />} />
              <Route path="permissions" element={<AdminPermissionsPage />} />
              <Route path="term-reset" element={<AdminTermResetPage />} />
            </Route>
          </Route>
          <Route element={<RequireRole roles={['doctor']} />}>
            <Route path="/doctor" element={<DoctorLayout />}>
              <Route index element={<Navigate to="exams" replace />} />
              <Route path="question-bank" element={<DoctorQuestionBankPage />} />
              <Route path="exams" element={<DoctorExamsPage />} />
              <Route path="exams/new" element={<ExamWizard />} />
              <Route path="exams/:examId/edit" element={<ExamWizardRoute />} />
            </Route>
          </Route>
          <Route element={<RequireRole roles={['ta']} />}><Route path="/ta" element={<RolePlaceholderPage title="TA home" />} /></Route>
          <Route element={<RequireRole roles={['student']} />}><Route path="/student" element={<RolePlaceholderPage title="Student home" />} /></Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
