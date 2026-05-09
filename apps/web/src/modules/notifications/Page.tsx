import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, CheckCheck } from 'lucide-react';
import { Badge, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fetchFeed, markRead, markAllRead } from './api';
import type { Notification } from './schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelBadgeTone(channel: string): 'blue' | 'success' | 'warning' | 'neutral' {
  if (channel === 'email')  return 'blue';
  if (channel === 'sms')    return 'success';
  if (channel === 'in_app') return 'neutral';
  return 'warning';
}

// ---------------------------------------------------------------------------
// NotificationRow
// ---------------------------------------------------------------------------

interface NotificationRowProps {
  item: Notification;
  onMarkRead: (id: number) => void;
  isMarking: boolean;
}

function NotificationRow({ item, onMarkRead, isMarking }: NotificationRowProps) {
  const unread = item.is_read === 0;
  return (
    <li
      className={cn(
        'py-3 flex items-start gap-3',
        unread && 'bg-brand-skyLight/40 -mx-5 px-5',
      )}
    >
      <Bell size={16} className="mt-0.5 text-muted flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={channelBadgeTone(item.channel)}>{item.channel}</Badge>
          {item.event_type && (
            <span className="text-[10px] text-muted font-mono">{item.event_type}</span>
          )}
          <span className="text-md text-ink font-medium truncate flex-1">{item.subject}</span>
        </div>
        <p className="text-xs text-ink-sub mt-0.5 whitespace-pre-line line-clamp-2">{item.body}</p>
        <p className="text-[11px] text-muted mt-1">{new Date(item.sent_at).toLocaleString()}</p>
      </div>
      {unread && (
        <button
          type="button"
          disabled={isMarking}
          onClick={() => { onMarkRead(item.id); }}
          className="text-xs text-brand-blue hover:underline flex items-center gap-1 flex-shrink-0 disabled:opacity-50"
          aria-label={`Mark notification ${item.id} as read`}
        >
          <CheckCircle2 size={13} />
          Mark read
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// NotificationsPage
// ---------------------------------------------------------------------------

export function NotificationsPage() {
  const qc = useQueryClient();

  const feed = useQuery({
    queryKey: ['notifications', 'feed'],
    queryFn:  () => fetchFeed({ limit: 100 }),
  });

  const markOne = useMutation({
    mutationFn: markRead,
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });

  const markAll = useMutation({
    mutationFn: markAllRead,
    onSuccess:  () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });

  const unread = feed.data?.unread_count ?? 0;

  return (
    <Panel
      title={`Notifications (${feed.data?.items.length ?? 0})`}
      action={
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">{unread} unread</span>
          {unread > 0 && (
            <button
              type="button"
              disabled={markAll.isPending}
              onClick={() => { markAll.mutate(); }}
              className="flex items-center gap-1 text-xs text-brand-blue hover:underline disabled:opacity-50"
            >
              <CheckCheck size={13} />
              Mark all read
            </button>
          )}
        </div>
      }
    >
      {feed.isLoading && <p className="text-md text-muted">Loading…</p>}
      <ul className="divide-y divide-divider">
        {feed.data?.items.map((item) => (
          <NotificationRow
            key={item.id}
            item={item}
            onMarkRead={(id) => { markOne.mutate(id); }}
            isMarking={markOne.isPending}
          />
        ))}
        {feed.data?.items.length === 0 && (
          <li className="py-10 flex flex-col items-center text-center text-muted">
            <CheckCircle2 size={32} className="mb-3 text-success" />
            <p className="text-md font-medium text-ink">No notifications</p>
            <p className="text-xs mt-1">You have no in-app notifications yet.</p>
          </li>
        )}
      </ul>
    </Panel>
  );
}
