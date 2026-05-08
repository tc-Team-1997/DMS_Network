import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { SessionExpiryBanner } from '@/components/SessionExpiryBanner';
import { SessionExpiredModal } from '@/components/SessionExpiredModal';
import { AuthRedirectOnExpiry } from '@/components/AuthRedirectOnExpiry';

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-page">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <SessionExpiryBanner />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <SessionExpiredModal />
      <AuthRedirectOnExpiry />
    </div>
  );
}
