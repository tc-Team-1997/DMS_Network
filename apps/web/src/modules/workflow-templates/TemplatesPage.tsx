import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Plus, Save, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, Panel } from '@/components/ui';
import { useAuth } from '@/store/auth';
import {
  cloneTemplate,
  createTemplate,
  deleteTemplate,
  fetchTemplates,
  patchTemplate,
  type Stage,
  type Template,
  type TemplateInput,
} from './api';

const ROLES = ['Maker', 'Checker', 'Doc Admin', 'system'] as const;

function blankStage(): Stage {
  return { name: '', role: 'Maker' };
}

export function TemplatesPage() {
  const role = useAuth((s) => s.user?.role);
  const canEdit = role === 'Doc Admin';
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['workflow-templates'], queryFn: fetchTemplates });

  const [selected, setSelected] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<TemplateInput>({ name: '', doc_type: null, steps: [blankStage()] });
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['workflow-templates'] });
  };

  const create = useMutation({
    mutationFn: createTemplate,
    onSuccess: () => { invalidate(); setSelected(null); },
    onError:   (e: unknown) => setError((e as Error).message),
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<TemplateInput> & { active?: 0 | 1 } }) =>
      patchTemplate(id, body),
    onSuccess: () => { invalidate(); setSelected(null); },
    onError:   (e: unknown) => setError((e as Error).message),
  });
  const clone = useMutation({ mutationFn: cloneTemplate, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: deleteTemplate, onSuccess: invalidate });

  const rows = templates.data ?? [];
  const editing = useMemo<Template | null>(() => {
    if (typeof selected !== 'number') return null;
    return rows.find((r) => r.id === selected) ?? null;
  }, [rows, selected]);

  const startNew = () => {
    setError(null);
    setSelected('new');
    setDraft({ name: '', doc_type: null, steps: [blankStage()] });
  };

  const startEdit = (t: Template) => {
    setError(null);
    setSelected(t.id);
    setDraft({
      name: t.name,
      doc_type: t.doc_type,
      steps: t.steps.map((s) => ({ name: s.name, role: s.role })),
    });
  };

  const updateStage = (idx: number, patchStage: Partial<Stage>) => {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === idx ? { ...s, ...patchStage } : s)),
    }));
  };

  const addStage = () => setDraft((d) => ({ ...d, steps: [...d.steps, blankStage()] }));
  const removeStage = (idx: number) =>
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, i) => i !== idx) }));

  const submit = () => {
    setError(null);
    if (selected === 'new') create.mutate(draft);
    else if (typeof selected === 'number') patch.mutate({ id: selected, body: draft });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">
      <Panel
        title="Templates"
        action={
          canEdit && (
            <Button size="sm" onClick={startNew} data-testid="template-new">
              <Plus size={14} /> New
            </Button>
          )
        }
      >
        {templates.isLoading && <p className="text-md text-muted">Loading…</p>}
        <ul className="space-y-2">
          {rows.map((t) => (
            <li
              key={t.id}
              data-testid={`template-row-${t.id}`}
              className="rounded-card border border-divider p-3 hover:bg-divider/40 flex items-center gap-3"
            >
              <button
                type="button"
                className="flex-1 text-left"
                onClick={() => startEdit(t)}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-md font-medium text-ink">{t.name}</span>
                  <Badge tone={t.active ? 'success' : 'neutral'}>
                    {t.active ? 'Published' : 'Draft'}
                  </Badge>
                  {t.current_version_id != null && (
                    <Badge tone="blue" data-testid={`template-${t.id}-version-badge`}>
                      v{t.current_version_id}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted">
                  {t.doc_type ?? 'Any type'} · {t.steps.length} stages
                </p>
              </button>
              {canEdit && (
                <>
                  <Link
                    to={`/workflows/templates/${t.id}/design`}
                    aria-label="Open Designer"
                    data-testid={`template-${t.id}-designer`}
                    onClick={(e) => e.stopPropagation()}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-brand-blue hover:bg-divider"
                  >
                    <ExternalLink size={13} />
                  </Link>
                  <button
                    type="button"
                    aria-label="Clone"
                    data-testid={`template-${t.id}-clone`}
                    onClick={() => clone.mutate(t.id)}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-brand-blue hover:bg-divider"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete"
                    data-testid={`template-${t.id}-delete`}
                    onClick={() => {
                      if (confirm(`Delete template "${t.name}"?`)) remove.mutate(t.id);
                    }}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
          {rows.length === 0 && (
            <li className="py-6 text-center text-muted text-md">No templates yet.</li>
          )}
        </ul>
      </Panel>

      <Panel
        title={
          selected === 'new'
            ? 'New template'
            : editing
              ? `Edit — ${editing.name}`
              : 'Select a template or create a new one'
        }
        action={
          selected !== null && (
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => { setSelected(null); setError(null); }}
              className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"
            >
              <X size={12} /> Cancel
            </button>
          )
        }
      >
        {selected === null ? (
          <p className="text-md text-muted py-8 text-center">
            Templates define the ordered stages a workflow moves through. Pick one on the left to edit, or create a new one.
          </p>
        ) : (
          <div className="space-y-4">
            <label className="flex flex-col text-xs text-muted">
              Name
              <input
                type="text"
                value={draft.name}
                disabled={!canEdit}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                data-testid="template-name"
                className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
              />
            </label>

            <label className="flex flex-col text-xs text-muted">
              Document type (optional)
              <input
                type="text"
                value={draft.doc_type ?? ''}
                disabled={!canEdit}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, doc_type: e.target.value ? e.target.value : null }))
                }
                data-testid="template-doc-type"
                placeholder="Passport, Loan Application, …"
                className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
              />
            </label>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted">Stages</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={addStage}
                    data-testid="template-add-stage"
                    className="text-xs text-brand-blue hover:underline"
                  >
                    + Add stage
                  </button>
                )}
              </div>
              <ol className="space-y-2">
                {draft.steps.map((stage, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-card border border-divider p-2"
                  >
                    <span className="w-6 h-6 rounded-full bg-brand-skyLight text-brand-blue text-xs flex items-center justify-center font-mono">
                      {i + 1}
                    </span>
                    <input
                      type="text"
                      value={stage.name}
                      disabled={!canEdit}
                      placeholder="Stage name"
                      onChange={(e) => updateStage(i, { name: e.target.value })}
                      data-testid={`template-stage-${i}-name`}
                      className="flex-1 h-8 rounded-input border border-border px-2 text-md text-ink"
                    />
                    <select
                      value={stage.role}
                      disabled={!canEdit}
                      onChange={(e) => updateStage(i, { role: e.target.value })}
                      data-testid={`template-stage-${i}-role`}
                      className="h-8 rounded-input border border-border px-2 text-md text-ink"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    {canEdit && draft.steps.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove stage ${i + 1}`}
                        onClick={() => removeStage(i)}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            {error && (
              <p className="rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger" data-testid="template-error">
                {error}
              </p>
            )}

            {canEdit && (
              <div className="flex justify-end gap-2">
                {typeof selected === 'number' && editing && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => patch.mutate({ id: selected, body: { active: editing.active ? 0 : 1 } })}
                    data-testid="template-publish"
                  >
                    {editing.active ? 'Unpublish' : 'Publish'}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={submit}
                  loading={create.isPending || patch.isPending}
                  data-testid="template-save"
                >
                  <Save size={14} /> Save
                </Button>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
