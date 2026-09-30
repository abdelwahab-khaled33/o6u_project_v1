import { NavLink, Outlet } from 'react-router-dom';

const sections = [
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/import', label: 'Excel import' },
  { to: '/admin/subjects', label: 'Subjects' },
  { to: '/admin/sections', label: 'Sections' },
  { to: '/admin/exams', label: 'Exams' },
  { to: '/admin/results', label: 'Results' },
  { to: '/admin/permissions', label: 'Permissions' },
  { to: '/admin/term-reset', label: 'Term reset' },
];

export default function AdminLayout() {
  return (
    <div>
      <h1>Admin dashboard</h1>
      <p className="page-intro">Manage users, academic structure, imports, and exam approvals.</p>
      <nav aria-label="Admin sections" className="form-stack">
        {sections.map((section) => <NavLink key={section.to} to={section.to}>{section.label}</NavLink>)}
      </nav>
      <Outlet />
    </div>
  );
}
