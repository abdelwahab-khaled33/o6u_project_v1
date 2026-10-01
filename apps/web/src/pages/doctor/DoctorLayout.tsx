import { Outlet } from 'react-router-dom';

export default function DoctorLayout() {
  return (
    <div className="page">
      <Outlet />
    </div>
  );
}
