import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import type { Role } from '@exam/shared';
import Layout from './components/Layout';
import { ExamTopbarProvider } from './hooks/examTopbar';
import { Spinner } from './components/ui/Spinner';
import { useAuth } from './hooks/useAuth';
import ChangePasswordPage from './pages/ChangePasswordPage';
import LoginPage from './pages/LoginPage';
import { WelcomePage } from './pages/WelcomePage';
import { HowItWorksPage } from './pages/HowItWorksPage';
import DoctorLayout from './pages/doctor/DoctorLayout';
import { DoctorQuestionBankPage } from './pages/doctor/DoctorQuestionBankPage';
import { DoctorExamsPage } from './pages/doctor/DoctorExamsPage';
import { ExamWizard } from './pages/doctor/ExamWizard';
import TaLayout from './pages/ta/TaLayout';
import { TaQuestionBankPage } from './pages/ta/TaQuestionBankPage';
import { TaQuizzesPage } from './pages/ta/TaQuizzesPage';
import { TaQuizWizard } from './pages/ta/TaQuizWizard';
import { StudentExamsPage } from './pages/student/StudentExamsPage';
import { ExamResultsPage } from './pages/results/ExamResultsPage';
import { SubjectResultsPage } from './pages/results/SubjectResultsPage';
import { ExamCompensationPage } from './pages/compensation/ExamCompensationPage';
import { ExamAccessCodePage } from './pages/monitoring/ExamAccessCodePage';
import { ExamLivePage } from './pages/monitoring/ExamLivePage';
import AdminLayout from './pages/admin/AdminLayout';
import { AdminDoctorAssignmentsPage } from './pages/admin/AdminDoctorAssignmentsPage';
import { AdminExamsPage } from './pages/admin/AdminExamsPage';
import { AdminExamReviewPage } from './pages/admin/AdminExamReviewPage';
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
  if (user) return <Navigate to={roleHomes[user.role]} replace />;
  return <WelcomePage />;
}

function NotFoundPage() {
  return <main className="grid min-h-screen place-content-center gap-3 p-6 text-center"><h1>Page not found</h1><p>The address does not match a page in Exam Platform.</p></main>;
}

function ExamWizardRoute() {
  const { examId } = useParams();
  return <ExamWizard examId={examId} />;
}

function TaQuizWizardRoute() {
  const { quizId } = useParams();
  return <TaQuizWizard quizId={quizId} />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center gap-2.5 text-muted"><Spinner label="Loading application" />Loading…</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={roleHomes[user.role]} replace /> : <LoginPage />} />
      <Route path="/how-it-works" element={<HowItWorksPage />} />
      <Route path="/" element={<HomeRedirect />} />
      <Route element={<RequireRole roles={['admin', 'doctor', 'ta', 'student']} />}>
        <Route element={<ExamTopbarProvider><Layout /></ExamTopbarProvider>}>
          <Route path="/account/change-password" element={<ChangePasswordPage />} />
          <Route element={<RequireRole roles={['admin']} />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="users" replace />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="import" element={<AdminImportPage />} />
              <Route path="subjects" element={<AdminSubjectsPage />} />
              <Route path="sections" element={<AdminSectionsPage />} />
              <Route path="doctor-assignments" element={<AdminDoctorAssignmentsPage />} />
              <Route path="exams" element={<AdminExamsPage />} />
              <Route path="exams/:examId/review" element={<AdminExamReviewPage />} />
              <Route path="results" element={<SubjectResultsPage detailsBase="/admin/results" />} />
              <Route path="results/:examId" element={<ExamResultsPage />} />
              <Route path="exams/:examId/compensate" element={<ExamCompensationPage />} />
              <Route path="exams/:examId/live" element={<ExamLivePage />} />
              <Route path="permissions" element={<AdminPermissionsPage />} />
              <Route path="term-reset" element={<AdminTermResetPage />} />
            </Route>
          </Route>
          <Route element={<RequireRole roles={['doctor']} />}>
            <Route path="/doctor" element={<DoctorLayout />}>
              <Route index element={<Navigate to="exams" replace />} />
              <Route path="question-bank" element={<DoctorQuestionBankPage />} />
              <Route path="exams" element={<DoctorExamsPage />} />
              <Route path="results" element={<SubjectResultsPage detailsBase="/doctor/results" />} />
              <Route path="results/:examId" element={<ExamResultsPage />} />
              <Route path="exams/new" element={<ExamWizard />} />
              <Route path="exams/:examId/edit" element={<ExamWizardRoute />} />
              <Route path="exams/:examId/compensate" element={<ExamCompensationPage />} />
              <Route path="exams/:examId/access-code" element={<ExamAccessCodePage />} />
              <Route path="exams/:examId/live" element={<ExamLivePage />} />
            </Route>
          </Route>
          <Route element={<RequireRole roles={['ta']} />}>
            <Route path="/ta" element={<TaLayout />}>
              <Route index element={<Navigate to="quizzes" replace />} />
              <Route path="question-bank" element={<TaQuestionBankPage />} />
              <Route path="quizzes" element={<TaQuizzesPage />} />
              <Route path="quizzes/:quizId/results" element={<ExamResultsPage />} />
              <Route path="quizzes/new" element={<TaQuizWizard />} />
              <Route path="quizzes/:quizId/edit" element={<TaQuizWizardRoute />} />
            </Route>
          </Route>
          <Route element={<RequireRole roles={['student']} />}>
            <Route path="/student" element={<StudentExamsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
