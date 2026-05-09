/**
 * BatchFileCard — per-file card in the batch upload list.
 *
 * Shows a thumbnail, file info, AI classification status, editable metadata,
 * and per-field Revert/Lock affordances via DynamicField.
 */

import { FileText, X, RefreshCw, CheckCircle2, AlertCircle, Wand2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { DocumentType } from '@/modules/document-types/api';
import type { FileCard } from '../types';
import { DEFAULT_CONFIDENCE_HIGH } from '../constants';
import { fmtSize } from '../utils';
import { DynamicField } from './DynamicField';
import { AutoRoutedBadge } from './AutoRoutedBadge';

interface BatchFileCardProps {
  card: FileCard;
  types: DocumentType[];
  onRemove: (id: string) => void;
  onRescan: (id: string) => void;
  onFieldChange: (cardId: string, key: string, val: string) => void;
  onDocTypeChange: (cardId: string, typeId: number | null) => void;
  onRevertField: (cardId: string, key: string) => void;
  onToggleLock: (cardId: string, key: string) => void;
}

export function BatchFileCard({
  card,
  types,
  onRemove,
  onRescan,
  onFieldChange,
  onDocTypeChange,
  onRevertField,
  onToggleLock,
}: BatchFileCardProps) {
  const { file, objectUrl, status, docTypeId, form, aiFilled, aiOriginalValues, manualEdits, lockedFields } = card;
  const isImage = file.type.startsWith('image/');
  const isPdf   = file.type === 'application/pdf';
  const docType = types.find((t) => t.id === docTypeId) ?? null;

  const statusNode = (() => {
    switch (status.tag) {
      case 'scanning':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-brand-blue font-medium">
            <Wand2 size={11} className="motion-safe:animate-pulse" aria-hidden="true" /> Scanning…
          </span>
        );
      case 'ready':
        return (
          <Badge tone={status.preview.classification.confidence >= DEFAULT_CONFIDENCE_HIGH ? 'success' : 'warning'}>
            {status.preview.classification.doc_class} · {Math.round(status.preview.classification.confidence * 100)}%
          </Badge>
        );
      case 'scan_error':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-danger">
            <AlertCircle size={11} aria-hidden="true" /> {status.message}
          </span>
        );
      case 'uploading':
        return <span className="text-xs text-brand-blue">Uploading…</span>;
      case 'done':
        return (
          <span className="inline-flex flex-col gap-1">
            <Link to={`/viewer/${status.uploadId}`} className="inline-flex items-center gap-1 text-xs text-success hover:underline">
              <CheckCircle2 size={11} aria-hidden="true" /> Doc #{status.uploadId}
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
        return (
          <span className="inline-flex items-center gap-1 text-xs text-danger">
            <AlertCircle size={11} aria-hidden="true" /> {status.message}
          </span>
        );
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
          'flex items-start gap-3 px-3 py-2 border-b border-divider transition-colors duration-200',
          status.tag === 'scanning' ? 'bg-brand-skyLight/20' : 'bg-raised',
        )}
      >
        {/* Thumbnail */}
        <div className="w-12 h-12 rounded-input border border-divider bg-page flex-shrink-0 overflow-hidden flex items-center justify-center">
          {isImage ? (
            <img src={objectUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <FileText size={20} className={cn('text-brand-blue', isPdf && 'text-danger')} />
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
              <RefreshCw size={11} aria-hidden="true" /> Rescan
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(card.id)}
            title="Remove"
            data-testid={`batch-remove-${card.id}`}
            className="w-6 h-6 rounded-input flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg"
          >
            <X size={13} aria-hidden="true" />
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
                  {...(aiOriginalValues[fieldDef.key] !== undefined
                    ? { aiOriginalValue: aiOriginalValues[fieldDef.key] }
                    : {})}
                  isManuallyEdited={manualEdits[fieldDef.key] === true}
                  isLocked={lockedFields[fieldDef.key] === true}
                  onRevert={(key) => onRevertField(card.id, key)}
                  onToggleLock={(key) => onToggleLock(card.id, key)}
                  confidenceHigh={docType.high_confidence ?? DEFAULT_CONFIDENCE_HIGH}
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
