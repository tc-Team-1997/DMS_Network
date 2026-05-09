import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder, Download, Trash2, ExternalLink, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, DataTable, Panel, statusTone, type Column } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { DocumentRow } from '@/lib/schemas';
import { useAuth } from '@/store/auth';
import { t } from '@/lib/i18n';
import { deleteDocument, fetchDocuments, fetchFolders } from './api';
import { CbsLinkDocumentDialog } from '@/modules/cbs/components/CbsLinkDocumentDialog';

// ── CBS feature flag ──────────────────────────────────────────────────────
const FF_CBS_LIVE: boolean =
  import.meta.env['VITE_FF_CBS_LIVE'] !== undefined
    ? import.meta.env['VITE_FF_CBS_LIVE'] !== 'false'
    : false;

export function RepositoryPage() {
  const role = useAuth((s) => s.user?.role);
  const canDelete = role === 'Doc Admin';
  // Maker and Doc Admin have cbs:write
  const canCbsWrite = FF_CBS_LIVE && (role === 'Maker' || role === 'Doc Admin');

  const [folderId, setFolderId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const qc = useQueryClient();

  // CBS link dialog state — tracks which doc is being linked
  const [cbsLinkDoc, setCbsLinkDoc] = useState<{ id: number; cif: string } | null>(null);

  const folders = useQuery({ queryKey: ['folders'], queryFn: fetchFolders });
  const docs = useQuery({
    queryKey: ['documents', { folderId, query }],
    queryFn: () => fetchDocuments({
      ...(folderId !== null ? { folder: folderId } : {}),
      ...(query ? { q: query } : {}),
      limit: 200,
    }),
  });

  const del = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['documents'] }); },
  });

  const columns = useMemo<Column<DocumentRow>[]>(
    () => [
      { key: 'name', header: 'Document',
        render: (d) => (
          <div className="flex flex-col">
            <Link to={`/viewer/${d.id}`} className="text-brand-blue hover:underline text-md font-medium">
              {d.original_name ?? d.filename}
            </Link>
            <span className="text-xs text-muted">{d.doc_type ?? '—'}</span>
          </div>
        ) },
      { key: 'customer', header: 'Customer',
        render: (d) => d.customer_name ?? d.customer_cid ?? '—' },
      { key: 'expiry',   header: 'Expiry',   width: 120,
        render: (d) => d.expiry_date ?? '—' },
      { key: 'branch',   header: 'Branch',   width: 140,
        render: (d) => d.branch ?? '—' },
      { key: 'status',   header: 'Status',   width: 110,
        render: (d) => <Badge tone={statusTone(d.status)}>{d.status}</Badge> },
      { key: 'size',     header: 'Size',     width: 90, align: 'right',
        render: (d) => d.size ? `${(d.size / 1024).toFixed(0)} KB` : '—' },
      { key: 'actions',  header: '',         width: canCbsWrite ? 160 : 120, align: 'right',
        render: (d) => (
          <div className="flex justify-end gap-1">
            {/* Link to T24 — only shown when FF is on, user has cbs:write, doc has a CIF */}
            {canCbsWrite && d.customer_cid && (
              <button
                type="button"
                data-testid="cbs-link-button"
                aria-label={t('cbs.link_to_t24_button')}
                title={t('cbs.link_to_t24_button')}
                onClick={() => {
                  if (d.customer_cid) {
                    setCbsLinkDoc({ id: d.id, cif: d.customer_cid });
                  }
                }}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:bg-brand-skyLight hover:text-brand-blue"
              >
                <Link2 size={14} />
              </button>
            )}
            <a href={`/uploads/${d.filename}`} download aria-label="Download"
               className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:bg-divider hover:text-brand-blue">
              <Download size={14} />
            </a>
            <Link to={`/viewer/${d.id}`} aria-label="Open"
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:bg-divider hover:text-brand-blue">
              <ExternalLink size={14} />
            </Link>
            {canDelete && (
              <button
                type="button"
                aria-label="Delete"
                onClick={() => { if (confirm(`Delete ${d.original_name ?? d.filename}?`)) del.mutate(d.id); }}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:bg-danger-bg hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ) },
    ],
    [canDelete, canCbsWrite, del],
  );

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-6">
        <Panel title="Folders">
          <ul className="space-y-1">
            <li>
              <button
                type="button"
                onClick={() => setFolderId(null)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-md text-left',
                  folderId === null ? 'bg-brand-skyLight text-brand-blue font-medium' : 'text-ink hover:bg-divider',
                )}
              >
                <Folder size={14} /> All documents
              </button>
            </li>
            {folders.data?.map((f) => (
              <li key={f.id} style={{ paddingLeft: f.parent_id ? 16 : 0 }}>
                <button
                  type="button"
                  onClick={() => setFolderId(f.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-md text-left',
                    folderId === f.id ? 'bg-brand-skyLight text-brand-blue font-medium' : 'text-ink hover:bg-divider',
                  )}
                >
                  <Folder size={14} /> {f.name}
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title={`${docs.data?.length ?? 0} documents`}
          action={
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="h-8 w-48 rounded-input border border-border px-3 text-xs"
            />
          }
        >
          <DataTable<DocumentRow>
            columns={columns}
            data={docs.data ?? []}
            empty={docs.isLoading ? 'Loading…' : 'No documents in this view'}
          />
          {del.isError && (
            <div className="mt-3 rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger">
              Delete failed. Check permissions and try again.
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <Link to="/capture">
              <Button size="sm">+ Upload document</Button>
            </Link>
          </div>
        </Panel>
      </div>

      {/* CBS Link Document Dialog */}
      {cbsLinkDoc !== null && (
        <CbsLinkDocumentDialog
          cif={cbsLinkDoc.cif}
          documentId={cbsLinkDoc.id}
          onClose={() => setCbsLinkDoc(null)}
          onLinked={() => { /* toast shown inside dialog; can add analytics here */ }}
        />
      )}
    </>
  );
}
