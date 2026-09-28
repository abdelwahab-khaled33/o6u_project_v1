import { NavLink, Outlet } from 'react-router-dom';

const sections = [
  { to: '/ta/question-bank', label: 'Question bank' },
  { to: '/ta/quizzes', label: 'Quizzes' },
];

export default function TaLayout() {
  return (
    <div>
      <h1>TA dashboard</h1>
      <p className="page-intro">
        Run quizzes for the sections you teach and maintain the question bank you share with your subject.
      </p>
      <nav aria-label="TA sections" className="form-stack">
        {sections.map((section) => <NavLink key={section.to} to={section.to}>{section.label}</NavLink>)}
      </nav>
      <Outlet />
    </div>
  );
}
