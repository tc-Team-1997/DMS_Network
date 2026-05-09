/**
 * AbTestPanel — side-by-side extraction comparison for two doctype versions.
 *
 * Lets the admin:
 *   1. Pick two versions (A and B)
 *   2. Select sample doc IDs to run against (entered as a comma-separated list)
 *   3. Compare extraction results side-by-side
 *
 * The panel makes a graceful fallback if the backend returns 404 / 501 —
 * shows a friendly "not available" message instead of crashing.
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FlaskConical, X } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { HttpError } from '@/lib/http';
import {
  listVersions,
  listSamples,
  runAbTest,
  type DocumentType,
  type AbTestResult,
} from '../api';

// ── helpers ───────────────────────────────────────────────────────────────────

function ResultColumn({
  label,
  results,
}: {
  label: string;
  results: Array<Record<string, unknown>>;
}) {
  if (results.length === 0) {
    return (
      <div className="flex-1 rounded-card border border-divider p-3">
        <p className="text-xs font-semibold text-ink mb-2">{label}</p>
        <p className="text-xs text-muted italic">No results</p>
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-card border border-divider p-3 min-w-0">
      <p className="text-xs font-semibold text-ink mb-2">{label}</p>
      <div className="space-y-1 overflow-y-auto max-h-60">
        {results.map((row, i) => (
          <div
            key={i}
            className="rounded-input border border-divider px-2 py-1 text-[11px] font-mono text-ink overflow-x-auto"
          >
            {Object.entries(row).map(([k, v]) => (
              <div key={k} className="flex gap-1">
                <span className="text-muted shrink-0">{k}:</span>
                <span className="text-ink">{String(v)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AbTestPanel ───────────────────────────────────────────────────────────────

export function AbTestPanel({ doctype }: { doctype: DocumentType }) {
  const versionsQuery = useQuery({
    queryKey: ['doctype-versions', doctype.id],
    queryFn: () => listVersions(doctype.id),
  });

  const samplesQuery = useQuery({
    queryKey: ['doctype-samples', doctype.id],
    queryFn: () => listSamples(doctype.id),
  });

  const versions = versionsQuery.data ?? [];
  const samples = samplesQuery.data ?? [];

  const [versionA, setVersionA] = useState<number | ''>('');
  const [versionB, setVersionB] = useState<number | ''>('');
  const [sampleIds, setSampleIds] = useState<number[]>([]);
  const [result, setResult] = useState<AbTestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const abTestMut = useMutation({
    mutationFn: () => {
      if (!versionA || !versionB || sampleIds.length === 0) {
        throw new Error('Select two versions and at least one sample.');
      }
      return runAbTest(doctype.id, {
        sample_doc_ids: sampleIds,
        version_a: versionA as number,
        version_b: versionB as number,
      });
    },
    onSuccess: (r) => { setResult(r); setErr(null); },
    onError: (e: unknown) => {
      if (e instanceof HttpError && (e.status === 404 || e.status === 501)) {
        setUnavailable(true);
        return;
      }
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    },
  });

  if (unavailable) {
    return (
      <div
        className="flex items-center gap-3 rounded-card border border-divider bg-raised p-4"
        data-testid="abtest-unavailable"
      >
        <FlaskConical size={18} className="text-muted" />
        <div>
          <p className="text-sm font-medium text-ink">A/B testing not available</p>
          <p className="text-xs text-muted mt-0.5">
            The DocBrain A/B endpoint is not deployed in this environment.
            It will become available when the Python service is updated.
          </p>
        </div>
      </div>
    );
  }

  const canRun =
    versionA !== '' &&
    versionB !== '' &&
    versionA !== versionB &&
    sampleIds.length > 0;

  return (
    <div className="space-y-4" data-testid="abtest-panel">
      <p className="text-xs text-muted">
        Compare extraction results between two schema versions against a set of sample documents.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col text-xs text-muted">
          Version A
          <select
            value={versionA}
            onChange={(e) => setVersionA(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
            className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
            data-testid="abtest-version-a"
            disabled={versions.length === 0}
          >
            <option value="">— select version —</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} ({v.status})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-xs text-muted">
          Version B
          <select
            value={versionB}
            onChange={(e) => setVersionB(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
            className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
            data-testid="abtest-version-b"
            disabled={versions.length === 0}
          >
            <option value="">— select version —</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} ({v.status})
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Sample selector */}
      <div>
        <p className="text-xs text-muted mb-1">
          Samples to test ({sampleIds.length} selected)
        </p>
        {samples.length === 0 ? (
          <p className="text-xs text-muted italic">No samples uploaded for this doctype.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="abtest-sample-list">
            {samples.map((s) => {
              const selected = sampleIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    setSampleIds((ids) =>
                      selected ? ids.filter((id) => id !== s.id) : [...ids, s.id],
                    )
                  }
                  className={cn(
                    'inline-flex items-center gap-1 rounded-input px-2 py-0.5 text-[11px] border transition-colors',
                    selected
                      ? 'bg-brand-blue text-white border-brand-blue'
                      : 'bg-white text-ink border-divider hover:border-brand-blue',
                  )}
                  data-testid={`abtest-sample-${s.id}`}
                >
                  {s.filename}
                  {selected && <X size={9} />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {err && (
        <p className="rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger" data-testid="abtest-error">
          {err}
        </p>
      )}

      <Button
        size="sm"
        onClick={() => abTestMut.mutate()}
        disabled={!canRun}
        loading={abTestMut.isPending}
        data-testid="abtest-run-btn"
      >
        <FlaskConical size={13} /> Run A/B test
      </Button>

      {/* Results */}
      {result && (
        <div data-testid="abtest-results">
          {result.note && (
            <p className="text-xs text-muted mb-3 italic">{result.note}</p>
          )}
          <div className="flex gap-3">
            <ResultColumn
              label={`Version A — v${result.version_a.version}`}
              results={result.version_a.results}
            />
            <ResultColumn
              label={`Version B — v${result.version_b.version}`}
              results={result.version_b.results}
            />
          </div>

          {/* Quick summary badges */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <Badge tone="neutral">A: {result.version_a.results.length} result{result.version_a.results.length === 1 ? '' : 's'}</Badge>
            <Badge tone="neutral">B: {result.version_b.results.length} result{result.version_b.results.length === 1 ? '' : 's'}</Badge>
          </div>
        </div>
      )}
    </div>
  );
}
