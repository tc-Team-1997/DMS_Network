/**
 * DedupSettingsPage — admin UI for deduplication threshold tuning.
 *
 * Thresholds are stored in tenant_config namespace "capture":
 *   dedup.fuzzy_min_ratio   — fraction 0–1 (stored), displayed as 0–100 %
 *   dedup.phash_max_distance — integer 0–64 (stored and displayed as-is)
 *
 * The dedup_settings table was dropped in migration 0036; all values now live
 * in CC1 tenant_config. This page reads/writes via useTenantConfig('capture')
 * and useUpdateConfig('capture').
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Save, RotateCcw, ShieldAlert } from 'lucide-react';
import { Badge, Button, Panel } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { useTenantConfig, useUpdateConfig } from '@/store/tenant-config';
import { fetchDedupDecisions, type DedupDecision } from './api';

// Defaults match services/duplicates.js DEFAULTS
const DEFAULT_FUZZY_PCT = 80;   // 0.8 fraction → 80 %
const DEFAULT_PHASH = 10;

// ── helpers ────────────────────────────────────────────────────────────────────

function toFraction(pct: number): number {
  return Math.round((pct / 100) * 1000) / 1000; // 3-decimal precision
}

function toPct(fraction: number): number {
  return Math.round(fraction * 100);
}

function numOrDefault(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return isFinite(n) ? n : fallback;
}

// ── shared slider component ────────────────────────────────────────────────────

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

// ── recent decisions table ─────────────────────────────────────────────────────

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

// ── page ───────────────────────────────────────────────────────────────────────

export function DedupSettingsPage() {
  // CC1 — read capture namespace
  const configQuery = useTenantConfig('capture');
  const updateConfig = useUpdateConfig('capture');

  // Decisions table — separate endpoint (not affected by dedup_settings removal)
  const decisions = useQuery({
    queryKey: ['dedup-decisions'],
    queryFn: fetchDedupDecisions,
    retry: (count, err: unknown) => {
      const status = (err as { status?: number } | null)?.status ?? 0;
      if (status === 404) return false;
      return count < 2;
    },
  });

  // Local slider state — seeded from tenant_config on first load
  const [fuzzyPct, setFuzzyPct] = useState(DEFAULT_FUZZY_PCT);
  const [phash, setPhash]       = useState(DEFAULT_PHASH);
  // Reason field — required by CC1 setConfig (≥20 chars)
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState<string | null>(null);
  const [saveErr, setSaveErr]     = useState<string | null>(null);
  const [savedOk, setSavedOk]     = useState(false);

  // Seed sliders once the namespace config resolves
  useEffect(() => {
    if (!configQuery.data) return;
    const raw = configQuery.data;
    const fuzzyFraction = numOrDefault(raw['dedup.fuzzy_min_ratio'], DEFAULT_FUZZY_PCT / 100);
    const phashRaw      = numOrDefault(raw['dedup.phash_max_distance'], DEFAULT_PHASH);
    setFuzzyPct(toPct(fuzzyFraction));
    setPhash(phashRaw);
  }, [configQuery.data]);

  const handleSave = async () => {
    setSaveErr(null);
    setSavedOk(false);
    setReasonErr(null);

    if (reason.trim().length < 20) {
      setReasonErr('Reason must be at least 20 characters.');
      return;
    }

    const auditReason = reason.trim();
    try {
      await updateConfig.mutateAsync({
        key: 'dedup.fuzzy_min_ratio',
        value: toFraction(fuzzyPct),
        reason: auditReason,
      });
      await updateConfig.mutateAsync({
        key: 'dedup.phash_max_distance',
        value: phash,
        reason: auditReason,
      });
      setSavedOk(true);
      setReason('');
      setTimeout(() => setSavedOk(false), 3000);
    } catch (err: unknown) {
      setSaveErr(err instanceof HttpError ? err.message : (err as Error).message);
    }
  };

  const handleReset = () => {
    setFuzzyPct(DEFAULT_FUZZY_PCT);
    setPhash(DEFAULT_PHASH);
    setReasonErr(null);
    setSaveErr(null);
    setSavedOk(false);
  };

  const isLoading = configQuery.isLoading;
  const configError = configQuery.error;
  const serverError =
    configError instanceof HttpError && configError.status !== 404
      ? configError.message
      : null;
  const show404Banner =
    configError instanceof HttpError && configError.status === 404;

  const decisionsData: DedupDecision[] | null =
    decisions.isSuccess ? decisions.data
    : decisions.error instanceof HttpError && decisions.error.status === 404 ? null
    : null;

  const isSaving = updateConfig.isPending;

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

        {serverError !== null && (
          <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger mb-4">
            {serverError}
          </div>
        )}

        {!isLoading && (
          <div className="space-y-6">
            <ThresholdSlider
              id="dedup-fuzzy-threshold"
              label="Fuzzy text similarity"
              value={fuzzyPct}
              min={0}
              max={100}
              unit="%"
              helpText="Levenshtein match threshold for near-duplicate text detection. Documents whose text similarity exceeds this value are flagged as duplicates."
              onChange={setFuzzyPct}
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

            {/* Audit reason — required by CC1 */}
            <div className="space-y-1">
              <label htmlFor="dedup-reason" className="text-xs font-medium text-ink">
                Reason for change <span className="text-muted">(min 20 characters)</span>
              </label>
              <textarea
                id="dedup-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Tuning thresholds after Q1 duplicate review audit"
                className="w-full rounded-input border border-border px-3 py-2 text-xs text-ink placeholder:text-muted resize-none focus:outline-none focus:ring-2 focus:ring-brand-blue"
                data-testid="dedup-reason"
              />
              {reasonErr !== null && (
                <p className="text-[10px] text-danger">{reasonErr}</p>
              )}
            </div>

            {saveErr !== null && (
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
                onClick={() => { void handleSave(); }}
                loading={isSaving}
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
