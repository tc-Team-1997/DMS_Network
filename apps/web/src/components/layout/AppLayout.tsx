import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sidebar } from './Sidebar';
import { MobileSidebar } from './MobileSidebar';
import { Topbar } from './Topbar';
import { SessionExpiryBanner } from '@/components/SessionExpiryBanner';
import { SessionExpiredModal } from '@/components/SessionExpiredModal';
import { AuthRedirectOnExpiry } from '@/components/AuthRedirectOnExpiry';
import { useIsBelowLg } from '@/lib/useMatchMedia';
import type { Locale } from '@/lib/i18n';

/**
 * LocaleEffect — synchronises <html lang> with the active i18next language.
 * Drives the :lang(dz) CSS selectors that switch to the Jomolhari font stack.
 */
function LocaleEffect() {
  const { i18n } = useTranslation();
  const lang = i18n.language as Locale;

  useEffect(() => {
    document.documentElement.lang = lang === 'dz' ? 'dz' : 'en';
  }, [lang]);

  return null;
}

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isBelowLg = useIsBelowLg();

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      <LocaleEffect />
      {/* Desktop sidebar — visible at lg+ only */}
      {!isBelowLg && <Sidebar />}

      {/* Mobile off-canvas drawer — visible below lg */}
      {isBelowLg && (
        <MobileSidebar open={drawerOpen} onClose={() => { setDrawerOpen(false); }} />
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          {...(isBelowLg ? { onMenuClick: () => { setDrawerOpen(true); } } : {})}
          menuOpen={drawerOpen}
        />
        <SessionExpiryBanner />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <SessionExpiredModal />
      <AuthRedirectOnExpiry />
    </div>
  );
}
