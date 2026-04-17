import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2 } from 'lucide-react';
import { get, post } from '@/lib/http';
import { AlertSchema, OkSchema, type Alert } from '@/lib/schemas';
import { z } from 'zod';
import { Badge, Panel, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/cn';

const fetchAlerts = () => get('/spa/api/alerts', z.array(AlertSchema), { limit: 200 });
const markRead = (id: number) => post(`/spa/api/alerts/${id}/read`, {}, OkSchema);

const toneByLevel: Record<Alert['level'], BadgeTone> = {
  critical: 'danger',
  warning:  'warning',
  info:     'blue',
  success:  'success',
};

export function AlertsPage() {
  const qc = useQueryClient();
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: fetchAlerts });
  const mark = useMutation({
    mutationFn: markRead,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const unread = alerts.data?.filter((a) => !a.is_read).length ?? 0;

  return (
    <Panel title={`${alerts.data?.length ?? 0} alerts`} action={<span className="text-xs text-muted">{unread} unread</span>}>
      {alerts.isLoading && <p className="text-md text-muted">Loading…</p>}
      <ul className="divide-y divide-divider">
        {alerts.data?.map((a) => (
          <li
            key={a.id}
            className={cn(
              'py-3 flex items-start gap-3',
              !a.is_read && 'bg-brand-skyLight/40 -mx-5 px-5',
            )}
          >
            <Bell size={16} className="mt-0.5 text-muted" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge tone={toneByLevel[a.level]}>{a.level}</Badge>
                <span className="text-md text-ink font-medium truncate">{a.title}</span>
              </div>
              {a.meta && <p className="text-xs text-muted mt-0.5">{a.meta}</p>}
              <p className="text-[11px] text-muted mt-1">{new Date(a.created_at).toLocaleString()}</p>
            </div>
            {!a.is_read && (
              <button
                type="button"
                onClick={() => mark.mutate(a.id)}
                className="text-xs text-brand-blue hover:underline flex items-center gap-1"
              >
                <CheckCircle2 size={13} /> Mark read
              </button>
            )}
          </li>
        ))}
        {alerts.data?.length === 0 && (
          <li className="py-10 text-center text-muted text-md">No alerts.</li>
        )}
      </ul>
    </Panel>
  );
}
