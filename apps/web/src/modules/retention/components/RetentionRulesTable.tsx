/**
 * RetentionRulesTable — inline-editable per-doctype retention rules.
 * Shows all doctypes from the tenant_config 'retention' namespace rules.*
 * and allows inline editing of each rule's fields.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { fetchRetentionRules, updateRetentionRule } from '../api';
import type { RetentionRule, DeletePolicy } from '../schemas';

const DELETE_POLICY_OPTIONS: Array<{ value: DeletePolicy; label: string }> = [
  { value: 'archive',     label: 'Archive' },
  { value: 'cryptoshred', label: 'Cryptoshred' },
  { value: 'soft_delete', label: 'Soft delete' },
];

// ── Inline edit state for a single row ────────────────────────────────────────

interface EditState {
  retention_period_days: string;
  worm_lock_period_days: string;
  legal_hold_eligible: boolean;
  delete_policy: DeletePolicy;
  reason: string;
}

function ruleToEdit(rule: RetentionRule): EditState {
  return {
    retention_period_days: String(rule.retention_period_days),
    worm_lock_period_days: rule.worm_lock_period_days !== null ? String(rule.worm_lock_period_days) : '',
    legal_hold_eligible: rule.legal_hold_eligible,
    delete_policy: rule.delete_policy,
    reason: '',
  };
}

// ── Row component ─────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  onSave,
  saving,
}: {
  rule: RetentionRule;
  onSave: (doctype: string, edit: EditState) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<EditState>(() => ruleToEdit(rule));

  function handleEdit() {
    setEdit(ruleToEdit(rule));
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
  }

  function handleSave() {
    onSave(rule.doctype, edit);
    setEditing(false);
  }

  const reasonOk = edit.reason.length >= 20;
  const retParsed = parseInt(edit.retention_period_days, 10);
  const retOk = !isNaN(retParsed) && retParsed >= 1;

  const inputCls = 'w-full rounded-input border border-border px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue';

  return (
    <tr className={cn('border-t border-divider', editing && 'bg-brand-skyLight/30')}>
      {/* Doctype */}
      <td className="px-3 py-2 text-xs font-medium text-ink">{rule.doctype}</td>

      {/* Retention days */}
      <td className="px-3 py-2 text-xs">
        {editing ? (
          <input
            type="number"
            min={1}
            value={edit.retention_period_days}
            onChange={(e) => setEdit((s) => ({ ...s, retention_period_days: e.target.value }))}
            className={inputCls}
            aria-label="Retention period days"
          />
        ) : (
          rule.retention_period_days
        )}
      </td>

      {/* WORM lock days */}
      <td className="px-3 py-2 text-xs">
        {editing ? (
          <input
            type="number"
            min={1}
            placeholder="None"
            value={edit.worm_lock_period_days}
            onChange={(e) => setEdit((s) => ({ ...s, worm_lock_period_days: e.target.value }))}
            className={inputCls}
            aria-label="WORM lock period days"
          />
        ) : (
          rule.worm_lock_period_days ?? <span className="text-muted">—</span>
        )}
      </td>

      {/* Legal hold eligible */}
      <td className="px-3 py-2 text-xs">
        {editing ? (
          <input
            type="checkbox"
            checked={edit.legal_hold_eligible}
            onChange={(e) => setEdit((s) => ({ ...s, legal_hold_eligible: e.target.checked }))}
            className="h-4 w-4 accent-brand-blue"
            aria-label="Legal hold eligible"
          />
        ) : (
          <Badge tone={rule.legal_hold_eligible ? 'blue' : 'neutral'}>
            {rule.legal_hold_eligible ? 'Yes' : 'No'}
          </Badge>
        )}
      </td>

      {/* Delete policy */}
      <td className="px-3 py-2 text-xs">
        {editing ? (
          <select
            value={edit.delete_policy}
            onChange={(e) => setEdit((s) => ({ ...s, delete_policy: e.target.value as DeletePolicy }))}
            className={inputCls}
            aria-label="Delete policy"
          >
            {DELETE_POLICY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <Badge tone="neutral">{rule.delete_policy}</Badge>
        )}
      </td>

      {/* Actions */}
      <td className="px-3 py-2">
        {editing ? (
          <div className="space-y-1">
            <input
              type="text"
              value={edit.reason}
              onChange={(e) => setEdit((s) => ({ ...s, reason: e.target.value }))}
              placeholder="Reason (min 20 chars)…"
              className={cn(inputCls, 'w-48', !reasonOk && edit.reason.length > 0 && 'border-danger')}
              aria-label="Reason for change"
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={!reasonOk || !retOk || saving}
                className="inline-flex items-center gap-1 rounded-input bg-brand-blue px-2 py-1 text-[10px] font-medium text-white disabled:opacity-40"
                aria-label="Save rule"
              >
                <Check size={10} /> Save
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[10px] text-ink-sub hover:bg-divider"
                aria-label="Cancel edit"
              >
                <X size={10} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleEdit}
            className="inline-flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[10px] text-ink-sub hover:bg-divider focus:outline-none focus:ring-2 focus:ring-brand-blue"
            aria-label={`Edit rule for ${rule.doctype}`}
          >
            <Pencil size={10} /> Edit
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function RetentionRulesTable() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['retention', 'rules'],
    queryFn: fetchRetentionRules,
  });

  const saveMutation = useMutation({
    mutationFn: ({ doctype, edit }: { doctype: string; edit: EditState }) => {
      const wormDays = edit.worm_lock_period_days.trim() !== ''
        ? parseInt(edit.worm_lock_period_days, 10)
        : null;
      return updateRetentionRule(doctype, {
        retention_period_days: parseInt(edit.retention_period_days, 10),
        worm_lock_period_days: wormDays,
        legal_hold_eligible: edit.legal_hold_eligible,
        delete_policy: edit.delete_policy,
        reason: edit.reason,
      });
    },
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ['retention', 'rules'] });
      toast({ variant: 'success', title: `Rule saved for ${updated.doctype}` });
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string }).message ?? 'Unknown error';
      toast({ variant: 'error', title: 'Save failed', message: msg });
    },
  });

  if (q.isLoading) {
    return <Skeleton className="h-32 w-full rounded-card" />;
  }

  if (q.isError) {
    return (
      <EmptyState
        title="Failed to load retention rules"
        body="Could not fetch per-doctype retention rules. Check the backend."
      />
    );
  }

  const rules = q.data ?? [];

  if (rules.length === 0) {
    return (
      <EmptyState
        title="No retention rules configured"
        body="Use the form below to add per-doctype retention rules, or configure the retention namespace via Admin Settings."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-divider bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="table-header">
            <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Doc type</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Retention (days)</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">WORM lock (days)</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Legal hold eligible</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Delete policy</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <RuleRow
              key={rule.doctype}
              rule={rule}
              saving={saveMutation.isPending}
              onSave={(doctype, edit) => saveMutation.mutate({ doctype, edit })}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
