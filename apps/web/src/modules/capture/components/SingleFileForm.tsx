/**
 * SingleFileForm — single-document upload form.
 *
 * Handles the drop zone, AI preview status, field form, CBS lookup,
 * validate + confirm flow, and post-upload success state.
 */

import React, { type FormEvent } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Eye,
  Wand2,
  Database,
  Camera,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, Input, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import type { DocumentType, FieldDef } from '@/modules/document-types/api';
import type { Folder } from '@/lib/schemas';
import type { PreviewResponse } from '../api';
import type { FormState } from '../types';
import { ALLOWED_MIME_TYPES, DEFAULT_CONFIDENCE_HIGH, MAX_FILES } from '../constants';
import { fmtSize } from '../utils';
import { DynamicField } from './DynamicField';

// ── CBS feature flag ──────────────────────────────────────────────────────────
const FF_CBS_LIVE: boolean =
  import.meta.env['VITE_FF_CBS_LIVE'] !== undefined
    ? import.meta.env['VITE_FF_CBS_LIVE'] !== 'false'
    : false;

// ── File preview (inline PDF / image) ────────────────────────────────────────

function FilePreview({ file, url, scanning = false }: { file: File; url: string; scanning?: boolean }) {
  const isPdf   = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');
  const canPreview = isPdf || isImage;
  return (
    <div className="rounded-card border border-divider bg-page overflow-hidden" data-testid="capture-file-preview">
      <div className="flex items-center justify-between px-3 py-2 border-b border-divider bg-white">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Eye size={12} className="text-brand-blue" aria-hidden="true" /> Preview
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
        {/* Restrained scanning overlay — no ai-scan-line animation */}
        {scanning && (
          <div className="absolute inset-0 pointer-events-none bg-brand-skyLight/10 flex items-start justify-end p-2" aria-hidden="true">
            <span className="inline-flex items-center gap-1 rounded-badge px-2 py-1 text-[10px] font-semibold bg-brand-navy/80 text-brand-skyLight border border-brand-sky/30">
              <Wand2 size={9} className="motion-safe:animate-pulse" /> Analysing…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Preview status banner ────────────────────────────────────────────────────

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
        className="rounded-card border border-brand-blue/20 bg-brand-skyLight/20 px-3 py-2.5 text-xs flex items-center gap-2 text-brand-blue"
        data-testid="capture-preview-running"
        role="status"
        aria-live="polite"
      >
        <Wand2 size={14} className="motion-safe:animate-pulse shrink-0" aria-hidden="true" />
        <span className="font-medium">DocBrain is reading the file — OCR + classify + extract…</span>
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
      <Sparkles size={13} className="text-brand-blue" aria-hidden="true" />
      <span className="font-medium">AI preview</span>
      <Badge tone={cls.confidence >= DEFAULT_CONFIDENCE_HIGH ? 'success' : 'warning'}>
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

// ── AI suggest chip ──────────────────────────────────────────────────────────

interface AiSuggestChipProps {
  name: string;
  similarity: number;
  onUse: () => void;
  onDismiss: () => void;
}
function AiSuggestChip({ name, similarity, onUse, onDismiss }: AiSuggestChipProps) {
  return (
    <div
      className="flex items-center gap-2 rounded-input border border-brand-blue/30 bg-brand-skyLight/50 px-3 py-1.5 text-xs text-ink"
      role="status"
      aria-live="polite"
      data-testid="capture-ai-suggest-chip"
    >
      <Sparkles size={12} className="text-brand-blue shrink-0" aria-hidden="true" />
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
        ×
      </button>
    </div>
  );
}

// ── Submit button ────────────────────────────────────────────────────────────

function SubmitButton({ loading, disabled, analysing }: { loading: boolean; disabled: boolean; analysing: boolean }) {
  return (
    <Button
      type="submit"
      loading={loading}
      disabled={disabled}
      data-testid="capture-submit"
    >
      {analysing ? (
        <><Wand2 size={14} className="motion-safe:animate-pulse" aria-hidden="true" /> Analysing…</>
      ) : (
        <><Upload size={14} aria-hidden="true" /> Upload</>
      )}
    </Button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface SingleFileFormProps {
  // File
  file: File | null;
  fileUrl: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  // Document type + folder
  docTypeId: number | null;
  types: DocumentType[];
  typesLoading: boolean;
  folderId: string;
  folders: Folder[];
  branch: string;
  // Form fields (AI autofill-aware)
  form: FormState;
  aiFilled: Record<string, number>;
  aiOriginalValues: Record<string, string>;
  manualEdits: Record<string, true>;
  lockedFields: Record<string, true>;
  selectedType: DocumentType | null;
  // Preview
  previewStatus: 'idle' | 'running' | 'done' | 'error';
  preview: PreviewResponse | null;
  previewError: string | null;
  // AI suggest
  aiSuggest: { best_match: { name: string; similarity: number } | null } | null;
  aiSuggestDismissed: boolean;
  // Upload state
  uploading: boolean;
  serverError: string | null;
  validationErrors: string[];
  clientError: string | null;
  lastUploadId: number | null;
  // Camera
  cameraEnabled: boolean;
  // CBS
  cbsRole: string | undefined;
  // Callbacks
  onDocTypeChange: (id: number | null) => void;
  onFolderChange: (v: string) => void;
  onBranchChange: (v: string) => void;
  onFieldChange: (key: string, value: string) => void;
  onRevertField: (key: string) => void;
  onToggleLock: (key: string) => void;
  onRetryPreview: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent<HTMLLabelElement>) => void;
  onAiSuggestUse: () => void;
  onAiSuggestDismiss: () => void;
  onCbsOpen: () => void;
}

export function SingleFileForm({
  file,
  fileUrl,
  fileInputRef,
  docTypeId,
  types,
  typesLoading,
  folderId,
  folders,
  branch,
  form,
  aiFilled,
  aiOriginalValues,
  manualEdits,
  lockedFields,
  selectedType,
  previewStatus,
  preview,
  previewError,
  aiSuggest,
  aiSuggestDismissed,
  uploading,
  serverError,
  validationErrors,
  clientError,
  lastUploadId,
  cameraEnabled,
  cbsRole,
  onDocTypeChange,
  onFolderChange,
  onBranchChange,
  onFieldChange,
  onRevertField,
  onToggleLock,
  onRetryPreview,
  onSubmit,
  onReset,
  onInputChange,
  onDrop,
  onAiSuggestUse,
  onAiSuggestDismiss,
  onCbsOpen,
}: SingleFileFormProps) {
  const canCbs = FF_CBS_LIVE && (cbsRole === 'Maker' || cbsRole === 'Doc Admin');

  return (
    <Panel title="Upload document" className="xl:col-span-2">
      <form onSubmit={onSubmit} className="space-y-4">
        {/* Drop zone */}
        <label
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
          {file
            ? <FileText size={28} className="text-success" aria-hidden="true" />
            : <Upload size={28} className="text-brand-blue" aria-hidden="true" />}
          <div className="text-md font-medium text-ink">
            {file ? file.name : 'Drop files here or click to browse'}
          </div>
          <div className="text-xs text-muted">
            {file
              ? `${fmtSize(file.size)} · ${file.type || 'unknown'}`
              : `PDF, JPG, PNG, WEBP, TIFF, DOC, DOCX, TXT · max 50 MB · up to ${MAX_FILES} files`}
          </div>
          {/* Standard file input */}
          <input
            ref={fileInputRef as React.RefObject<HTMLInputElement>}
            type="file"
            multiple
            data-testid="capture-file-input"
            className="sr-only"
            accept={ALLOWED_MIME_TYPES.join(',')}
            onChange={onInputChange}
          />
          {/* Camera capture — mobile path, gated by tenant config */}
          {cameraEnabled && !file && (
            <span className="inline-flex items-center gap-1.5 mt-1 text-[11px] text-muted">
              <Camera size={11} aria-hidden="true" />
              <label className="cursor-pointer text-brand-blue hover:underline">
                Use camera
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={onInputChange}
                  data-testid="capture-camera-input"
                />
              </label>
            </span>
          )}
        </label>

        {file && fileUrl && <FilePreview file={file} url={fileUrl} scanning={previewStatus === 'running'} />}

        {file && (
          <PreviewStatus
            status={previewStatus}
            preview={preview}
            onRetry={onRetryPreview}
            error={previewError}
          />
        )}

        {/* AI suggest chip */}
        {file && aiSuggest?.best_match && aiSuggest.best_match.similarity > 0.7 && !aiSuggestDismissed && (
          <AiSuggestChip
            name={aiSuggest.best_match.name}
            similarity={aiSuggest.best_match.similarity}
            onUse={onAiSuggestUse}
            onDismiss={onAiSuggestDismiss}
          />
        )}

        {/* Doc type + folder */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
              Document type <span className="text-danger">*</span>
            </span>
            <select
              value={docTypeId ?? ''}
              onChange={(e) => {
                onDocTypeChange(e.target.value ? parseInt(e.target.value, 10) : null);
              }}
              data-testid="capture-field-doc_type"
              disabled={typesLoading}
              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-md"
            >
              <option value="">{typesLoading ? 'Loading…' : 'Select…'}</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 text-xs font-medium text-muted">Folder</span>
            <select
              value={folderId}
              onChange={(e) => onFolderChange(e.target.value)}
              data-testid="capture-field-folder_id"
              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-md"
            >
              <option value="">— no folder —</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        </div>

        {/* Dynamic schema fields */}
        {selectedType && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="capture-schema-fields">
            {selectedType.fields.map((fieldDef: FieldDef) => (
              <DynamicField
                key={fieldDef.key}
                field={fieldDef}
                value={form[fieldDef.key] ?? ''}
                onChange={(v) => onFieldChange(fieldDef.key, v)}
                confidence={aiFilled[fieldDef.key]}
                {...(aiOriginalValues[fieldDef.key] !== undefined
                  ? { aiOriginalValue: aiOriginalValues[fieldDef.key] }
                  : {})}
                isManuallyEdited={manualEdits[fieldDef.key] === true}
                isLocked={lockedFields[fieldDef.key] === true}
                onRevert={onRevertField}
                onToggleLock={onToggleLock}
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
              onChange={(e) => onBranchChange(e.target.value)}
              placeholder="e.g. Thimphu"
              data-testid="capture-field-branch"
            />
          </label>
        )}

        {/* Validation errors */}
        {validationErrors.length > 0 && (
          <div className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger" data-testid="capture-validation">
            <p className="font-medium flex items-center gap-2">
              <AlertCircle size={13} aria-hidden="true" /> Fix before uploading:
            </p>
            <ul className="mt-1 list-disc list-inside">
              {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        {clientError && (
          <div className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger flex items-center gap-2" data-testid="capture-client-error">
            <AlertCircle size={14} aria-hidden="true" /> {clientError}
          </div>
        )}
        {serverError && (
          <div className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger flex items-center gap-2">
            <AlertCircle size={14} aria-hidden="true" /> Upload failed — {serverError}
          </div>
        )}

        {/* Success — pipeline shown in DocumentSummaryPanel */}
        {lastUploadId !== null && (
          <div className="space-y-2" data-testid="capture-success">
            <div className="rounded-lg bg-success-bg border border-success/30 px-3 py-2 text-xs text-success flex items-center gap-2 font-medium">
              <CheckCircle2 size={14} aria-hidden="true" /> Uploaded as document #{lastUploadId}
            </div>
            <Link to={`/viewer/${lastUploadId}`}>
              <Button size="sm" variant="secondary">
                Open in viewer
              </Button>
            </Link>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between items-center gap-2">
          {canCbs && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="cbs-lookup-button"
              onClick={onCbsOpen}
            >
              <Database size={13} aria-hidden="true" />
              {t('cbs.pull_from_cbs_button')}
            </Button>
          )}
          <div className="flex gap-2 ms-auto">
            <Button type="button" variant="secondary" onClick={onReset}>Reset</Button>
            <SubmitButton
              loading={uploading}
              disabled={!file || previewStatus === 'running' || !selectedType}
              analysing={previewStatus === 'running'}
            />
          </div>
        </div>
      </form>
    </Panel>
  );
}
