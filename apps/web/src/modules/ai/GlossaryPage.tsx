/**
 * AI glossary admin page — the editable vocabulary the AI Engine agent
 * consults before composing analytics queries. Doc Admin only.
 *
 * Flow:
 *   - Auto-generated entries arrive with `source = 'auto'`, `approved = 0`.
 *   - Admin reviews, edits (which flips source → 'admin'), and approves.
 *   - `Regenerate from schema` re-asks the LLM to draft new auto terms;
 *     admin-edited rows are preserved server-side.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, CheckCircle2, Edit3, PlusCircle, RefreshCw, Save, Trash2,
  Search, Sparkles, X, AlertTriangle,
} from 'lucide-react';
import { Badge, Button, Input, MetricCard, Panel, type BadgeTone } from '@/components/ui';
import {
  createTerm, deleteTerm, fetchGlossary, regenerateGlossary, reindexGlossary, updateTerm,
  type GlossaryTerm, type TermInput,
} from './glossary-api';
import { cn } from '@/lib/cn';

const CATEGORIES: GlossaryTerm['category'][] = ['column', 'metric', 'filter', 'entity'];

function categoryTone(c: GlossaryTerm['category']): BadgeTone {
  switch (c) {
    case 'metric':  return 'blue';
    case 'column':  return 'purple';
    case 'filter':  return 'warning';
    case 'entity':  return 'success';
    default:        return 'neutral';
  }
}

export function GlossaryPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GlossaryTerm['category'] | 'all'>('all');
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [editing, setEditing] = useState<GlossaryTerm | null>(null);
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const listQuery = useQuery({
    queryKey: ['glossary', { query, category, approvedOnly }],
    queryFn: () => fetchGlossary({
      ...(query ? { query } : {}),
      ...(category !== 'all' ? { category } : {}),
      ...(approvedOnly ? { approved: true } : {}),
    }),
  });

  const regenerate = useMutation({
    mutationFn: () => regenerateGlossary(true),
    onSuccess: (r) => {
      setBanner({
        tone: 'success',
        text: `Regeneration complete — inserted ${r.inserted}, updated ${r.updated}, admin rows preserved ${r.preserved_admin}.`,
      });
      void qc.invalidateQueries({ queryKey: ['glossary'] });
    },
    onError: (err: Error) => setBanner({ tone: 'danger', text: `Regenerate failed: ${err.message}` }),
  });

  const reindex = useMutation({
    mutationFn: () => reindexGlossary(),
    onSuccess: (r) => setBanner({ tone: 'success', text: `Re-indexed ${r.indexed} terms into the vector store.` }),
    onError: (err: Error) => setBanner({ tone: 'danger', text: `Reindex failed: ${err.message}` }),
  });

  const items = listQuery.data?.items ?? [];
  const coverage = listQuery.data?.coverage;
  const grouped = useMemo(() => {
    const by: Record<GlossaryTerm['category'], GlossaryTerm[]> = {
      column: [], metric: [], filter: [], entity: [],
    };
    for (const t of items) by[t.category].push(t);
    return by;
  }, [items]);

  return (
    <div className="space-y-6">
      <Panel
        title="AI glossary"
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => reindex.mutate()}
              loading={reindex.isPending}
            >
              <Sparkles size={14} /> Re-index
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => regenerate.mutate()}
              loading={regenerate.isPending}
            >
              <RefreshCw size={14} /> Regenerate from schema
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusCircle size={14} /> New term
            </Button>
          </div>
        }
      >
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-brand-skyLight flex items-center justify-center">
            <BookOpen size={20} className="text-brand-blue" />
          </div>
          <p className="text-md text-muted flex-1">
            Business vocabulary the tool-using agent consults before composing analytics queries.
            Auto-generated terms start unapproved until a Doc Admin reviews them. Admin edits always win
            over a regenerate.
          </p>
        </div>
      </Panel>

      {banner && (
        <div
          className={cn(
            'rounded-input border px-3 py-2 text-sm flex items-center justify-between gap-2',
            banner.tone === 'success' ? 'bg-success-bg border-success/30 text-ink'
                                      : 'bg-danger-bg border-danger/30 text-danger',
          )}
        >
          <span className="flex items-center gap-2">
            {banner.tone === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {banner.text}
          </span>
          <button onClick={() => setBanner(null)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Total terms"    value={coverage?.total ?? '…'} tone="neutral" />
        <MetricCard label="Approved"       value={coverage?.approved ?? '…'} tone="success" sub="Visible to the agent's preamble" />
        <MetricCard label="Admin-edited"   value={coverage?.admin_edited ?? '…'} tone="purple" sub="Locked from regenerate" />
        <MetricCard
          label="Draft / auto"
          value={coverage ? coverage.total - coverage.approved : '…'}
          tone="warning"
          sub="Awaiting admin review"
        />
      </div>

      <Panel title="Filter">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              placeholder="Search term, definition, synonyms…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            className="rounded-input border border-border px-2 py-1 text-sm bg-white"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="text-xs text-muted inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={approvedOnly}
              onChange={(e) => setApprovedOnly(e.target.checked)}
            />
            Approved only
          </label>
        </div>
      </Panel>

      {listQuery.isLoading && <Panel>Loading glossary…</Panel>}
      {listQuery.error && (
        <Panel title="Error">
          <p className="text-md text-danger">{(listQuery.error as Error).message}</p>
        </Panel>
      )}

      {listQuery.data && items.length === 0 && (
        <Panel>
          <p className="text-md text-muted text-center py-6">
            No glossary terms match this filter. Try "Regenerate from schema" to seed the catalog.
          </p>
        </Panel>
      )}

      {CATEGORIES.map((c) => (
        grouped[c].length > 0 && (
          <Panel key={c} title={c[0]!.toUpperCase() + c.slice(1) + 's'}>
            <ul className="divide-y divide-divider">
              {grouped[c].map((t) => (
                <TermRow
                  key={t.id}
                  term={t}
                  onEdit={() => setEditing(t)}
                  onApprove={async () => {
                    try {
                      await updateTerm(t.id, { approved: !t.approved });
                      void qc.invalidateQueries({ queryKey: ['glossary'] });
                    } catch (err) {
                      setBanner({ tone: 'danger', text: (err as Error).message });
                    }
                  }}
                  onDelete={async () => {
                    if (!confirm(`Delete "${t.term}"?`)) return;
                    try {
                      await deleteTerm(t.id);
                      void qc.invalidateQueries({ queryKey: ['glossary'] });
                    } catch (err) {
                      setBanner({ tone: 'danger', text: (err as Error).message });
                    }
                  }}
                />
              ))}
            </ul>
          </Panel>
        )
      ))}

      {(editing || creating) && (
        <TermEditor
          initial={editing}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onSaved={() => {
            setEditing(null); setCreating(false);
            void qc.invalidateQueries({ queryKey: ['glossary'] });
            setBanner({ tone: 'success', text: 'Saved.' });
          }}
          onError={(msg) => setBanner({ tone: 'danger', text: msg })}
        />
      )}
    </div>
  );
}

function TermRow({
  term, onEdit, onApprove, onDelete,
}: {
  term: GlossaryTerm;
  onEdit: () => void;
  onApprove: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="py-3 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <span className="text-md font-semibold text-ink">{term.term}</span>
          <Badge tone={categoryTone(term.category)}>{term.category}</Badge>
          {term.approved
            ? <Badge tone="success">approved</Badge>
            : <Badge tone="warning">draft</Badge>}
          {term.source === 'admin' && <Badge tone="purple">admin-edited</Badge>}
        </div>
        <p className="text-sm text-ink leading-relaxed">{term.definition}</p>
        {term.synonyms.length > 0 && (
          <p className="text-xs text-muted mt-1">
            Synonyms: {term.synonyms.join(', ')}
          </p>
        )}
        {(term.table_hint || term.column_hint || term.sql_template) && (
          <div className="mt-1 text-[11px] text-muted font-mono">
            {term.table_hint && <span>{term.table_hint}{term.column_hint ? `.${term.column_hint}` : ''}</span>}
            {term.sql_template && <span className="ml-2">WHERE {term.sql_template}</span>}
          </div>
        )}
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <Button size="sm" variant="secondary" onClick={onApprove} aria-label={term.approved ? 'Unapprove' : 'Approve'}>
          <CheckCircle2 size={13} />
        </Button>
        <Button size="sm" variant="secondary" onClick={onEdit} aria-label="Edit">
          <Edit3 size={13} />
        </Button>
        <Button size="sm" variant="secondary" onClick={onDelete} aria-label="Delete">
          <Trash2 size={13} />
        </Button>
      </div>
    </li>
  );
}

function TermEditor({
  initial, onCancel, onSaved, onError,
}: {
  initial: GlossaryTerm | null;
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<TermInput>({
    term:         initial?.term ?? '',
    definition:   initial?.definition ?? '',
    synonyms:     initial?.synonyms ?? [],
    table_hint:   initial?.table_hint ?? null,
    column_hint:  initial?.column_hint ?? null,
    sql_template: initial?.sql_template ?? null,
    category:     initial?.category ?? 'metric',
    approved:     initial?.approved ?? true,
  });
  const [synonymText, setSynonymText] = useState((initial?.synonyms ?? []).join(', '));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload: TermInput = {
        ...form,
        synonyms: synonymText.split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (initial) await updateTerm(initial.id, payload);
      else         await createTerm(payload);
      onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-30 flex items-center justify-center p-4">
      <div className="bg-white rounded-card border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
          <h3 className="text-md font-semibold">{initial ? 'Edit term' : 'New term'}</h3>
          <button onClick={onCancel} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <Field label="Term">
            <Input value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} />
          </Field>
          <Field label="Definition">
            <textarea
              className="w-full rounded-input border border-border px-3 py-2 text-sm min-h-[80px]"
              value={form.definition}
              onChange={(e) => setForm({ ...form, definition: e.target.value })}
            />
          </Field>
          <Field label="Synonyms (comma-separated)">
            <Input value={synonymText} onChange={(e) => setSynonymText(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Table hint">
              <Input
                value={form.table_hint ?? ''}
                onChange={(e) => setForm({ ...form, table_hint: e.target.value || null })}
              />
            </Field>
            <Field label="Column hint">
              <Input
                value={form.column_hint ?? ''}
                onChange={(e) => setForm({ ...form, column_hint: e.target.value || null })}
              />
            </Field>
          </div>
          <Field label="SQL template (WHERE fragment)">
            <Input
              value={form.sql_template ?? ''}
              placeholder="e.g. status != 'Valid'"
              onChange={(e) => setForm({ ...form, sql_template: e.target.value || null })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as GlossaryTerm['category'] })}
                className="w-full rounded-input border border-border px-3 py-2 text-sm bg-white"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <label className="text-xs text-muted inline-flex items-center gap-1.5 h-9">
                <input
                  type="checkbox"
                  checked={form.approved ?? false}
                  onChange={(e) => setForm({ ...form, approved: e.target.checked })}
                />
                Approved
              </label>
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-divider">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!form.term || !form.definition}>
            <Save size={14} /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      {children}
    </label>
  );
}
