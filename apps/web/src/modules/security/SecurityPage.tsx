import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { DataTable, MetricCard, Panel, type Column } from '@/components/ui';
import { fetchRbac, fetchSessions, type SessionRow } from './api';

export function SecurityPage() {
  const rbac = useQuery({ queryKey: ['security', 'rbac'], queryFn: fetchRbac });
  const sessions = useQuery({ queryKey: ['security', 'sessions'], queryFn: fetchSessions });

  const matrix = rbac.data;
  const totalUsers = (matrix?.userCounts ?? []).reduce((sum, r) => sum + r.c, 0);

  const sessionColumns: Column<SessionRow>[] = [
    { key: 'when',   header: 'When',   width: 170, render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'user',   header: 'User',   width: 180, render: (r) => r.username ?? `#${r.user_id ?? '—'}` },
    { key: 'role',   header: 'Role',   width: 140, render: (r) => r.role ?? '—' },
    { key: 'branch', header: 'Branch', width: 140, render: (r) => r.branch ?? '—' },
    { key: 'action', header: 'Event',                render: (r) => r.action ?? '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Roles"       value={matrix?.roles.length ?? '—'}       tone="blue"    sub="RBAC model" />
        <MetricCard label="Permissions" value={matrix?.permissions.length ?? '—'} tone="purple"  sub="Unique actions" />
        <MetricCard label="Users"       value={totalUsers || '—'}                 tone="success" sub="Active accounts" />
        <MetricCard label="Session log" value={sessions.data?.length ?? '—'}      tone="warning" sub="Recent events" />
      </div>

      <Panel title="Role / permission matrix">
        {matrix ? (
          <div className="overflow-x-auto">
            <table className="w-full text-md" data-testid="rbac-matrix">
              <thead>
                <tr className="text-xs text-muted text-left border-b border-divider">
                  <th className="py-2 pr-4">Permission</th>
                  {matrix.roles.map((role) => (
                    <th key={role} className="py-2 px-3 text-center">{role}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.permissions.map((perm) => (
                  <tr key={perm} className="border-b border-divider/60 last:border-b-0">
                    <td className="py-1.5 pr-4 font-mono text-xs text-ink">{perm}</td>
                    {matrix.roles.map((role) => {
                      const cell = matrix.matrix.find((r) => r.role === role);
                      const granted = !!cell?.perms[perm];
                      return (
                        <td key={role} className="py-1.5 px-3 text-center">
                          {granted ? <Check size={14} className="inline text-success" /> : <X size={14} className="inline text-muted/40" />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-md text-muted py-4">Loading…</p>
        )}
      </Panel>

      <Panel title="Recent login activity">
        <DataTable<SessionRow>
          columns={sessionColumns}
          data={sessions.data ?? []}
          empty={sessions.isLoading ? 'Loading…' : 'No recent login events'}
        />
      </Panel>
    </div>
  );
}
