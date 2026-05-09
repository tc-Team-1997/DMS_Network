/**
 * ExtractionPreview — sample picker + test-against-sample button.
 * Shows a table of extracted fields color-coded by confidence vs. thresholds.
 *
 * Status logic (matching §3 workflow comment in the contract):
 *   confidence >= high_confidence  → green  "auto-fill"
 *   confidence >= autofill_floor   → gold   "review"
 *   confidence <  autofill_floor   → red    "below threshold"
 */

import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import type { ExtractedField, Sample } from '../api';

// ── Types ─────────────────────────────────────────────────────────────────────

type Status = 'autofill' | 'review' | 'skip';

function fieldStatus(
  confidence: number,
  autofillFloor: number,
  highConf: number,
): Status {
  if (confidence >= highConf) return 'autofill';
  if (confidence >= autofillFloor) return 'review';
  return 'skip';
}

const STATUS_CLASSES: Record<Status, string> = {
  autofill: 'text-success bg-success-bg border-success/30',
  review:   'text-warning bg-warning-bg border-warning/30',
  skip:     'text-danger bg-danger-bg border-danger/30',
};

const STATUS_LABEL_KEY: Record<Status, string> = {
  autofill: 'doctype.preview_status_autofill',
  review:   'doctype.preview_status_review',
  skip:     'doctype.preview_status_skip',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {[1, 2, 3, 4].map((n) => (
        <td key={n} className="px-3 py-2">
          <div className="h-3 bg-divider rounded" />
        </td>
      ))}
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ExtractionPreviewProps {
  samples: Sample[];
  samplesLoading: boolean;
  selectedSampleId: number | null;
  onSelectSample: (id: number | null) => void;

  autofillFloor: number;
  highConf: number;

  /** Results from the last test-thresholds call */
  results: ExtractedField[] | null;
  /** True while the POST is in-flight */
  testing: boolean;

  onTest: () => void;

  /** Error states */
  errorKind: 'none' | 'network' | 'invalid_thresholds' | 'sample_not_found' | 'forbidden' | 'server' | 'concurrent';
  onRetry: () => void;
  onRefreshConcurrent: () => void;
}

export function ExtractionPreview({
  samples,
  samplesLoading,
  selectedSampleId,
  onSelectSample,
  autofillFloor,
  highConf,
  results,
  testing,
  onTest,
  errorKind,
  onRetry,
  onRefreshConcurrent,
}: ExtractionPreviewProps) {
  const hasSamples = samples.length > 0;
  const selectedSample = selectedSampleId != null
    ? samples.find((s) => s.id === selectedSampleId) ?? null
    : null;

  return (
    <section aria-label={t('doctype.preview_section_title')} className="space-y-3 mt-2">
      <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">
        {t('doctype.preview_section_title')}
      </h3>

      {/* ── Error banners ── */}
      {errorKind === 'network' && (
        <div
          className="flex items-center gap-3 rounded-input border border-danger/30 bg-danger-bg px-3 py-2"
          role="alert"
          data-testid="threshold-error"
        >
          <p className="text-xs text-danger flex-1">{t('doctype.error_network_retry')}</p>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            {t('doctype.error_retry_button')}
          </Button>
        </div>
      )}

      {errorKind === 'server' && (
        <div
          className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2"
          role="alert"
          data-testid="threshold-error"
        >
          <p className="text-xs text-danger">{t('doctype.error_generic')}</p>
        </div>
      )}

      {errorKind === 'forbidden' && (
        <div
          className="rounded-input border border-warning/30 bg-warning-bg px-3 py-2"
          role="alert"
          data-testid="threshold-error"
        >
          <p className="text-xs text-warning">{t('doctype.error_forbidden')}</p>
        </div>
      )}

      {errorKind === 'concurrent' && (
        <div
          className="flex items-center gap-3 rounded-input border border-warning/30 bg-warning-bg px-3 py-2"
          role="alert"
          data-testid="threshold-error"
        >
          <p className="text-xs text-warning flex-1">{t('doctype.error_concurrent')}</p>
          <Button size="sm" variant="ghost" onClick={onRefreshConcurrent}>
            {t('doctype.error_concurrent_refresh')}
          </Button>
        </div>
      )}

      {/* ── Empty — no samples ── */}
      {!samplesLoading && !hasSamples && (
        <div
          className="rounded-card border-2 border-dashed border-border bg-page py-8 text-center"
          data-testid="threshold-preview-pane"
        >
          <p className="text-sm text-muted">{t('doctype.preview_empty_no_samples')}</p>
        </div>
      )}

      {/* ── Sample picker + test button ── */}
      {hasSamples && (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex flex-col text-xs text-muted flex-1 min-w-40">
            {t('doctype.preview_sample_picker_label')}
            <select
              value={selectedSampleId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                onSelectSample(v === '' ? null : parseInt(v, 10));
              }}
              data-testid="threshold-sample-picker"
              className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
              aria-label={t('doctype.preview_sample_picker_label')}
            >
              <option value="">{t('doctype.preview_sample_none_option')}</option>
              {samples.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.filename}
                </option>
              ))}
            </select>
          </label>

          <Button
            size="sm"
            variant="secondary"
            onClick={onTest}
            disabled={selectedSampleId == null || testing}
            loading={testing}
            data-testid="threshold-test-button"
            className="mt-4"
          >
            {testing ? t('doctype.preview_testing') : t('doctype.preview_test_button')}
          </Button>
        </div>
      )}

      {/* ── Preview pane ── */}
      <div data-testid="threshold-preview-pane">
        {/* No sample selected yet */}
        {hasSamples && selectedSampleId == null && !testing && results == null && (
          <p className="text-xs text-muted py-4 text-center">
            {t('doctype.preview_empty_no_selection')}
          </p>
        )}

        {/* Sample not found error */}
        {errorKind === 'sample_not_found' && (
          <p
            className="text-xs text-danger py-4 text-center"
            data-testid="threshold-error"
          >
            {t('doctype.preview_sample_not_found')}
          </p>
        )}

        {/* Skeleton while testing */}
        {testing && (
          <div className="overflow-x-auto rounded-card border border-divider mt-2">
            <table className="w-full text-xs" aria-label={t('doctype.preview_section_title')}>
              <thead className="bg-page border-b border-divider">
                <tr>
                  <th className="px-3 py-2 text-left text-muted font-medium">{t('doctype.preview_table_field')}</th>
                  <th className="px-3 py-2 text-left text-muted font-medium">{t('doctype.preview_table_value')}</th>
                  <th className="px-3 py-2 text-left text-muted font-medium">{t('doctype.preview_table_confidence')}</th>
                  <th className="px-3 py-2 text-left text-muted font-medium">{t('doctype.preview_table_status')}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Results table */}
        {!testing && results != null && results.length > 0 && (
          <div className="overflow-x-auto rounded-card border border-divider mt-2" data-testid="extraction-preview-table">
            <table
              className="w-full text-xs"
              aria-label={t('doctype.preview_section_title')}
            >
              <thead className="bg-page border-b border-divider">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-muted font-medium">
                    {t('doctype.preview_table_field')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-muted font-medium">
                    {t('doctype.preview_table_value')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-muted font-medium">
                    {t('doctype.preview_table_confidence')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-muted font-medium">
                    {t('doctype.preview_table_status')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {results.map((field) => {
                  const status = fieldStatus(field.confidence, autofillFloor, highConf);
                  return (
                    <tr
                      key={field.key}
                      data-testid={`extraction-field-status-${field.key}`}
                    >
                      <td className="px-3 py-2 font-mono text-ink">{field.key}</td>
                      <td className="px-3 py-2 text-ink max-w-48 truncate" title={field.value}>
                        {field.value}
                      </td>
                      <td className="px-3 py-2 text-ink">
                        {Math.round(field.confidence * 100)}%
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-badge border px-2 py-0.5 text-[10px] font-medium',
                            STATUS_CLASSES[status],
                          )}
                        >
                          {t(STATUS_LABEL_KEY[status])}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty results from server */}
        {!testing && results != null && results.length === 0 && selectedSample != null && (
          <p className="text-xs text-muted py-4 text-center">
            No fields extracted from this sample.
          </p>
        )}
      </div>
    </section>
  );
}
