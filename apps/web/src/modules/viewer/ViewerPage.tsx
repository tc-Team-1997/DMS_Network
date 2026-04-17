import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Button, Panel, statusTone } from '@/components/ui';
import { fetchDocument } from '@/modules/repository/api';
import { AIPanel } from '@/modules/docbrain/AIPanel';
import { RagChat } from '@/modules/docbrain/RagChat';

export function ViewerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const docId = id ? Number(id) : NaN;

  const doc = useQuery({
    queryKey: ['document', docId],
    queryFn: () => fetchDocument(docId),
    enabled: Number.isFinite(docId),
  });

  if (!Number.isFinite(docId)) {
    return (
      <Panel title="No document selected">
        <p className="text-md text-muted">
          Open a document from the{' '}
          <Link to="/repository" className="text-brand-blue hover:underline">repository</Link>.
        </p>
      </Panel>
    );
  }

  if (doc.isLoading) return <Panel>Loading…</Panel>;
  if (doc.error) return <Panel title="Not found"><p className="text-md text-danger">{doc.error.message}</p></Panel>;
  if (!doc.data) return null;

  const d = doc.data;
  const src = `/uploads/${d.filename}`;
  const isPdf = (d.mime_type ?? '').includes('pdf');
  const isImage = (d.mime_type ?? '').startsWith('image/');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
      {/* Left: preview + chat */}
      <div className="space-y-6">
        <Panel
          title={d.original_name ?? d.filename}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate(-1)}>
                <ArrowLeft size={14} /> Back
              </Button>
              <a href={src} download>
                <Button size="sm"><Download size={14} /> Download</Button>
              </a>
            </div>
          }
        >
          <div className="rounded-card border border-divider bg-page min-h-[520px] flex items-center justify-center overflow-hidden">
            {isPdf && (
              <iframe title="Document preview" src={src} className="w-full h-[620px] border-0" />
            )}
            {isImage && (
              <img src={src} alt="" className="max-h-[620px] max-w-full object-contain" />
            )}
            {!isPdf && !isImage && (
              <div className="text-center text-muted p-8">
                <p className="text-md mb-2">Preview not available for {d.mime_type ?? 'this file type'}.</p>
                <a href={src} download><Button size="sm">Download</Button></a>
              </div>
            )}
          </div>
        </Panel>

        <RagChat documentId={docId} />
      </div>

      {/* Right: metadata + AI panel */}
      <div className="space-y-6">
        <AIPanel documentId={docId} />

        <Panel title="Metadata">
          <dl className="space-y-3 text-md">
            <Row label="Status"><Badge tone={statusTone(d.status)}>{d.status}</Badge></Row>
            <Row label="Type">{d.doc_type ?? '—'}</Row>
            <Row label="Customer">{d.customer_name ?? d.customer_cid ?? '—'}</Row>
            <Row label="CID">{d.customer_cid ?? '—'}</Row>
            <Row label="Doc number">{d.doc_number ?? '—'}</Row>
            <Row label="Branch">{d.branch ?? '—'}</Row>
            <Row label="Expiry">{d.expiry_date ?? '—'}</Row>
            <Row label="Uploaded">{new Date(d.uploaded_at).toLocaleString()}</Row>
            <Row label="Size">{d.size ? `${(d.size / 1024).toFixed(0)} KB` : '—'}</Row>
            <Row label="OCR">
              {d.ocr_confidence != null
                ? <Badge tone={d.ocr_confidence > 90 ? 'success' : d.ocr_confidence > 70 ? 'warning' : 'danger'}>
                    {d.ocr_confidence.toFixed(1)}%
                  </Badge>
                : <span className="text-muted">pending</span>}
            </Row>
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-ink text-right">{children}</dd>
    </div>
  );
}
