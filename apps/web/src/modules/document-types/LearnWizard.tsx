/**
 * LearnWizard — "Learn from samples" multi-step modal wizard.
 *
 * Step 1: Drop 3–10 files (PDF/JPEG/PNG/WEBP/TIFF, max 25 MB each).
 * Step 2: Analysing samples… (POST /spa/api/docbrain/doctypes/infer).
 * Step 3: Editable schema card with proposed name/description/fields.
 * Step 4: Save as draft vs Publish live (POST /spa/api/docbrain/doctypes/commit).
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  X,
  FileText,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Plus,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { HttpError } from '@/lib/http';
import {
  AI_EXTRACT_KEYS,
  FIELD_TYPES,
  commitDoctype,
  inferDoctype,
  type CommitRequest,
  type FieldDef,
  type InferResponse,
  type InferredField,
} from './api';

const WIZARD_ALLOWED = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
];
const WIZARD_MAX_BYTES = 25 * 1024 * 1024;
const WIZARD_MIN_FILES = 3;
const WIZARD_MAX_FILES = 10;

type WizardStep = 1 | 2 | 3 | 4;

function inferredToFieldDef(f: InferredField): FieldDef {
  const base: FieldDef = {
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
  };
  if (f.ai_extract_from) {
    return { ...base, ai_extract_from: f.ai_extract_from };
  }
  return base;
}

interface DraftSchema {
  name: string;
  description: string;
  fields: InferredField[];
}

export function LearnWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<WizardStep>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [dropError, setDropError] = useState<string | null>(null);
  const [inferResult, setInferResult] = useState<InferResponse | null>(null);
  const [draft, setDraft] = useState<DraftSchema>({ name: '', description: '', fields: [] });
  const [commitErr, setCommitErr] = useState<string | null>(null);
  const [committed, setCommitted] = useState<{ schema_id: number; samples_saved: number; vectors_indexed: number } | null>(null);
  // Confidence threshold state (stored as 0–1, displayed as 0–100%)
  const [autofillFloor, setAutofillFloor] = useState(40);
  const [highConfidence, setHighConfidence] = useState(70);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  // Focus trap: focus the modal on mount
  useEffect(() => {
    firstFocusRef.current?.focus();
  }, []);

  // Keyboard: Escape closes
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const inferMutation = useMutation({
    mutationFn: inferDoctype,
    onSuccess: (res) => {
      setInferResult(res);
      setDraft({
        name: res.name,
        description: res.description,
        fields: res.fields,
      });
      setStep(3);
    },
    onError: (e: unknown) => {
      const msg = e instanceof HttpError ? e.message : (e as Error).message;
      setDropError(msg);
      setStep(1);
    },
  });

  const commitMutation = useMutation({
    mutationFn: ({ payload, files }: { payload: CommitRequest; files: File[] }) =>
      commitDoctype(payload, files),
    onSuccess: (r) => {
      setCommitted(r);
      void qc.invalidateQueries({ queryKey: ['document-types'] });
      setStep(4);
    },
    onError: (e: unknown) => {
      setCommitErr(e instanceof HttpError ? e.message : (e as Error).message);
    },
  });

  const addFiles = (incoming: File[]) => {
    setDropError(null);
    const valid = incoming.filter((f) => WIZARD_ALLOWED.includes(f.type) && f.size <= WIZARD_MAX_BYTES);
    if (valid.length === 0) {
      setDropError('No valid files. Supported: PDF, JPEG, PNG, WEBP, TIFF — max 25 MB each.');
      return;
    }
    setFiles((prev) => {
      const combined = [...prev, ...valid];
      if (combined.length > WIZARD_MAX_FILES) {
        setDropError(`Maximum ${WIZARD_MAX_FILES} files allowed.`);
        return prev;
      }
      return combined;
    });
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files));
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startAnalysis = () => {
    if (files.length < WIZARD_MIN_FILES) {
      setDropError(`Drop at least ${WIZARD_MIN_FILES} samples.`);
      return;
    }
    setDropError(null);
    setStep(2);
    inferMutation.mutate(files);
  };

  const updateField = (idx: number, patch: Partial<InferredField>) => {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    }));
  };

  const removeField = (idx: number) =>
    setDraft((d) => ({ ...d, fields: d.fields.filter((_, i) => i !== idx) }));

  const addField = () =>
    setDraft((d) => ({
      ...d,
      fields: [
        ...d.fields,
        {
          key: '',
          label: '',
          type: 'text' as const,
          required: false,
        },
      ],
    }));

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

  const commit = (status: 'draft' | 'live') => {
    setCommitErr(null);
    commitMutation.mutate({
      payload: {
        name: draft.name.trim(),
        description: draft.description || undefined,
        fields: draft.fields
          .map((f) => inferredToFieldDef(f))
          .filter((f) => f.key && f.label),
        inference_status: status,
        per_sample: inferResult?.per_sample,
        autofill_floor: autofillFloor / 100,
        high_confidence: highConfidence / 100,
      },
      files,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-labelledby="learn-wizard-title"
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-card bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-divider">
          <h2 id="learn-wizard-title" className="text-md font-semibold text-ink inline-flex items-center gap-2">
            <Sparkles size={15} className="text-brand-blue" />
            Learn from samples
            <span className="text-xs font-normal text-muted ml-1">Step {step} of 4</span>
          </h2>
          <button
            ref={firstFocusRef}
            type="button"
            onClick={onClose}
            aria-label="Close wizard"
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-divider"
            data-testid="learn-wizard-close"
          >
            <X size={14} />
          </button>
        </header>

        {/* Step indicators */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-divider bg-raised text-xs text-muted">
          {(['Drop files', 'Analysing', 'Review schema', 'Save'] as const).map((label, i) => {
            const s = (i + 1) as WizardStep;
            return (
              <span
                key={s}
                className={cn(
                  'inline-flex items-center gap-1',
                  step === s ? 'text-brand-blue font-medium' : step > s ? 'text-success' : '',
                )}
              >
                {step > s ? <CheckCircle2 size={11} /> : null}
                {label}
                {i < 3 && <span className="mx-1 text-divider">›</span>}
              </span>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {step === 1 && (
            <Step1
              files={files}
              dropError={dropError}
              fileInputRef={fileInputRef}
              onDrop={onDrop}
              onInputChange={onInputChange}
              onRemoveFile={removeFile}
              onNext={startAnalysis}
            />
          )}
          {step === 2 && (
            <Step2
              files={files}
              perSample={inferResult?.per_sample ?? []}
              isPending={inferMutation.isPending}
            />
          )}
          {step === 3 && inferResult && (
            <Step3
              draft={draft}
              inferResult={inferResult}
              commitErr={commitErr}
              isCommitting={commitMutation.isPending}
              autofillFloor={autofillFloor}
              highConfidence={highConfidence}
              onAutofillFloorChange={setAutofillFloor}
              onHighConfidenceChange={setHighConfidence}
              onUpdateName={(v) => setDraft((d) => ({ ...d, name: v }))}
              onUpdateDesc={(v) => setDraft((d) => ({ ...d, description: v }))}
              onUpdateField={updateField}
              onRemoveField={removeField}
              onAddField={addField}
              onMoveField={moveField}
              onCommit={commit}
            />
          )}
          {step === 4 && committed && (
            <Step4 result={committed} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 1 — Dropzone ─────────────────────────────────────────────────────────

function Step1({
  files,
  dropError,
  fileInputRef,
  onDrop,
  onInputChange,
  onRemoveFile,
  onNext,
}: {
  files: File[];
  dropError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onDrop: (e: React.DragEvent<HTMLLabelElement>) => void;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (idx: number) => void;
  onNext: () => void;
}) {
  return (
    <div className="p-5 space-y-4">
      <p className="text-sm text-muted">
        Drop {WIZARD_MIN_FILES}–{WIZARD_MAX_FILES} sample documents of the same type.
        The AI will infer a field schema from them.
      </p>

      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed',
          'border-border bg-page hover:border-brand-blue hover:bg-brand-skyLight transition-colors cursor-pointer',
          'py-8 px-6 text-center',
          files.length > 0 && 'border-brand-blue/50',
        )}
        aria-label="Drop sample files here or click to browse"
        data-testid="learn-wizard-dropzone"
      >
        <Upload size={24} className="text-brand-blue" />
        <p className="text-md font-medium text-ink">Drop samples here or click to browse</p>
        <p className="text-xs text-muted">PDF, JPEG, PNG, WEBP, TIFF · max 25 MB each · {WIZARD_MIN_FILES}–{WIZARD_MAX_FILES} files</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          accept={WIZARD_ALLOWED.join(',')}
          onChange={onInputChange}
          aria-label="Select sample files"
          data-testid="learn-wizard-file-input"
        />
      </label>

      {dropError && (
        <div className="flex items-center gap-2 rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger" data-testid="learn-wizard-drop-error">
          <AlertCircle size={13} /> {dropError}
        </div>
      )}

      {files.length > 0 && (
        <ul className="space-y-1.5" data-testid="learn-wizard-file-list">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-input border border-divider px-3 py-1.5 bg-white text-xs">
              <FileText size={12} className="text-brand-blue shrink-0" />
              <span className="flex-1 truncate text-ink">{f.name}</span>
              <span className="text-muted shrink-0">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button
                type="button"
                onClick={() => onRemoveFile(i)}
                aria-label={`Remove ${f.name}`}
                className="text-muted hover:text-danger"
                data-testid={`learn-wizard-remove-${i}`}
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-muted">
          {files.length} / {WIZARD_MAX_FILES} files selected
          {files.length < WIZARD_MIN_FILES && ` (need at least ${WIZARD_MIN_FILES})`}
        </span>
        <Button
          size="sm"
          onClick={onNext}
          disabled={files.length < WIZARD_MIN_FILES}
          data-testid="learn-wizard-next-1"
        >
          <Sparkles size={13} /> Analyse samples
        </Button>
      </div>
    </div>
  );
}

// ── Step 2 — Loading ──────────────────────────────────────────────────────────

function Step2({
  files,
  perSample,
  isPending,
}: {
  files: File[];
  perSample: Array<{ filename: string; ocr_backend?: string | undefined; confidence?: number | undefined }>;
  isPending: boolean;
}) {
  return (
    <div className="p-5 space-y-4" data-testid="learn-wizard-step2">
      <div className="flex items-center gap-3 rounded-card border border-brand-blue/30 bg-brand-skyLight/40 px-4 py-3">
        <Sparkles size={18} className={cn('text-brand-blue', isPending && 'animate-pulse')} />
        <div>
          <p className="text-md font-medium text-ink">Analysing samples…</p>
          <p className="text-xs text-muted mt-0.5">
            Running OCR + field extraction on {files.length} file{files.length === 1 ? '' : 's'}.
            This may take up to 2 minutes.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {files.map((f, i) => {
          const result = perSample.find((s) => s.filename === f.name);
          return (
            <li key={i} className="flex items-center gap-3 rounded-input border border-divider px-3 py-2 bg-white text-xs">
              <FileText size={12} className="text-brand-blue shrink-0" />
              <span className="flex-1 truncate text-ink">{f.name}</span>
              {result ? (
                <div className="flex items-center gap-2">
                  {result.ocr_backend && (
                    <Badge tone="purple" className="normal-case">{result.ocr_backend}</Badge>
                  )}
                  {result.confidence != null && (
                    <Badge tone={result.confidence >= 0.7 ? 'success' : 'warning'}>
                      {Math.round(result.confidence * 100)}%
                    </Badge>
                  )}
                  <CheckCircle2 size={12} className="text-success" />
                </div>
              ) : (
                <span className="text-muted animate-pulse">Processing…</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Step 3 — Edit proposed schema ─────────────────────────────────────────────

function ConfidenceSlider({
  id,
  label,
  value,
  onChange,
  helpText,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  helpText: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs text-ink font-medium">{label}</label>
        <span className="text-xs font-mono text-brand-blue w-9 text-right" aria-live="polite">{value}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={label}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand-blue bg-divider"
        data-testid={id}
      />
      <p className="text-[10px] text-muted">{helpText}</p>
    </div>
  );
}

function Step3({
  draft,
  inferResult,
  commitErr,
  isCommitting,
  autofillFloor,
  highConfidence,
  onAutofillFloorChange,
  onHighConfidenceChange,
  onUpdateName,
  onUpdateDesc,
  onUpdateField,
  onRemoveField,
  onAddField,
  onMoveField,
  onCommit,
}: {
  draft: DraftSchema;
  inferResult: InferResponse;
  commitErr: string | null;
  isCommitting: boolean;
  autofillFloor: number;
  highConfidence: number;
  onAutofillFloorChange: (v: number) => void;
  onHighConfidenceChange: (v: number) => void;
  onUpdateName: (v: string) => void;
  onUpdateDesc: (v: string) => void;
  onUpdateField: (idx: number, patch: Partial<InferredField>) => void;
  onRemoveField: (idx: number) => void;
  onAddField: () => void;
  onMoveField: (idx: number, dir: -1 | 1) => void;
  onCommit: (status: 'draft' | 'live') => void;
}) {
  const [thresholdsOpen, setThresholdsOpen] = useState(false);

  return (
    <div className="p-5 space-y-4" data-testid="learn-wizard-step3">
      {/* Confidence badge */}
      <div className="flex items-center gap-3">
        <Badge tone={inferResult.confidence >= 0.7 ? 'success' : 'warning'} data-testid="learn-wizard-confidence">
          <Sparkles size={10} className="inline mr-1" />
          AI confidence: {Math.round(inferResult.confidence * 100)}%
        </Badge>
        <span className="text-xs text-muted">
          {inferResult.total_samples} sample{inferResult.total_samples === 1 ? '' : 's'} analysed
        </span>
      </div>

      {/* Confidence thresholds collapsible */}
      <div className="rounded-card border border-divider overflow-hidden" data-testid="learn-wizard-thresholds">
        <button
          type="button"
          onClick={() => setThresholdsOpen((o) => !o)}
          aria-expanded={thresholdsOpen}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-ink bg-raised hover:bg-divider/60 transition-colors"
          data-testid="learn-wizard-thresholds-toggle"
        >
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={11} className="text-brand-blue" />
            Confidence thresholds
          </span>
          {thresholdsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {thresholdsOpen && (
          <div className="px-3 pb-3 pt-2 space-y-3 border-t border-divider bg-page">
            <ConfidenceSlider
              id="learn-wizard-autofill-floor"
              label="AI auto-fill floor"
              value={autofillFloor}
              onChange={onAutofillFloorChange}
              helpText="Fields below this confidence won't auto-fill into Capture."
            />
            <ConfidenceSlider
              id="learn-wizard-high-confidence"
              label="High-confidence threshold"
              value={highConfidence}
              onChange={onHighConfidenceChange}
              helpText="Fields above this skip the 'verify' pill in Capture."
            />
          </div>
        )}
      </div>

      {/* Name + description */}
      <label className="flex flex-col text-xs text-muted">
        Document type name
        <input
          value={draft.name}
          onChange={(e) => onUpdateName(e.target.value)}
          className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
          data-testid="learn-wizard-name"
          aria-label="Document type name"
        />
      </label>

      <label className="flex flex-col text-xs text-muted">
        Description
        <input
          value={draft.description}
          onChange={(e) => onUpdateDesc(e.target.value)}
          placeholder="Short description (optional)"
          className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
          data-testid="learn-wizard-description"
          aria-label="Document type description"
        />
      </label>

      {/* Fields list */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted font-medium">Proposed fields ({draft.fields.length})</span>
          <button
            type="button"
            onClick={onAddField}
            className="text-xs text-brand-blue hover:underline inline-flex items-center gap-1"
            data-testid="learn-wizard-add-field"
            aria-label="Add field"
          >
            <Plus size={11} /> Add field
          </button>
        </div>
        <div className="space-y-2" role="list" aria-label="Proposed fields">
          {draft.fields.map((f, i) => (
            <WizardFieldRow
              key={i}
              index={i}
              field={f}
              totalSamples={inferResult.total_samples}
              onChange={(p) => onUpdateField(i, p)}
              onRemove={() => onRemoveField(i)}
              onMove={(dir) => onMoveField(i, dir)}
              canMoveUp={i > 0}
              canMoveDown={i < draft.fields.length - 1}
            />
          ))}
        </div>
      </div>

      {commitErr && (
        <p className="rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger break-all" data-testid="learn-wizard-commit-error">
          {commitErr}
        </p>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onCommit('draft')}
          loading={isCommitting}
          data-testid="learn-wizard-save-draft"
        >
          Save as draft
        </Button>
        <Button
          size="sm"
          onClick={() => onCommit('live')}
          loading={isCommitting}
          data-testid="learn-wizard-publish"
        >
          <CheckCircle2 size={13} /> Publish live
        </Button>
      </div>
    </div>
  );
}

function WizardFieldRow({
  index,
  field,
  totalSamples,
  onChange,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  index: number;
  field: InferredField;
  totalSamples: number;
  onChange: (patch: Partial<InferredField>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const seenLabel =
    field.seen_in_samples != null
      ? `seen in ${field.seen_in_samples}/${totalSamples} samples`
      : null;

  return (
    <div
      className="rounded-card border border-divider p-2.5 space-y-2"
      role="listitem"
      data-testid={`learn-wizard-field-${index}`}
    >
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-12 md:col-span-3">
          <label className="flex flex-col text-[11px] text-muted">
            Key
            <input
              value={field.key}
              onChange={(e) => onChange({ key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
              placeholder="field_key"
              className="mt-0.5 h-8 rounded-input border border-border px-2 text-md font-mono text-ink"
              aria-label={`Field ${index + 1} key`}
            />
          </label>
        </div>
        <div className="col-span-12 md:col-span-3">
          <label className="flex flex-col text-[11px] text-muted">
            Label
            <input
              value={field.label}
              onChange={(e) => onChange({ label: e.target.value })}
              placeholder="Display label"
              className="mt-0.5 h-8 rounded-input border border-border px-2 text-md text-ink"
              aria-label={`Field ${index + 1} label`}
            />
          </label>
        </div>
        <div className="col-span-6 md:col-span-2">
          <label className="flex flex-col text-[11px] text-muted">
            Type
            <select
              value={field.type}
              onChange={(e) => onChange({ type: e.target.value as FieldDef['type'] })}
              className="mt-0.5 h-8 rounded-input border border-border px-2 text-md text-ink"
              aria-label={`Field ${index + 1} type`}
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
                onChange({ ai_extract_from: v ? (v as FieldDef['ai_extract_from']) : undefined });
              }}
              className="mt-0.5 h-8 rounded-input border border-border px-2 text-md text-ink"
              aria-label={`Field ${index + 1} AI extract source`}
            >
              <option value="">— none —</option>
              {AI_EXTRACT_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
        </div>
        <div className="col-span-6 md:col-span-1 flex items-center justify-center pt-3">
          <label className="inline-flex items-center gap-1 text-[11px] text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={(e) => onChange({ required: e.target.checked })}
              aria-label={`Field ${index + 1} required`}
            />
            Req
          </label>
        </div>
        <div className="col-span-6 md:col-span-1 flex items-center justify-end gap-0.5 pt-3">
          <button
            type="button"
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
            aria-label="Move field up"
            className="w-6 h-6 rounded flex items-center justify-center text-muted hover:text-ink disabled:opacity-30"
          >
            <ArrowUp size={11} />
          </button>
          <button
            type="button"
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
            aria-label="Move field down"
            className="w-6 h-6 rounded flex items-center justify-center text-muted hover:text-ink disabled:opacity-30"
          >
            <ArrowDown size={11} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove field ${index + 1}`}
            className="w-6 h-6 rounded flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg"
            data-testid={`learn-wizard-field-${index}-delete`}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      {seenLabel && (
        <p className="text-[10px] text-muted">{seenLabel}</p>
      )}
    </div>
  );
}

// ── Step 4 — Done ─────────────────────────────────────────────────────────────

function Step4({
  result,
  onClose,
}: {
  result: { schema_id: number; samples_saved: number; vectors_indexed: number };
  onClose: () => void;
}) {
  return (
    <div className="p-6 space-y-4 text-center" data-testid="learn-wizard-step4">
      <CheckCircle2 size={36} className="mx-auto text-success" />
      <h3 className="text-md font-semibold text-ink">Schema created</h3>
      <p className="text-sm text-muted">
        Schema ID #{result.schema_id} · {result.samples_saved} sample{result.samples_saved === 1 ? '' : 's'} saved
        · {result.vectors_indexed} vectors indexed
      </p>
      <Button onClick={onClose} data-testid="learn-wizard-done">
        Done
      </Button>
    </div>
  );
}
