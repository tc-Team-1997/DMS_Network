/**
 * DedupSettingsPage — admin UI for deduplication threshold tuning.
 *
 * Req 44–45: surface the fuzzy-text similarity threshold and pHash Hamming
 * distance that the Python/Node dedup service uses.  A read-only table of
 * recent dedup decisions is shown below when the endpoint exists.
 */

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, RotateCcw, ShieldAlert } from 'lucide-react';
import { Badge, Button, Panel } from '@/components/ui';
import { HttpError } from '@/lib/http';
import {
  fetchDedupSettings,
  fetchDedupDecisions,
  updateDedupSettings,
  type DedupDecision,
  type DedupSettings,
} from './api';

const DEFAULT_FUZZY = 80;
const DEFAULT_PHASH = 10;

// ── shared slider component ────────────────────────────────────────────────

function ThresholdSlider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  helpText,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  helpText: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-ink">
          {label}
        </label>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= min && v <= max) onChange(v);
            }}
            aria-label={`${label} numeric input`}
            className="w-16 h-7 rounded-input border border-border px-2 text-xs font-mono text-ink text-right"
            data-testid={`${id}-number`}
          />
          <span className="text-xs text-muted w-6">{unit}</span>
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand-blue bg-divider"
        data-testid={id}
      />
      <p className="text-[10px] text-muted">{helpText}</p>
    </div>
  );
}

// ── recent decisions table ─────────────────────────────────────────────────

function DedupDecisionsTable({ rows }: { rows: DedupDecision[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-md text-muted italic py-4 text-center">
        No dedup decisions recorded yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" data-testid="dedup-decisions-table">
        <thead>
          <tr className="border-b border-divider text-muted text-left">
            <th className="py-2 pr-3 font-medium">ID</th>
            <th className="py-2 pr-3 font-medium">Doc</th>
            <th className="py-2 pr-3 font-medium">Matched doc</th>
            <th className="py-2 pr-3 font-medium">Score</th>
            <th className="py-2 pr-3 font-medium">Decision</th>
            <th className="py-2 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-divider/60 hover:bg-raised/50">
              <td className="py-1.5 pr-3 font-mono text-muted">{r.id}</td>
              <td className="py-1.5 pr-3 text-ink">#{r.doc_id}</td>
              <td className="py-1.5 pr-3 text-ink">#{r.matched_doc_id}</td>
              <td className="py-1.5 pr-3">
                <Badge tone={r.score >= 0.9 ? 'danger' : r.score >= 0.7 ? 'warning' : 'neutral'}>
                  {Math.round(r.score * 100)}%
                </Badge>
              </td>
              <td className="py-1.5 pr-3">
                <Badge
                  tone={
                    r.decision === 'duplicate' ? 'danger'
                    : r.decision === 'similar'  ? 'warning'
                    : 'success'
                  }
                >
                  {r.decision}
                </Badge>
              </td>
              <td className="py-1.5 text-muted">
                {new Date(r.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export function DedupSettingsPage() {
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ['dedup-settings'],
    queryFn: fetchDedupSettings,
    retry: (count, err: unknown) => {
      const status = (err as { status?: number } | null)?.status ?? 0;
      if (status === 404) return false;
      return count < 2;
    },
  });

  const decisions = useQuery({
    queryKey: ['dedup-decisions'],
    queryFn: fetchDedupDecisions,
    retry: (count, err: unknown) => {
      const status = (err as { status?: number } | null)?.status ?? 0;
      if (status === 404) return false;
      return count < 2;
    },
  });

  // Local slider state — seeded from server once loaded
  const [fuzzy, setFuzzy] = useState(DEFAULT_FUZZY);
  const [phash, setPhash] = useState(DEFAULT_PHASH);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  // Seed from server data when it arrives
  useEffect(() => {
    if (settings.data) {
      setFuzzy(settings.data.fuzzy_threshold);
      setPhash(settings.data.phash_distance);
    }
  }, [settings.data]);

  const saveMutation = useMutation({
    mutationFn: updateDedupSettings,
    onSuccess: (updated: DedupSettings) => {
      void qc.invalidateQueries({ queryKey: ['dedup-settings'] });
      setFuzzy(updated.fuzzy_threshold);
      setPhash(updated.phash_distance);
      setSaveErr(null);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    },
    onError: (e: unknown) => {
      setSaveErr(e instanceof HttpError ? e.message : (e as Error).message);
    },
  });

  const handleSave = () => {
    setSaveErr(null);
    setSavedOk(false);
    saveMutation.mutate({ fuzzy_threshold: fuzzy, phash_distance: phash });
  };

  const handleReset = () => {
    setFuzzy(DEFAULT_FUZZY);
    setPhash(DEFAULT_PHASH);
  };

  const isLoading = settings.isLoading;
  const serverError = settings.error instanceof HttpError && settings.error.status !== 404
    ? settings.error.message
    : null;

  // Gate decisions table on a 200 response (hide on 404)
  const decisionsData: typeof decisions.data | null =
    decisions.isSuccess ? decisions.data
    : decisions.error instanceof HttpError && decisions.error.status === 404 ? null
    : null;

  const show404Banner = settings.error instanceof HttpError && settings.error.status === 404;

  return (
    <div className="space-y-6 max-w-2xl">
      <Panel
        title="Deduplication thresholds"
        action={
          <span className="text-xs text-muted">
            Admin only — changes take effect on next ingest
          </span>
        }
      >
        {isLoading && <p className="text-md text-muted">Loading…</p>}

        {show404Banner && (
          <div
            className="rounded-input border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-ink flex items-center gap-2 mb-4"
            data-testid="dedup-settings-404"
          >
            <ShieldAlert size={13} className="text-warning shrink-0" />
            Backend endpoint not yet available — showing defaults. Save will retry when the API is deployed.
          </div>
        )}

        {serverError && (
          <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger mb-4">
            {serverError}
          </div>
        )}

        {!isLoading && (
          <div className="space-y-6">
            <ThresholdSlider
              id="dedup-fuzzy-threshold"
              label="Fuzzy text similarity"
              value={fuzzy}
              min={0}
              max={100}
              unit="%"
              helpText="Levenshtein match threshold for near-duplicate text detection. Documents whose text similarity exceeds this value are flagged as duplicates."
              onChange={setFuzzy}
            />

            <ThresholdSlider
              id="dedup-phash-distance"
              label="pHash distance"
              value={phash}
              min={0}
              max={64}
              unit="bits"
              helpText="Perceptual hash Hamming distance for image duplicate detection. Lower values = stricter matching. 0 = exact visual duplicate only."
              onChange={setPhash}
            />

            {saveErr && (
              <p
                className="rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger"
                data-testid="dedup-save-error"
              >
                {saveErr}
              </p>
            )}

            {savedOk && (
              <p
                className="rounded-input bg-success-bg border border-success/30 px-3 py-2 text-xs text-success"
                data-testid="dedup-save-ok"
              >
                Thresholds saved.
              </p>
            )}

            {settings.data && (
              <p className="text-[11px] text-muted">
                Last updated {new Date(settings.data.updated_at).toLocaleString()} by {settings.data.updated_by}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-divider">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleReset}
                data-testid="dedup-reset"
              >
                <RotateCcw size={13} /> Reset to defaults
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                loading={saveMutation.isPending}
                data-testid="dedup-save"
              >
                <Save size={13} /> Save
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {/* Recent dedup decisions — gated on 200 response */}
      {decisionsData !== null && (
        <Panel
          title={`Recent dedup decisions (last ${decisionsData.length})`}
          data-testid="dedup-decisions-panel"
        >
          <DedupDecisionsTable rows={decisionsData} />
        </Panel>
      )}
    </div>
  );
}
