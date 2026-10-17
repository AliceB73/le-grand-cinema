import { Outlet } from 'react-router-dom';
import SiteHeader from './SiteHeader';

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <SiteHeader />
      <Outlet />
    </div>
  );
}
