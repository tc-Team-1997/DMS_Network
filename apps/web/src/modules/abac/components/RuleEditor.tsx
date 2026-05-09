/**
 * RuleEditor — visual builder for an ABAC rule.
 * Rendered inside a Modal. Supports creating new rules and editing existing ones.
 *
 * Sections:
 *   1. Basic info (id, name, description, effect, priority)
 *   2. Condition scope (resource type, action)
 *   3. AND-group predicates (when_all)
 *   4. OR-group predicates (when_any)
 *   5. Reason (≥20 chars) + Save
 */
import { useState, useId } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Modal, Button, Combobox, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAddRule, useUpdateRule } from '../api';
import {
  ALLOWED_FIELD_PATHS,
  ALLOWED_OPS,
  KNOWN_RESOURCES,
  KNOWN_ACTIONS,
  type AbacRule,
  type Predicate,
  type AllowedFieldPath,
  type AllowedOp,
} from '../schemas';

// ---------------------------------------------------------------------------
// Combobox option builders
// ---------------------------------------------------------------------------

const RESOURCE_OPTIONS = KNOWN_RESOURCES.map(v => ({ value: v, label: v }));
const ACTION_OPTIONS   = KNOWN_ACTIONS.map(v => ({ value: v, label: v }));
const FIELD_OPTIONS    = ALLOWED_FIELD_PATHS.map(v => ({ value: v, label: v }));
const OP_OPTIONS       = ALLOWED_OPS.map(v => ({ value: v, label: v }));
const EFFECT_OPTIONS   = [
  { value: 'allow', label: 'allow' },
  { value: 'deny',  label: 'deny'  },
];

// ---------------------------------------------------------------------------
// Default blank rule
// ---------------------------------------------------------------------------

function blankRule(): AbacRule {
  return {
    id:          '',
    name:        '',
    description: '',
    effect:      'deny',
    priority:    10,
    condition: {
      resource: 'document',
      action:   'approve',
      when_all: [],
      when_any: [],
    },
  };
}

function blankPredicate(): Predicate {
  return { field: 'resource.risk_band', op: 'eq', value: '' };
}

// ---------------------------------------------------------------------------
// Predicate editor row
// ---------------------------------------------------------------------------

function PredicateRow({
  pred,
  onChange,
  onRemove,
}: {
  pred: Predicate;
  onChange: (p: Predicate) => void;
  onRemove: () => void;
}) {
  const rowId = useId();

  // Value field type depends on the selected field
  const isBoolean = pred.field === 'context.stepup_valid';
  const isNumeric  = pred.field === 'context.time_unix';
  const isArray    = pred.op === 'in' || pred.op === 'not_in';

  function handleValueChange(raw: string) {
    if (isBoolean) {
      onChange({ ...pred, value: raw === 'true' });
    } else if (isNumeric) {
      onChange({ ...pred, value: Number(raw) });
    } else if (isArray) {
      // Comma-separated → string[]
      onChange({ ...pred, value: raw.split(',').map(s => s.trim()).filter(Boolean) });
    } else {
      onChange({ ...pred, value: raw });
    }
  }

  function currentValueStr(): string {
    if (isArray && Array.isArray(pred.value)) return pred.value.join(', ');
    if (typeof pred.value === 'boolean') return pred.value ? 'true' : 'false';
    return String(pred.value ?? '');
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 grid grid-cols-3 gap-2">
        {/* Field */}
        <Combobox
          options={FIELD_OPTIONS}
          value={pred.field}
          onChange={v => { onChange({ ...pred, field: v as AllowedFieldPath, value: '' }); }}
          placeholder="field"
        />
        {/* Op */}
        <Combobox
          options={OP_OPTIONS}
          value={pred.op}
          onChange={v => { onChange({ ...pred, op: v as AllowedOp }); }}
          placeholder="op"
        />
        {/* Value */}
        {isBoolean ? (
          <Combobox
            options={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]}
            value={currentValueStr()}
            onChange={v => { handleValueChange(v); }}
            placeholder="value"
          />
        ) : (
          <input
            id={`${rowId}-val`}
            type={isNumeric ? 'number' : 'text'}
            value={currentValueStr()}
            onChange={e => { handleValueChange(e.target.value); }}
            placeholder={isArray ? 'val1, val2, …' : 'value'}
            className="input w-full text-xs"
          />
        )}
      </div>
      <button
        type="button"
        aria-label="Remove predicate"
        onClick={onRemove}
        className="mt-1 rounded-input p-1.5 text-ink-sub hover:bg-danger-bg hover:text-danger focus:outline-none focus:ring-2 focus:ring-danger"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RuleEditor
// ---------------------------------------------------------------------------

export interface RuleEditorProps {
  initial?: AbacRule | undefined;
  onClose: () => void;
}

export function RuleEditor({ initial, onClose }: RuleEditorProps) {
  const { toast } = useToast();
  const addRule    = useAddRule();
  const updateRule = useUpdateRule();

  const isEdit = initial !== undefined;
  const [rule, setRule] = useState<AbacRule>(() =>
    initial
      ? {
          ...initial,
          condition: {
            ...initial.condition,
            when_all: initial.condition.when_all ?? [],
            when_any: initial.condition.when_any ?? [],
          },
        }
      : blankRule()
  );
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isPending = addRule.isPending || updateRule.isPending;

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!rule.id.trim()) e['id'] = 'ID is required';
    else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rule.id)) e['id'] = 'ID must be a safe identifier (letters, digits, underscores)';
    if (!rule.name.trim()) e['name'] = 'Name is required';
    if (reason.length < 20) e['reason'] = 'Reason must be at least 20 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async function handleSubmit() {
    if (!validate()) return;
    const clean: AbacRule = {
      ...rule,
      condition: {
        ...rule.condition,
        when_all: (rule.condition.when_all ?? []).filter(p => String(p.value).trim() !== '' || Array.isArray(p.value)),
        when_any: (rule.condition.when_any ?? []).filter(p => String(p.value).trim() !== '' || Array.isArray(p.value)),
      },
    };
    try {
      if (isEdit) {
        await updateRule.mutateAsync({ id: initial.id, rule: clean, reason });
        toast({ variant: 'success', title: 'Rule updated', message: `"${clean.name}" saved` });
      } else {
        await addRule.mutateAsync({ rule: clean, reason });
        toast({ variant: 'success', title: 'Rule created', message: `"${clean.name}" added` });
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast({ variant: 'error', title: 'Save failed', message: msg });
    }
  }

  // ---------------------------------------------------------------------------
  // Predicate helpers
  // ---------------------------------------------------------------------------

  function addPredicate(group: 'when_all' | 'when_any') {
    setRule(r => ({
      ...r,
      condition: {
        ...r.condition,
        [group]: [...(r.condition[group] ?? []), blankPredicate()],
      },
    }));
  }

  function updatePredicate(group: 'when_all' | 'when_any', idx: number, pred: Predicate) {
    setRule(r => {
      const list = [...(r.condition[group] ?? [])];
      list[idx] = pred;
      return { ...r, condition: { ...r.condition, [group]: list } };
    });
  }

  function removePredicate(group: 'when_all' | 'when_any', idx: number) {
    setRule(r => {
      const list = [...(r.condition[group] ?? [])];
      list.splice(idx, 1);
      return { ...r, condition: { ...r.condition, [group]: list } };
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const formId = useId();

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit rule: ${initial.name}` : 'New ABAC rule'}
      size="lg"
    >
      <form id={formId} onSubmit={e => { e.preventDefault(); void handleSubmit(); }} noValidate>
        <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">

          {/* ── Basic info ── */}
          <Section title="Basic info">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Rule ID" error={errors['id']} required hint="Safe identifier, e.g. r_crit_stepup">
                <input
                  type="text"
                  value={rule.id}
                  onChange={e => { setRule(r => ({ ...r, id: e.target.value })); if (errors['id']) setErrors(er => ({ ...er, id: '' })); }}
                  disabled={isEdit}
                  placeholder="r_my_rule"
                  className={cn('input w-full', errors['id'] && 'border-danger', isEdit && 'bg-surface-alt text-muted cursor-not-allowed')}
                />
              </FormField>
              <FormField label="Priority" hint="0–1000; higher evaluated first">
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={rule.priority}
                  onChange={e => { setRule(r => ({ ...r, priority: Math.max(0, Math.min(1000, parseInt(e.target.value, 10) || 0)) })); }}
                  className="input w-full"
                />
              </FormField>
            </div>
            <FormField label="Name" error={errors['name']} required>
              <input
                type="text"
                value={rule.name}
                onChange={e => { setRule(r => ({ ...r, name: e.target.value })); if (errors['name']) setErrors(er => ({ ...er, name: '' })); }}
                placeholder="Critical docs require step-up"
                className={cn('input w-full', errors['name'] && 'border-danger')}
              />
            </FormField>
            <FormField label="Description">
              <textarea
                value={rule.description ?? ''}
                onChange={e => { setRule(r => ({ ...r, description: e.target.value })); }}
                rows={2}
                placeholder="Human-readable explanation of this rule (optional)"
                className="input w-full resize-none"
              />
            </FormField>
            <FormField label="Effect">
              <Combobox
                options={EFFECT_OPTIONS}
                value={rule.effect}
                onChange={v => { setRule(r => ({ ...r, effect: v as 'allow' | 'deny' })); }}
                placeholder="allow / deny"
              />
            </FormField>
          </Section>

          {/* ── Condition scope ── */}
          <Section title="Condition scope">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Resource type" hint="'*' matches any resource">
                <Combobox
                  options={RESOURCE_OPTIONS}
                  value={rule.condition.resource}
                  onChange={v => { setRule(r => ({ ...r, condition: { ...r.condition, resource: v } })); }}
                  placeholder="document"
                />
              </FormField>
              <FormField label="Action" hint="'*' matches any action">
                <Combobox
                  options={ACTION_OPTIONS}
                  value={rule.condition.action}
                  onChange={v => { setRule(r => ({ ...r, condition: { ...r.condition, action: v } })); }}
                  placeholder="approve"
                />
              </FormField>
            </div>
          </Section>

          {/* ── AND predicates ── */}
          <Section
            title="All of (AND)"
            hint="All predicates must be true"
            action={
              <button type="button" onClick={() => { addPredicate('when_all'); }}
                className="flex items-center gap-1 text-xs text-brand-blue hover:underline focus:outline-none">
                <Plus size={11} /> Add condition
              </button>
            }
          >
            {(rule.condition.when_all ?? []).length === 0 && (
              <p className="text-xs text-muted">No AND conditions. Rule will match on scope alone.</p>
            )}
            <div className="space-y-2">
              {(rule.condition.when_all ?? []).map((pred, i) => (
                <PredicateRow
                  key={i}
                  pred={pred}
                  onChange={p => { updatePredicate('when_all', i, p); }}
                  onRemove={() => { removePredicate('when_all', i); }}
                />
              ))}
            </div>
          </Section>

          {/* ── OR predicates ── */}
          <Section
            title="Any of (OR)"
            hint="At least one predicate must be true"
            action={
              <button type="button" onClick={() => { addPredicate('when_any'); }}
                className="flex items-center gap-1 text-xs text-brand-blue hover:underline focus:outline-none">
                <Plus size={11} /> Add condition
              </button>
            }
          >
            {(rule.condition.when_any ?? []).length === 0 && (
              <p className="text-xs text-muted">No OR conditions.</p>
            )}
            <div className="space-y-2">
              {(rule.condition.when_any ?? []).map((pred, i) => (
                <PredicateRow
                  key={i}
                  pred={pred}
                  onChange={p => { updatePredicate('when_any', i, p); }}
                  onRemove={() => { removePredicate('when_any', i); }}
                />
              ))}
            </div>
          </Section>

          {/* ── Reason ── */}
          <Section title="Reason for change">
            <FormField label="Reason" error={errors['reason']} required>
              <textarea
                value={reason}
                onChange={e => { setReason(e.target.value); if (errors['reason']) setErrors(er => ({ ...er, reason: '' })); }}
                rows={2}
                placeholder="Describe why you are adding/changing this rule (minimum 20 characters)…"
                className={cn('input w-full resize-none', errors['reason'] && 'border-danger')}
              />
              <p className={cn('mt-0.5 text-xs', reason.length === 0 ? 'text-muted' : reason.length >= 20 ? 'text-success' : 'text-danger')}>
                {reason.length}/20 characters minimum
              </p>
            </FormField>
          </Section>
        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-end gap-2 border-t border-divider pt-4">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending && <Loader2 size={13} className="animate-spin" />}
            {isEdit ? 'Save changes' : 'Create rule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string | undefined;
  action?: React.ReactNode | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-divider bg-surface-alt p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function FormField({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label mb-1 block text-sm font-medium text-ink">
        {label}{required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {hint && <p className="mb-1 text-xs text-muted">{hint}</p>}
      {children}
      {error && <p className="mt-0.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
