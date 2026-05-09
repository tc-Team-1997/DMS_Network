import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Folder, Plus, Save, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { Badge, Button, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { HttpError } from '@/lib/http';
import {
  AI_EXTRACT_KEYS,
  FIELD_TYPES,
  createDocumentType,
  deleteDocumentType,
  fetchDocumentTypes,
  patchDocumentType,
  type DocumentType,
  type DocumentTypeInput,
  type FieldDef,
} from './api';
import { fetchFolders } from '@/modules/capture/api';
import { LearnWizard } from './LearnWizard';
import { SamplesTab } from './SamplesTab';

const BLANK_FIELD: FieldDef = { key: '', label: '', type: 'text', required: false };

function blankInput(): DocumentTypeInput {
  return { name: '', description: '', fields: [{ ...BLANK_FIELD }], active: true, default_folder_id: null };
}

type EditTab = 'fields' | 'samples';

export function DocumentTypesPage() {
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: ['document-types', { active: false }],
    queryFn: () => fetchDocumentTypes(false),
  });
  const folders = useQuery({
    queryKey: ['folders'],
    queryFn: fetchFolders,
  });

  const [selected, setSelected] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<DocumentTypeInput>(blankInput());
  const [err, setErr] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [editTab, setEditTab] = useState<EditTab>('fields');
  // Thresholds modal
  const [thresholdTarget, setThresholdTarget] = useState<DocumentType | null>(null);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['document-types'] }); };

  const create = useMutation({
    mutationFn: createDocumentType,
    onSuccess: (t) => { invalidate(); setSelected(t.id); setErr(null); },
    onError: (e: unknown) => setErr(e instanceof HttpError ? String(e.data ?? e.message) : (e as Error).message),
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<DocumentTypeInput> }) => patchDocumentType(id, body),
    onSuccess: () => { invalidate(); setErr(null); },
    onError: (e: unknown) => setErr(e instanceof HttpError ? String(e.data ?? e.message) : (e as Error).message),
  });
  const remove = useMutation({
    mutationFn: deleteDocumentType,
    onSuccess: () => { invalidate(); setSelected(null); setErr(null); },
    onError: (e: unknown) => setErr(e instanceof HttpError ? String(e.data ?? e.message) : (e as Error).message),
  });

  const editingType = useMemo<DocumentType | null>(() => {
    if (typeof selected !== 'number') return null;
    return types.data?.find((t) => t.id === selected) ?? null;
  }, [selected, types.data]);

  const startNew = () => {
    setSelected('new');
    setDraft(blankInput());
    setErr(null);
    setEditTab('fields');
  };

  const startEdit = (t: DocumentType) => {
    setSelected(t.id);
    setDraft({
      name: t.name,
      description: t.description ?? '',
      fields: t.fields.map((f) => ({ ...f })),
      active: !!t.active,
      default_folder_id: t.default_folder_id ?? null,
    });
    setErr(null);
    setEditTab('fields');
  };

  const updateField = (idx: number, patch: Partial<FieldDef>) => {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    }));
  };

  const addField = () => setDraft((d) => ({ ...d, fields: [...d.fields, { ...BLANK_FIELD }] }));

  const removeField = (idx: number) =>
    setDraft((d) => ({ ...d, fields: d.fields.filter((_, i) => i !== idx) }));

  const moveField = (idx: number, dir: -1 | 1) => {
    setDraft((d) => {
      const next = [...d.fields];
      const to = idx + dir;
      if (to < 0 || to >= next.length) return d;
      const a = next[idx];
      const b = next[to];
      if (!a || !b) return d;
      next[idx] = b;
      next[to] = a;
      return { ...d, fields: next };
    });
  };

  const submit = () => {
    const payload: DocumentTypeInput = {
      name: draft.name.trim(),
      ...(draft.description ? { description: draft.description } : {}),
      fields: draft.fields
        .map((f) => ({
          key: f.key.trim().toLowerCase(),
          label: f.label.trim(),
          type: f.type,
          required: !!f.required,
          ...(f.ai_extract_from ? { ai_extract_from: f.ai_extract_from } : {}),
        }))
        .filter((f) => f.key && f.label),
      ...(draft.active !== undefined ? { active: draft.active } : {}),
      default_folder_id: draft.default_folder_id ?? null,
    };
    if (selected === 'new') create.mutate(payload);
    else if (typeof selected === 'number') patch.mutate({ id: selected, body: payload });
  };

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
        <Panel
          title="Document types"
          action={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowWizard(true)}
                data-testid="doctype-learn-btn"
              >
                <Sparkles size={13} /> Learn from samples
              </Button>
              <Button size="sm" onClick={startNew} data-testid="doctype-new">
                <Plus size={13} /> New
              </Button>
            </div>
          }
        >
          {types.isLoading && <p className="text-md text-muted">Loading…</p>}
          <ul className="space-y-2">
            {types.data?.map((t) => (
              <li
                key={t.id}
                data-testid={`doctype-row-${t.id}`}
                onClick={() => startEdit(t)}
                className={cn(
                  'rounded-card border p-3 cursor-pointer',
                  selected === t.id ? 'border-brand-blue bg-brand-skyLight' : 'border-divider hover:bg-divider/40',
                )}
              >
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-md font-medium text-ink">{t.name}</span>
                  <Badge tone={t.active ? 'success' : 'neutral'}>{t.active ? 'Active' : 'Inactive'}</Badge>
                  {t.inference_status && t.inference_status !== 'manual' && (
                    <Badge tone={t.inference_status === 'live' ? 'blue' : 'warning'}>
                      {t.inference_status}
                    </Badge>
                  )}
                  {t.default_folder_name != null && (
                    <span
                      className="inline-flex items-center gap-1 rounded-input border border-brand-blue/30 bg-brand-skyLight px-1.5 py-0.5 text-[10px] text-brand-blue font-medium"
                      data-testid={`doctype-folder-pill-${t.id}`}
                    >
                      <Folder size={9} />
                      {t.default_folder_name}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setThresholdTarget(t); }}
                    className="ml-auto inline-flex items-center gap-1 rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:text-ink hover:bg-divider"
                    aria-label={`Edit thresholds for ${t.name}`}
                    data-testid={`doctype-thresholds-btn-${t.id}`}
                  >
                    <Settings2 size={10} /> Thresholds
                  </button>
                </div>
                <p className="text-xs text-muted">
                  {t.fields.length} field{t.fields.length === 1 ? '' : 's'}
                  {' · '}
                  {t.fields.filter((f) => f.required).length} required
                </p>
                {t.description && (
                  <p className="text-[11px] text-muted mt-1 line-clamp-2">{t.description}</p>
                )}
              </li>
            ))}
            {types.data?.length === 0 && (
              <li className="py-6 text-center text-muted text-md">No document types yet.</li>
            )}
          </ul>
        </Panel>

        <Panel
          title={
            selected === 'new' ? 'New document type'
            : editingType ? `Edit — ${editingType.name}`
            : 'Select a type or create a new one'
          }
          action={
            selected !== null && (
              <button
                type="button"
                onClick={() => { setSelected(null); setErr(null); }}
                className="text-xs text-muted hover:text-ink inline-flex items-center gap-1"
              >
                <X size={12} /> Cancel
              </button>
            )
          }
        >
          {selected === null ? (
            <p className="text-md text-muted py-8 text-center">
              Document types define the fields the Capture form renders and which ones are required.
              AI auto-fill maps extracted values onto fields via <code className="font-mono text-xs">ai_extract_from</code>.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Tab bar — only shown when editing an existing type */}
              {typeof selected === 'number' && editingType && (
                <div
                  className="inline-flex rounded-input border border-border overflow-hidden"
                  role="tablist"
                  aria-label="Edit document type tabs"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={editTab === 'fields'}
                    onClick={() => setEditTab('fields')}
                    className={cn(
                      'px-3 py-1.5 text-xs',
                      editTab === 'fields'
                        ? 'bg-brand-blue text-white'
                        : 'bg-white text-ink hover:bg-divider',
                    )}
                    data-testid="doctype-tab-fields"
                  >
                    Fields
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={editTab === 'samples'}
                    onClick={() => setEditTab('samples')}
                    className={cn(
                      'px-3 py-1.5 text-xs border-l border-border',
                      editTab === 'samples'
                        ? 'bg-brand-blue text-white'
                        : 'bg-white text-ink hover:bg-divider',
                    )}
                    data-testid="doctype-tab-samples"
                  >
                    Samples
                  </button>
                </div>
              )}

              {/* Samples tab content */}
              {editTab === 'samples' && typeof selected === 'number' && editingType ? (
                <SamplesTab docType={editingType} />
              ) : (
                <>
                  <label className="flex flex-col text-xs text-muted">
                    Name
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      data-testid="doctype-name"
                      className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
                    />
                  </label>

                  <label className="flex flex-col text-xs text-muted">
                    Description
                    <input
                      value={draft.description ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      placeholder="Short description (optional)"
                      className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
                    />
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={!!draft.active}
                      onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
                      data-testid="doctype-active"
                    />
                    Active (only active types show in the Capture picker)
                  </label>

                  <label className="flex flex-col text-xs text-muted">
                    Default folder
                    <select
                      value={draft.default_folder_id ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraft((d) => ({
                          ...d,
                          default_folder_id: v === '' ? null : parseInt(v, 10),
                        }));
                      }}
                      data-testid="doctype-default-folder-select"
                      className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
                      disabled={folders.isLoading}
                    >
                      <option value="">— no default folder —</option>
                      {folders.data?.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    <span className="mt-1 text-[11px] text-muted leading-snug">
                      Documents classified as this type will auto-route to this folder during upload.
                      The user can still override at capture time, and reviewers can re-route during
                      workflow approval.
                    </span>
                  </label>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted font-medium">
                        Fields ({draft.fields.length})
                      </span>
                      <button
                        type="button"
                        onClick={addField}
                        data-testid="doctype-add-field"
                        className="text-xs text-brand-blue hover:underline"
                      >
                        + Add field
                      </button>
                    </div>
                    <div className="space-y-2">
                      {draft.fields.map((f, i) => (
                        <FieldEditor
                          key={i}
                          index={i}
                          field={f}
                          onChange={(p) => updateField(i, p)}
                          onRemove={() => removeField(i)}
                          onMove={(dir) => moveField(i, dir)}
                          canMoveUp={i > 0}
                          canMoveDown={i < draft.fields.length - 1}
                        />
                      ))}
                    </div>
                  </div>

                  {err && (
                    <p className="rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger break-all" data-testid="doctype-error">
                      {err}
                    </p>
                  )}

                  <div className="flex justify-end gap-2">
                    {typeof selected === 'number' && editingType && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (confirm(`Delete "${editingType.name}"?`)) remove.mutate(editingType.id);
                        }}
                        data-testid="doctype-delete"
                      >
                        <Trash2 size={13} /> Delete
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={submit}
                      loading={create.isPending || patch.isPending}
                      data-testid="doctype-save"
                    >
                      <Save size={14} /> Save
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Panel>
      </div>

      {showWizard && (
        <LearnWizard onClose={() => setShowWizard(false)} />
      )}

      {thresholdTarget && (
        <ThresholdsModal
          docType={thresholdTarget}
          onClose={() => setThresholdTarget(null)}
          onSave={(id, autofill_floor, high_confidence) => {
            patch.mutate({ id, body: { autofill_floor, high_confidence } as Partial<DocumentTypeInput> });
            setThresholdTarget(null);
          }}
        />
      )}
    </>
  );
}

// ── Thresholds modal ──────────────────────────────────────────────────────────

function ThresholdsModal({
  docType,
  onClose,
  onSave,
}: {
  docType: DocumentType;
  onClose: () => void;
  onSave: (id: number, autofill_floor: number, high_confidence: number) => void;
}) {
  const [autofill, setAutofill] = useState(
    Math.round((docType.autofill_floor ?? 0.4) * 100),
  );
  const [highConf, setHighConf] = useState(
    Math.round((docType.high_confidence ?? 0.7) * 100),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="thresholds-modal-title"
    >
      <div
        className="w-full max-w-sm rounded-card bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-divider">
          <h2 id="thresholds-modal-title" className="text-md font-semibold text-ink inline-flex items-center gap-2">
            <Settings2 size={14} className="text-brand-blue" />
            Confidence thresholds — {docType.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-divider"
          >
            <X size={14} />
          </button>
        </header>

        <div className="p-4 space-y-4">
          {/* AI auto-fill floor slider */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor="thresholds-autofill" className="text-xs font-medium text-ink">AI auto-fill floor</label>
              <span className="text-xs font-mono text-brand-blue w-9 text-right" aria-live="polite">{autofill}%</span>
            </div>
            <input
              id="thresholds-autofill"
              type="range"
              min={0}
              max={100}
              step={1}
              value={autofill}
              onChange={(e) => setAutofill(parseInt(e.target.value, 10))}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={autofill}
              aria-label="AI auto-fill floor"
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand-blue bg-divider"
              data-testid="thresholds-autofill-slider"
            />
            <p className="text-[10px] text-muted">Fields below this confidence won't auto-fill into Capture.</p>
          </div>

          {/* High-confidence threshold slider */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor="thresholds-high" className="text-xs font-medium text-ink">High-confidence threshold</label>
              <span className="text-xs font-mono text-brand-blue w-9 text-right" aria-live="polite">{highConf}%</span>
            </div>
            <input
              id="thresholds-high"
              type="range"
              min={0}
              max={100}
              step={1}
              value={highConf}
              onChange={(e) => setHighConf(parseInt(e.target.value, 10))}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={highConf}
              aria-label="High-confidence threshold"
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand-blue bg-divider"
              data-testid="thresholds-high-slider"
            />
            <p className="text-[10px] text-muted">Fields above this skip the 'verify' pill in Capture.</p>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-divider bg-page">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => onSave(docType.id, autofill / 100, highConf / 100)}
            data-testid="thresholds-save"
          >
            <Save size={13} /> Save
          </Button>
        </footer>
      </div>
    </div>
  );
}

function FieldEditor({
  index,
  field,
  onChange,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  index: number;
  field: FieldDef;
  onChange: (patch: Partial<FieldDef>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <div
      className="rounded-card border border-divider p-2 grid grid-cols-12 gap-2 items-end"
      data-testid={`doctype-field-${index}`}
    >
      <div className="col-span-12 md:col-span-3">
        <label className="flex flex-col text-[11px] text-muted">
          Key
          <input
            value={field.key}
            onChange={(e) => onChange({ key: e.target.value.toLowerCase() })}
            placeholder="customer_cid"
            data-testid={`doctype-field-${index}-key`}
            className="mt-0.5 h-8 rounded-input border border-border px-2 text-md font-mono text-ink"
          />
        </label>
      </div>
      <div className="col-span-12 md:col-span-3">
        <label className="flex flex-col text-[11px] text-muted">
          Label
          <input
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Customer CID"
            data-testid={`doctype-field-${index}-label`}
            className="mt-0.5 h-8 rounded-input border border-border px-2 text-md text-ink"
          />
        </label>
      </div>
      <div className="col-span-6 md:col-span-2">
        <label className="flex flex-col text-[11px] text-muted">
          Type
          <select
            value={field.type}
            onChange={(e) => onChange({ type: e.target.value as FieldDef['type'] })}
            data-testid={`doctype-field-${index}-type`}
            className="mt-0.5 h-8 rounded-input border border-border px-2 text-md text-ink"
          >
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <div className="col-span-6 md:col-span-2">
        <label className="flex flex-col text-[11px] text-muted">
          AI extract
          <select
            value={field.ai_extract_from ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                const { ai_extract_from: _omit, ...rest } = field;
                void _omit;
                onChange({ ...rest, ai_extract_from: undefined });
              } else {
                onChange({ ai_extract_from: v as FieldDef['ai_extract_from'] });
              }
            }}
            data-testid={`doctype-field-${index}-ai`}
            className="mt-0.5 h-8 rounded-input border border-border px-2 text-md text-ink"
          >
            <option value="">— none —</option>
            {AI_EXTRACT_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </div>
      <div className="col-span-6 md:col-span-1 flex items-center justify-center pt-2">
        <label className="inline-flex items-center gap-1 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={!!field.required}
            onChange={(e) => onChange({ required: e.target.checked })}
            data-testid={`doctype-field-${index}-required`}
          />
          Req
        </label>
      </div>
      <div className="col-span-6 md:col-span-1 flex items-center justify-end gap-0.5 pt-3">
        <button
          type="button"
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
          aria-label="Move up"
          className="w-6 h-6 rounded flex items-center justify-center text-muted hover:text-ink disabled:opacity-30"
        >
          <ArrowUp size={12} />
        </button>
        <button
          type="button"
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
          aria-label="Move down"
          className="w-6 h-6 rounded flex items-center justify-center text-muted hover:text-ink disabled:opacity-30"
        >
          <ArrowDown size={12} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove field"
          data-testid={`doctype-field-${index}-delete`}
          className="w-6 h-6 rounded flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
