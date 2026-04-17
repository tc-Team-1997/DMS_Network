import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Upload, FileText, CheckCircle2, AlertCircle, Sparkles, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Input, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { HttpError } from '@/lib/http';
import { fetchFolders, uploadDocument } from './api';
import { analyzeDocument } from '@/modules/docbrain/api';

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

const DOC_TYPES = [
  'Passport', 'National ID', 'Utility Bill', 'Loan Application',
  'Contract', 'Compliance', 'KYC', 'Other',
];

export function CapturePage() {
  const folders = useQuery({ queryKey: ['folders'], queryFn: fetchFolders });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [lastUploadId, setLastUploadId] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: uploadDocument,
    onSuccess: (r) => {
      setLastUploadId(r.id);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Fire-and-forget DocBrain analysis so by the time the user opens
      // the viewer, classification + entities are already populated.
      analyzeDocument(r.id).catch(() => {
        /* ignore — user can retry from Viewer's AI panel */
      });
    },
  });

  const onFileChange = (f: File | null) => {
    setClientError(null);
    setLastUploadId(null);
    if (!f) return setFile(null);
    if (!ALLOWED.includes(f.type)) {
      setClientError(`Unsupported file type: ${f.type || 'unknown'}`);
      return setFile(null);
    }
    if (f.size > MAX_BYTES) {
      setClientError('File exceeds 50 MB');
      return setFile(null);
    }
    setFile(f);
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) {
      setClientError('Select a file to upload');
      return;
    }
    const form = new FormData(e.currentTarget);
    form.set('file', file);
    mutation.mutate(form);
  };

  const serverError =
    mutation.error instanceof HttpError ? mutation.error.message : null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <Panel title="Upload document" className="xl:col-span-2">
        <form onSubmit={onSubmit} className="space-y-4">
          <label
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed',
              'border-border bg-page hover:border-brand-blue hover:bg-brand-skyLight transition-colors cursor-pointer',
              'py-10 px-6 text-center',
              file && 'border-success bg-success-bg',
            )}
          >
            {file ? <FileText size={28} className="text-success" /> : <Upload size={28} className="text-brand-blue" />}
            <div className="text-md font-medium text-ink">
              {file ? file.name : 'Drop a file here or click to browse'}
            </div>
            <div className="text-xs text-muted">
              {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type || 'unknown'}` : 'PDF, JPG, PNG, WEBP, TIFF, DOC, DOCX, TXT · max 50 MB'}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept={ALLOWED.join(',')}
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Document type</span>
              <select
                name="doc_type"
                defaultValue=""
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-md"
              >
                <option value="" disabled>Select…</option>
                {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Folder</span>
              <select
                name="folder_id"
                defaultValue=""
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-md"
              >
                <option value="">— no folder —</option>
                {folders.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <Input label="Customer CID" name="customer_cid" />
            <Input label="Customer name" name="customer_name" />
            <Input label="Document number" name="doc_number" />
            <Input label="Date of birth" name="dob" type="date" />
            <Input label="Issue date" name="issue_date" type="date" />
            <Input label="Expiry date" name="expiry_date" type="date" />
            <Input label="Issuing authority" name="issuing_authority" />
            <Input label="Branch" name="branch" placeholder="e.g. Cairo West" />
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Notes</span>
            <textarea
              name="notes"
              rows={3}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-md"
            />
          </label>

          {clientError && (
            <div className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger flex items-center gap-2">
              <AlertCircle size={14} /> {clientError}
            </div>
          )}
          {serverError && (
            <div className="rounded-lg bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger flex items-center gap-2">
              <AlertCircle size={14} /> Upload failed — {serverError}
            </div>
          )}
          {lastUploadId !== null && (
            <div className="rounded-lg bg-success-bg border border-success/30 px-3 py-3 text-xs text-success space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 size={14} /> Uploaded as document #{lastUploadId}
              </div>
              <div className="flex items-center gap-2 text-ink">
                <Sparkles size={12} className="text-brand-blue" />
                DocBrain is analysing locally (OCR + classify + extract). Open it in the viewer to see results.
              </div>
              <div>
                <Link to={`/viewer/${lastUploadId}`}>
                  <Button size="sm">
                    <ExternalLink size={12} /> Open in viewer
                  </Button>
                </Link>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => {
              setFile(null);
              setClientError(null);
              setLastUploadId(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}>
              Reset
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!file}>
              Upload
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Capture guidelines">
        <ul className="space-y-2 text-md text-muted">
          <li>• Scanned PDFs under 10 MB OCR fastest.</li>
          <li>• Passports and IDs: include all corners and the MRZ line.</li>
          <li>• Utility bills: top-of-page with customer name and address visible.</li>
          <li>• Expiry date drives alerts — fill it when known.</li>
          <li>• Files are virus-scoped server-side before indexing.</li>
        </ul>
      </Panel>
    </div>
  );
}
