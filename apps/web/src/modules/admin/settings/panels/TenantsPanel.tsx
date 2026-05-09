/**
 * TenantsPanel — direct editor for the tenants table.
 *
 * Shows all tenants in a DataTable. "Add tenant" opens a Modal; edit row
 * opens a Drawer. Delete is intentionally absent — deactivate via is_active.
 * All writes go through admin-tenants.js which calls CC1's setConfig for
 * the audit trail.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  Modal,
  useToast,
  type Column,
} from '@/components/ui';
import {
  fetchTenants,
  createTenant,
  updateTenant,
  type TenantRow,
  type CreateTenantBody,
  type UpdateTenantBody,
} from '../api';
import { HttpError } from '@/lib/http';

// DataTable requires T extends { id: string | number }.
// We map TenantRow → TenantTableRow, using tenant_id as the id key.
type TenantTableRow = TenantRow & { id: string };

function toTableRow(r: TenantRow): TenantTableRow {
  return { ...r, id: r.tenant_id };
}

// ---------------------------------------------------------------------------
// Tenant form (shared by Modal + Drawer)
// ---------------------------------------------------------------------------

type TenantFormMode = 'create' | 'edit';

interface TenantFormProps {
  mode: TenantFormMode;
  initial?: Partial<TenantRow>;
  onSave: (data: CreateTenantBody | UpdateTenantBody) => void;
  onCancel: () => void;
  isPending: boolean;
}

function TenantForm({ mode, initial, onSave, onCancel, isPending }: TenantFormProps) {
  const [form, setForm] = useState({
    tenant_id:         initial?.tenant_id         ?? '',
    slug:              initial?.slug              ?? '',
    display_name:      initial?.display_name      ?? '',
    regulator_name:    initial?.regulator_name    ?? '',
    regulator_short:   initial?.regulator_short   ?? '',
    default_locale:    initial?.default_locale    ?? 'en',
    primary_color:     initial?.primary_color     ?? '#0D2B6A',
    monogram:          initial?.monogram          ?? '',
    environment_label: initial?.environment_label ?? '',
    is_active:         initial?.is_active !== false,
    reason:            '',
  });

  function field(k: keyof typeof form) {
    return {
      value: String(form[k]),
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((prev) => ({ ...prev, [k]: e.target.value })),
    };
  }

  const reasonOk = form.reason.length >= 20;
  const canSubmit =
    form.display_name.trim() !== '' &&
    form.regulator_name.trim() !== '' &&
    form.regulator_short.trim() !== '' &&
    reasonOk &&
    !isPending &&
    (mode === 'edit' || form.tenant_id.trim() !== '');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (mode === 'create') {
      onSave({
        tenant_id:         form.tenant_id.trim(),
        slug:              form.slug.trim() || form.tenant_id.trim(),
        display_name:      form.display_name.trim(),
        regulator_name:    form.regulator_name.trim(),
        regulator_short:   form.regulator_short.trim(),
        default_locale:    form.default_locale.trim() || 'en',
        primary_color:     form.primary_color || '#0D2B6A',
        monogram:          form.monogram.trim() || form.tenant_id.slice(0, 2).toUpperCase(),
        environment_label: form.environment_label.trim() || undefined,
        is_active:         form.is_active,
        reason:            form.reason,
      } satisfies CreateTenantBody);
    } else {
      onSave({
        slug:              form.slug.trim() || undefined,
        display_name:      form.display_name.trim() || undefined,
        regulator_name:    form.regulator_name.trim() || undefined,
        regulator_short:   form.regulator_short.trim() || undefined,
        default_locale:    form.default_locale.trim() || undefined,
        primary_color:     form.primary_color || undefined,
        monogram:          form.monogram.trim() || undefined,
        environment_label: form.environment_label.trim() || null,
        is_active:         form.is_active,
        reason:            form.reason,
      } satisfies UpdateTenantBody);
    }
  }

  const inputClass = 'input mt-1 w-full';
  const labelClass = 'label text-sm font-medium text-ink';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode === 'create' && (
        <label className="block">
          <span className={labelClass}>Tenant ID <span className="text-danger">*</span></span>
          <input type="text" {...field('tenant_id')} placeholder="nbe" className={inputClass} required />
          <span className="text-xs text-muted">Lowercase letters, digits, hyphens, underscores only.</span>
        </label>
      )}

      <label className="block">
        <span className={labelClass}>Display name <span className="text-danger">*</span></span>
        <input type="text" {...field('display_name')} className={inputClass} required />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Regulator name <span className="text-danger">*</span></span>
          <input type="text" {...field('regulator_name')} className={inputClass} required />
        </label>
        <label className="block">
          <span className={labelClass}>Short <span className="text-danger">*</span></span>
          <input type="text" {...field('regulator_short')} maxLength={20} className={inputClass} required />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Slug</span>
          <input type="text" {...field('slug')} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Locale</span>
          <input type="text" {...field('default_locale')} placeholder="en" className={inputClass} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Primary colour</span>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="color"
              value={form.primary_color}
              onChange={(e) => setForm((p) => ({ ...p, primary_color: e.target.value }))}
              className="h-9 w-12 cursor-pointer rounded-input border border-border p-0.5"
            />
            <input
              type="text"
              value={form.primary_color}
              onChange={(e) => setForm((p) => ({ ...p, primary_color: e.target.value }))}
              className="input flex-1"
            />
          </div>
        </label>
        <label className="block">
          <span className={labelClass}>Monogram</span>
          <input type="text" {...field('monogram')} maxLength={8} className={inputClass} />
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>Environment label</span>
        <input type="text" {...field('environment_label')} placeholder="production / staging / sandbox" className={inputClass} />
      </label>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
          className="h-4 w-4 rounded border-border text-brand-blue focus:ring-brand-blue"
        />
        <span className={labelClass}>Active</span>
      </label>

      {/* Reason */}
      <div className="border-t border-divider pt-4">
        <label className="block">
          <span className={labelClass}>Reason <span className="text-danger">*</span></span>
          <textarea
            value={form.reason}
            onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
            rows={3}
            placeholder="Describe why you are making this change (minimum 20 characters)…"
            className={cn(
              'input mt-1 w-full resize-none',
              form.reason.length > 0 && !reasonOk && 'border-danger',
            )}
          />
          <span className={cn('text-xs', reasonOk ? 'text-success' : 'text-muted')}>
            {form.reason.length}/20 minimum
          </span>
        </label>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit} loading={isPending}>
          {mode === 'create' ? 'Create tenant' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// TenantsPanel
// ---------------------------------------------------------------------------

export function TenantsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<TenantRow | null>(null);

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['admin', 'tenants'],
    queryFn: fetchTenants,
  });

  const createMut = useMutation({
    mutationFn: (body: CreateTenantBody) => createTenant(body),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      setAddOpen(false);
      toast({ variant: 'success', title: `Tenant created · ${row.display_name}` });
    },
    onError: (err: unknown) => {
      const msg = err instanceof HttpError ? err.message : 'Unknown error';
      toast({ variant: 'error', title: 'Failed to create tenant', message: msg });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ tenantId, body }: { tenantId: string; body: UpdateTenantBody }) =>
      updateTenant(tenantId, body),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      setEditing(null);
      toast({ variant: 'success', title: `Tenant updated · ${row.display_name}` });
    },
    onError: (err: unknown) => {
      const msg = err instanceof HttpError ? err.message : 'Unknown error';
      toast({ variant: 'error', title: 'Failed to update tenant', message: msg });
    },
  });

  const tableRows: TenantTableRow[] = (tenants ?? []).map(toTableRow);

  const columns: Column<TenantTableRow>[] = [
    {
      key: 'tenant_id',
      header: 'ID',
      width: 100,
      render: (r) => <span className="font-mono text-xs text-ink">{r.tenant_id}</span>,
    },
    {
      key: 'display_name',
      header: 'Name',
      render: (r) => (
        <div>
          <p className="text-sm font-medium text-ink">{r.display_name}</p>
          <p className="text-xs text-muted">{r.slug}</p>
        </div>
      ),
    },
    {
      key: 'regulator',
      header: 'Regulator',
      width: 140,
      render: (r) => <span className="text-xs text-ink-sub">{r.regulator_short}</span>,
    },
    {
      key: 'locale',
      header: 'Locale',
      width: 80,
      render: (r) => <span className="text-xs">{r.default_locale}</span>,
    },
    {
      key: 'env',
      header: 'Env',
      width: 100,
      render: (r) =>
        r.environment_label !== null && r.environment_label !== ''
          ? <span className="text-xs font-mono text-muted">{r.environment_label}</span>
          : <span className="text-xs text-muted">—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 90,
      render: (r) => (
        <Badge tone={r.is_active ? 'success' : 'neutral'}>
          {r.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 60,
      render: (r) => (
        <button
          type="button"
          aria-label={`Edit ${r.display_name}`}
          onClick={() => setEditing(r)}
          className="rounded p-1 text-muted hover:text-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue"
        >
          <Pencil size={13} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-ink">Tenants</h2>
          <p className="mt-1 text-sm text-muted">
            Manage tenant registry rows. Deactivate instead of deleting to preserve audit trail.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={13} /> Add tenant
        </Button>
      </div>

      <DataTable<TenantTableRow>
        columns={columns}
        data={tableRows}
        empty={isLoading ? 'Loading…' : 'No tenants found'}
        loading={isLoading}
      />

      {/* Add Modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add tenant" size="lg">
        <TenantForm
          mode="create"
          onSave={(body) => createMut.mutate(body as CreateTenantBody)}
          onCancel={() => setAddOpen(false)}
          isPending={createMut.isPending}
        />
      </Modal>

      {/* Edit Drawer */}
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit · ${editing?.display_name ?? ''}`}
        width="500px"
      >
        {editing !== null && (
          <div className="p-6">
            <TenantForm
              mode="edit"
              initial={editing}
              onSave={(body) =>
                updateMut.mutate({ tenantId: editing.tenant_id, body: body as UpdateTenantBody })
              }
              onCancel={() => setEditing(null)}
              isPending={updateMut.isPending}
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}
