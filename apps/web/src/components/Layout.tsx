import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '@exam/shared';
import { O6ULogo } from './brand/O6ULogo';

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

function NavIcon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`h-[19px] w-[19px] flex-none opacity-100 ${className}`.trim()}>
      <path d={ICONS[name] ?? ICONS.file} />
    </svg>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  if (!user) return <Outlet />;

  const items = NAV_BY_ROLE[user.role];
  return (
    <div className="grid min-h-screen bg-[#edf0f6] md:grid-cols-[76px_minmax(0,1fr)] lg:grid-cols-[252px_minmax(0,1fr)]">
      <aside aria-label="Primary" className="sticky top-0 flex h-screen flex-col gap-[18px] bg-gradient-to-b from-[#304269] to-[#232f4d] px-3.5 pb-4 pt-5 text-[#e9edf7] max-md:static max-md:h-auto max-md:flex-row max-md:items-center max-md:gap-2.5 max-md:px-3 max-md:py-2.5">
        <Link to={homeByRole[user.role]} className="flex flex-col items-center gap-2 px-3 pt-1 text-inherit no-underline md:justify-center">
          <span className="grid w-full place-items-center rounded-2xl bg-white/95 px-3 py-2.5 shadow-[0_2px_8px_rgb(0_0_0/25%)]">
            <O6ULogo size="md" />
          </span>
          <span className="grid text-center text-[1.02rem] font-extrabold leading-tight text-white max-md:grid md:hidden lg:grid">
            O6U Exam Platform
            <small className="text-[0.74rem] font-semibold text-[#cdd7ee]">{workspaceByRole[user.role]}</small>
          </span>
        </Link>
        <nav aria-label="Workspace sections" className="grid gap-1 overflow-y-auto max-md:flex max-md:flex-1 max-md:gap-1.5 max-md:overflow-x-auto">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }: { isActive: boolean }) =>
                isActive
                  ? 'flex items-center gap-3 rounded-[10px] border border-accent/60 border-b-2 border-b-accent bg-gradient-to-r from-accent/25 via-accent/10 to-transparent px-3 py-2.5 text-[0.94rem] font-bold text-white no-underline shadow-[0_4px_14px_rgb(242_132_47/25%)] transition-colors max-md:whitespace-nowrap md:justify-center md:p-3 lg:justify-start [&_svg]:text-accent'
                  : 'flex items-center gap-3 rounded-[10px] border-b-2 border-transparent px-3 py-2.5 text-[0.94rem] font-semibold text-[#dbe3f4] no-underline transition-colors hover:bg-white/10 hover:text-white max-md:whitespace-nowrap md:justify-center md:p-3 lg:justify-start'
              }
            >
              <NavIcon name={item.icon} />
              <span className="max-md:inline md:hidden lg:inline">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto grid gap-3 border-t border-white/15 pt-3.5 max-md:hidden">
          <div className="flex items-center gap-2.5 px-1.5 md:justify-center lg:justify-start">
            <span aria-hidden="true" className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full bg-white/15 font-extrabold text-white">{user.fullName.slice(0, 1).toUpperCase()}</span>
            <span className="grid min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.88rem] font-semibold md:hidden lg:grid">
              {user.fullName}
              <small className="font-medium capitalize text-[#b9c4de]">{user.role}</small>
            </span>
          </div>
          <div className="flex items-center gap-2 px-1.5 md:hidden lg:flex">
            <NavLink to="/account/change-password" className="text-[0.85rem] font-semibold text-[#dbe3f4]">Account</NavLink>
            <button type="button" onClick={logout} className="rounded-lg border border-white/25 bg-transparent px-3 py-1.5 text-[0.85rem] font-semibold text-white hover:bg-white/10">Sign out</button>
          </div>
        </div>
      </aside>
      <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[#dfe5f0] bg-white/90 px-7 py-3.5 backdrop-blur max-md:px-4 max-md:py-3">
          <span className="font-bold text-primary-dark">{workspaceByRole[user.role]}</span>
        </header>
        <main className="mx-auto w-full max-w-[1160px] px-7 pb-12 pt-7 max-md:px-4 max-md:py-5"><Outlet /></main>
      </div>
    </div>
  );
}
