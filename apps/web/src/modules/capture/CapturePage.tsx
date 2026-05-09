/**
 * CapturePage — orchestrator for single-file and multi-file (batch) capture.
 *
 * This file only coordinates. Heavy render trees live in:
 *   components/SingleFileForm.tsx   — single-doc form
 *   components/BatchMode.tsx        — batch upload UI
 *   hooks/useBatchUpload.ts         — batch state + per-file mutations
 *   hooks/useAiAutofill.ts          — AI field state + revert/lock
 *
 * Tenant-controlled limits (max_file_size_mb, batch_limit, camera_capture_enabled)
 * are read from the 'capture' tenant_config namespace via useTenantConfig.
 */

import React, { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { HttpError } from '@/lib/http';
import { useAuth } from '@/store/auth';
import { useTenantConfig } from '@/store/tenant-config';
import { CbsLookupDialog } from '@/modules/cbs/components/CbsLookupDialog';
import {
  fetchFolders,
  previewDocument,
  uploadDocumentWithKey,
} from './api';
import { analyzeDocument } from '@/modules/docbrain/api';
import {
  classifyOne,
  fetchDocumentTypes,
  type ClassifyOneResponse,
} from '@/modules/document-types/api';
import {
  enqueue as outboxEnqueue,
  isIndexedDbAvailable,
  type EnqueueInput,
} from '@/lib/offline-outbox';
import type { DocumentType } from '@/modules/document-types/api';

import { SingleFileForm } from './components/SingleFileForm';
import { BatchMode } from './components/BatchMode';
import { DocumentSummaryPanel } from './components/DocumentSummaryPanel';
import { ConfirmUploadDialog } from './components/ConfirmUploadDialog';
import { useAiAutofill } from './hooks/useAiAutofill';
import { useBatchUpload } from './hooks/useBatchUpload';
import {
  ALLOWED_MIME_TYPES,
  DEFAULT_AUTOFILL_FLOOR,
  MAX_FILES,
  MAX_BYTES,
  PREVIEW_MAX_BYTES,
} from './constants';

// ---------------------------------------------------------------------------
// Tenant config helpers
// ---------------------------------------------------------------------------

function readNum(cfg: Record<string, unknown>, key: string, fallback: number): number {
  const v = cfg[key];
  return typeof v === 'number' ? v : fallback;
}
function readBool(cfg: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = cfg[key];
  return typeof v === 'boolean' ? v : fallback;
}

// ---------------------------------------------------------------------------
// CapturePage
// ---------------------------------------------------------------------------

export function CapturePage() {
  // ── data queries ──────────────────────────────────────────────────────────
  const folders = useQuery({ queryKey: ['folders'], queryFn: fetchFolders });
  const types = useQuery({
    queryKey: ['document-types', { active: true }],
    queryFn: () => fetchDocumentTypes(true),
  });
  const captureConfig = useTenantConfig('capture');
  const cfg = (captureConfig.data ?? {}) as Record<string, unknown>;

  // Tenant-controlled limits (fall back to hard-coded defaults if config absent)
  const maxBytes    = readNum(cfg, 'max_file_size_mb', 50) * 1024 * 1024;
  const batchLimit  = readNum(cfg, 'batch_limit', MAX_FILES);
  const cameraEnabled = readBool(cfg, 'camera_capture_enabled', true);

  // ── refs ──────────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── single-file state ─────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [docTypeId, setDocTypeId] = useState<number | null>(null);
  const [folderId, setFolderId] = useState('');
  const [branch, setBranch] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const [lastUploadId, setLastUploadId] = useState<number | null>(null);
  const [lastAutoRouted, setLastAutoRouted] = useState<import('./api').AutoRouted | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [aiSuggest, setAiSuggest] = useState<ClassifyOneResponse | null>(null);
  const [aiSuggestDismissed, setAiSuggestDismissed] = useState(false);
  const [uploadedDocType, setUploadedDocType] = useState<string | null>(null);
  const [uploadedOcr, setUploadedOcr] = useState<number | null>(null);
  const [uploadedOcrText, setUploadedOcrText] = useState<string | null>(null);
  const [offlineToast, setOfflineToast] = useState<string | null>(null);

  // ── auth ──────────────────────────────────────────────────────────────────
  const sessionUser = useAuth((s) => s.user);
  const cbsRole = useAuth((s) => s.user?.role);

  // ── AI autofill hook ──────────────────────────────────────────────────────
  const selectedType = useMemo<DocumentType | null>(
    () => types.data?.find((t) => t.id === docTypeId) ?? null,
    [types.data, docTypeId],
  );
  const {
    form,
    aiFilled,
    aiOriginalValues,
    manualEdits,
    lockedFields,
    setField,
    revertField,
    toggleLock,
    applyPreview,
    resetAutofill,
  } = useAiAutofill({ selectedType });

  // ── batch upload hook ─────────────────────────────────────────────────────
  const {
    cards,
    batchFolderId,
    batchBranch,
    batchUploading,
    setBatchFolderId,
    setBatchBranch,
    buildCards,
    setCards,
    scanCard,
    rescanCard,
    updateCardField,
    updateCardDocType,
    revertCardField,
    toggleCardLock,
    removeCard,
    resetBatch,
    uploadAll,
  } = useBatchUpload({ types: types.data, fileInputRef });

  const isMulti = cards.length > 0;

  // ── default doc type ──────────────────────────────────────────────────────
  useEffect(() => {
    if (docTypeId == null && types.data && types.data.length > 0) {
      setDocTypeId(types.data[0]?.id ?? null);
    }
  }, [docTypeId, types.data]);

  // ── blob URL for single file ──────────────────────────────────────────────
  useEffect(() => {
    if (!file) { setFileUrl(null); return; }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // ── clean up batch object URLs on unmount ─────────────────────────────────
  useEffect(() => {
    return () => {
      setCards((prev) => { for (const c of prev) URL.revokeObjectURL(c.objectUrl); return prev; });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── preview mutation ──────────────────────────────────────────────────────
  const previewMutation = useMutation({
    mutationFn: previewDocument,
    onSuccess: (data) => {
      // Auto-select doc type from classification.
      const cls = data.classification;
      const autofillFloor = selectedType?.autofill_floor ?? DEFAULT_AUTOFILL_FLOOR;
      if (cls.doc_class && cls.doc_class !== 'Unknown' && cls.confidence >= autofillFloor && !manualEdits['__doc_type']) {
        const normalised = cls.doc_class.toLowerCase().replace(/[\s_-]+/g, '');
        const match = types.data?.find(
          (t) => t.name.toLowerCase().replace(/\s+/g, '') === normalised,
        );
        if (match) setDocTypeId(match.id);
      }
      applyPreview(data);
    },
  });

  const preview = previewMutation.data ?? null;
  const previewStatus: 'idle' | 'running' | 'done' | 'error' =
    previewMutation.isPending ? 'running'
    : previewMutation.isError  ? 'error'
    : preview                  ? 'done'
    : 'idle';

  // ── upload mutation ───────────────────────────────────────────────────────
  const uploadMutation = useMutation({
    mutationFn: ({ fd, key }: { fd: FormData; key: string }) =>
      uploadDocumentWithKey(fd, key),
    onSuccess: (r) => {
      setLastUploadId(r.id);
      setLastAutoRouted(r.auto_routed ?? null);
      if (preview) {
        setUploadedDocType(preview.classification.doc_class);
        setUploadedOcr(preview.classification.confidence * 100);
        setUploadedOcrText(preview.summary || null);
      }
      analyzeDocument(r.id).catch(() => {});
      setFile(null);
      resetAutofill();
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  // ── reset ─────────────────────────────────────────────────────────────────
  const reset = () => {
    setFile(null);
    resetAutofill();
    setValidationErrors([]);
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
    previewMutation.reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── file selection ────────────────────────────────────────────────────────
  const processFiles = (files: File[]) => {
    setClientError(null);
    setLastUploadId(null);

    const effectiveMaxBytes = maxBytes || MAX_BYTES;
    const effectiveBatchLimit = batchLimit || MAX_FILES;

    const valid = files.filter((f) => {
      if (!ALLOWED_MIME_TYPES.includes(f.type)) return false;
      if (f.size > effectiveMaxBytes) return false;
      return true;
    });

    if (valid.length === 0) {
      setClientError('No supported files selected. Check type and size.');
      return;
    }
    if (valid.length > effectiveBatchLimit) {
      setClientError(`Maximum ${effectiveBatchLimit} files per batch.`);
      return;
    }

    // Single file → original single-file flow
    if (valid.length === 1) {
      for (const c of cards) URL.revokeObjectURL(c.objectUrl);
      setCards([]);
      const f = valid[0]!;
      setFile(f);
      previewMutation.reset();
      resetAutofill();
      setAiSuggest(null);
      setAiSuggestDismissed(false);
      if (f.size > PREVIEW_MAX_BYTES) {
        setClientError('File too large for AI preview (>25 MB). Upload will still work.');
        return;
      }
      previewMutation.mutate(f);
      classifyOne(f).then(setAiSuggest).catch(() => {});
      return;
    }

    // Multi-file → build cards and scan
    setFile(null);
    const newCards = buildCards(valid);
    setCards(newCards);
    for (const card of newCards) {
      if (card.status.tag === 'scanning') void scanCard(card, newCards);
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 1) processFiles([files[0]!]);
    else if (files.length > 1) processFiles(files);
  };

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) processFiles(files);
  };

  // ── single-file validation + submit ──────────────────────────────────────
  const validate = (): string[] => {
    if (!selectedType) return ['Select a document type.'];
    return selectedType.fields
      .filter((f) => f.required && !String(form[f.key] ?? '').trim())
      .map((f) => `${f.label} is required.`);
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
    const key = crypto.randomUUID();
    const fd = new FormData();
    fd.set('file', file);
    fd.set('doc_type', selectedType.name);
    if (folderId) fd.set('folder_id', folderId);
    if (branch) fd.set('branch', branch);
    fd.set('metadata_json', JSON.stringify(form));
    uploadMutation.mutate(
      { fd, key },
      {
        onError: (err) => {
          const errAsUnknown: unknown = err;
          const errStatus: unknown =
            typeof errAsUnknown === 'object' && errAsUnknown !== null
              ? (errAsUnknown as Record<string, unknown>)['status']
              : undefined;
          const isOffline =
            (err instanceof TypeError && err.message.toLowerCase().includes('failed to fetch')) ||
            (err instanceof Error && err.message.toLowerCase().includes('network error')) ||
            errStatus === 0;

          if (isOffline && isIndexedDbAvailable()) {
            const entry: EnqueueInput = {
              id: crypto.randomUUID(),
              idempotency_key: key,
              endpoint: '/spa/api/documents',
              sensitive: {
                customer_cid: (form['customer_cid'] as string | undefined) ?? null,
                doc_number:   (form['doc_number']   as string | undefined) ?? null,
                customer_name:(form['customer_name'] as string | undefined) ?? null,
              },
              request_body: {
                original_name: file.name,
                doc_type: selectedType.name,
                metadata_json: JSON.stringify(form),
                notes: (form['notes'] as string | undefined) ?? null,
              },
              enqueued_at: new Date().toISOString(),
            };
            outboxEnqueue(entry, String(sessionUser?.id ?? 'anon'))
              .then(() => {
                setOfflineToast('Saved for sync — will upload when online');
                setTimeout(() => setOfflineToast(null), 6_000);
              })
              .catch(() => {
                setOfflineToast('Could not save offline — IndexedDB unavailable.');
                setTimeout(() => setOfflineToast(null), 4_000);
              });
          }
        },
      },
    );
    setConfirming(false);
  };

  // ── CBS state ─────────────────────────────────────────────────────────────
  const [cbsDialogOpen, setCbsDialogOpen] = useState(false);

  // ── batch: handle removing card that drops count to 1 ────────────────────
  const handleRemoveCard = (cardId: string) => {
    removeCard(cardId, (sole) => {
      setFile(sole.file);
      previewMutation.reset();
      resetAutofill();
    });
  };

  // ── render ────────────────────────────────────────────────────────────────

  if (isMulti) {
    return (
      <BatchMode
        cards={cards}
        types={types.data ?? []}
        folders={folders.data ?? []}
        batchFolderId={batchFolderId}
        batchBranch={batchBranch}
        batchUploading={batchUploading}
        fileInputRef={fileInputRef}
        onInputChange={onInputChange}
        onRemove={handleRemoveCard}
        onRescan={rescanCard}
        onFieldChange={updateCardField}
        onDocTypeChange={updateCardDocType}
        onRevertField={revertCardField}
        onToggleLock={toggleCardLock}
        onFolderChange={setBatchFolderId}
        onBranchChange={setBatchBranch}
        onUploadAll={uploadAll}
        onReset={resetBatch}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <SingleFileForm
        file={file}
        fileUrl={fileUrl}
        fileInputRef={fileInputRef}
        docTypeId={docTypeId}
        types={types.data ?? []}
        typesLoading={types.isLoading}
        folderId={folderId}
        folders={folders.data ?? []}
        branch={branch}
        form={form}
        aiFilled={aiFilled}
        aiOriginalValues={aiOriginalValues}
        manualEdits={manualEdits}
        lockedFields={lockedFields}
        selectedType={selectedType}
        previewStatus={previewStatus}
        preview={preview}
        previewError={previewMutation.error instanceof HttpError ? previewMutation.error.message : null}
        aiSuggest={aiSuggest}
        aiSuggestDismissed={aiSuggestDismissed}
        uploading={uploadMutation.isPending}
        serverError={uploadMutation.error instanceof HttpError ? uploadMutation.error.message : null}
        validationErrors={validationErrors}
        clientError={clientError}
        lastUploadId={lastUploadId}
        cameraEnabled={cameraEnabled}
        cbsRole={cbsRole}
        onDocTypeChange={(id) => {
          setDocTypeId(id);
          // Track that user manually selected doc type
        }}
        onFolderChange={setFolderId}
        onBranchChange={setBranch}
        onFieldChange={setField}
        onRevertField={revertField}
        onToggleLock={toggleLock}
        onRetryPreview={() => { if (file) previewMutation.mutate(file); }}
        onSubmit={onSubmit}
        onReset={reset}
        onInputChange={onInputChange}
        onDrop={onDrop}
        onAiSuggestUse={() => {
          const match = types.data?.find((t) => t.name === aiSuggest?.best_match?.name);
          if (match) setDocTypeId(match.id);
          setAiSuggestDismissed(true);
        }}
        onAiSuggestDismiss={() => setAiSuggestDismissed(true)}
        onCbsOpen={() => setCbsDialogOpen(true)}
      />

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
        onRetry={() => { if (file) previewMutation.mutate(file); }}
        error={previewMutation.error instanceof HttpError ? previewMutation.error.message : null}
        lastUploadId={lastUploadId}
        lastAutoRouted={lastAutoRouted}
        uploadedOcr={uploadedOcr}
        uploadedDocType={uploadedDocType}
        uploadedOcrText={uploadedOcrText}
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
