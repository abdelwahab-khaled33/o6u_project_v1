import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/Button';

const homeByRole = { admin: '/admin', doctor: '/doctor', ta: '/ta', student: '/student' };

export default function Layout() {
  const { user, logout } = useAuth();
  if (!user) return <Outlet />;

  return (
    <div className="layout">
      <header className="app-header">
        <Link className="app-header-brand" to={homeByRole[user.role]}>Exam Platform</Link>
        <nav className="app-nav" aria-label="Main navigation">
          <NavLink to={homeByRole[user.role]}>Home</NavLink>
          <NavLink to="/account/change-password">Account</NavLink>
        </nav>
        <div className="app-header-user"><span>{user.fullName}<small>{user.role}</small></span><Button variant="text" onClick={logout}>Sign out</Button></div>
      </header>
      <main className="app-main"><Outlet /></main>
    </div>
  );
}
