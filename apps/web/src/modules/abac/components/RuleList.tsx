/**
 * RuleList — displays the current ABAC rules with New / Edit / Delete actions.
 */
import { useState } from 'react';
import { ShieldCheck, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton, useToast, Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAbacRules, useDeleteRule } from '../api';
import { RuleEditor } from './RuleEditor';
import type { AbacRule } from '../schemas';

export function RuleList() {
  const { toast } = useToast();
  const rulesQuery = useAbacRules();
  const deleteRule = useDeleteRule();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AbacRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AbacRule | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteReasonErr, setDeleteReasonErr] = useState('');

  function openNew() {
    setEditTarget(null);
    setEditorOpen(true);
  }

  function openEdit(rule: AbacRule) {
    setEditTarget(rule);
    setEditorOpen(true);
  }

  function openDelete(rule: AbacRule) {
    setDeleteTarget(rule);
    setDeleteReason('');
    setDeleteReasonErr('');
  }

  function closeDelete() {
    setDeleteTarget(null);
    setDeleteReason('');
    setDeleteReasonErr('');
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteReason.length < 20) {
      setDeleteReasonErr('Reason must be at least 20 characters');
      return;
    }
    try {
      await deleteRule.mutateAsync({ id: deleteTarget.id, reason: deleteReason });
      toast({ variant: 'success', title: 'Rule deleted', message: `"${deleteTarget.name}" removed` });
      closeDelete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast({ variant: 'error', title: 'Delete failed', message: msg });
    }
  }

  if (rulesQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-3/4" />
      </div>
    );
  }

  const rules = rulesQuery.data ?? [];

  return (
    <div>
      {/* Header row */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-ink-sub">
          {rules.length === 0
            ? 'No custom rules. Base RBAC matrix applies.'
            : `${rules.length} custom rule${rules.length === 1 ? '' : 's'}, evaluated before base RBAC.`}
        </p>
        <Button size="sm" onClick={openNew}>
          <Plus size={13} />
          New rule
        </Button>
      </div>

      {rules.length === 0 && (
        <EmptyState
          icon={<ShieldCheck size={20} />}
          title="No custom ABAC rules"
          body="Add rules to override the default RBAC matrix for specific resources, actions, or conditions."
        />
      )}

      {rules.length > 0 && (
        <div className="space-y-2">
          {[...rules]
            .sort((a, b) => b.priority - a.priority)
            .map(rule => (
              <div
                key={rule.id}
                className="flex items-start justify-between gap-4 rounded-card border border-divider bg-surface p-4 shadow-card"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink text-sm truncate">{rule.name}</span>
                    <Badge tone={rule.effect === 'allow' ? 'success' : 'danger'}>
                      {rule.effect}
                    </Badge>
                    <span className="text-xs text-muted">priority {rule.priority}</span>
                  </div>
                  {rule.description && (
                    <p className="mt-0.5 text-xs text-ink-sub line-clamp-2">{rule.description}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <ConditionChip label="resource" value={rule.condition.resource} />
                    <ConditionChip label="action" value={rule.condition.action} />
                    {(rule.condition.when_all ?? []).map((p, i) => (
                      <ConditionChip key={i} label={p.field} value={`${p.op} ${JSON.stringify(p.value)}`} />
                    ))}
                    {(rule.condition.when_any ?? []).length > 0 && (
                      <span className="rounded-badge bg-brand-skyLight px-2 py-0.5 text-[10px] text-brand-blue">
                        OR: {rule.condition.when_any?.length} condition{(rule.condition.when_any?.length ?? 0) === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Edit rule ${rule.name}`}
                    onClick={() => { openEdit(rule); }}
                    className="rounded-input p-1.5 text-ink-sub hover:bg-surface-alt hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete rule ${rule.name}`}
                    onClick={() => { openDelete(rule); }}
                    className="rounded-input p-1.5 text-ink-sub hover:bg-danger-bg hover:text-danger focus:outline-none focus:ring-2 focus:ring-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Rule editor modal */}
      {editorOpen && (
        <RuleEditor
          initial={editTarget ?? undefined}
          onClose={() => { setEditorOpen(false); }}
        />
      )}

      {/* Delete confirmation modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        title={`Delete rule: ${deleteTarget?.name ?? ''}`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-sub">
            This will remove the rule from the policy. Compile and push after deletion to apply the change.
          </p>
          <div>
            <label className="label text-sm font-medium text-ink" htmlFor="delete-reason">
              Reason for deletion <span className="text-danger">*</span>
            </label>
            <textarea
              id="delete-reason"
              value={deleteReason}
              onChange={e => {
                setDeleteReason(e.target.value);
                if (deleteReasonErr) setDeleteReasonErr('');
              }}
              rows={3}
              placeholder="Describe why you are deleting this rule (minimum 20 characters)…"
              className={cn(
                'input mt-1 w-full resize-none',
                deleteReasonErr && 'border-danger focus:border-danger',
              )}
            />
            {deleteReasonErr && (
              <p className="mt-0.5 text-xs text-danger">{deleteReasonErr}</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={closeDelete}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => { void confirmDelete(); }}
              disabled={deleteRule.isPending}
            >
              {deleteRule.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ConditionChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-badge bg-divider px-2 py-0.5 text-[10px] text-ink-sub">
      <span className="font-medium text-muted">{label}:</span>
      <span className="font-mono text-ink-sub">{value}</span>
    </span>
  );
}
