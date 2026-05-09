/**
 * SessionsTab — active session list with kill-session and kill-all-sessions.
 * Requires Redis — shows empty state when Redis is not configured.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Trash2 } from 'lucide-react';
import { Badge, Button, DataTable, useToast, type Column } from '@/components/ui';
import { fetchActiveSessions, killSession, killAllSessions, type ActiveSessionRow } from '../api';
import { HttpError } from '@/lib/http';

export function SessionsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const sessionsQ = useQuery({
    queryKey:  ['active-sessions'],
    queryFn:   fetchActiveSessions,
    refetchInterval: 30_000,
  });

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['active-sessions'] }); };

  const killMut = useMutation({
    mutationFn: ({ userId, sid }: { userId: number; sid: string }) => killSession(userId, sid),
    onSuccess: () => { invalidate(); toast({ variant: 'success', title: 'Session terminated' }); },
    onError: (e) => toast({ variant: 'error', title: 'Kill failed', message: e instanceof HttpError ? e.message : 'Error' }),
  });

  const killAllMut = useMutation({
    mutationFn: (userId: number) => killAllSessions(userId),
    onSuccess: (data) => {
      invalidate();
      toast({ variant: 'success', title: 'All sessions terminated', message: `${data.sessions_killed} session(s) killed` });
    },
    onError: (e) => toast({ variant: 'error', title: 'Kill all failed', message: e instanceof HttpError ? e.message : 'Error' }),
  });

  const isRedisError =
    sessionsQ.isError &&
    sessionsQ.error instanceof HttpError &&
    sessionsQ.error.status === 503;

  if (isRedisError) {
    return (
      <div className="rounded-card border border-border bg-surface-alt p-6 text-center">
        <p className="text-sm font-medium text-ink">Session tracking unavailable</p>
        <p className="text-xs text-muted mt-1">
          Redis is not configured. Set <code className="font-mono">REDIS_URL</code> to enable live session management.
        </p>
      </div>
    );
  }

  const sessions = sessionsQ.data ?? [];

  // Group by user for kill-all button.
  const userIds = [...new Set(sessions.map((s) => s.user_id))];

  const columns: Column<ActiveSessionRow>[] = [
    {
      key: 'username',
      header: 'User',
      render: (s) => (
        <div className="flex flex-col">
          <span className="font-mono text-md text-ink">{s.username}</span>
          <span className="text-2xs text-muted">id:{s.user_id}</span>
        </div>
      ),
    },
    {
      key: 'sid_last8',
      header: 'Session',
      width: 100,
      render: (s) => <span className="font-mono text-xs text-muted">…{s.sid_last8}</span>,
    },
    {
      key: 'ip',
      header: 'IP',
      width: 130,
      render: (s) => <span className="text-xs text-ink-sub">{s.ip ?? '—'}</span>,
    },
    {
      key: 'expires_at',
      header: 'Expires',
      width: 150,
      render: (s) => (
        <span className="text-xs text-ink-sub">
          {s.expires_at !== null ? new Date(s.expires_at).toLocaleString() : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 80,
      align: 'right',
      render: (s) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => killMut.mutate({ userId: s.user_id, sid: s.sid_last8 })}
          loading={killMut.isPending}
          data-testid={`session-kill-${s.sid_last8}`}
          aria-label="Terminate session"
        >
          <LogOut size={13} />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {sessions.length} active session(s) across {userIds.length} user(s)
        </p>
        <Badge tone="neutral" className="text-2xs">Auto-refreshes every 30s</Badge>
      </div>

      {userIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {userIds.map((uid) => {
            const uname = sessions.find((s) => s.user_id === uid)?.username ?? String(uid);
            return (
              <Button
                key={uid}
                size="sm"
                variant="ghost"
                onClick={() => killAllMut.mutate(uid)}
                loading={killAllMut.isPending && killAllMut.variables === uid}
                data-testid={`session-kill-all-${String(uid)}`}
                className="text-danger hover:bg-danger/10"
              >
                <Trash2 size={12} /> Kill all — {uname}
              </Button>
            );
          })}
        </div>
      )}

      <DataTable<ActiveSessionRow>
        columns={columns}
        data={sessions}
        empty={sessionsQ.isLoading ? 'Loading…' : 'No active sessions (Redis not connected or empty)'}
      />
    </div>
  );
}
