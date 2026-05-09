/**
 * BatchMode — multi-file batch upload UI.
 *
 * Renders the batch header, per-file BatchFileCards, status banners,
 * and the "Upload all" action button.
 */

import React from 'react';
import { Upload, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button, Input, Panel } from '@/components/ui';
import type { DocumentType } from '@/modules/document-types/api';
import type { Folder } from '@/lib/schemas';
import type { FileCard } from '../types';
import { ALLOWED_MIME_TYPES } from '../constants';
import { BatchFileCard } from './BatchFileCard';

interface BatchModeProps {
  cards: FileCard[];
  types: DocumentType[];
  folders: Folder[];
  batchFolderId: string;
  batchBranch: string;
  batchUploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
  onRescan: (id: string) => void;
  onFieldChange: (cardId: string, key: string, val: string) => void;
  onDocTypeChange: (cardId: string, typeId: number | null) => void;
  onRevertField: (cardId: string, key: string) => void;
  onToggleLock: (cardId: string, key: string) => void;
  onFolderChange: (v: string) => void;
  onBranchChange: (v: string) => void;
  onUploadAll: () => void;
  onReset: () => void;
}

export function BatchMode({
  cards,
  types,
  folders,
  batchFolderId,
  batchBranch,
  batchUploading,
  fileInputRef,
  onInputChange,
  onRemove,
  onRescan,
  onFieldChange,
  onDocTypeChange,
  onRevertField,
  onToggleLock,
  onFolderChange,
  onBranchChange,
  onUploadAll,
  onReset,
}: BatchModeProps) {
  const allDone   = cards.every((c) => c.status.tag === 'done');
  const hasFailed = cards.some((c) => c.status.tag === 'upload_error');
  const pending   = cards.filter((c) => c.status.tag !== 'done').length;

  return (
    <div className="space-y-4">
      <Panel
        title={`Batch capture — ${cards.length} files`}
        action={
          <div className="flex items-center gap-2">
            <label>
              <span className="sr-only">Add more files</span>
              <input
                ref={fileInputRef as React.RefObject<HTMLInputElement>}
                type="file"
                multiple
                className="sr-only"
                accept={ALLOWED_MIME_TYPES.join(',')}
                onChange={onInputChange}
                data-testid="capture-file-input"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={12} aria-hidden="true" /> Add files
              </Button>
            </label>
            <Button type="button" variant="secondary" size="sm" onClick={onReset}>
              <X size={12} aria-hidden="true" /> Clear all
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
              onChange={(e) => onFolderChange(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-md"
              data-testid="batch-folder"
            >
              <option value="">— no folder —</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 text-xs font-medium text-muted">Branch (all files)</span>
            <Input
              value={batchBranch}
              onChange={(e) => onBranchChange(e.target.value)}
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
              types={types}
              onRemove={onRemove}
              onRescan={onRescan}
              onFieldChange={onFieldChange}
              onDocTypeChange={onDocTypeChange}
              onRevertField={onRevertField}
              onToggleLock={onToggleLock}
            />
          ))}
        </div>

        {/* Status banners */}
        {allDone && (
          <div
            className="mt-4 rounded-lg bg-success-bg border border-success/30 px-3 py-2 text-xs text-success flex items-center gap-2"
            data-testid="batch-all-done"
          >
            <CheckCircle2 size={13} aria-hidden="true" /> All {cards.length} files uploaded successfully.
          </div>
        )}
        {hasFailed && !allDone && (
          <div
            className="mt-4 rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger flex items-center gap-2"
            data-testid="batch-has-errors"
          >
            <AlertCircle size={13} aria-hidden="true" /> Some uploads failed. Retry below or remove failed cards.
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex justify-end gap-2">
          {!allDone && (
            <Button
              onClick={onUploadAll}
              loading={batchUploading}
              disabled={batchUploading}
              data-testid="batch-upload-all"
            >
              <Upload size={14} aria-hidden="true" />
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
