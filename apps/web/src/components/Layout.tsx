import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '@exam/shared';

const homeByRole: Record<Role, string> = { admin: '/admin', doctor: '/doctor', ta: '/ta', student: '/student' };

const workspaceByRole: Record<Role, string> = {
  admin: 'Admin workspace',
  doctor: 'Doctor workspace',
  ta: 'TA workspace',
  student: 'Student workspace',
};

type NavItem = { to: string; label: string; icon: string };

const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    { to: '/admin/users', label: 'Users', icon: 'users' },
    { to: '/admin/import', label: 'Excel import', icon: 'upload' },
    { to: '/admin/subjects', label: 'Subjects', icon: 'book' },
    { to: '/admin/sections', label: 'Sections', icon: 'grid' },
    { to: '/admin/doctor-assignments', label: 'Doctor assignments', icon: 'link' },
    { to: '/admin/exams', label: 'Exams', icon: 'file' },
    { to: '/admin/results', label: 'Results', icon: 'chart' },
    { to: '/admin/permissions', label: 'Permissions', icon: 'key' },
    { to: '/admin/term-reset', label: 'Term reset', icon: 'reset' },
  ],
  doctor: [
    { to: '/doctor/exams', label: 'Exams', icon: 'file' },
    { to: '/doctor/question-bank', label: 'Question bank', icon: 'bank' },
    { to: '/doctor/results', label: 'Results', icon: 'chart' },
  ],
  ta: [
    { to: '/ta/quizzes', label: 'Quizzes', icon: 'file' },
    { to: '/ta/question-bank', label: 'Question bank', icon: 'bank' },
  ],
  student: [{ to: '/student', label: 'My exams', icon: 'file' }],
};

const ICONS: Record<string, string> = {
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.87M15.5 3.13a3.5 3.5 0 0 1 0 6.74',
  upload: 'M12 16V4m0 0 4 4m-4-4-4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4',
  chart: 'M3 3v18h18M8 17V9m5 8V5m5 12v-6',
  key: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 12 20 4m-2 2 2 2m-2-5 2 2',
  reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  bank: 'M4 10h16M6 10v8m4-8v8m4-8v8m4-8v8M3 10l9-6 9 6M5 18h14',
};

function NavIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.file} />
    </svg>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  if (!user) return <Outlet />;

  const items = NAV_BY_ROLE[user.role];
  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Primary">
        <Link className="sidebar-brand" to={homeByRole[user.role]}>
          <span className="sidebar-mark" aria-hidden="true">E</span>
          <span className="sidebar-brand-text">Exam Platform<small>{workspaceByRole[user.role]}</small></span>
        </Link>
        <nav className="sidebar-nav" aria-label="Workspace sections">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-avatar" aria-hidden="true">{user.fullName.slice(0, 1).toUpperCase()}</span>
            <span className="sidebar-user-text">{user.fullName}<small>{user.role}</small></span>
          </div>
          <div className="sidebar-footer-actions">
            <NavLink className="sidebar-account" to="/account/change-password">Account</NavLink>
            <button type="button" className="sidebar-signout" onClick={logout}>Sign out</button>
          </div>
        </div>
      </aside>
      <div className="app-body">
        <header className="app-topbar">
          <span className="topbar-workspace">{workspaceByRole[user.role]}</span>
          <span className="topbar-user">{user.fullName}<small>{user.role}</small></span>
        </header>
        <main className="app-main"><Outlet /></main>
      </div>
    </div>
  );
}
