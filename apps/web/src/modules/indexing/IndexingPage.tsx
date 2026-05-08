import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, MetricCard, Panel, statusTone, type BadgeTone } from '@/components/ui';
import {
  fetchIndexingQueue,
  fetchIndexingStats,
  patchIndexingRow,
  type IndexingPatch,
  type IndexingRow,
} from './api';

const EDITABLE = [
  'doc_type', 'customer_cid', 'customer_name', 'doc_number',
  'dob', 'issue_date', 'expiry_date', 'issuing_authority', 'notes',
] as const satisfies readonly (keyof IndexingPatch)[];

type EditField = (typeof EDITABLE)[number];

function ocrTone(v: number | null): BadgeTone {
  if (v == null) return 'warning';
  if (v >= 90) return 'success';
  if (v >= 70) return 'warning';
  return 'danger';
}

export function IndexingPage() {
  const qc = useQueryClient();
  const [onlyLowConf, setOnlyLowConf] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<EditField, string>>(blankDraft());

  const stats = useQuery({ queryKey: ['indexing', 'stats'], queryFn: fetchIndexingStats });
  const queue = useQuery({
    queryKey: ['indexing', 'queue', { onlyLowConf }],
    queryFn: () =>
      fetchIndexingQueue({ limit: 200, ...(onlyLowConf ? { low_conf: 1 } : {}) }),
  });

  const save = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: IndexingPatch }) =>
      patchIndexingRow(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['indexing'] });
      void qc.invalidateQueries({ queryKey: ['documents'] });
      setEditing(null);
    },
  });

  const startEdit = (row: IndexingRow) => {
    setEditing(row.id);
    setDraft({
      doc_type: row.doc_type ?? '',
      customer_cid: row.customer_cid ?? '',
      customer_name: row.customer_name ?? '',
      doc_number: row.doc_number ?? '',
      dob: row.dob ?? '',
      issue_date: row.issue_date ?? '',
      expiry_date: row.expiry_date ?? '',
      issuing_authority: row.issuing_authority ?? '',
      notes: row.notes ?? '',
    });
  };

  const submitEdit = (id: number) => {
    const patch: IndexingPatch = {};
    for (const f of EDITABLE) {
      const v = draft[f].trim();
      patch[f] = v === '' ? null : v;
    }
    save.mutate({ id, patch });
  };

  const rows = queue.data ?? [];
  const s = stats.data;

  const summary = useMemo(
    () => [
      { label: 'Low OCR confidence', value: s?.low_confidence ?? '—', tone: 'warning' as const },
      { label: 'Missing doc type',   value: s?.missing_type ?? '—',   tone: 'blue' as const },
      { label: 'Missing owner',      value: s?.missing_owner ?? '—',  tone: 'danger' as const },
      { label: 'Missing doc number', value: s?.missing_number ?? '—', tone: 'warning' as const },
    ],
    [s],
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {summary.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} tone={m.tone} sub="Needs attention" />
        ))}
      </div>

      <Panel
        title={`${rows.length} documents in triage queue`}
        action={
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              data-testid="only-low-conf"
              checked={onlyLowConf}
              onChange={(e) => setOnlyLowConf(e.target.checked)}
            />
            Only low OCR confidence
          </label>
        }
      >
        {rows.length === 0 ? (
          <p className="text-md text-muted py-8 text-center">
            {queue.isLoading ? 'Loading…' : 'Nothing to triage — everything looks indexed.'}
          </p>
        ) : (
          <ul className="divide-y divide-divider">
            {rows.map((row) => {
              const isEditing = editing === row.id;
              return (
                <li key={row.id} className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Link
                          to={`/viewer/${row.id}`}
                          className="text-md font-medium text-brand-blue hover:underline inline-flex items-center gap-1"
                          data-testid={`indexing-${row.id}-open`}
                        >
                          {row.original_name ?? row.filename} <ExternalLink size={12} />
                        </Link>
                        <Badge tone={ocrTone(row.ocr_confidence)}>
                          OCR {row.ocr_confidence == null ? 'pending' : `${row.ocr_confidence.toFixed(1)}%`}
                        </Badge>
                        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                        {row.branch && <span className="text-xs text-muted">{row.branch}</span>}
                      </div>
                      {!isEditing ? (
                        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                          <Field label="Type">{row.doc_type}</Field>
                          <Field label="Customer">{row.customer_name ?? row.customer_cid}</Field>
                          <Field label="Doc #">{row.doc_number}</Field>
                          <Field label="Expiry">{row.expiry_date}</Field>
                        </dl>
                      ) : (
                        <EditForm
                          draft={draft}
                          setDraft={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
                        />
                      )}
                    </div>
                    <div className="flex gap-2">
                      {!isEditing ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => startEdit(row)}
                          data-testid={`indexing-${row.id}-edit`}
                        >
                          Triage
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => submitEdit(row.id)}
                            loading={save.isPending}
                            data-testid={`indexing-${row.id}-save`}
                          >
                            <Save size={14} /> Save
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {save.isError && (
          <div className="mt-3 rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger" data-testid="indexing-error">
            Save failed. Check permissions and try again.
          </div>
        )}
      </Panel>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{children ?? '—'}</dd>
    </>
  );
}

function EditForm({
  draft,
  setDraft,
}: {
  draft: Record<EditField, string>;
  setDraft: (key: EditField, value: string) => void;
}) {
  const fields: Array<{ key: EditField; label: string; type?: string }> = [
    { key: 'doc_type', label: 'Type' },
    { key: 'customer_name', label: 'Customer name' },
    { key: 'customer_cid', label: 'Customer CID' },
    { key: 'doc_number', label: 'Doc number' },
    { key: 'dob', label: 'Date of birth', type: 'date' },
    { key: 'issue_date', label: 'Issue date', type: 'date' },
    { key: 'expiry_date', label: 'Expiry date', type: 'date' },
    { key: 'issuing_authority', label: 'Issuing authority' },
    { key: 'notes', label: 'Notes' },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col text-xs text-muted">
          {f.label}
          <input
            type={f.type ?? 'text'}
            value={draft[f.key]}
            onChange={(e) => setDraft(f.key, e.target.value)}
            data-testid={`indexing-input-${f.key}`}
            className="mt-0.5 h-8 rounded-input border border-border px-2 text-md text-ink"
          />
        </label>
      ))}
    </div>
  );
}

function blankDraft(): Record<EditField, string> {
  return {
    doc_type: '',
    customer_cid: '',
    customer_name: '',
    doc_number: '',
    dob: '',
    issue_date: '',
    expiry_date: '',
    issuing_authority: '',
    notes: '',
  };
}
