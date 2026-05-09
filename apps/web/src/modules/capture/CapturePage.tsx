/**
 * CapturePage — single-file OR multi-file (up to 25) batch upload.
 *
 * Single file (≤1 file dropped):  original layout preserved exactly.
 * Multi-file (2–25 files dropped): per-card preview + AI scan + editable
 *   metadata, then sequential "Upload all" with per-card progress.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ExternalLink,
  FolderOpen,
  Wand2,
  Eye,
  X,
  RefreshCw,
  Database,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, Input, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { CbsLookupDialog } from '@/modules/cbs/components/CbsLookupDialog';

// ── CBS feature flag ──────────────────────────────────────────────────────
const FF_CBS_LIVE: boolean =
  import.meta.env['VITE_FF_CBS_LIVE'] !== undefined
    ? import.meta.env['VITE_FF_CBS_LIVE'] !== 'false'
    : false;
import {
  fetchFolders,
  previewDocument,
  uploadDocumentWithKey,
  type AutoRouted,
  type Extraction,
  type PreviewResponse,
} from './api';
import { analyzeDocument } from '@/modules/docbrain/api';
import { fetchDocument } from '@/modules/viewer/api';
import {
  classifyOne,
  fetchDocumentTypes,
  type ClassifyOneResponse,
  type DocumentType,
  type FieldDef,
} from '@/modules/document-types/api';
import {
  enqueue as outboxEnqueue,
  isIndexedDbAvailable,
  type EnqueueInput,
} from '@/lib/offline-outbox';

const DEFAULT_AUTOFILL_FLOOR = 0.4;
const DEFAULT_CONFIDENCE_HIGH = 0.7;

/** Module-level fallbacks used in helper sub-components that don't have doctype context. */
const CONFIDENCE_HIGH = DEFAULT_CONFIDENCE_HIGH;
const AUTOFILL_FLOOR  = DEFAULT_AUTOFILL_FLOOR;
const MAX_FILES = 25;

const ALLOWED = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const MAX_BYTES = 50 * 1024 * 1024;
const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

/** Form state is a string dictionary keyed by field.key. */
type FormState = Record<string, string>;

// ── multi-file card state ─────────────────────────────────────────────────

type CardStatus =
  | { tag: 'idle' }
  | { tag: 'scanning' }
  | { tag: 'ready'; preview: PreviewResponse }
  | { tag: 'scan_error'; message: string }
  | { tag: 'uploading' }
  | { tag: 'done'; uploadId: number; autoRouted: AutoRouted | null }
  | { tag: 'upload_error'; message: string };

interface FileCard {
  id: string;
  file: File;
  objectUrl: string;
  form: FormState;
  aiFilled: Record<string, number>;
  manualEdits: Record<string, true>;
  docTypeId: number | null;
  status: CardStatus;
}

function cardUid() {
  return Math.random().toString(36).slice(2, 10);
}

// ── helpers ───────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ── AI pipeline step-progress ─────────────────────────────────────────────

type PipelineStep = 'uploaded' | 'ocr' | 'classify' | 'indexed';
interface PipelineStepDef {
  id: PipelineStep;
  label: string;
}
const PIPELINE_STEPS: PipelineStepDef[] = [
  { id: 'uploaded', label: 'Uploaded' },
  { id: 'ocr',      label: 'OCR Processing' },
  { id: 'classify', label: 'AI Classification' },
  { id: 'indexed',  label: 'Indexed' },
];

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 30_000;

function AiPipelineProgress({
  documentId,
  initialOcr,
  initialDocType,
  initialOcrText,
}: {
  documentId: number;
  initialOcr: number | null;
  initialDocType: string | null;
  initialOcrText: string | null;
}) {
  const [step, setStep] = useState<PipelineStep>(
    initialOcr !== null ? 'indexed' : 'uploaded',
  );
  const [docType, setDocType] = useState<string | null>(initialDocType);
  const [ocr, setOcr] = useState<number | null>(initialOcr);
  const [ocrText] = useState<string | null>(initialOcrText);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  const poll = useCallback(async () => {
    try {
      const doc = await fetchDocument(documentId);
      if (doc.status !== 'captured') {
        setStep('indexed');
        setDocType(doc.doc_type);
        setOcr(doc.ocr_confidence);
        if (pollRef.current !== null) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        return;
      }
      // Advance through steps while still processing
      elapsedRef.current += POLL_INTERVAL_MS;
      if (elapsedRef.current >= 2 * POLL_INTERVAL_MS) setStep('ocr');
      if (elapsedRef.current >= 4 * POLL_INTERVAL_MS) setStep('classify');
      if (elapsedRef.current >= POLL_MAX_MS) {
        setStep('indexed');
        if (pollRef.current !== null) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {
      // ignore poll errors
    }
  }, [documentId]);

  useEffect(() => {
    if (initialOcr !== null) {
      // Already fully processed — no polling needed
      return;
    }
    // Start at OCR step immediately
    setStep('ocr');
    pollRef.current = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, [documentId, initialOcr, poll]);

  const activeIdx = PIPELINE_STEPS.findIndex((s) => s.id === step);

  return (
    <div
      className="rounded-lg border border-brand-blue/30 px-4 py-4 space-y-4 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #0D2B6A 0%, #1a2e6b 30%, #1565C0 70%, #0e4a9a 100%)',
        boxShadow: '0 0 32px 4px rgba(21, 101, 192, 0.22), 0 0 64px 8px rgba(33, 150, 243, 0.09)',
      }}
      data-testid="capture-ai-pipeline"
    >
      {/* Subtle noise texture overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
        }}
        aria-hidden="true"
      />

      <p className="relative text-xs font-semibold text-brand-skyLight flex items-center gap-1.5">
        <Sparkles size={12} className="text-brand-sky" /> AI Processing Pipeline
      </p>

      {/* Step progress bar */}
      <div className="relative flex items-center gap-0">
        {PIPELINE_STEPS.map((s, i) => {
          const isIndexedStep = s.id === 'indexed';
          const done = i < activeIdx || (i === activeIdx && step === 'indexed');
          const active = i === activeIdx && step !== 'indexed';
          const future = i > activeIdx;
          return (
            <div key={s.id} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center flex-shrink-0 relative">
                {/* Animated halo rings — only while this step is active */}
                {active && (
                  <>
                    <span
                      className="absolute rounded-full border border-brand-sky/60 motion-safe:animate-ai-halo-outer"
                      style={{ width: '42px', height: '42px', top: '-7px', left: '-7px' }}
                      aria-hidden="true"
                    />
                    <span
                      className="absolute rounded-full border border-brand-sky/40 motion-safe:animate-ai-halo-inner"
                      style={{ width: '34px', height: '34px', top: '-3px', left: '-3px' }}
                      aria-hidden="true"
                    />
                  </>
                )}
                {/* Sparkle pulse on the indexed (final) node */}
                {done && isIndexedStep && (
                  <span
                    className="absolute -top-1 -right-1 motion-safe:animate-ai-sparkle"
                    aria-hidden="true"
                  >
                    <Sparkles size={10} className="text-success" />
                  </span>
                )}
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all relative z-10',
                    done   && 'bg-success border-success text-white',
                    active && 'bg-brand-sky border-brand-sky text-white',
                    future && 'bg-white/10 border-white/20 text-white/40',
                  )}
                >
                  {done ? <CheckCircle2 size={14} /> : i + 1}
                </div>
                <span
                  className={cn(
                    'mt-1 text-[10px] whitespace-nowrap',
                    done   && 'text-success font-medium',
                    active && 'text-brand-skyLight font-medium',
                    future && 'text-white/40',
                  )}
                >
                  {s.label}
                </span>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div
                  className={cn(
                    'h-0.5 flex-1 mx-1 mb-4 rounded transition-all relative overflow-hidden',
                    i < activeIdx ? 'bg-success/60' : 'bg-white/15',
                  )}
                >
                  {/* Flowing light gradient on traversed connectors */}
                  {i < activeIdx && (
                    <span
                      className="absolute inset-y-0 w-1/2 motion-safe:animate-ai-connector-flow"
                      style={{
                        background: 'linear-gradient(90deg, transparent, rgba(33,150,243,0.8), transparent)',
                      }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Results when indexed */}
      {step === 'indexed' && (
        <div className="relative space-y-2">
          {docType && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-brand-skyLight/70 font-medium">Document type:</span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-medium',
                  ocr !== null && ocr >= 70
                    ? 'bg-success/20 text-success border border-success/30'
                    : 'bg-warning/20 text-warning border border-warning/30',
                )}
              >
                <Sparkles size={10} />
                {docType}
                {ocr !== null && ` — ${ocr.toFixed(0)}% confidence`}
              </span>
            </div>
          )}
          {ocrText && (
            <div>
              <p className="text-xs text-brand-skyLight/70 font-medium mb-1">OCR text preview:</p>
              <p className="text-xs text-white/80 bg-white/5 border border-white/10 rounded-input px-3 py-2 font-mono leading-relaxed line-clamp-3">
                {ocrText.slice(0, 200)}{ocrText.length > 200 ? '…' : ''}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────

export function CapturePage() {
  const folders = useQuery({ queryKey: ['folders'], queryFn: fetchFolders });
  const types = useQuery({
    queryKey: ['document-types', { active: true }],
    queryFn: () => fetchDocumentTypes(true),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLLabelElement>(null);

  // Single-file mode state (kept identical to original)
  const [file, setFile] = useState<File | null>(null);
  const [docTypeId, setDocTypeId] = useState<number | null>(null);
  const [folderId, setFolderId] = useState<string>('');
  const [branch, setBranch] = useState<string>('');
  const [form, setForm] = useState<FormState>({});
  const [aiFilled, setAiFilled] = useState<Record<string, number>>({});
  const [manualEdits, setManualEdits] = useState<Record<string, true>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [lastUploadId, setLastUploadId] = useState<number | null>(null);
  const [lastAutoRouted, setLastAutoRouted] = useState<AutoRouted | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [aiSuggest, setAiSuggest] = useState<ClassifyOneResponse | null>(null);
  const [aiSuggestDismissed, setAiSuggestDismissed] = useState(false);
  const [uploadedDocType, setUploadedDocType] = useState<string | null>(null);
  const [uploadedOcr, setUploadedOcr] = useState<number | null>(null);
  const [uploadedOcrText, setUploadedOcrText] = useState<string | null>(null);

  // Offline queue state
  const [offlineToast, setOfflineToast] = useState<string | null>(null);
  const sessionUser = useAuth((s) => s.user);

  // CBS state
  const cbsRole = useAuth((s) => s.user?.role);
  const [cbsDialogOpen, setCbsDialogOpen] = useState(false);
  // Maker or Doc Admin can pull from CBS
  const canCbs = FF_CBS_LIVE && (cbsRole === 'Maker' || cbsRole === 'Doc Admin');

  // Multi-file mode state
  const [cards, setCards] = useState<FileCard[]>([]);
  const [batchFolderId, setBatchFolderId] = useState<string>('');
  const [batchBranch, setBatchBranch] = useState<string>('');
  const [batchUploading, setBatchUploading] = useState(false);

  const isMulti = cards.length > 0;

  // Default doc type
  useEffect(() => {
    if (docTypeId == null && types.data && types.data.length > 0) {
      setDocTypeId(types.data[0]?.id ?? null);
    }
  }, [docTypeId, types.data]);

  const selectedType = useMemo<DocumentType | null>(
    () => types.data?.find((t) => t.id === docTypeId) ?? null,
    [types.data, docTypeId],
  );

  // Blob URL for single file
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setFileUrl(null); return; }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Revoke object URLs on unmount / cards change
  useEffect(() => {
    return () => {
      for (const c of cards) URL.revokeObjectURL(c.objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── single-file reset ───────────────────────────────────────────────

  const reset = () => {
    setFile(null);
    setForm({});
    setAiFilled({});
    setManualEdits({});
    setValidationErrors([]);
    setPreview(null);
    setClientError(null);
    setLastUploadId(null);
    setLastAutoRouted(null);
    setConfirming(false);
    setFolderId('');
    setBranch('');
    setAiSuggest(null);
    setAiSuggestDismissed(false);
    setUploadedDocType(null);
    setUploadedOcr(null);
    setUploadedOcrText(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const setField = (key: string, value: string) => {
    setForm((s) => ({ ...s, [key]: value }));
    setManualEdits((m) => ({ ...m, [key]: true }));
    setAiFilled((a) => {
      if (!(key in a)) return a;
      const next = { ...a };
      delete next[key];
      return next;
    });
  };

  // ── single-file AI preview ──────────────────────────────────────────

  const previewMutation = useMutation({
    mutationFn: previewDocument,
    onSuccess: (data) => {
      setPreview(data);
      const cls = data.classification;
      const autofillFloor = selectedType?.autofill_floor ?? DEFAULT_AUTOFILL_FLOOR;
      if (
        cls.doc_class &&
        cls.doc_class !== 'Unknown' &&
        cls.confidence >= autofillFloor &&
        !manualEdits.__doc_type
      ) {
        const normalised = cls.doc_class.toLowerCase().replace(/[\s_-]+/g, '');
        const match = types.data?.find(
          (t) => t.name.toLowerCase().replace(/\s+/g, '') === normalised,
        );
        if (match) setDocTypeId(match.id);
      }
    },
  });

  useEffect(() => {
    if (!preview || !selectedType) return;
    const nextForm: FormState = { ...form };
    const nextConf: Record<string, number> = { ...aiFilled };
    const typeAutofillFloor = selectedType.autofill_floor ?? DEFAULT_AUTOFILL_FLOOR;
    const typeAutofillFloorFreetext = Math.max(0, typeAutofillFloor - 0.05);
    for (const f of selectedType.fields) {
      if (manualEdits[f.key] || nextForm[f.key]) continue;
      if (!f.ai_extract_from) continue;
      const ext = preview.extraction[f.ai_extract_from as keyof Extraction];
      if (!ext || !ext.value) continue;
      const floor = f.ai_extract_from === 'address' ? typeAutofillFloorFreetext : typeAutofillFloor;
      if (ext.confidence < floor) continue;
      nextForm[f.key] = ext.value;
      nextConf[f.key] = ext.confidence;
    }
    setForm(nextForm);
    setAiFilled(nextConf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, selectedType]);

  const retryPreview = () => { if (file) previewMutation.mutate(file); };

  // ── single-file upload ──────────────────────────────────────────────

  const uploadMutation = useMutation({
    mutationFn: ({ form, idempotencyKey }: { form: FormData; idempotencyKey: string }) =>
      uploadDocumentWithKey(form, idempotencyKey),
    onSuccess: (r) => {
      setLastUploadId(r.id);
      setLastAutoRouted(r.auto_routed ?? null);
      // Capture classification info from preview for the pipeline display
      if (preview) {
        setUploadedDocType(preview.classification.doc_class);
        setUploadedOcr(preview.classification.confidence * 100);
        // First non-empty line of the OCR text (approximated from summary)
        setUploadedOcrText(preview.summary || null);
      }
      analyzeDocument(r.id).catch(() => { /* user can retry from viewer */ });
      setFile(null);
      setForm({});
      setAiFilled({});
      setManualEdits({});
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const validate = (): string[] => {
    if (!selectedType) return ['Select a document type.'];
    const errs: string[] = [];
    for (const f of selectedType.fields) {
      if (f.required) {
        const v = form[f.key];
        if (v == null || !String(v).trim()) {
          errs.push(`${f.label} is required.`);
        }
      }
    }
    return errs;
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) { setClientError('Select a file to upload'); return; }
    const errs = validate();
    setValidationErrors(errs);
    if (errs.length > 0) return;
    setConfirming(true);
  };

  const confirmUpload = () => {
    if (!file || !selectedType) return;
    const idempotencyKey = crypto.randomUUID();
    const fd = new FormData();
    fd.set('file', file);
    fd.set('doc_type', selectedType.name);
    if (folderId) fd.set('folder_id', folderId);
    if (branch) fd.set('branch', branch);
    fd.set('metadata_json', JSON.stringify(form));
    // Attempt upload; on network failure, queue to IndexedDB outbox.
    uploadMutation.mutate(
      { form: fd, idempotencyKey },
      {
        onError: (err) => {
          // Detect offline error: TypeError with "Failed to fetch" message or
          // HttpError with status 0 (no response received).
          const errAsUnknown: unknown = err;
          const errStatus: unknown = typeof errAsUnknown === 'object' && errAsUnknown !== null
            ? (errAsUnknown as Record<string, unknown>)['status']
            : undefined;
          const isOffline =
            (err instanceof TypeError && err.message.toLowerCase().includes('failed to fetch')) ||
            (err instanceof Error && err.message.toLowerCase().includes('network error')) ||
            (errStatus === 0);

          if (isOffline && isIndexedDbAvailable()) {
            const entry: EnqueueInput = {
              id: crypto.randomUUID(),
              idempotency_key: idempotencyKey,
              endpoint: '/spa/api/documents',
              sensitive: {
                customer_cid: (form['customer_cid'] as string | undefined) ?? null,
                doc_number: (form['doc_number'] as string | undefined) ?? null,
                customer_name: (form['customer_name'] as string | undefined) ?? null,
              },
              request_body: {
                original_name: file.name,
                doc_type: selectedType.name,
                metadata_json: JSON.stringify(form),
                notes: (form['notes'] as string | undefined) ?? null,
              },
              enqueued_at: new Date().toISOString(),
            };
            // Use session user ID as session token proxy for key derivation.
            // The session ID is not persisted — it lives only in memory.
            const sessionToken = String(sessionUser?.id ?? 'anon');
            outboxEnqueue(entry, sessionToken).then(() => {
              setOfflineToast(`Saved for sync — will upload when online`);
              setTimeout(() => setOfflineToast(null), 6_000);
            }).catch(() => {
              setOfflineToast('Could not save offline — IndexedDB unavailable.');
              setTimeout(() => setOfflineToast(null), 4_000);
            });
          }
        },
      },
    );
    setConfirming(false);
  };

  const previewStatus: 'idle' | 'running' | 'done' | 'error' =
    previewMutation.isPending ? 'running'
    : previewMutation.isError  ? 'error'
    : preview                  ? 'done'
    : 'idle';

  // ── file selection (both modes) ─────────────────────────────────────

  const processFiles = (files: File[]) => {
    setClientError(null);
    setLastUploadId(null);

    const valid = files.filter((f) => {
      if (!ALLOWED.includes(f.type)) return false;
      if (f.size > MAX_BYTES) return false;
      return true;
    });

    if (valid.length === 0) {
      setClientError('No supported files selected. Check type and size (max 50 MB).');
      return;
    }
    if (valid.length > MAX_FILES) {
      setClientError(`Maximum ${MAX_FILES} files per batch.`);
      return;
    }

    // Single-file: use existing flow
    if (valid.length === 1) {
      // Reset multi-file state
      for (const c of cards) URL.revokeObjectURL(c.objectUrl);
      setCards([]);
      const f = valid[0]!;
      setFile(f);
      setPreview(null);
      setAiFilled({});
      setAiSuggest(null);
      setAiSuggestDismissed(false);
      if (f.size > PREVIEW_MAX_BYTES) {
        setClientError('File is too large for AI preview (>25 MB). Upload will still work.');
        return;
      }
      previewMutation.mutate(f);
      // Run classify-one in parallel — do not block the preview mutation
      classifyOne(f).then(setAiSuggest).catch(() => { /* best-effort */ });
      return;
    }

    // Multi-file: build cards
    setFile(null);
    const newCards: FileCard[] = valid.map((f) => {
      const defaultTypeId = types.data?.[0]?.id ?? null;
      return {
        id: cardUid(),
        file: f,
        objectUrl: URL.createObjectURL(f),
        form: {},
        aiFilled: {},
        manualEdits: {},
        docTypeId: defaultTypeId,
        status: f.size <= PREVIEW_MAX_BYTES
          ? { tag: 'scanning' }
          : { tag: 'idle' },
      };
    });
    setCards(newCards);

    // Kick off preview for each scannable card
    for (const card of newCards) {
      if (card.status.tag !== 'scanning') continue;
      scanCard(card, newCards);
    }
  };

  // Run /preview for one card and update state
  const scanCard = async (card: FileCard, currentCards: FileCard[]) => {
    try {
      const data = await previewDocument(card.file);
      setCards((prev) => prev.map((c) => {
        if (c.id !== card.id) return c;
        // Auto-detect doc type
        let nextDocTypeId = c.docTypeId;
        const cls = data.classification;
        if (cls.doc_class && cls.doc_class !== 'Unknown') {
          const normalised = cls.doc_class.toLowerCase().replace(/[\s_-]+/g, '');
          const match = types.data?.find(
            (t) => t.name.toLowerCase().replace(/\s+/g, '') === normalised,
          );
          if (match) {
            const matchFloor = match.autofill_floor ?? DEFAULT_AUTOFILL_FLOOR;
            if (cls.confidence >= matchFloor) nextDocTypeId = match.id;
          }
        }
        // Apply AI extracted fields
        const docType = types.data?.find((t) => t.id === nextDocTypeId) ?? null;
        const nextForm: FormState = {};
        const nextConf: Record<string, number> = {};
        if (docType) {
          const typeFloor = docType.autofill_floor ?? DEFAULT_AUTOFILL_FLOOR;
          const typeFloorFreetext = Math.max(0, typeFloor - 0.05);
          for (const f of docType.fields) {
            if (!f.ai_extract_from) continue;
            const ext = data.extraction[f.ai_extract_from as keyof Extraction];
            if (!ext || !ext.value) continue;
            const floor = f.ai_extract_from === 'address' ? typeFloorFreetext : typeFloor;
            if (ext.confidence < floor) continue;
            nextForm[f.key] = ext.value;
            nextConf[f.key] = ext.confidence;
          }
        }
        return {
          ...c,
          docTypeId: nextDocTypeId,
          form: nextForm,
          aiFilled: nextConf,
          status: { tag: 'ready', preview: data },
        };
      }));
    } catch (err) {
      const msg = err instanceof HttpError ? err.message : 'AI preview failed';
      setCards((prev) => prev.map((c) =>
        c.id === card.id ? { ...c, status: { tag: 'scan_error', message: msg } } : c,
      ));
    }
    // suppress unused-param lint; currentCards used to trigger scan in batch
    void currentCards;
  };

  const rescanCard = (cardId: string) => {
    setCards((prev) => {
      const next = prev.map((c) =>
        c.id === cardId && c.file.size <= PREVIEW_MAX_BYTES
          ? { ...c, status: { tag: 'scanning' as const } }
          : c,
      );
      const card = next.find((c) => c.id === cardId);
      if (card) void scanCard(card, next);
      return next;
    });
  };

  const updateCardField = (cardId: string, key: string, value: string) => {
    setCards((prev) => prev.map((c) => {
      if (c.id !== cardId) return c;
      const nextAiFilled = { ...c.aiFilled };
      delete nextAiFilled[key];
      return {
        ...c,
        form: { ...c.form, [key]: value },
        manualEdits: { ...c.manualEdits, [key]: true as const },
        aiFilled: nextAiFilled,
      };
    }));
  };

  const updateCardDocType = (cardId: string, typeId: number | null) => {
    setCards((prev) => prev.map((c) =>
      c.id === cardId
        ? { ...c, docTypeId: typeId, manualEdits: { ...c.manualEdits, __doc_type: true } }
        : c,
    ));
  };

  const removeCard = (cardId: string) => {
    setCards((prev) => {
      const card = prev.find((c) => c.id === cardId);
      if (card) URL.revokeObjectURL(card.objectUrl);
      const next = prev.filter((c) => c.id !== cardId);
      // If only 1 left — drop back to single-file
      if (next.length === 1) {
        const sole = next[0]!;
        setFile(sole.file);
        URL.revokeObjectURL(sole.objectUrl);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return [];
      }
      return next;
    });
  };

  const resetBatch = () => {
    for (const c of cards) URL.revokeObjectURL(c.objectUrl);
    setCards([]);
    setBatchFolderId('');
    setBatchBranch('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── batch upload-all (sequential) ──────────────────────────────────

  const uploadAll = async () => {
    if (batchUploading) return;
    setBatchUploading(true);

    const defaultType = types.data?.[0];

    for (const card of cards) {
      if (card.status.tag === 'done') continue; // already succeeded
      const docType = types.data?.find((t) => t.id === card.docTypeId) ?? defaultType;
      if (!docType) continue;

      setCards((prev) => prev.map((c) =>
        c.id === card.id ? { ...c, status: { tag: 'uploading' } } : c,
      ));

      const fd = new FormData();
      fd.set('file', card.file);
      fd.set('doc_type', docType.name);
      if (batchFolderId) fd.set('folder_id', batchFolderId);
      if (batchBranch) fd.set('branch', batchBranch);
      fd.set('metadata_json', JSON.stringify(card.form));

      try {
        const result = await uploadDocumentWithKey(fd, crypto.randomUUID());
        analyzeDocument(result.id).catch(() => { /* background */ });
        setCards((prev) => prev.map((c) =>
          c.id === card.id ? { ...c, status: { tag: 'done', uploadId: result.id, autoRouted: result.auto_routed ?? null } } : c,
        ));
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : 'Upload failed';
        setCards((prev) => prev.map((c) =>
          c.id === card.id ? { ...c, status: { tag: 'upload_error', message: msg } } : c,
        ));
      }
    }

    setBatchUploading(false);
  };

  const onFileChange = (f: File | null) => {
    if (!f) return;
    processFiles([f]);
  };

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) processFiles(files);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 1) {
      onFileChange(files[0] ?? null);
    } else if (files.length > 1) {
      processFiles(files);
    }
  };

  const serverError =
    uploadMutation.error instanceof HttpError ? uploadMutation.error.message : null;

  // ── render multi-file mode ──────────────────────────────────────────

  if (isMulti) {
    const allDone   = cards.every((c) => c.status.tag === 'done');
    const hasFailed = cards.some((c) => c.status.tag === 'upload_error');
    const pending   = cards.filter((c) => c.status.tag !== 'done').length;

    return (
      <div className="space-y-4">
        {/* Batch header */}
        <Panel
          title={`Batch capture — ${cards.length} files`}
          action={
            <div className="flex items-center gap-2">
              <label className="inline-block">
                <span className="sr-only">Add more files</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="sr-only"
                  accept={ALLOWED.join(',')}
                  onChange={onInputChange}
                  data-testid="capture-file-input"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={12} /> Add files
                </Button>
              </label>
              <Button type="button" variant="secondary" size="sm" onClick={resetBatch}>
                <X size={12} /> Clear all
              </Button>
            </div>
          }
        >
          {/* Batch-level folder + branch */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <label className="block">
              <span className="mb-1 text-xs font-medium text-muted">Folder (all files)</span>
              <select
                value={batchFolderId}
                onChange={(e) => setBatchFolderId(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-md"
                data-testid="batch-folder"
              >
                <option value="">— no folder —</option>
                {folders.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 text-xs font-medium text-muted">Branch (all files)</span>
              <Input
                value={batchBranch}
                onChange={(e) => setBatchBranch(e.target.value)}
                placeholder="e.g. Thimphu"
                data-testid="batch-branch"
              />
            </label>
          </div>

          {/* Per-file cards */}
          <div className="space-y-3">
            {cards.map((card) => (
              <BatchFileCard
                key={card.id}
                card={card}
                types={types.data ?? []}
                onRemove={removeCard}
                onRescan={rescanCard}
                onFieldChange={updateCardField}
                onDocTypeChange={updateCardDocType}
              />
            ))}
          </div>

          {/* Status banners */}
          {allDone && (
            <div className="mt-4 rounded-lg bg-success-bg border border-success/30 px-3 py-2 text-xs text-success flex items-center gap-2" data-testid="batch-all-done">
              <CheckCircle2 size={13} /> All {cards.length} files uploaded successfully.
            </div>
          )}
          {hasFailed && !allDone && (
            <div className="mt-4 rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger flex items-center gap-2" data-testid="batch-has-errors">
              <AlertCircle size={13} /> Some uploads failed. Retry below or remove failed cards.
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex justify-end gap-2">
            {!allDone && (
              <Button
                onClick={uploadAll}
                loading={batchUploading}
                disabled={batchUploading}
                data-testid="batch-upload-all"
              >
                <Upload size={14} />
                {batchUploading
                  ? `Uploading… (${cards.filter((c) => c.status.tag === 'done').length}/${cards.length})`
                  : `Upload all${pending > 0 ? ` (${pending})` : ''}`}
              </Button>
            )}
          </div>
        </Panel>
      </div>
    );
  }

  // ── render single-file mode (original layout) ───────────────────────

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <Panel title="Upload document" className="xl:col-span-2">
        <form onSubmit={onSubmit} className="space-y-4">
          <label
            ref={dropRef}
            data-testid="capture-dropzone"
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed',
              'border-border bg-page hover:border-brand-blue hover:bg-brand-skyLight transition-colors cursor-pointer',
              'py-10 px-6 text-center',
              file && 'border-success bg-success-bg',
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            {file ? <FileText size={28} className="text-success" /> : <Upload size={28} className="text-brand-blue" />}
            <div className="text-md font-medium text-ink">
              {file ? file.name : 'Drop files here or click to browse'}
            </div>
            <div className="text-xs text-muted">
              {file
                ? `${fmtSize(file.size)} · ${file.type || 'unknown'}`
                : `PDF, JPG, PNG, WEBP, TIFF, DOC, DOCX, TXT · max 50 MB · up to ${MAX_FILES} files`}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              data-testid="capture-file-input"
              className="sr-only"
              accept={ALLOWED.join(',')}
              onChange={onInputChange}
            />
          </label>

          {file && fileUrl && <FilePreview file={file} url={fileUrl} scanning={previewMutation.isPending} />}

          {file && (
            <PreviewStatus
              status={previewStatus}
              preview={preview}
              onRetry={retryPreview}
              error={previewMutation.error instanceof HttpError ? previewMutation.error.message : null}
            />
          )}

          {/* AI suggest chip — shown when classify-one returns similarity > 0.7 */}
          {file && aiSuggest?.best_match && aiSuggest.best_match.similarity > 0.7 && !aiSuggestDismissed && (
            <AiSuggestChip
              name={aiSuggest.best_match.name}
              similarity={aiSuggest.best_match.similarity}
              onUse={() => {
                const match = types.data?.find((t) => t.name === aiSuggest.best_match?.name);
                if (match) {
                  setDocTypeId(match.id);
                  setManualEdits((m) => ({ ...m, __doc_type: true }));
                }
                setAiSuggestDismissed(true);
              }}
              onDismiss={() => setAiSuggestDismissed(true)}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
                Document type <span className="text-danger">*</span>
              </span>
              <select
                value={docTypeId ?? ''}
                onChange={(e) => {
                  setDocTypeId(e.target.value ? parseInt(e.target.value, 10) : null);
                  setManualEdits((m) => ({ ...m, __doc_type: true }));
                }}
                data-testid="capture-field-doc_type"
                disabled={types.isLoading}
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-md"
              >
                <option value="">{types.isLoading ? 'Loading…' : 'Select…'}</option>
                {types.data?.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 text-xs font-medium text-muted">Folder</span>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                data-testid="capture-field-folder_id"
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-md"
              >
                <option value="">— no folder —</option>
                {folders.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          </div>

          {selectedType && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="capture-schema-fields">
              {selectedType.fields.map((fieldDef) => (
                <DynamicField
                  key={fieldDef.key}
                  field={fieldDef}
                  value={form[fieldDef.key] ?? ''}
                  onChange={(v) => setField(fieldDef.key, v)}
                  confidence={aiFilled[fieldDef.key]}
                  confidenceHigh={selectedType.high_confidence ?? DEFAULT_CONFIDENCE_HIGH}
                />
              ))}
            </div>
          )}

          {selectedType && (
            <label className="block">
              <span className="mb-1 text-xs font-medium text-muted">Branch</span>
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="e.g. Thimphu"
                data-testid="capture-field-branch"
              />
            </label>
          )}

          {validationErrors.length > 0 && (
            <div className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger" data-testid="capture-validation">
              <p className="font-medium flex items-center gap-2"><AlertCircle size={13} /> Fix before uploading:</p>
              <ul className="mt-1 list-disc list-inside">
                {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {clientError && (
            <div className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger flex items-center gap-2" data-testid="capture-client-error">
              <AlertCircle size={14} /> {clientError}
            </div>
          )}
          {serverError && (
            <div className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger flex items-center gap-2">
              <AlertCircle size={14} /> Upload failed — {serverError}
            </div>
          )}
          {lastUploadId !== null && (
            <div className="space-y-3" data-testid="capture-success">
              <div className="rounded-lg bg-success-bg border border-success/30 px-3 py-2 text-xs text-success flex items-center gap-2 font-medium">
                <CheckCircle2 size={14} /> Uploaded as document #{lastUploadId}
              </div>
              {lastAutoRouted != null && (
                <AutoRoutedBadge
                  folderName={lastAutoRouted.folder_name}
                  documentId={lastUploadId}
                />
              )}
              <AiPipelineProgress
                documentId={lastUploadId}
                initialOcr={uploadedOcr}
                initialDocType={uploadedDocType}
                initialOcrText={uploadedOcrText}
              />
              <div>
                <Link to={`/viewer/${lastUploadId}`}>
                  <Button size="sm">
                    <ExternalLink size={12} /> Open in viewer
                  </Button>
                </Link>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center gap-2">
            {canCbs && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="cbs-lookup-button"
                onClick={() => setCbsDialogOpen(true)}
              >
                <Database size={13} />
                {t('cbs.pull_from_cbs_button')}
              </Button>
            )}
            <div className="flex gap-2 ms-auto">
              <Button type="button" variant="secondary" onClick={reset}>Reset</Button>
              <AiSubmitButton
                loading={uploadMutation.isPending}
                disabled={!file || previewMutation.isPending || !selectedType}
                analysing={previewMutation.isPending}
              />
            </div>
          </div>
        </form>
      </Panel>

      {cbsDialogOpen && (
        <CbsLookupDialog
          initialCif={form['customer_cif'] ?? ''}
          canAdmin={cbsRole === 'Doc Admin'}
          onClose={() => setCbsDialogOpen(false)}
        />
      )}

      <DocumentSummaryPanel
        file={file}
        status={previewStatus}
        preview={preview}
        onRetry={retryPreview}
        error={previewMutation.error instanceof HttpError ? previewMutation.error.message : null}
      />

      {confirming && file && selectedType && (
        <ConfirmUploadDialog
          file={file}
          docType={selectedType}
          form={form}
          aiFilled={aiFilled}
          folderName={folders.data?.find((f) => String(f.id) === folderId)?.name ?? null}
          branch={branch}
          preview={preview}
          uploading={uploadMutation.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={confirmUpload}
        />
      )}

      {/* Offline sync toast */}
      {offlineToast !== null && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-badge border border-warning/40 bg-warning/10 px-4 py-2 text-sm font-medium text-warning shadow-card"
          data-testid="capture-offline-toast"
        >
          {offlineToast}
        </div>
      )}
    </div>
  );
}

// ── BatchFileCard ─────────────────────────────────────────────────────────

function BatchFileCard({
  card,
  types,
  onRemove,
  onRescan,
  onFieldChange,
  onDocTypeChange,
}: {
  card: FileCard;
  types: DocumentType[];
  onRemove: (id: string) => void;
  onRescan: (id: string) => void;
  onFieldChange: (cardId: string, key: string, val: string) => void;
  onDocTypeChange: (cardId: string, typeId: number | null) => void;
}) {
  const { file, objectUrl, status, docTypeId, form, aiFilled } = card;
  const isImage = file.type.startsWith('image/');
  const isPdf   = file.type === 'application/pdf';
  const docType = types.find((t) => t.id === docTypeId) ?? null;

  const statusNode = (() => {
    switch (status.tag) {
      case 'scanning':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-brand-sky font-medium">
            <Wand2 size={11} className="motion-safe:animate-pulse" /> Scanning…
          </span>
        );
      case 'ready':
        return (
          <Badge tone={status.preview.classification.confidence >= CONFIDENCE_HIGH ? 'success' : 'warning'}>
            {status.preview.classification.doc_class} · {Math.round(status.preview.classification.confidence * 100)}%
          </Badge>
        );
      case 'scan_error':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-danger">
            <AlertCircle size={11} /> {status.message}
          </span>
        );
      case 'uploading':
        return <span className="text-xs text-brand-blue">Uploading…</span>;
      case 'done':
        return (
          <span className="inline-flex flex-col gap-1">
            <Link to={`/viewer/${status.uploadId}`} className="inline-flex items-center gap-1 text-xs text-success hover:underline">
              <CheckCircle2 size={11} /> Doc #{status.uploadId}
            </Link>
            {status.autoRouted != null && (
              <AutoRoutedBadge
                folderName={status.autoRouted.folder_name}
                documentId={status.uploadId}
                compact
              />
            )}
          </span>
        );
      case 'upload_error':
        return <span className="inline-flex items-center gap-1 text-xs text-danger"><AlertCircle size={11} /> {status.message}</span>;
      default:
        return null;
    }
  })();

  return (
    <div
      className={cn(
        'rounded-card border bg-white overflow-hidden',
        status.tag === 'done'         && 'border-success/40',
        status.tag === 'upload_error' && 'border-danger/40',
        status.tag !== 'done' && status.tag !== 'upload_error' && 'border-divider',
      )}
      data-testid={`batch-card-${card.id}`}
    >
      <div
        className={cn(
          'flex items-start gap-3 px-3 py-2 border-b border-divider relative transition-colors duration-300',
          status.tag === 'scanning' ? 'bg-brand-navy/5' : 'bg-raised',
        )}
      >
        {/* Thumbnail */}
        <div className="w-12 h-12 rounded-input border border-divider bg-page flex-shrink-0 overflow-hidden flex items-center justify-center relative">
          {isImage ? (
            <img src={objectUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <FileText size={20} className={cn('text-brand-blue', isPdf && 'text-danger')} />
          )}
          {/* Mini scan overlay on thumbnail */}
          {status.tag === 'scanning' && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
              <div
                className="absolute left-0 right-0 h-px motion-safe:animate-ai-scan-line"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(33,150,243,0.9), transparent)',
                  boxShadow: '0 0 4px rgba(33,150,243,0.6)',
                }}
              />
            </div>
          )}
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <p className="text-md font-medium text-ink truncate" title={file.name}>{file.name}</p>
          <p className="text-xs text-muted">{fmtSize(file.size)} · {file.type || 'unknown'}</p>
          <div className="mt-1">{statusNode}</div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {(status.tag === 'idle' || status.tag === 'scan_error') && (
            <button
              type="button"
              onClick={() => onRescan(card.id)}
              title="Rescan with AI"
              data-testid={`batch-rescan-${card.id}`}
              className="inline-flex items-center gap-1 rounded-input border border-border bg-white px-2 py-1 text-xs text-ink hover:bg-divider"
            >
              <RefreshCw size={11} /> Rescan
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(card.id)}
            title="Remove"
            data-testid={`batch-remove-${card.id}`}
            className="w-6 h-6 rounded-input flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Editable metadata — only shown when not done */}
      {status.tag !== 'done' && (
        <div className="px-3 py-2 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 text-xs font-medium text-muted">Document type</span>
              <select
                value={docTypeId ?? ''}
                onChange={(e) => onDocTypeChange(card.id, e.target.value ? parseInt(e.target.value, 10) : null)}
                className="h-8 w-full rounded-input border border-border bg-white px-2 text-xs"
              >
                <option value="">Select…</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          </div>

          {docType && docType.fields.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {docType.fields.map((fieldDef) => (
                <DynamicField
                  key={fieldDef.key}
                  field={fieldDef}
                  value={form[fieldDef.key] ?? ''}
                  onChange={(v) => onFieldChange(card.id, fieldDef.key, v)}
                  confidence={aiFilled[fieldDef.key]}
                  confidenceHigh={docType.high_confidence ?? CONFIDENCE_HIGH}
                  compact
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── dynamic field ─────────────────────────────────────────────────────────

function DynamicField({
  field,
  value,
  onChange,
  confidence,
  confidenceHigh = CONFIDENCE_HIGH,
  compact = false,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  confidence: number | undefined;
  /** High-confidence threshold from the selected doc-type (0–1). Defaults to module fallback. */
  confidenceHigh?: number;
  compact?: boolean;
}) {
  const testId = `capture-field-${field.key}`;
  const hasAi = confidence != null;
  const isHighConf = hasAi && confidence >= confidenceHigh;
  const isMedConf  = hasAi && !isHighConf && confidence >= AUTOFILL_FLOOR;

  /** Left-border glow style applied when AI has filled the field */
  const aiGlowStyle: React.CSSProperties | undefined = hasAi
    ? {
        borderLeftWidth: '3px',
        borderLeftColor: isHighConf
          ? '#1D9E75'   // success / emerald
          : isMedConf
            ? '#EF9F27' // warning / amber
            : '#888780', // muted — low confidence, no glow
        boxShadow: isHighConf
          ? '0 0 8px 0 rgba(29,158,117,0.28)'
          : isMedConf
            ? '0 0 8px 0 rgba(239,159,39,0.22)'
            : 'none',
      }
    : undefined;

  const common = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    'data-testid': testId,
  };

  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 font-medium text-muted text-xs">
        {field.label}
        {field.required && <span className="text-danger" aria-label="required">*</span>}
        {hasAi && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-badge px-1.5 py-0.5 text-[10px] font-semibold normal-case',
              isHighConf && 'text-success border border-success/40',
              isMedConf  && 'text-warning border border-warning/40',
              !isHighConf && !isMedConf && 'text-muted border border-border',
            )}
            style={
              isHighConf
                ? { background: 'linear-gradient(135deg, rgba(29,158,117,0.12), rgba(21,101,192,0.08))' }
                : isMedConf
                  ? { background: 'linear-gradient(135deg, rgba(239,159,39,0.12), rgba(21,101,192,0.08))' }
                  : { background: 'transparent' }
            }
          >
            <Sparkles size={9} />
            AI · {Math.round(confidence * 100)}%
            {!isHighConf && confidence >= AUTOFILL_FLOOR && ' · verify'}
          </span>
        )}
      </span>
      <div className="relative transition-all duration-200">
        {field.type === 'textarea' ? (
          <textarea
            rows={compact ? 2 : 3}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-md transition-all duration-200"
            style={aiGlowStyle}
            {...common}
          />
        ) : (
          <Input
            type={htmlInputType(field.type)}
            className={cn(hasAi && 'transition-all duration-200')}
            style={aiGlowStyle}
            {...common}
          />
        )}
      </div>
    </label>
  );
}

function htmlInputType(t: FieldDef['type']): string {
  switch (t) {
    case 'date':   return 'date';
    case 'number': return 'number';
    case 'email':  return 'email';
    case 'tel':    return 'tel';
    default:       return 'text';
  }
}

// ── AI Submit Button — gradient + shimmer + glow ──────────────────────────

/**
 * The primary upload button with AI-grade visual treatment:
 * - Gradient background: brand-navy → brand-blue → brand-sky → violet tone
 * - Sweeping shimmer diagonal every ~3s (motion-safe)
 * - Hover: stronger glow shadow
 * - While analysing: continuous pulse glow instead of shimmer (no stuck feel)
 *
 * Behavior is byte-identical to the plain Button — only presentation differs.
 */
function AiSubmitButton({
  loading,
  disabled,
  analysing,
}: {
  loading: boolean;
  disabled: boolean;
  analysing: boolean;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-input group transition-all duration-200',
        !disabled && 'hover:shadow-ai-btn-hover',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      )}
      style={
        disabled
          ? undefined
          : {
              background: 'linear-gradient(135deg, #0D2B6A 0%, #1565C0 45%, #2196F3 75%, #7F77DD 100%)',
              boxShadow: '0 0 16px 2px rgba(21, 101, 192, 0.35)',
            }
      }
    >
      {/* Shimmer sweep — only when idle (not analysing), motion-safe */}
      {!analysing && !disabled && (
        <span
          className="absolute inset-y-0 w-1/3 motion-safe:animate-ai-shimmer pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)',
          }}
          aria-hidden="true"
        />
      )}
      {/* Pulse glow ring — shown while AI is analysing */}
      {analysing && (
        <span
          className="absolute inset-0 rounded-input motion-safe:animate-ai-badge-pulse pointer-events-none"
          style={{
            boxShadow: '0 0 0 3px rgba(33,150,243,0.4)',
          }}
          aria-hidden="true"
        />
      )}
      <button
        type="submit"
        disabled={disabled || loading}
        data-testid="capture-submit"
        title={analysing ? 'Waiting for AI preview…' : undefined}
        className={cn(
          'relative z-10 inline-flex items-center justify-center gap-2 rounded-input font-medium transition-colors',
          'h-10 px-4 text-sm',
          disabled
            ? 'bg-brand-blue text-white'
            : 'bg-transparent text-white',
        )}
      >
        {analysing ? (
          <>
            <Wand2 size={14} className="motion-safe:animate-pulse" />
            Analysing…
          </>
        ) : loading ? (
          <span className="motion-safe:animate-pulse">…</span>
        ) : (
          <>
            <Upload size={14} />
            Upload
          </>
        )}
      </button>
    </div>
  );
}

// ── AI preview banner (existing) ──────────────────────────────────────────

function PreviewStatus({
  status,
  preview,
  onRetry,
  error,
}: {
  status: 'idle' | 'running' | 'done' | 'error';
  preview: PreviewResponse | null;
  onRetry: () => void;
  error: string | null;
}) {
  if (status === 'idle') return null;
  if (status === 'running') {
    return (
      <div
        className="relative overflow-hidden rounded-card border border-brand-blue/30 px-3 py-2.5 text-xs flex items-center gap-2"
        style={{
          background: 'linear-gradient(135deg, rgba(13,43,106,0.06) 0%, rgba(21,101,192,0.08) 60%, rgba(33,150,243,0.06) 100%)',
          color: '#1565C0',
        }}
        data-testid="capture-preview-running"
        role="status"
        aria-live="polite"
      >
        {/* Subtle animated scan stripe */}
        <span
          className="absolute inset-y-0 w-1/4 motion-safe:animate-ai-connector-flow pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(33,150,243,0.08), transparent)' }}
          aria-hidden="true"
        />
        <Wand2 size={14} className="text-brand-blue motion-safe:animate-pulse shrink-0 relative z-10" />
        <span className="relative z-10 font-medium">DocBrain is reading the file — OCR + classify + extract…</span>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div
        className="rounded-card border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger flex items-center justify-between gap-2"
        data-testid="capture-preview-error"
      >
        <span className="flex items-center gap-2">
          <AlertCircle size={13} /> AI preview failed · {error ?? 'unknown error'}
        </span>
        <button type="button" onClick={onRetry} className="text-brand-blue underline hover:no-underline">
          Retry
        </button>
      </div>
    );
  }
  if (!preview) return null;
  const cls = preview.classification;
  const pages = preview.ocr.pages;
  const meanConf = preview.ocr.mean_confidence;
  const langs = preview.ocr.languages.join(', ') || 'unknown';
  return (
    <div
      className="rounded-card border border-success/30 bg-success-bg/60 px-3 py-2 text-xs text-ink flex flex-wrap items-center gap-2"
      data-testid="capture-preview-done"
    >
      <Sparkles size={13} className="text-brand-blue" />
      <span className="font-medium">AI preview</span>
      <Badge tone={cls.confidence >= CONFIDENCE_HIGH ? 'success' : 'warning'}>
        {cls.doc_class} · {Math.round(cls.confidence * 100)}%
      </Badge>
      <span className="text-muted">
        {pages} page{pages === 1 ? '' : 's'} · OCR {meanConf.toFixed(0)}% · {langs}
        {preview.ocr.backend && preview.ocr.backend !== 'tesseract' && preview.ocr.backend !== 'passthrough'
          ? ` · via ${preview.ocr.backend}`
          : ''}
      </span>
    </div>
  );
}

// ── right-hand review panel ───────────────────────────────────────────────

function DocumentSummaryPanel({
  file,
  status,
  preview,
  onRetry,
  error,
}: {
  file: File | null;
  status: 'idle' | 'running' | 'done' | 'error';
  preview: PreviewResponse | null;
  onRetry: () => void;
  error: string | null;
}) {
  if (!file) {
    return (
      <Panel title="Capture guidelines">
        <ul className="space-y-2 text-md text-muted">
          <li>• Form fields come from admin-configured per-type schemas at /admin/document-types.</li>
          <li>• AI auto-fill runs on the selected file before upload. Edit any field to override.</li>
          <li>• Required fields (marked *) block upload if empty.</li>
          <li>• Scanned PDFs under 10 MB OCR fastest.</li>
          <li>• Expiry date drives alerts — fill it when known.</li>
          <li>• Drop up to {MAX_FILES} files at once for batch upload.</li>
        </ul>
      </Panel>
    );
  }

  if (status === 'running') {
    return (
      <Panel
        title="Document summary"
        action={
          <span className="inline-flex items-center gap-1.5 text-xs text-brand-blue">
            <Wand2 size={12} className="animate-pulse" /> Analysing…
          </span>
        }
      >
        <div className="space-y-3" data-testid="capture-summary-loading">
          <p className="text-md text-muted">
            DocBrain is reading <span className="font-medium text-ink">{file.name}</span>. This runs
            OCR across every page, classifies the document, and pulls every field we can identify.
          </p>
          <QuantumLoader />
        </div>
      </Panel>
    );
  }

  if (status === 'error') {
    return (
      <Panel title="Document summary">
        <div className="space-y-3" data-testid="capture-summary-error">
          <div className="flex items-start gap-2 rounded-card border border-danger/30 bg-danger-bg p-3 text-xs text-danger">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">AI preview failed</p>
              <p className="mt-0.5">{error ?? 'The analyser did not return a response.'}</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={onRetry}>Retry preview</Button>
        </div>
      </Panel>
    );
  }

  if (!preview) return null;
  const cls = preview.classification;
  const ocr = preview.ocr;
  const ext = preview.extraction;
  const EXTRACT_ROWS: Array<{ key: keyof Extraction; label: string }> = [
    { key: 'customer_cid',      label: 'Customer CID' },
    { key: 'customer_name',     label: 'Customer name' },
    { key: 'doc_number',        label: 'Document number' },
    { key: 'dob',               label: 'Date of birth' },
    { key: 'issue_date',        label: 'Issue date' },
    { key: 'expiry_date',       label: 'Expiry date' },
    { key: 'issuing_authority', label: 'Issuing authority' },
    { key: 'address',           label: 'Address' },
  ];
  const capturedCount = EXTRACT_ROWS.filter((r) => !!ext[r.key].value).length;
  return (
    <Panel
      title="Document summary"
      action={
        <Badge tone={cls.confidence >= CONFIDENCE_HIGH ? 'success' : 'warning'}>
          {cls.doc_class} · {Math.round(cls.confidence * 100)}%
        </Badge>
      }
    >
      <div className="space-y-4" data-testid="capture-summary-done">
        <div className="flex items-start gap-2 text-md text-ink">
          <FileText size={14} className="text-brand-blue mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate" title={file.name}>{file.name}</p>
            <p className="text-xs text-muted">
              {fmtSize(file.size)} · {file.type || 'unknown'}
            </p>
          </div>
        </div>
        {preview.summary && (
          <div className="rounded-input bg-brand-skyLight/40 border border-brand-blue/20 px-3 py-2">
            <p className="text-xs font-medium text-brand-blue mb-1 inline-flex items-center gap-1">
              <Sparkles size={10} /> AI summary
            </p>
            <p className="text-xs text-ink leading-relaxed">{preview.summary}</p>
          </div>
        )}
        {cls.reasoning && (
          <div>
            <p className="text-xs font-medium text-muted mb-1">Classification</p>
            <p className="text-xs text-ink leading-relaxed">{cls.reasoning}</p>
            {cls.alternative && (
              <p className="text-[11px] text-muted mt-1">Alternative considered: {cls.alternative}</p>
            )}
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-muted mb-1">OCR</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="blue">{ocr.pages} page{ocr.pages === 1 ? '' : 's'}</Badge>
            <Badge tone={ocr.mean_confidence >= 85 ? 'success' : ocr.mean_confidence >= 70 ? 'warning' : 'danger'}>
              {ocr.mean_confidence.toFixed(0)}% text clarity
            </Badge>
            {ocr.backend && ocr.backend !== 'tesseract' && ocr.backend !== 'passthrough' && (
              <Badge tone="purple" className="inline-flex items-center gap-1 normal-case">
                <Sparkles size={9} /> {ocr.backend}
              </Badge>
            )}
            <Badge tone="neutral">{ocr.languages.join(', ') || 'unknown'}</Badge>
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted mb-2">
            Extracted fields ({capturedCount} / {EXTRACT_ROWS.length})
          </p>
          <dl className="space-y-1.5 text-xs">
            {EXTRACT_ROWS.map(({ key, label }) => (
              <ExtractedRow key={key} label={label} field={ext[key]} />
            ))}
          </dl>
        </div>
      </div>
    </Panel>
  );
}

function ExtractedRow({
  label,
  field,
}: {
  label: string;
  field: { value: string | null; confidence: number };
}) {
  const present = !!field.value;
  const tone =
    field.confidence >= CONFIDENCE_HIGH ? 'success'
    : field.confidence >= AUTOFILL_FLOOR ? 'warning'
    : 'neutral';
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-32 shrink-0 text-muted truncate">{label}</dt>
      <dd className="flex-1 min-w-0">
        {present ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-ink truncate max-w-full" title={field.value ?? ''}>
              {field.value}
            </span>
            <Badge tone={tone}>{Math.round(field.confidence * 100)}%</Badge>
          </div>
        ) : (
          <span className="text-muted italic">not detected</span>
        )}
      </dd>
    </div>
  );
}

// ── AI suggest chip ───────────────────────────────────────────────────────────

function AiSuggestChip({
  name,
  similarity,
  onUse,
  onDismiss,
}: {
  name: string;
  similarity: number;
  onUse: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-input border border-brand-blue/30 bg-brand-skyLight/50 px-3 py-1.5 text-xs text-ink"
      role="status"
      aria-live="polite"
      data-testid="capture-ai-suggest-chip"
    >
      <Sparkles size={12} className="text-brand-blue shrink-0" />
      <span>
        AI suggests: <strong className="text-ink">{name}</strong>{' '}
        <span className="text-muted">({Math.round(similarity * 100)}% match)</span>
      </span>
      <button
        type="button"
        onClick={onUse}
        className="text-brand-blue hover:underline font-medium ml-1"
        data-testid="capture-ai-suggest-use"
      >
        Use this
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss suggestion"
        className="text-muted hover:text-ink ml-auto"
        data-testid="capture-ai-suggest-dismiss"
      >
        <X size={11} />
      </button>
    </div>
  );
}

// ── QuantumLoader ──────────────────────────────────────────────────────────

const PHASES = ['Reading every page', 'Classifying', 'Extracting fields'] as const;

function QuantumLoader() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const id = setInterval(() => {
      setPhaseIndex(prev => (prev + 1) % PHASES.length);
    }, 1800);
    return () => clearInterval(id);
  }, [reducedMotion]);

  // Tick mark geometry: 12 marks at every 30°, from r=118 to r=122
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const angleRad = (i * 30 * Math.PI) / 180;
    const x1 = 130 + 118 * Math.sin(angleRad);
    const y1 = 130 - 118 * Math.cos(angleRad);
    const x2 = 130 + 122 * Math.sin(angleRad);
    const y2 = 130 - 122 * Math.cos(angleRad);
    return { x1, y1, x2, y2 };
  });

  // Outer gear: 12 teeth, 24 segments alternating outer-radius=22 / inner-radius=16
  const GEAR_OUTER = 22;
  const GEAR_INNER = 16;
  const outerGearPath = Array.from({ length: 24 }, (_, i) => {
    const angleDeg = i * 15 - 90; // 360/24 = 15° per segment
    const angleRad = (angleDeg * Math.PI) / 180;
    const r = i % 2 === 0 ? GEAR_OUTER : GEAR_INNER;
    const x = 130 + r * Math.cos(angleRad);
    const y = 130 + r * Math.sin(angleRad);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`;
  }).join(' ') + ' Z';

  // Inner (micro) gear: 8 teeth, 16 segments alternating outer=7 / inner=5
  const MICRO_OUTER = 7;
  const MICRO_INNER = 5;
  const innerGearPath = Array.from({ length: 16 }, (_, i) => {
    const angleDeg = i * 22.5 - 90; // 360/16 = 22.5° per segment
    const angleRad = (angleDeg * Math.PI) / 180;
    const r = i % 2 === 0 ? MICRO_OUTER : MICRO_INNER;
    const x = 130 + r * Math.cos(angleRad);
    const y = 130 + r * Math.sin(angleRad);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`;
  }).join(' ') + ' Z';

  // LED chip dots: every other outer-gear tooth tip (6 dots at even i * 30° steps)
  const chipDots = Array.from({ length: 12 }, (_, i) => {
    if (i % 2 !== 0) return null; // only even-indexed teeth
    const angleDeg = i * 2 * 15 - 90; // tooth tips at i*30° - 90°
    const angleRad = (angleDeg * Math.PI) / 180;
    const x = 130 + GEAR_OUTER * Math.cos(angleRad);
    const y = 130 + GEAR_OUTER * Math.sin(angleRad);
    return { x, y, key: i };
  }).filter((d): d is { x: number; y: number; key: number } => d !== null);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Gradient backdrop */}
      <div className="min-h-[280px] flex items-center justify-center rounded-card bg-gradient-to-b from-brand-skyLight/30 via-white to-white w-full">
        {/* Breathing outer glow — sits behind SVG via DOM order */}
        <div className="relative">
          <div
            className={
              reducedMotion
                ? 'absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(33,150,243,0.20)_0%,_transparent_60%)] blur-2xl'
                : 'absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(33,150,243,0.35)_0%,_transparent_60%)] blur-2xl animate-ai-breathe'
            }
            aria-hidden="true"
          />
        <svg
          viewBox="0 0 260 260"
          width="220"
          height="220"
          aria-hidden="true"
          role="img"
          style={{ position: 'relative' }}
        >
          <defs>
            {/* Glow filter for particles — tuned for white background */}
            <filter id="qglow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Gear glow filter — soft powered look on outer gear only */}
            <filter id="gearglow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* ── Outer dashed guide ring + tick marks (slow rotation) ── */}
          <g>
            {!reducedMotion && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 130 130"
                to="360 130 130"
                dur="60s"
                repeatCount="indefinite"
              />
            )}
            {/* Dashed ring */}
            <circle
              cx="130"
              cy="130"
              r="122"
              fill="none"
              stroke="rgba(21,101,192,0.22)"
              strokeWidth="0.5"
              strokeDasharray="1 5"
            />
            {/* 12 tick marks */}
            {ticks.map((t, i) => (
              <line
                key={i}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke="rgba(21,101,192,0.20)"
                strokeWidth="1"
              />
            ))}
          </g>

          {/* ── Scan arc (static position, brand-blue) ── */}
          {!reducedMotion && (
            <circle
              cx="130"
              cy="130"
              r="122"
              fill="none"
              stroke="#1565C0"
              strokeWidth="1.5"
              strokeDasharray="38 1000"
              strokeLinecap="round"
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 130 130"
                to="360 130 130"
                dur="4s"
                repeatCount="indefinite"
              />
            </circle>
          )}
          {reducedMotion && (
            <circle
              cx="130"
              cy="130"
              r="122"
              fill="none"
              stroke="#1565C0"
              strokeWidth="1.5"
              strokeDasharray="38 1000"
              strokeLinecap="round"
            />
          )}

          {/* ── Inner guide ring (r=80, subtle) ── */}
          <circle
            cx="130"
            cy="130"
            r="80"
            fill="none"
            stroke="rgba(21,101,192,0.10)"
            strokeWidth="0.5"
            strokeDasharray="2 6"
          />

          {/* ── Particle 1: primary orbit, tilted 60°, brand-blue mid ── */}
          <g transform="rotate(60 130 130)">
            {reducedMotion ? (
              // Static fallback at motion start position
              <g transform="translate(30 130)">
                <circle r="7" fill="#2196F3" filter="url(#qglow)" opacity="0.7" />
                <circle r="2.4" fill="#ffffff" />
              </g>
            ) : (
              <g>
                <circle r="7" fill="#2196F3" filter="url(#qglow)" opacity="0.7" />
                <circle r="2.4" fill="#ffffff" />
                <animateMotion
                  dur="5.5s"
                  repeatCount="indefinite"
                  begin="-1.2s"
                  path="M 30 130 A 100 32 0 1 0 230 130 A 100 32 0 1 0 30 130"
                />
              </g>
            )}
          </g>

          {/* ── Particle 2: complementary orbit, tilted -30°, sky-blue ── */}
          <g transform="rotate(-30 130 130)">
            {reducedMotion ? (
              <g transform="translate(230 130)">
                <circle r="5.5" fill="#0EA5E9" filter="url(#qglow)" opacity="0.65" />
                <circle r="1.8" fill="#ffffff" />
              </g>
            ) : (
              <g>
                <circle r="5.5" fill="#0EA5E9" filter="url(#qglow)" opacity="0.65" />
                <circle r="1.8" fill="#ffffff" />
                <animateMotion
                  dur="7.5s"
                  repeatCount="indefinite"
                  begin="-3.1s"
                  path="M 30 130 A 100 32 0 1 0 230 130 A 100 32 0 1 0 30 130"
                />
              </g>
            )}
          </g>

          {/* ── Center nucleus: rotating gear assembly ── */}
          {/* Outer gear — 12 teeth, clockwise, with gearglow filter */}
          <g>
            <path
              d={outerGearPath}
              stroke="#1565C0"
              strokeWidth="1.5"
              fill="rgba(21,101,192,0.12)"
              filter="url(#gearglow)"
            />
            {/* LED chip dots at every other tooth tip */}
            {chipDots.map(({ x, y, key }) => (
              <circle key={key} cx={x} cy={y} r="1" fill="#0EA5E9" />
            ))}
            {/* Inner hole ring so it reads as a true gear */}
            <circle cx="130" cy="130" r="8" fill="white" stroke="#1565C0" strokeWidth="1.2" />
            {!reducedMotion && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 130 130"
                to="360 130 130"
                dur="14s"
                repeatCount="indefinite"
              />
            )}
          </g>

          {/* Inner micro-gear — 8 teeth, counter-rotating */}
          <g>
            <path
              d={innerGearPath}
              stroke="#2196F3"
              strokeWidth="0.8"
              fill="rgba(33,150,243,0.18)"
            />
            {!reducedMotion && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="360 130 130"
                to="0 130 130"
                dur="9s"
                repeatCount="indefinite"
              />
            )}
          </g>
        </svg>
        </div>{/* end relative wrapper */}
      </div>

      {/* Phase text — cycles with opacity transition */}
      <p className="text-xs text-center select-none">
        {PHASES.map((phase, i) => (
          <span
            key={phase}
            className={cn(
              'transition-opacity duration-200',
              i === phaseIndex
                ? 'text-brand-blue font-medium opacity-100'
                : 'text-muted opacity-60',
            )}
          >
            {phase}
            {i < PHASES.length - 1 && (
              <span className="mx-1.5 text-muted opacity-40"> · </span>
            )}
          </span>
        ))}
      </p>
    </div>
  );
}

// ── inline file preview (blob URL) ────────────────────────────────────────

function FilePreview({ file, url, scanning = false }: { file: File; url: string; scanning?: boolean }) {
  const isPdf = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');
  const canPreview = isPdf || isImage;
  return (
    <div className="rounded-card border border-divider bg-page overflow-hidden" data-testid="capture-file-preview">
      <div className="flex items-center justify-between px-3 py-2 border-b border-divider bg-white">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Eye size={12} className="text-brand-blue" /> Preview
        </span>
        <span className="text-[11px] text-muted font-mono truncate max-w-[60%]" title={file.name}>
          {file.name}
        </span>
      </div>
      <div className="h-[360px] flex items-center justify-center bg-page relative">
        {isPdf && (
          <iframe
            title={`Preview of ${file.name}`}
            src={url}
            className="w-full h-full border-0"
            data-testid="capture-file-preview-pdf"
          />
        )}
        {isImage && (
          <img src={url} alt={file.name} className="max-w-full max-h-full object-contain" data-testid="capture-file-preview-image" />
        )}
        {!canPreview && (
          <div className="text-center text-muted p-6" data-testid="capture-file-preview-unavailable">
            <FileText size={32} className="mx-auto mb-2 text-brand-blue/60" />
            <p className="text-md">No inline preview for {file.type || 'this file type'}.</p>
            <p className="text-xs mt-1">Upload will still work — the AI summary above reflects what DocBrain sees.</p>
          </div>
        )}

        {/* Scanner overlay — shown while AI is reading the document */}
        <ScanOverlay visible={scanning} />
      </div>
    </div>
  );
}

/** Animated scan overlay shown while AI processes a document preview. */
function ScanOverlay({ visible }: { visible: boolean }) {
  return (
    <div
      className={cn(
        'absolute inset-0 pointer-events-none transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden="true"
    >
      {/* Cyan grid suggesting "AI reading" */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(33,150,243,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(33,150,243,0.06) 1px, transparent 1px)
          `,
          backgroundSize: '28px 28px',
        }}
      />
      {/* Horizontal scan line */}
      <div
        className="absolute left-0 right-0 h-px motion-safe:animate-ai-scan-line"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 20%, rgba(33,150,243,0.9) 50%, rgba(255,255,255,0.6) 80%, transparent 100%)',
          boxShadow: '0 0 8px 2px rgba(33,150,243,0.5)',
        }}
      />
      {/* "AI ANALYZING…" floating badge — top-right */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5 rounded-badge px-2 py-1 text-[10px] font-semibold tracking-wide"
        style={{
          background: 'linear-gradient(135deg, rgba(13,43,106,0.88) 0%, rgba(21,101,192,0.88) 100%)',
          color: '#E3EFFF',
          border: '1px solid rgba(33,150,243,0.4)',
          backdropFilter: 'blur(4px)',
        }}
        role="status"
        aria-live="polite"
      >
        <span
          className="w-1.5 h-1.5 rounded-full bg-brand-sky motion-safe:animate-ai-badge-pulse"
        />
        AI ANALYZING…
      </div>
    </div>
  );
}

// ── confirm-before-upload dialog ──────────────────────────────────────────

function ConfirmUploadDialog({
  file,
  docType,
  form,
  aiFilled,
  folderName,
  branch,
  preview,
  uploading,
  onCancel,
  onConfirm,
}: {
  file: File;
  docType: DocumentType;
  form: FormState;
  aiFilled: Record<string, number>;
  folderName: string | null;
  branch: string;
  preview: PreviewResponse | null;
  uploading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);

  const populated = docType.fields
    .map((f) => ({ field: f, value: form[f.key] ?? '' }))
    .filter((r) => r.value.trim() !== '');
  const missingRequired = docType.fields
    .filter((f) => f.required && !(form[f.key] ?? '').trim());
  const notSupplied = docType.fields
    .filter((f) => !f.required && !(form[f.key] ?? '').trim());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
      onClick={onCancel}
      data-testid="confirm-backdrop"
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-card bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        data-testid="confirm-dialog"
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-divider">
          <h2 id="confirm-title" className="text-md font-semibold text-ink inline-flex items-center gap-2">
            <CheckCircle2 size={16} className="text-brand-blue" />
            Confirm upload
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-divider"
            data-testid="confirm-close"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section>
            <p className="text-xs font-medium text-muted mb-2">File</p>
            <div className="rounded-card border border-divider p-3 flex items-start gap-3">
              <FileText size={16} className="text-brand-blue mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-md font-medium text-ink truncate" title={file.name}>{file.name}</p>
                <p className="text-xs text-muted mt-0.5">
                  {fmtSize(file.size)} · {file.type || 'unknown'}
                  {preview && ` · ${preview.ocr.pages} page${preview.ocr.pages === 1 ? '' : 's'}`}
                </p>
              </div>
              <Badge tone="blue">{docType.name}</Badge>
            </div>
          </section>

          {missingRequired.length > 0 && (
            <div
              className="rounded-card border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger"
              data-testid="confirm-missing-required"
            >
              <p className="font-medium">Required fields missing:</p>
              <ul className="mt-1 list-disc list-inside">
                {missingRequired.map((f) => <li key={f.key}>{f.label}</li>)}
              </ul>
            </div>
          )}

          <section>
            <p className="text-xs font-medium text-muted mb-2">
              Metadata to save ({populated.length} field{populated.length === 1 ? '' : 's'})
            </p>
            {populated.length === 0 ? (
              <p className="text-md text-muted italic">No metadata supplied.</p>
            ) : (
              <dl className="divide-y divide-divider rounded-card border border-divider">
                {populated.map(({ field, value }) => (
                  <div
                    key={field.key}
                    className="flex items-start gap-3 px-3 py-2 text-md"
                    data-testid={`confirm-row-${field.key}`}
                  >
                    <dt className="w-40 shrink-0 text-muted text-xs pt-0.5">
                      {field.label}{field.required && <span className="text-danger"> *</span>}
                    </dt>
                    <dd className="flex-1 min-w-0 text-ink flex items-center gap-2 flex-wrap">
                      <span className="break-words">{value}</span>
                      {aiFilled[field.key] != null && (
                        <Badge
                          tone={aiFilled[field.key]! >= CONFIDENCE_HIGH ? 'purple' : 'warning'}
                          className="inline-flex items-center gap-1 normal-case"
                        >
                          <Sparkles size={9} /> AI · {Math.round((aiFilled[field.key] ?? 0) * 100)}%
                        </Badge>
                      )}
                    </dd>
                  </div>
                ))}
                {folderName && (
                  <div className="flex items-start gap-3 px-3 py-2 text-md">
                    <dt className="w-40 shrink-0 text-muted text-xs pt-0.5">Folder</dt>
                    <dd className="flex-1 text-ink">{folderName}</dd>
                  </div>
                )}
                {branch && (
                  <div className="flex items-start gap-3 px-3 py-2 text-md">
                    <dt className="w-40 shrink-0 text-muted text-xs pt-0.5">Branch</dt>
                    <dd className="flex-1 text-ink">{branch}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>

          {notSupplied.length > 0 && (
            <section data-testid="confirm-missing">
              <p className="text-xs font-medium text-muted mb-1">Not supplied (optional)</p>
              <p className="text-xs text-muted">
                {notSupplied.map((f) => f.label).join(', ')}
                {' '}— add from the Viewer after upload if needed.
              </p>
            </section>
          )}

          <div className="rounded-input bg-brand-skyLight/50 border border-brand-blue/20 px-3 py-2 text-xs text-ink inline-flex items-start gap-2">
            <Sparkles size={12} className="text-brand-blue mt-0.5 shrink-0" />
            <span>
              After upload, DocBrain runs the full analysis (OCR + classify + extract + embed) on
              the saved file and persists results to the Viewer.
            </span>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-divider bg-page">
          <Button type="button" variant="secondary" onClick={onCancel} data-testid="confirm-cancel">
            Back to edit
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            loading={uploading}
            disabled={missingRequired.length > 0}
            data-testid="confirm-upload"
          >
            <Upload size={14} /> Confirm upload
          </Button>
        </footer>
      </div>
    </div>
  );
}

// ── AutoRoutedBadge ───────────────────────────────────────────────────────────

/**
 * Shown after upload when the backend auto-resolved the folder from the
 * document type's default_folder_id (source: 'doctype-default').
 *
 * Props:
 *   folderName  — human-readable folder name from the server response
 *   documentId  — used to link to the viewer for the "Move…" action
 *   compact     — when true (batch cards) renders a smaller inline variant
 *
 * New test IDs: capture-auto-routed-badge
 */
function AutoRoutedBadge({
  folderName,
  documentId,
  compact = false,
}: {
  folderName: string;
  documentId: number;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-input border-l-2 border-brand-blue bg-gradient-to-r from-brand-skyLight/60 to-brand-blue/10 px-2 py-0.5 text-[10px] text-brand-blue"
        data-testid="capture-auto-routed-badge"
        title={`AI auto-routed to folder: ${folderName}`}
      >
        <Sparkles size={9} />
        <FolderOpen size={9} />
        {folderName}
      </span>
    );
  }

  return (
    <div
      className="rounded-lg border-l-4 border-brand-blue bg-gradient-to-r from-brand-skyLight/60 to-brand-blue/10 px-3 py-2 space-y-1"
      data-testid="capture-auto-routed-badge"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-brand-blue">
        <Sparkles size={12} />
        AI auto-routed to
        <FolderOpen size={12} />
        <span>{folderName}</span>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-ink-sub">
          Reviewer can confirm or move during approval.
        </p>
        <Link
          to={`/viewer/${documentId}`}
          className="inline-flex items-center gap-1 text-[11px] text-brand-blue hover:underline"
          aria-label={`Open document ${documentId} in viewer to change folder`}
        >
          <FolderOpen size={11} /> Move…
        </Link>
      </div>
    </div>
  );
}
