import { NavLink, Outlet } from 'react-router-dom';

const sections = [{ to: '/doctor/question-bank', label: 'Question bank' }];

export default function DoctorLayout() {
  return (
    <div>
      <h1>Doctor dashboard</h1>
      <p className="page-intro">Maintain your private per-subject question bank.</p>
      <nav aria-label="Doctor sections" className="form-stack">
        {sections.map((section) => <NavLink key={section.to} to={section.to}>{section.label}</NavLink>)}
      </nav>
      <Outlet />
    </div>
  );
}
