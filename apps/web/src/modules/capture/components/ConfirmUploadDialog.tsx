/**
 * ConfirmUploadDialog — final review modal before committing the upload.
 *
 * Renders as a centered modal overlay. Closes on Escape or backdrop click.
 * Uses the native dialog pattern (role="dialog" + aria-modal).
 */

import { useEffect } from 'react';
import { CheckCircle2, FileText, Upload, X, Sparkles } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { DocumentType } from '@/modules/document-types/api';
import type { PreviewResponse } from '../api';
import type { FormState } from '../types';
import { fmtSize } from '../utils';
import { DEFAULT_CONFIDENCE_HIGH } from '../constants';

interface ConfirmUploadDialogProps {
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
}

export function ConfirmUploadDialog({
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
}: ConfirmUploadDialogProps) {
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
                          tone={
                            (aiFilled[field.key] ?? 0) >= DEFAULT_CONFIDENCE_HIGH ? 'purple' : 'warning'
                          }
                          className={cn('inline-flex items-center gap-1 normal-case')}
                        >
                          <Sparkles size={9} aria-hidden="true" />
                          AI · {Math.round((aiFilled[field.key] ?? 0) * 100)}%
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
            <Sparkles size={12} className="text-brand-blue mt-0.5 shrink-0" aria-hidden="true" />
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
