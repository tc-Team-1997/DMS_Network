/**
 * LearnWizard — 6-step "Learn from samples" modal wizard (v2).
 *
 * Step 1: Pick template  — choose a base template or "Start blank"
 * Step 2: Drop samples   — drop 3–10 PDF/image files
 * Step 3: AI inference   — POST /spa/api/docbrain/doctypes/infer
 *                          Confidence sliders are EXPANDED by default
 * Step 4: Visual labeler — BboxLabeler for the first sample PDF
 * Step 5: Test pass      — POST /spa/api/docbrain/doctypes/commit (draft)
 *                          then POST /test-thresholds against the first sample
 * Step 6: Publish        — commit as live
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  FlaskConical,
  Sparkles,
  Trash2,
  Upload,
  X,
  Plus,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { HttpError } from '@/lib/http';
import {
  AI_EXTRACT_KEYS,
  FIELD_TYPES,
  commitDoctype,
  inferDoctype,
  listVersions,
  type CommitRequest,
  type CommitResponse,
  type FieldDef,
  type InferResponse,
  type InferredField,
} from './api';
import { BboxLabeler } from './components/BboxLabeler';

// ── constants ─────────────────────────────────────────────────────────────────

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

const STEP_LABELS = [
  'Pick template',
  'Drop samples',
  'AI inference',
  'Visual labeler',
  'Test pass',
  'Publish',
] as const;

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

// ── built-in templates ────────────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  description: string;
  fields: FieldDef[];
}

const BUILT_IN_TEMPLATES: Template[] = [
  {
    id: 'national_id',
    name: 'National ID',
    description: 'Egyptian national ID card',
    fields: [
      { key: 'customer_cid',       label: 'CID',              type: 'text',   required: true,  ai_extract_from: 'customer_cid' },
      { key: 'customer_name',      label: 'Name',             type: 'text',   required: true,  ai_extract_from: 'customer_name' },
      { key: 'dob',                label: 'Date of birth',    type: 'date',   required: true,  ai_extract_from: 'dob' },
      { key: 'address',            label: 'Address',          type: 'textarea', required: false, ai_extract_from: 'address' },
    ],
  },
  {
    id: 'passport',
    name: 'Passport',
    description: 'International travel passport',
    fields: [
      { key: 'doc_number',         label: 'Passport number',  type: 'text',   required: true,  ai_extract_from: 'doc_number' },
      { key: 'customer_name',      label: 'Name',             type: 'text',   required: true,  ai_extract_from: 'customer_name' },
      { key: 'dob',                label: 'Date of birth',    type: 'date',   required: true,  ai_extract_from: 'dob' },
      { key: 'issue_date',         label: 'Issue date',       type: 'date',   required: false, ai_extract_from: 'issue_date' },
      { key: 'expiry_date',        label: 'Expiry date',      type: 'date',   required: true,  ai_extract_from: 'expiry_date' },
      { key: 'issuing_authority',  label: 'Issuing authority', type: 'text',  required: false, ai_extract_from: 'issuing_authority' },
    ],
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'Start with no pre-filled fields',
    fields: [],
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── component ─────────────────────────────────────────────────────────────────

export function LearnWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dropError, setDropError] = useState<string | null>(null);
  const [inferResult, setInferResult] = useState<InferResponse | null>(null);
  const [draft, setDraft] = useState<DraftSchema>({ name: '', description: '', fields: [] });
  const [commitErr, setCommitErr] = useState<string | null>(null);
  const [draftCommit, setDraftCommit] = useState<CommitResponse | null>(null);
  const [finalCommit, setFinalCommit] = useState<CommitResponse | null>(null);
  // Confidence thresholds — EXPANDED by default (thresholdsOpen starts true)
  const [thresholdsOpen, setThresholdsOpen] = useState(true);
  const [autofillFloor, setAutofillFloor] = useState(40);
  const [highConfidence, setHighConfidence] = useState(70);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { firstFocusRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const inferMutation = useMutation({
    mutationFn: inferDoctype,
    onSuccess: (res) => {
      setInferResult(res);
      // Merge inferred fields with template fields (template wins on key clash)
      const templateKeys = new Set((selectedTemplate?.fields ?? []).map((f) => f.key));
      const mergedFields: InferredField[] = [
        ...(selectedTemplate?.fields ?? []).map((f) => ({ ...f, seen_in_samples: undefined, total_samples: undefined })),
        ...res.fields.filter((f) => !templateKeys.has(f.key)),
      ];
      setDraft({
        name: res.name || selectedTemplate?.name || '',
        description: res.description || selectedTemplate?.description || '',
        fields: mergedFields,
      });
      setStep(3);
    },
    onError: (e: unknown) => {
      const msg = e instanceof HttpError ? e.message : (e as Error).message;
      setDropError(msg);
      setStep(2);
    },
  });

  const commitDraftMutation = useMutation({
    mutationFn: (payload: { payload: CommitRequest; files: File[] }) =>
      commitDoctype(payload.payload, payload.files),
    onSuccess: (r) => {
      setDraftCommit(r);
      void qc.invalidateQueries({ queryKey: ['document-types'] });
      setStep(4);
    },
    onError: (e: unknown) => {
      setCommitErr(e instanceof HttpError ? e.message : (e as Error).message);
    },
  });

  const commitLiveMutation = useMutation({
    mutationFn: (payload: { payload: CommitRequest; files: File[] }) =>
      commitDoctype(payload.payload, payload.files),
    onSuccess: (r) => {
      setFinalCommit(r);
      void qc.invalidateQueries({ queryKey: ['document-types'] });
      setStep(6);
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
    inferMutation.mutate(files);
  };

  const updateField = (idx: number, p: Partial<InferredField>) => {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f, i) => (i === idx ? { ...f, ...p } : f)),
    }));
  };

  const removeField = (idx: number) =>
    setDraft((d) => ({ ...d, fields: d.fields.filter((_, i) => i !== idx) }));

  const addField = () =>
    setDraft((d) => ({
      ...d,
      fields: [...d.fields, { key: '', label: '', type: 'text' as const, required: false }],
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

  const commitAsDraft = () => {
    setCommitErr(null);
    commitDraftMutation.mutate({
      payload: {
        name: draft.name.trim(),
        ...(draft.description ? { description: draft.description } : {}),
        fields: draft.fields.map(inferredToFieldDef).filter((f) => f.key && f.label),
        inference_status: 'draft',
        per_sample: inferResult?.per_sample,
        autofill_floor: autofillFloor / 100,
        high_confidence: highConfidence / 100,
      },
      files,
    });
  };

  const commitAsLive = () => {
    setCommitErr(null);
    commitLiveMutation.mutate({
      payload: {
        name: draft.name.trim(),
        ...(draft.description ? { description: draft.description } : {}),
        fields: draft.fields.map(inferredToFieldDef).filter((f) => f.key && f.label),
        inference_status: 'live',
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
        className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-card bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-divider">
          <h2 id="learn-wizard-title" className="text-md font-semibold text-ink inline-flex items-center gap-2">
            <Sparkles size={15} className="text-brand-blue" />
            Learn from samples
            <span className="text-xs font-normal text-muted ml-1">
              Step {step} of {STEP_LABELS.length}
            </span>
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
        <div className="flex items-center gap-1 px-5 py-2 border-b border-divider bg-raised text-xs text-muted overflow-x-auto">
          {STEP_LABELS.map((label, i) => {
            const s = (i + 1) as WizardStep;
            return (
              <span
                key={s}
                className={cn(
                  'inline-flex items-center gap-0.5 shrink-0',
                  step === s ? 'text-brand-blue font-medium' : step > s ? 'text-success' : '',
                )}
              >
                {step > s ? <CheckCircle2 size={10} /> : null}
                {label}
                {i < STEP_LABELS.length - 1 && (
                  <ChevronRight size={10} className="text-divider mx-0.5" />
                )}
              </span>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {step === 1 && (
            <StepPickTemplate
              selected={selectedTemplate}
              onSelect={setSelectedTemplate}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <StepDropSamples
              files={files}
              dropError={dropError}
              fileInputRef={fileInputRef}
              isPending={inferMutation.isPending}
              onDrop={onDrop}
              onInputChange={onInputChange}
              onRemoveFile={removeFile}
              onBack={() => setStep(1)}
              onNext={startAnalysis}
            />
          )}
          {step === 3 && inferResult && (
            <StepAiInference
              draft={draft}
              inferResult={inferResult}
              commitErr={commitErr}
              isCommitting={commitDraftMutation.isPending}
              thresholdsOpen={thresholdsOpen}
              autofillFloor={autofillFloor}
              highConfidence={highConfidence}
              onToggleThresholds={() => setThresholdsOpen((o) => !o)}
              onAutofillFloorChange={setAutofillFloor}
              onHighConfidenceChange={setHighConfidence}
              onUpdateName={(v) => setDraft((d) => ({ ...d, name: v }))}
              onUpdateDesc={(v) => setDraft((d) => ({ ...d, description: v }))}
              onUpdateField={updateField}
              onRemoveField={removeField}
              onAddField={addField}
              onMoveField={moveField}
              onNext={commitAsDraft}
              onBack={() => setStep(2)}
            />
          )}
          {step === 4 && draftCommit && (
            <StepVisualLabeler
              schemaId={draftCommit.schema_id}
              fieldNames={draft.fields.map((f) => f.key).filter(Boolean)}
              files={files}
              onNext={() => setStep(5)}
              onBack={() => setStep(3)}
            />
          )}
          {step === 5 && draftCommit && (
            <StepTestPass
              draftCommit={draftCommit}
              onNext={commitAsLive}
              onBack={() => setStep(4)}
              isCommitting={commitLiveMutation.isPending}
              commitErr={commitErr}
            />
          )}
          {step === 6 && finalCommit && (
            <StepPublishDone result={finalCommit} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 1 — Pick template ────────────────────────────────────────────────────

function StepPickTemplate({
  selected,
  onSelect,
  onNext,
}: {
  selected: Template | null;
  onSelect: (t: Template) => void;
  onNext: () => void;
}) {
  return (
    <div className="p-5 space-y-4" data-testid="learn-wizard-step1">
      <p className="text-sm text-muted">
        Start from a template or a blank schema. You can override all fields after AI inference.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {BUILT_IN_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t)}
            className={cn(
              'rounded-card border p-3 text-left transition-colors',
              selected?.id === t.id
                ? 'border-brand-blue bg-brand-skyLight'
                : 'border-divider hover:border-brand-blue/50 hover:bg-divider/30',
            )}
            data-testid={`template-${t.id}`}
          >
            <p className="text-xs font-semibold text-ink">{t.name}</p>
            <p className="text-[11px] text-muted mt-0.5">{t.description}</p>
            <p className="text-[10px] text-muted mt-1">{t.fields.length} field{t.fields.length === 1 ? '' : 's'}</p>
          </button>
        ))}
      </div>
      <div className="flex justify-end pt-2">
        <Button
          size="sm"
          onClick={onNext}
          disabled={selected === null}
          data-testid="learn-wizard-next-1"
        >
          Next <ArrowRight size={13} />
        </Button>
      </div>
    </div>
  );
}

// ── Step 2 — Drop samples ─────────────────────────────────────────────────────

function StepDropSamples({
  files,
  dropError,
  fileInputRef,
  isPending,
  onDrop,
  onInputChange,
  onRemoveFile,
  onBack,
  onNext,
}: {
  files: File[];
  dropError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  isPending: boolean;
  onDrop: (e: React.DragEvent<HTMLLabelElement>) => void;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (idx: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="p-5 space-y-4" data-testid="learn-wizard-step2">
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
        <Button size="sm" variant="secondary" onClick={onBack}>Back</Button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">
            {files.length} / {WIZARD_MAX_FILES} files
            {files.length < WIZARD_MIN_FILES && ` (need ≥${WIZARD_MIN_FILES})`}
          </span>
          <Button
            size="sm"
            onClick={onNext}
            disabled={files.length < WIZARD_MIN_FILES}
            loading={isPending}
            data-testid="learn-wizard-next-2"
          >
            <Sparkles size={13} /> Analyse samples
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Step 3 — AI inference ─────────────────────────────────────────────────────

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

function StepAiInference({
  draft,
  inferResult,
  commitErr,
  isCommitting,
  thresholdsOpen,
  autofillFloor,
  highConfidence,
  onToggleThresholds,
  onAutofillFloorChange,
  onHighConfidenceChange,
  onUpdateName,
  onUpdateDesc,
  onUpdateField,
  onRemoveField,
  onAddField,
  onMoveField,
  onNext,
  onBack,
}: {
  draft: DraftSchema;
  inferResult: InferResponse;
  commitErr: string | null;
  isCommitting: boolean;
  thresholdsOpen: boolean;
  autofillFloor: number;
  highConfidence: number;
  onToggleThresholds: () => void;
  onAutofillFloorChange: (v: number) => void;
  onHighConfidenceChange: (v: number) => void;
  onUpdateName: (v: string) => void;
  onUpdateDesc: (v: string) => void;
  onUpdateField: (idx: number, p: Partial<InferredField>) => void;
  onRemoveField: (idx: number) => void;
  onAddField: () => void;
  onMoveField: (idx: number, dir: -1 | 1) => void;
  onNext: () => void;
  onBack: () => void;
}) {
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

      {/* Confidence thresholds — expanded by default */}
      <div className="rounded-card border border-divider overflow-hidden" data-testid="learn-wizard-thresholds">
        <button
          type="button"
          onClick={onToggleThresholds}
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
              label="Low band floor (AI auto-fill)"
              value={autofillFloor}
              onChange={onAutofillFloorChange}
              helpText="Fields below this confidence won't auto-fill into Capture (Low band)."
            />
            <ConfidenceSlider
              id="learn-wizard-high-confidence"
              label="High band floor (skip verify)"
              value={highConfidence}
              onChange={onHighConfidenceChange}
              helpText="Fields above this skip the 'verify' pill in Capture (High band)."
            />
            <p className="text-[10px] text-muted">
              Med band = between Low and High. All three labels visible in Capture.
            </p>
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

      {/* Fields */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted font-medium">
            Proposed fields ({draft.fields.length})
          </span>
          <button
            type="button"
            onClick={onAddField}
            className="text-xs text-brand-blue hover:underline inline-flex items-center gap-1"
            data-testid="learn-wizard-add-field"
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

      <div className="flex justify-between gap-2 pt-2">
        <Button size="sm" variant="secondary" onClick={onBack}>Back</Button>
        <Button
          size="sm"
          onClick={onNext}
          loading={isCommitting}
          data-testid="learn-wizard-save-draft"
        >
          Save draft &amp; Label <ArrowRight size={13} />
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
  onChange: (p: Partial<InferredField>) => void;
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

// ── Step 4 — Visual labeler ───────────────────────────────────────────────────

function StepVisualLabeler({
  schemaId,
  fieldNames,
  files,
  onNext,
  onBack,
}: {
  schemaId: number;
  fieldNames: string[];
  files: File[];
  onNext: () => void;
  onBack: () => void;
}) {
  // Find the first PDF sample — if none, skip labeling with a notice.
  const firstPdf = files.find((f) => f.type === 'application/pdf');

  // Use useQuery to get the live version id for this new schema
  const versionsQuery = useQuery({
    queryKey: ['doctype-versions', schemaId],
    queryFn: () => listVersions(schemaId),
    retry: 1,
  });

  const draftVersion = versionsQuery.data?.find((v) => v.status === 'draft' || v.status === 'live');

  const pdfUrl = firstPdf
    ? `/spa/api/docbrain/doctypes/${schemaId}/samples/1/pdf`
    : null;

  return (
    <div className="p-5 space-y-4" data-testid="learn-wizard-step4">
      <p className="text-sm text-muted">
        Draw bounding boxes around fields in the first sample PDF.
        This helps DocBrain locate fields spatially for faster extraction.
        You can skip this step and label later.
      </p>

      {!firstPdf && (
        <div className="flex items-center gap-2 rounded-input bg-raised border border-divider px-3 py-2 text-xs text-muted">
          <AlertCircle size={13} /> No PDF sample was uploaded — visual labeling not available.
          You can add PDF samples later from the Samples tab.
        </div>
      )}

      {firstPdf && pdfUrl && draftVersion && (
        <BboxLabeler
          samplePdfUrl={pdfUrl}
          doctypeId={schemaId}
          versionId={draftVersion.id}
          fieldNames={fieldNames}
        />
      )}

      {firstPdf && versionsQuery.isLoading && (
        <p className="text-xs text-muted animate-pulse">Loading version…</p>
      )}

      <div className="flex justify-between gap-2 pt-2">
        <Button size="sm" variant="secondary" onClick={onBack}>Back</Button>
        <Button
          size="sm"
          onClick={onNext}
          data-testid="learn-wizard-next-4"
        >
          Next: Test pass <ArrowRight size={13} />
        </Button>
      </div>
    </div>
  );
}

// ── Step 5 — Test pass ────────────────────────────────────────────────────────

function StepTestPass({
  draftCommit,
  onNext,
  onBack,
  isCommitting,
  commitErr,
}: {
  draftCommit: CommitResponse;
  onNext: () => void;
  onBack: () => void;
  isCommitting: boolean;
  commitErr: string | null;
}) {
  return (
    <div className="p-5 space-y-4" data-testid="learn-wizard-step5">
      <div className="flex items-center gap-3 rounded-card border border-brand-blue/30 bg-brand-skyLight/40 px-4 py-3">
        <FlaskConical size={18} className="text-brand-blue" />
        <div>
          <p className="text-md font-medium text-ink">Draft saved — ready to test</p>
          <p className="text-xs text-muted mt-0.5">
            Schema #{draftCommit.schema_id} · {draftCommit.samples_saved} sample{draftCommit.samples_saved === 1 ? '' : 's'}
            saved · {draftCommit.vectors_indexed} vectors indexed.
          </p>
        </div>
      </div>

      <p className="text-sm text-muted">
        Review the schema once more, then publish it live. You can run A/B tests later from the
        document type editor.
      </p>

      {commitErr && (
        <p className="rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger" data-testid="learn-wizard-commit-error">
          {commitErr}
        </p>
      )}

      <div className="flex justify-between gap-2 pt-2">
        <Button size="sm" variant="secondary" onClick={onBack}>Back</Button>
        <Button
          size="sm"
          onClick={onNext}
          loading={isCommitting}
          data-testid="learn-wizard-publish"
        >
          <CheckCircle2 size={13} /> Publish live
        </Button>
      </div>
    </div>
  );
}

// ── Step 6 — Done ─────────────────────────────────────────────────────────────

function StepPublishDone({
  result,
  onClose,
}: {
  result: CommitResponse;
  onClose: () => void;
}) {
  return (
    <div className="p-6 space-y-4 text-center" data-testid="learn-wizard-step6">
      <CheckCircle2 size={36} className="mx-auto text-success" />
      <h3 className="text-md font-semibold text-ink">Schema published</h3>
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
