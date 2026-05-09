/**
 * NotificationFeed — compact popover panel for the Topbar bell.
 *
 * Shows the 10 most recent in-app notifications with mark-read actions.
 * Full list is at /notifications.
 */
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CheckCheck, Bell } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fetchFeed, markRead, markAllRead } from './api';

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
  const qc  = useQueryClient();

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

  const items  = feed.data?.items ?? [];
  const unread = feed.data?.unread_count ?? 0;

  return (
    <div className="w-80 max-h-[420px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider flex-shrink-0">
        <span className="text-sm font-semibold text-ink">Notifications</span>
        {unread > 0 && (
          <button
            type="button"
            disabled={markAll.isPending}
            onClick={() => { markAll.mutate(); }}
            className="flex items-center gap-1 text-xs text-brand-blue hover:underline disabled:opacity-50"
          >
            <CheckCheck size={12} />
            Mark all read
          </button>
        )}
      </div>

      {/* List */}
      <ul className="flex-1 overflow-y-auto divide-y divide-divider">
        {feed.isLoading && (
          <li className="px-4 py-6 text-center text-xs text-muted">Loading…</li>
        )}
        {!feed.isLoading && items.length === 0 && (
          <li className="px-4 py-6 flex flex-col items-center text-center text-muted gap-2">
            <CheckCircle2 size={24} className="text-success" />
            <span className="text-xs">No notifications</span>
          </li>
        )}
        {items.map((item) => {
          const unreadItem = item.is_read === 0;
          return (
            <li
              key={item.id}
              className={cn(
                'px-4 py-2.5 flex items-start gap-2.5',
                unreadItem && 'bg-brand-skyLight/30',
              )}
            >
              <Bell size={13} className="mt-0.5 text-muted flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-ink truncate">{item.subject}</p>
                <p className="text-[11px] text-muted mt-0.5">
                  {new Date(item.sent_at).toLocaleString()}
                </p>
              </div>
              {unreadItem && (
                <button
                  type="button"
                  disabled={markOne.isPending}
                  onClick={() => { markOne.mutate(item.id); }}
                  className="text-[11px] text-brand-blue hover:underline flex-shrink-0 disabled:opacity-50"
                  aria-label="Mark as read"
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
          View all notifications
        </Link>
      </div>
    </div>
  );
}
