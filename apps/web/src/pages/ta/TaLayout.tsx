import { Outlet } from 'react-router-dom';

export default function TaLayout() {
  return (
    <div className="grid content-start gap-5">
      <Outlet />
    </div>
  );
}
