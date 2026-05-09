/**
 * Customer360Drawer — 480px right-side drawer showing full customer context.
 *
 * Opens on top of the current page via a portal.  Closes on ESC or backdrop click.
 *
 * Six tabs (CC4 Tabs):
 *   Master       — 9-attribute header card + PII reveal
 *   Accounts     — account list (paginated)
 *   Documents    — document list (paginated)
 *   Transactions — transaction list (paginated)
 *   Workflows    — workflow list (paginated)
 *   Activity     — audit log (paginated)
 *
 * A11y:
 *   - Drawer has role="complementary" and aria-label.
 *   - ESC handler and focus-trap (Tab/Shift-Tab cycle within drawer).
 *   - Customer name announced via live region on load.
 */

import { useEffect, useRef, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, User, AlertTriangle } from 'lucide-react';
import { Tabs, TabList, Tab, TabPanel } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { fetchCustomer360Header } from './api';
import { MasterTab }       from './components/MasterTab';
import { AccountsTab }     from './components/AccountsTab';
import { DocumentsTab }    from './components/DocumentsTab';
import { TransactionsTab } from './components/TransactionsTab';
import { WorkflowsTab }    from './components/WorkflowsTab';
import { ActivityTab }     from './components/ActivityTab';

interface Customer360DrawerProps {
  cid:     string;
  onClose: () => void;
}

const RISK_BAND_COLOR: Record<string, string> = {
  low:    'text-success',
  medium: 'text-warning',
  high:   'text-danger',
};

export function Customer360Drawer({ cid, onClose }: Customer360DrawerProps) {
  const drawerId   = useId();
  const drawerRef  = useRef<HTMLDivElement>(null);

  const q = useQuery({
    queryKey: ['customer360', cid, 'header'],
    queryFn:  () => fetchCustomer360Header(cid),
  });

  // Focus first focusable element on open
  useEffect(() => {
    const el = drawerRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    el?.focus();
  }, []);

  // ESC closes
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // Focus trap
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    drawer.addEventListener('keydown', h);
    return () => drawer.removeEventListener('keydown', h);
  }, []);

  const header    = q.data;
  const isLoading = q.isLoading;
  const isError   = q.isError;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-ink/20"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="complementary"
        aria-label={t('customer360.drawer_aria_label', { cid })}
        data-testid="customer360-drawer"
        className={cn(
          'fixed right-0 top-0 bottom-0 z-50 w-full max-w-[480px]',
          'bg-surface border-l border-divider shadow-[−8px_0_32px_rgba(16,24,40,0.12)]',
          'flex flex-col',
        )}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-divider shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              {isLoading && (
                <div className="h-5 w-40 rounded bg-divider animate-pulse" />
              )}
              {isError && (
                <div className="flex items-center gap-1.5 text-xs text-danger">
                  <AlertTriangle size={13} aria-hidden="true" />
                  {t('customer360.error_load')}
                </div>
              )}
              {header && (
                <>
                  <h2
                    id={`${drawerId}-title`}
                    className="text-md font-semibold text-ink flex items-center gap-2"
                  >
                    <User size={15} className="text-muted" aria-hidden="true" />
                    {header.full_name}
                  </h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-2xs font-mono text-muted">{header.cid}</span>
                    {header.risk_band && (
                      <span
                        className={cn(
                          'text-2xs font-semibold uppercase',
                          RISK_BAND_COLOR[header.risk_band] ?? 'text-ink-sub',
                        )}
                        aria-label={`${t('customer360.attr_risk_band')}: ${header.risk_band}`}
                      >
                        {header.risk_band} risk
                      </span>
                    )}
                    {header.kyc_status && (
                      <span className="text-2xs text-muted">
                        KYC: {header.kyc_status}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('customer360.close')}
              className="shrink-0 rounded-input p-1.5 text-muted hover:bg-divider hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <Tabs defaultValue="master">
            <TabList className="px-5 shrink-0">
              <Tab value="master">{t('customer360.tab_master')}</Tab>
              <Tab value="accounts">{t('customer360.tab_accounts')}</Tab>
              <Tab value="documents">{t('customer360.tab_documents')}</Tab>
              <Tab value="transactions">{t('customer360.tab_transactions')}</Tab>
              <Tab value="workflows">{t('customer360.tab_workflows')}</Tab>
              <Tab value="activity">{t('customer360.tab_activity')}</Tab>
            </TabList>

            <div className="flex-1 overflow-y-auto px-5 py-4">

              <TabPanel value="master">
                {isLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <div key={n} className="h-8 rounded-card bg-divider animate-pulse" />
                    ))}
                  </div>
                ) : isError ? (
                  <p className="text-xs text-muted italic">{t('customer360.error_load')}</p>
                ) : header ? (
                  <MasterTab header={header} cid={cid} />
                ) : null}
              </TabPanel>

              <TabPanel value="accounts">
                <AccountsTab cid={cid} />
              </TabPanel>

              <TabPanel value="documents">
                <DocumentsTab cid={cid} />
              </TabPanel>

              <TabPanel value="transactions">
                <TransactionsTab cid={cid} />
              </TabPanel>

              <TabPanel value="workflows">
                <WorkflowsTab cid={cid} />
              </TabPanel>

              <TabPanel value="activity">
                <ActivityTab cid={cid} />
              </TabPanel>

            </div>
          </Tabs>
        </div>
      </div>
    </>
  );
}
