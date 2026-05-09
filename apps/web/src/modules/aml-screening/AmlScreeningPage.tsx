/**
 * AmlScreeningPage — /admin/aml
 *
 * Three-tab layout: Watchlists | Hits Queue | Recent Screenings.
 * Feature-flagged by VITE_FF_AML_LIVE (default true in dev, false otherwise).
 */

import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { WatchlistsTab } from './components/WatchlistsTab';
import { HitsQueueTab } from './components/HitsQueueTab';
import { ScreeningsTab } from './components/ScreeningsTab';

// ── Feature flag ──────────────────────────────────────────────────────────────

const FF_AML_LIVE: boolean =
  import.meta.env['VITE_FF_AML_LIVE'] !== undefined
    ? import.meta.env['VITE_FF_AML_LIVE'] !== 'false'
    : import.meta.env.DEV;

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = 'watchlists' | 'hits' | 'screenings';

const TABS: Array<{ key: Tab; labelKey: string; testId: string }> = [
  { key: 'watchlists', labelKey: 'aml.tab_watchlists', testId: 'aml-tab-watchlists' },
  { key: 'hits',       labelKey: 'aml.tab_hits',       testId: 'aml-tab-hits' },
  { key: 'screenings', labelKey: 'aml.tab_screenings', testId: 'aml-tab-screenings' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export function AmlScreeningPage() {
  const [activeTab, setActiveTab] = useState<Tab>('watchlists');
  const role = useAuth((s) => s.user?.role);

  const isAdmin = role === 'Doc Admin';
  // Compliance role = Doc Admin or Checker in the existing RBAC model
  const canDecide = role === 'Doc Admin' || role === 'Checker';
  const canTrigger = role === 'Doc Admin' || role === 'Checker';

  if (!FF_AML_LIVE) {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 text-center text-muted space-y-3"
        data-testid="aml-page"
      >
        <ShieldAlert size={32} className="text-muted" aria-hidden="true" />
        <p className="text-md font-medium text-ink">{t('aml.feature_disabled')}</p>
        <p className="text-xs">{t('aml.feature_disabled_hint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="aml-page">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-ink flex items-center gap-2">
          <ShieldAlert size={20} className="text-brand-blue" aria-hidden="true" />
          {t('aml.page_title')}
        </h1>
        <p className="text-xs text-muted mt-1">{t('aml.page_subtitle')}</p>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label={t('aml.tabs_aria')}
        className="flex flex-wrap gap-2 border-b border-divider pb-0"
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`aml-tab-${tab.key}`}
            aria-selected={activeTab === tab.key}
            aria-controls={`aml-panel-${tab.key}`}
            data-testid={tab.testId}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded-t',
              activeTab === tab.key
                ? 'border-brand-blue text-brand-blue'
                : 'border-transparent text-ink-sub hover:text-ink hover:border-border',
            )}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div
        role="tabpanel"
        id={`aml-panel-${activeTab}`}
        aria-labelledby={`aml-tab-${activeTab}`}
      >
        {activeTab === 'watchlists' && (
          <WatchlistsTab isAdmin={isAdmin} />
        )}
        {activeTab === 'hits' && (
          <HitsQueueTab canDecide={canDecide} />
        )}
        {activeTab === 'screenings' && (
          <ScreeningsTab canTrigger={canTrigger} />
        )}
      </div>
    </div>
  );
}
