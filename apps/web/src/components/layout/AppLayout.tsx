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
  const { t } = useTranslation();

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:bg-surface focus:rounded-input focus:outline-none focus:ring-2 focus:ring-brand-blue"
      >
        {t('a11y.skip_to_content', 'Skip to main content')}
      </a>
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
        <main id="main" className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <SessionExpiredModal />
      <AuthRedirectOnExpiry />
    </div>
  );
}
