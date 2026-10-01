import { Outlet } from 'react-router-dom';

export default function TaLayout() {
  return (
    <div className="page">
      <Outlet />
    </div>
  );
}
