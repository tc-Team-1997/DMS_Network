/**
 * ThresholdsTab — OCR confidence threshold tuning UI.
 * Embedded as the "Thresholds" tab in the DocumentTypesPage edit panel.
 *
 * Feature flag: VITE_FF_OCR_CONFIDENCE_TUNING (default on in dev).
 * When off, renders a disabled notice and falls back gracefully.
 *
 * Contract: docs/contracts/ocr-confidence-tuning.md §6
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import {
  listSamples,
  patchThresholds,
  testThresholds,
  type DocumentType,
  type ExtractedField,
} from './api';
import { ConfidenceRangeSlider } from './components/ConfidenceRangeSlider';
import { ExtractionPreview } from './components/ExtractionPreview';

// ── Feature flag ──────────────────────────────────────────────────────────────

const FF_ENABLED: boolean =
  import.meta.env['VITE_FF_OCR_CONFIDENCE_TUNING'] !== 'false';

// ── Default thresholds ────────────────────────────────────────────────────────

const DEFAULT_FLOOR = 0.4;
const DEFAULT_HIGH = 0.7;

// ── Save indicator states ─────────────────────────────────────────────────────

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

type ErrorKind =
  | 'none'
  | 'network'
  | 'invalid_thresholds'
  | 'sample_not_found'
  | 'forbidden'
  | 'server'
  | 'concurrent';

// ── Helper: classify HttpError ────────────────────────────────────────────────

function classifyError(e: unknown): ErrorKind {
  if (e instanceof HttpError) {
    if (e.status === 403) return 'forbidden';
    if (e.status === 409) return 'concurrent';
    if (e.status === 404) return 'sample_not_found';
    if (e.status === 400) return 'invalid_thresholds';
    if (e.status >= 500) return 'server';
    return 'network';
  }
  return 'network';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ThresholdsTabProps {
  docType: DocumentType;
}

export function ThresholdsTab({ docType }: ThresholdsTabProps) {
  // Feature-flag gate
  if (!FF_ENABLED) {
    return (
      <div className="py-6 text-center text-sm text-muted" data-testid="thresholds-tab">
        {t('doctype.feature_disabled')}
      </div>
    );
  }

  return <ThresholdsTabInner docType={docType} />;
}

function ThresholdsTabInner({ docType }: ThresholdsTabProps) {
  const qc = useQueryClient();

  // ── Local slider state ──────────────────────────────────────────────────────
  const [floor, setFloor] = useState<number>(docType.autofill_floor ?? DEFAULT_FLOOR);
  const [high, setHigh] = useState<number>(docType.high_confidence ?? DEFAULT_HIGH);

  // ── Save indicator ──────────────────────────────────────────────────────────
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // Tracks whether either value differs from the persisted docType values
  const isDirty =
    floor !== (docType.autofill_floor ?? DEFAULT_FLOOR) ||
    high !== (docType.high_confidence ?? DEFAULT_HIGH);

  // ── Error state ─────────────────────────────────────────────────────────────
  const [errorKind, setErrorKind] = useState<ErrorKind>('none');
  const [sliderError, setSliderError] = useState<string | null>(null);

  // ── Preview state ───────────────────────────────────────────────────────────
  const [selectedSampleId, setSelectedSampleId] = useState<number | null>(
    docType.tested_with_sample_id ?? null,
  );
  const [testResults, setTestResults] = useState<ExtractedField[] | null>(null);

  // ── Debounce ref for live constraint animation ──────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Samples query ───────────────────────────────────────────────────────────
  const samplesQuery = useQuery({
    queryKey: ['doctype-samples', docType.id],
    queryFn: () => listSamples(docType.id),
  });

  // ── Save mutation ───────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () =>
      patchThresholds(docType.id, {
        autofill_floor: floor,
        high_confidence: high,
        tested_with_sample_id: selectedSampleId ?? undefined,
      }),
    onMutate: () => {
      setSaveState('saving');
      setErrorKind('none');
      setSliderError(null);
    },
    onSuccess: () => {
      setSaveState('saved');
      setErrorKind('none');
      void qc.invalidateQueries({ queryKey: ['document-types'] });
      // Reset to 'idle' after 2 s
      const t2 = setTimeout(() => setSaveState('idle'), 2000);
      return () => clearTimeout(t2);
    },
    onError: (e: unknown) => {
      const kind = classifyError(e);
      setErrorKind(kind);
      setSaveState('dirty');
      if (kind === 'invalid_thresholds') {
        setSliderError(t('doctype.error_invalid_thresholds'));
      }
    },
  });

  // ── Test mutation ───────────────────────────────────────────────────────────
  const testMutation = useMutation({
    mutationFn: () => {
      if (selectedSampleId == null) {
        return Promise.reject(new Error('No sample selected'));
      }
      return testThresholds(docType.id, selectedSampleId, floor, high);
    },
    onSuccess: (res) => {
      setTestResults(res.extracted_fields);
      setErrorKind('none');
    },
    onError: (e: unknown) => {
      const kind = classifyError(e);
      setErrorKind(kind);
      if (kind === 'sample_not_found') {
        setTestResults(null);
        setSelectedSampleId(null);
      }
    },
  });

  // ── Dirty state tracking ────────────────────────────────────────────────────
  useEffect(() => {
    if (saveState === 'saved') return;
    setSaveState(isDirty ? 'dirty' : 'idle');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, high, isDirty]);

  // ── Constraint: floor cannot exceed high ───────────────────────────────────
  const handleFloorChange = useCallback(
    (v: number) => {
      if (v > high) {
        setSliderError(t('doctype.error_autofill_exceeds_high'));
        // snap to high
        setFloor(high);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setSliderError(null), 2500);
        return;
      }
      setSliderError(null);
      setFloor(v);
    },
    [high],
  );

  const handleHighChange = useCallback(
    (v: number) => {
      if (v < floor) {
        setSliderError(t('doctype.error_autofill_exceeds_high'));
        setHigh(floor);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setSliderError(null), 2500);
        return;
      }
      setSliderError(null);
      setHigh(v);
    },
    [floor],
  );

  // ── Reset ───────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setFloor(DEFAULT_FLOOR);
    setHigh(DEFAULT_HIGH);
    setSliderError(null);
    setErrorKind('none');
  };

  // ── beforeunload guard ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ── Cleanup debounce on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const isForbidden = errorKind === 'forbidden';

  return (
    <div className="space-y-6" data-testid="thresholds-tab">
      {/* ── Sliders ── */}
      <ConfidenceRangeSlider
        floor={floor}
        high={high}
        onFloorChange={handleFloorChange}
        onHighChange={handleHighChange}
        disabled={isForbidden || saveMutation.isPending}
      />

      {/* ── Slider constraint error ── */}
      {sliderError && (
        <p
          className="text-xs text-danger bg-danger-bg border border-danger/30 rounded-input px-3 py-2"
          role="alert"
          data-testid="threshold-error"
        >
          {sliderError}
        </p>
      )}

      {/* ── Live display pill ── */}
      <div className="flex items-center gap-2 text-xs text-muted flex-wrap">
        <span
          className="inline-flex items-center gap-1 rounded-badge border border-warning/40 bg-warning-bg px-2 py-0.5 text-warning font-medium"
          data-testid="autofill-floor-label"
        >
          {t('doctype.autofill_label_display', { pct: Math.round(floor * 100) })}
        </span>
        <span className="text-border">·</span>
        <span
          className="inline-flex items-center gap-1 rounded-badge border border-success/40 bg-success-bg px-2 py-0.5 text-success font-medium"
          data-testid="confidence-high-label"
        >
          {t('doctype.high_label_display', { pct: Math.round(high * 100) })}
        </span>
      </div>

      {/* ── Controls: reset + save ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={handleReset}
          disabled={isForbidden || saveMutation.isPending}
          data-testid="threshold-reset"
        >
          <RotateCcw size={12} />
          {t('doctype.reset_button')}
        </Button>

        <div className="flex items-center gap-3">
          {/* Save indicator pill */}
          <span
            aria-live="polite"
            aria-atomic="true"
            data-testid="threshold-save-indicator"
            className={cn(
              'text-xs px-2 py-0.5 rounded-badge border transition-colors',
              saveState === 'saved'
                ? 'text-success bg-success-bg border-success/30'
                : saveState === 'saving'
                  ? 'text-muted bg-page border-border animate-pulse'
                  : saveState === 'dirty'
                    ? 'text-warning bg-warning-bg border-warning/30'
                    : 'text-transparent border-transparent',
            )}
          >
            {saveState === 'saved'
              ? t('doctype.save_indicator_saved')
              : saveState === 'saving'
                ? t('doctype.save_indicator_saving')
                : saveState === 'dirty'
                  ? t('doctype.save_indicator_dirty')
                  : ' ' /* non-breaking space to preserve height */}
          </span>

          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            disabled={!isDirty || isForbidden || saveMutation.isPending}
            data-testid="thresholds-save-button"
          >
            <Save size={13} />
            {t('doctype.save_button')}
          </Button>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-divider" />

      {/* ── Preview pane ── */}
      <ExtractionPreview
        samples={samplesQuery.data ?? []}
        samplesLoading={samplesQuery.isLoading}
        selectedSampleId={selectedSampleId}
        onSelectSample={setSelectedSampleId}
        autofillFloor={floor}
        highConf={high}
        results={testResults}
        testing={testMutation.isPending}
        onTest={() => testMutation.mutate()}
        errorKind={
          // Only pass preview-relevant errors to ExtractionPreview;
          // save errors are shown above
          errorKind === 'none' || errorKind === 'sample_not_found'
            ? errorKind
            : 'none'
        }
        onRetry={() => testMutation.mutate()}
        onRefreshConcurrent={() => {
          void qc.invalidateQueries({ queryKey: ['document-types'] });
          setErrorKind('none');
        }}
      />
    </div>
  );
}
