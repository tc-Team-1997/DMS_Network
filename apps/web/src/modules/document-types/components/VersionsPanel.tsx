/**
 * VersionsPanel — schema version management for a single doctype.
 *
 * Features:
 *   - List versions with status badges (draft / live / archived)
 *   - Create a new draft version
 *   - Publish (requires reason ≥ 20 chars)
 *   - Rollback (requires reason ≥ 20 chars)
 *   - Diff two versions (added / removed / modified fields)
 *
 * Props:
 *   doctype  — the parent DocumentType (for its id and current fields_json)
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { HttpError } from '@/lib/http';
import {
  createVersion,
  diffVersions,
  listVersions,
  publishVersion,
  rollbackVersion,
  type DocumentType,
  type DoctypeVersion,
  type DoctypeVersionDiff,
} from '../api';

// ── helpers ───────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<DoctypeVersion['status'], 'success' | 'warning' | 'neutral'> = {
  live:     'success',
  draft:    'warning',
  archived: 'neutral',
};

function versionLabel(v: { version: number }) {
  return `v${v.version}`;
}

// ── Reason dialog ─────────────────────────────────────────────────────────────

function ReasonDialog({
  title,
  actionLabel,
  isPending,
  onConfirm,
  onCancel,
}: {
  title: string;
  actionLabel: string;
  isPending: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const ok = reason.trim().length >= 20;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reason-dialog-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-card bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-divider">
          <h2 id="reason-dialog-title" className="text-md font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-divider"
          >
            <X size={14} />
          </button>
        </header>
        <div className="p-4 space-y-3">
          <label className="flex flex-col text-xs text-muted">
            Reason for change
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Minimum 20 characters required…"
              className={cn(
                'mt-1 rounded-input border px-3 py-2 text-md text-ink resize-none',
                reason.length > 0 && !ok ? 'border-danger' : 'border-border',
              )}
              data-testid="version-reason-input"
            />
            <span className={cn('mt-0.5 text-[11px]', ok ? 'text-success' : 'text-muted')}>
              {reason.trim().length}/20 characters minimum
            </span>
          </label>
        </div>
        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-divider bg-page">
          <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => onConfirm(reason.trim())}
            disabled={!ok}
            loading={isPending}
            data-testid="version-reason-confirm"
          >
            {actionLabel}
          </Button>
        </footer>
      </div>
    </div>
  );
}

// ── Diff view ─────────────────────────────────────────────────────────────────

function DiffView({ diff }: { diff: DoctypeVersionDiff }) {
  const { added, removed, modified } = diff.diff;
  const empty = added.length === 0 && removed.length === 0 && modified.length === 0;

  if (empty) {
    return (
      <p className="text-xs text-muted italic px-1">No field differences between these versions.</p>
    );
  }

  const renderItem = (item: Record<string, unknown>, tone: 'success' | 'danger' | 'warning') => {
    const key = typeof item['key'] === 'string' ? item['key'] : JSON.stringify(item);
    const detail = Object.entries(item)
      .filter(([k]) => k !== 'key')
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', ');

    const bg =
      tone === 'success' ? 'bg-success/5 border-success/20' :
      tone === 'danger'  ? 'bg-danger-bg border-danger/20' :
                           'bg-warning/5 border-warning/20';

    return (
      <li key={key} className={cn('rounded-input border px-2 py-1 text-xs', bg)}>
        <span className="font-mono font-medium text-ink">{key}</span>
        {detail && <span className="text-muted ml-2">{detail}</span>}
      </li>
    );
  };

  return (
    <div className="space-y-3 text-xs">
      {added.length > 0 && (
        <div>
          <p className="font-medium text-success mb-1">Added ({added.length})</p>
          <ul className="space-y-1">
            {added.map((item) => renderItem(item, 'success'))}
          </ul>
        </div>
      )}
      {removed.length > 0 && (
        <div>
          <p className="font-medium text-danger mb-1">Removed ({removed.length})</p>
          <ul className="space-y-1">
            {removed.map((item) => renderItem(item, 'danger'))}
          </ul>
        </div>
      )}
      {modified.length > 0 && (
        <div>
          <p className="font-medium text-warning mb-1">Modified ({modified.length})</p>
          <ul className="space-y-1">
            {modified.map((item) => renderItem(item, 'warning'))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── VersionsPanel ─────────────────────────────────────────────────────────────

export function VersionsPanel({ doctype }: { doctype: DocumentType }) {
  const qc = useQueryClient();

  const versionsQuery = useQuery({
    queryKey: ['doctype-versions', doctype.id],
    queryFn: () => listVersions(doctype.id),
  });

  const [action, setAction] = useState<
    | { type: 'publish'; version: DoctypeVersion }
    | { type: 'rollback'; version: DoctypeVersion }
    | null
  >(null);

  const [diffTarget, setDiffTarget] = useState<number | null>(null);
  const [diffResult, setDiffResult] = useState<DoctypeVersionDiff | null>(null);
  const [diffOpen, setDiffOpen] = useState<number | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['doctype-versions', doctype.id] }); };

  const createMut = useMutation({
    mutationFn: () => {
      const schemaJson = JSON.stringify(doctype.fields);
      return createVersion(doctype.id, schemaJson);
    },
    onSuccess: () => { invalidate(); setCreateErr(null); },
    onError: (e: unknown) => {
      setCreateErr(e instanceof HttpError ? e.message : (e as Error).message);
    },
  });

  const publishMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      publishVersion(doctype.id, id, reason),
    onSuccess: () => { invalidate(); setAction(null); },
    onError: (e: unknown) => {
      setCreateErr(e instanceof HttpError ? e.message : (e as Error).message);
      setAction(null);
    },
  });

  const rollbackMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      rollbackVersion(doctype.id, id, reason),
    onSuccess: () => { invalidate(); setAction(null); },
    onError: (e: unknown) => {
      setCreateErr(e instanceof HttpError ? e.message : (e as Error).message);
      setAction(null);
    },
  });

  const loadDiff = async (versionId: number, compareId?: number) => {
    try {
      const result = await diffVersions(doctype.id, versionId, compareId);
      setDiffResult(result);
      setDiffTarget(versionId);
      setDiffOpen(versionId);
    } catch {
      // silently ignore — no diff shown
    }
  };

  const versions = versionsQuery.data ?? [];
  const liveVersion = versions.find((v) => v.status === 'live');

  return (
    <div className="space-y-4" data-testid="versions-panel">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Schema versioning — track changes and publish with a reason for audit.
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => createMut.mutate()}
          loading={createMut.isPending}
          data-testid="versions-create-draft"
        >
          <Plus size={12} /> New draft
        </Button>
      </div>

      {createErr && (
        <p className="rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger" data-testid="versions-error">
          {createErr}
        </p>
      )}

      {versionsQuery.isLoading && (
        <p className="text-md text-muted animate-pulse">Loading versions…</p>
      )}

      {versions.length === 0 && !versionsQuery.isLoading && (
        <p className="text-xs text-muted italic">No versions yet. Create a draft to start tracking changes.</p>
      )}

      <div className="space-y-2">
        {versions.map((v) => {
          const isDiffOpen = diffOpen === v.id;
          return (
            <div
              key={v.id}
              className="rounded-card border border-divider bg-white overflow-hidden"
              data-testid={`version-row-${v.id}`}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-xs font-mono font-medium text-ink w-8">{versionLabel(v)}</span>
                <Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge>
                {v.created_by && (
                  <span className="text-[11px] text-muted">by {v.created_by}</span>
                )}
                <span className="text-[11px] text-muted ml-auto shrink-0">
                  {new Date(v.created_at).toLocaleDateString()}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1 ml-2">
                  {v.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => setAction({ type: 'publish', version: v })}
                      className="inline-flex items-center gap-1 rounded-input px-2 py-0.5 text-[11px] text-success border border-success/30 hover:bg-success/5"
                      data-testid={`version-publish-${v.id}`}
                    >
                      <CheckCircle2 size={10} /> Publish
                    </button>
                  )}
                  {v.status === 'live' && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-success">
                      <CheckCircle2 size={10} /> Current
                    </span>
                  )}
                  {v.status === 'archived' && liveVersion && (
                    <button
                      type="button"
                      onClick={() => setAction({ type: 'rollback', version: v })}
                      className="inline-flex items-center gap-1 rounded-input px-2 py-0.5 text-[11px] text-muted border border-border hover:bg-divider"
                      data-testid={`version-rollback-${v.id}`}
                    >
                      <RefreshCw size={10} /> Rollback
                    </button>
                  )}

                  {/* Diff button */}
                  <button
                    type="button"
                    onClick={async () => {
                      if (isDiffOpen) {
                        setDiffOpen(null);
                        return;
                      }
                      const prevVersion = versions.find(
                        (pv) => pv.version === v.version - 1,
                      );
                      await loadDiff(v.id, prevVersion?.id);
                    }}
                    className="inline-flex items-center gap-0.5 rounded-input px-2 py-0.5 text-[11px] text-muted border border-border hover:bg-divider"
                    aria-label={isDiffOpen ? 'Hide diff' : 'Show diff'}
                    data-testid={`version-diff-btn-${v.id}`}
                  >
                    {isDiffOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    Diff
                  </button>
                </div>
              </div>

              {/* Diff body */}
              {isDiffOpen && diffTarget === v.id && diffResult && (
                <div className="border-t border-divider px-3 py-2 bg-page">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                    {versionLabel(diffResult.version_b)} vs {versionLabel(diffResult.version_a)}
                  </p>
                  <DiffView diff={diffResult} />
                </div>
              )}

              {/* Schema snippet */}
              <details className="border-t border-divider">
                <summary className="px-3 py-1.5 text-[11px] text-muted cursor-pointer hover:bg-divider/40 flex items-center gap-1">
                  <Archive size={10} /> Schema JSON
                </summary>
                <pre className="px-3 py-2 text-[10px] font-mono text-muted overflow-x-auto bg-page max-h-40">
                  {JSON.stringify(JSON.parse(v.schema_json), null, 2)}
                </pre>
              </details>
            </div>
          );
        })}
      </div>

      {/* Publish / Rollback dialog */}
      {action?.type === 'publish' && (
        <ReasonDialog
          title={`Publish ${versionLabel(action.version)} — ${doctype.name}`}
          actionLabel="Publish live"
          isPending={publishMut.isPending}
          onConfirm={(reason) => publishMut.mutate({ id: action.version.id, reason })}
          onCancel={() => setAction(null)}
        />
      )}
      {action?.type === 'rollback' && (
        <ReasonDialog
          title={`Rollback to ${versionLabel(action.version)} — ${doctype.name}`}
          actionLabel="Rollback"
          isPending={rollbackMut.isPending}
          onConfirm={(reason) => rollbackMut.mutate({ id: action.version.id, reason })}
          onCancel={() => setAction(null)}
        />
      )}
    </div>
  );
}
