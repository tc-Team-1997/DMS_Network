import { useQuery } from '@tanstack/react-query';
import { Plug } from 'lucide-react';
import { Badge, DataTable, Panel, type BadgeTone, type Column } from '@/components/ui';
import { useTenant } from '@/store/tenant';
import { fetchAdapters, type AdapterRow, type AdapterStatus } from './api';

const statusTone: Record<AdapterStatus, BadgeTone> = {
  live:    'success',
  sandbox: 'warning',
  mock:    'blue',
  planned: 'neutral',
};

const statusLabel: Record<AdapterStatus, string> = {
  live:    'Live',
  sandbox: 'Sandbox',
  mock:    'Mock',
  planned: 'Planned',
};

export function IntegrationsPage() {
  const q = useQuery({ queryKey: ['integrations'], queryFn: fetchAdapters });
  const tenant = useTenant();
  const productName = tenant.product_name ?? tenant.display_name ?? 'DocManager';
  const rows = q.data?.adapters ?? [];

  const byCategory = rows.reduce<Record<string, AdapterRow[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

  const columns: Column<AdapterRow>[] = [
    { key: 'name', header: 'Adapter',
      render: (r) => (
        <div className="flex flex-col">
          <span className="text-md text-ink font-medium">{r.name}</span>
          <span className="text-xs text-muted font-mono">{r.id}</span>
        </div>
      ) },
    { key: 'status',  header: 'Status',  width: 110,
      render: (r) => <Badge tone={statusTone[r.status]}>{statusLabel[r.status]}</Badge> },
    { key: 'wave',    header: 'Wave',    width: 120, render: (r) => <span className="text-xs text-muted">{r.wave}</span> },
    { key: 'health',  header: 'Health',  width: 120,
      render: (r) => r.health
        ? <Badge tone="success">healthy</Badge>
        : <span className="text-xs text-muted">—</span> },
  ];

  return (
    <div className="space-y-6">
      <Panel title="Integration marketplace">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-skyLight flex items-center justify-center">
            <Plug size={22} className="text-brand-blue" />
          </div>
          <div className="flex-1">
            <p className="text-md text-ink">
              Connect {productName} to your core banking, CRM, signature, and analytics stack.
              Each adapter ships mock, sandbox, and live modes — onboarding switches them per-tenant.
            </p>
            {q.data?.note && <p className="text-xs text-muted mt-2">{q.data.note}</p>}
          </div>
        </div>
      </Panel>

      {Object.entries(byCategory).map(([category, items]) => (
        <Panel key={category} title={category}>
          <DataTable<AdapterRow> columns={columns} data={items} empty="No adapters in this category" />
        </Panel>
      ))}

      {rows.length === 0 && !q.isLoading && (
        <Panel title="Adapters">
          <p className="text-md text-muted py-8 text-center">
            No adapters registered. Check <code className="font-mono text-xs">/spa/api/integrations</code> for wiring issues.
          </p>
        </Panel>
      )}
    </div>
  );
}
