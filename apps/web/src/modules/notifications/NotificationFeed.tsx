/**
 * NotificationFeed — compact 3-tab popover panel for the Topbar bell.
 *
 * Tabs: Alerts | Approvals | System
 * Test IDs:
 *   notif-tab-alerts, notif-tab-approvals, notif-tab-system  (tab buttons)
 *   notif-list                                                (the <ul>)
 *
 * Shows the 10 most recent in-app notifications with mark-read actions.
 * Full list is at /notifications.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CheckCheck, Bell, AlertCircle, GitPullRequest, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { fetchFeed, markRead, markAllRead } from './api';
import type { Notification } from './schemas';

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type TabId = 'alerts' | 'approvals' | 'system';

// ---------------------------------------------------------------------------
// Bucketing rule
// ---------------------------------------------------------------------------

function tabFor(n: Notification): TabId {
  // `severity` is sent by the Python notifications path (mobile/JWT). The Node /spa/api/notifications
  // SELECT does not return this column today; the alerts bucket still works via event_type.startsWith('alert.').
  if (n.event_type?.startsWith('alert.') || n.severity === 'critical') return 'alerts';
  if (n.channel === 'workflow' || n.event_type?.startsWith('workflow.')) return 'approvals';
  return 'system';
}

// ---------------------------------------------------------------------------
// Hook — exported for Topbar unread badge
// ---------------------------------------------------------------------------

export function useUnreadCount(): number {
  const feed = useQuery({
    queryKey:    ['notifications', 'feed'],
    queryFn:     () => fetchFeed({ limit: 10 }),
    // Poll every 60 s for new in-app notifications.
    refetchInterval: 60_000,
    // Don't block the page on this.
    staleTime: 30_000,
  });
  return feed.data?.unread_count ?? 0;
}

// ---------------------------------------------------------------------------
// NotificationFeed component
// ---------------------------------------------------------------------------

export function NotificationFeed() {
  const { t } = useTranslation();
  const qc  = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('alerts');

  const feed = useQuery({
    queryKey: ['notifications', 'feed'],
    queryFn:  () => fetchFeed({ limit: 10 }),
  });

  const markOne = useMutation({
    mutationFn: markRead,
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });

  const markAll = useMutation({
    mutationFn: markAllRead,
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });

  const allItems = feed.data?.items ?? [];
  const unread   = feed.data?.unread_count ?? 0;

  // Per-tab unread counts (only is_read === 0 rows count).
  const tabUnread: Record<TabId, number> = {
    alerts:    allItems.filter((n) => tabFor(n) === 'alerts'    && n.is_read === 0).length,
    approvals: allItems.filter((n) => tabFor(n) === 'approvals' && n.is_read === 0).length,
    system:    allItems.filter((n) => tabFor(n) === 'system'    && n.is_read === 0).length,
  };

  const visibleItems = allItems.filter((n) => tabFor(n) === activeTab);

  const tabs: Array<{ id: TabId; label: string; icon: typeof Bell }> = [
    { id: 'alerts',    label: t('notif.tab.alerts',    'Alerts'),    icon: AlertCircle },
    { id: 'approvals', label: t('notif.tab.approvals', 'Approvals'), icon: GitPullRequest },
    { id: 'system',    label: t('notif.tab.system',    'System'),    icon: Settings },
  ];

  return (
    <div className="w-80 max-h-[480px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider flex-shrink-0">
        <span className="text-sm font-semibold text-ink">{t('notif.title', 'Notifications')}</span>
        {unread > 0 && (
          <button
            type="button"
            disabled={markAll.isPending}
            onClick={() => { markAll.mutate(); }}
            className="flex items-center gap-1 text-xs text-brand-blue hover:underline disabled:opacity-50"
          >
            <CheckCheck size={12} />
            {t('notif.mark_all_read', 'Mark all read')}
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label={t('notif.tabs_aria', 'Notification tabs')}
        className="flex border-b border-divider flex-shrink-0"
      >
        {tabs.map(({ id, label, icon: Icon }) => {
          const count = tabUnread[id];
          const isActive = id === activeTab;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={isActive}
              aria-controls="notif-list-region"
              data-testid={`notif-tab-${id}`}
              type="button"
              onClick={() => { setActiveTab(id); }}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue/40 focus:ring-inset',
                isActive
                  ? 'border-b-2 border-brand-blue text-brand-blue'
                  : 'text-muted hover:text-ink border-b-2 border-transparent',
              )}
            >
              <Icon size={11} className="flex-shrink-0" />
              {label}
              {count > 0 && (
                <span
                  aria-label={`${count} unread`}
                  className={cn(
                    'min-w-[16px] h-4 rounded-full text-[10px] font-semibold flex items-center justify-center px-1',
                    id === 'alerts'
                      ? 'bg-danger-bg text-danger-on-light'
                      : id === 'approvals'
                        ? 'bg-warning-bg text-warning-on-light'
                        : 'bg-divider text-muted',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      <ul
        id="notif-list-region"
        data-testid="notif-list"
        className="flex-1 overflow-y-auto divide-y divide-divider"
        role="tabpanel"
      >
        {feed.isLoading && (
          <li className="px-4 py-6 text-center text-xs text-muted">{t('notif.loading', 'Loading…')}</li>
        )}
        {!feed.isLoading && visibleItems.length === 0 && (
          <li className="px-4 py-6 flex flex-col items-center text-center text-muted gap-2">
            <CheckCircle2 size={24} className="text-success" />
            <span className="text-xs">{t('notif.empty', 'No notifications')}</span>
          </li>
        )}
        {visibleItems.map((item) => {
          const isUnread = item.is_read === 0;
          return (
            <li
              key={item.id}
              className={cn(
                'px-4 py-2.5 flex items-start gap-2.5',
                isUnread && 'bg-brand-skyLight/30',
              )}
            >
              <Bell size={13} className="mt-0.5 text-muted flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-ink truncate">{item.subject}</p>
                <p className="text-[11px] text-muted mt-0.5">
                  {new Date(item.sent_at).toLocaleString()}
                </p>
              </div>
              {isUnread && (
                <button
                  type="button"
                  disabled={markOne.isPending}
                  onClick={() => { markOne.mutate(item.id); }}
                  className="text-[11px] text-brand-blue hover:underline flex-shrink-0 disabled:opacity-50"
                  aria-label={t('notif.mark_read', 'Mark as read')}
                >
                  <CheckCircle2 size={13} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-divider flex-shrink-0">
        <Link
          to="/notifications"
          className="text-xs text-brand-blue hover:underline"
        >
          {t('notif.view_all', 'View all notifications')}
        </Link>
      </div>
    </div>
  );
}
