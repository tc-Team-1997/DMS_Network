/**
 * IndexingPage — Indexing Station v2 (Wave B).
 *
 * 3-pane layout:
 *   Left  (260px) : QueuePane  — claimable document queue (DataTable v1)
 *   Center (flex) : PdfPane    — PDF viewer with per-field bbox overlay
 *   Right  (320px): FieldPane  — editable fields with AI confidence chips
 *
 * Station lifecycle:
 *   1. User clicks a queue row → POST /indexing/:id/claim (race-safe PK).
 *   2. Lock acquired → PDF + fields appear; other users see "Locked by X".
 *   3. User edits fields → Shift+Enter or Save button → PATCH /indexing/:id.
 *   4. On save success, auto-advance to next unclaimed queue item.
 *   5. Esc or Release button → DELETE /indexing/:id/claim → station closes.
 *   6. Tab close → navigator.sendBeacon fires the POST /release beacon.
 *
 * Keyboard: J/K (configurable) next/prev field; Shift+Enter save+next;
 *           Esc release; ? toggle shortcut help.
 *
 * Autofocus: on document open, the first field below the confidence threshold
 *            (default 70%) is auto-focused.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutPanelLeft } from 'lucide-react';
import { MetricCard } from '@/components/ui';
import { useAuth } from '@/store/auth';
import {
  fetchIndexingQueue,
  fetchIndexingStats,
  fetchIndexingAnalysis,
  patchIndexingRow,
  claimIndexingDoc,
  releaseIndexingDoc,
  beaconRelease,
} from './api';
import {
  FIELD_DEFS,
  type FieldKey,
  type IndexingRow,
  type IndexingPatch,
  type AnalysisResponse,
} from './schemas';
import { QueuePane } from './components/QueuePane';
import { PdfPane } from './components/PdfPane';
import { FieldPane } from './components/FieldPane';
import { ShortcutHelpOverlay } from './components/ShortcutHelpOverlay';
import { useIndexingKeyboard } from './hooks/useIndexingKeyboard';

// ── constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIDENCE_THRESHOLD = 70;
const KEY_NEXT = 'j';
const KEY_PREV = 'k';

// ── draft helpers ─────────────────────────────────────────────────────────────

function blankDraft(): Record<FieldKey, string> {
  return Object.fromEntries(FIELD_DEFS.map((f) => [f.key, ''])) as Record<FieldKey, string>;
}

function rowToDraft(row: IndexingRow): Record<FieldKey, string> {
  return Object.fromEntries(
    FIELD_DEFS.map((f) => [f.key, (row[f.key as keyof IndexingRow] as string | null) ?? '']),
  ) as Record<FieldKey, string>;
}

function draftToPatch(draft: Record<FieldKey, string>): IndexingPatch {
  return Object.fromEntries(
    FIELD_DEFS.map((f) => [f.key, draft[f.key].trim() === '' ? null : draft[f.key].trim()]),
  ) as IndexingPatch;
}

/** Return the key of the first field below the confidence threshold. */
function firstLowConfidenceField(
  analysis: AnalysisResponse | null,
  threshold: number,
): FieldKey | null {
  if (!analysis) return null;
  for (const f of FIELD_DEFS) {
    const af = analysis.fields[f.key];
    if (!af) continue;
    const pct = af.confidence * 100;
    if (pct > 0 && pct < threshold) return f.key;
  }
  return null;
}

// ── component ─────────────────────────────────────────────────────────────────

export function IndexingPage() {
  const qc = useQueryClient();
  const { user } = useAuth();

  // ── queue + stats ─────────────────────────────────────────────────────────
  const [onlyLowConf, setOnlyLowConf] = useState(false);
  const queue = useQuery({
    queryKey: ['indexing', 'queue', { onlyLowConf }],
    queryFn: () =>
      fetchIndexingQueue({ limit: 200, ...(onlyLowConf ? { low_conf: 1 as const } : {}) }),
    refetchInterval: 15_000,
  });
  const stats = useQuery({
    queryKey: ['indexing', 'stats'],
    queryFn: fetchIndexingStats,
  });

  // ── active document ───────────────────────────────────────────────────────
  const [activeDoc, setActiveDoc] = useState<IndexingRow | null>(null);
  const [draft, setDraft] = useState<Record<FieldKey, string>>(blankDraft());
  const [focusedFieldIndex, setFocusedFieldIndex] = useState(-1);
  const [showHelp, setShowHelp] = useState(false);
  const [initialFocusKey, setInitialFocusKey] = useState<FieldKey | null>(null);

  // ── per-field analysis ────────────────────────────────────────────────────
  const analysisQuery = useQuery({
    queryKey: ['indexing', 'analysis', activeDoc?.id],
    queryFn: () => fetchIndexingAnalysis(activeDoc!.id),
    enabled: activeDoc !== null,
    staleTime: 60_000,
  });

  // ── field refs for keyboard navigation ────────────────────────────────────
  const fieldRefs = useMemo<RefObject<HTMLInputElement | null>[]>(
    () => FIELD_DEFS.map(() => ({ current: null })),
    [],
  );

  // ── beacon ref (stable across renders) ───────────────────────────────────
  const activeDocIdRef = useRef<number | null>(null);

  useEffect(() => {
    function onBeforeUnload() {
      const id = activeDocIdRef.current;
      if (id !== null) beaconRelease(id);
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // ── claim mutation ────────────────────────────────────────────────────────
  const claimMut = useMutation({
    mutationFn: (id: number) => claimIndexingDoc(id),
  });

  // ── release mutation ──────────────────────────────────────────────────────
  const releaseMut = useMutation({
    mutationFn: (id: number) => releaseIndexingDoc(id),
    onSettled: () => {
      activeDocIdRef.current = null;
      void qc.invalidateQueries({ queryKey: ['indexing', 'queue'] });
      setActiveDoc(null);
      setDraft(blankDraft());
      setFocusedFieldIndex(-1);
      setInitialFocusKey(null);
    },
  });

  // ── save mutation ─────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: IndexingPatch }) =>
      patchIndexingRow(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['indexing'] });
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  // ── open a document from the queue ───────────────────────────────────────
  const openDoc = useCallback(
    (row: IndexingRow) => {
      claimMut.mutate(row.id, {
        onSuccess: () => {
          activeDocIdRef.current = row.id;
          setActiveDoc(row);
          setDraft(rowToDraft(row));
          setFocusedFieldIndex(-1);
          setInitialFocusKey(null);
          void qc.invalidateQueries({ queryKey: ['indexing', 'queue'] });
        },
        onError: () => {
          void qc.invalidateQueries({ queryKey: ['indexing', 'queue'] });
        },
      });
    },
    [claimMut, qc],
  );

  // ── set autofocus once analysis loads ────────────────────────────────────
  useEffect(() => {
    if (!analysisQuery.data || !activeDoc) return;
    const key = firstLowConfidenceField(analysisQuery.data, DEFAULT_CONFIDENCE_THRESHOLD);
    setInitialFocusKey(key);
  }, [analysisQuery.data, activeDoc]);

  // ── release lock ──────────────────────────────────────────────────────────
  const handleRelease = useCallback(() => {
    if (!activeDoc) return;
    releaseMut.mutate(activeDoc.id);
  }, [activeDoc, releaseMut]);

  // ── save + advance to next unclaimed doc ─────────────────────────────────
  const handleSaveAndNext = useCallback(() => {
    if (!activeDoc) return;
    const patch = draftToPatch(draft);
    const currentId = activeDoc.id;
    saveMut.mutate(
      { id: currentId, patch },
      {
        onSuccess: () => {
          releaseMut.mutate(currentId, {
            onSettled: () => {
              const rows = queue.data ?? [];
              const currentIdx = rows.findIndex((r) => r.id === currentId);
              for (let i = currentIdx + 1; i < rows.length; i++) {
                const next = rows[i];
                if (next !== undefined && next.lock === null) {
                  openDoc(next);
                  return;
                }
              }
            },
          });
        },
      },
    );
  }, [activeDoc, draft, saveMut, releaseMut, queue.data, openDoc]);

  // ── bbox click → focus matching field ────────────────────────────────────
  const handleBboxClick = useCallback(
    (fieldKey: string) => {
      const idx = FIELD_DEFS.findIndex((f) => f.key === fieldKey);
      if (idx === -1) return;
      setFocusedFieldIndex(idx);
      const ref = fieldRefs[idx];
      if (ref?.current) {
        ref.current.focus();
        ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    [fieldRefs],
  );

  // ── keyboard hook ─────────────────────────────────────────────────────────
  useIndexingKeyboard({
    active: activeDoc !== null,
    fieldRefs,
    focusedFieldIndex,
    setFocusedFieldIndex,
    onSaveAndNext: handleSaveAndNext,
    onRelease: handleRelease,
    onToggleHelp: () => setShowHelp((v) => !v),
    keyNext: KEY_NEXT,
    keyPrev: KEY_PREV,
  });

  // ── active field key for bbox overlay ────────────────────────────────────
  const activeFieldKey: string | null = useMemo(() => {
    if (focusedFieldIndex < 0 || focusedFieldIndex >= FIELD_DEFS.length) return null;
    return FIELD_DEFS[focusedFieldIndex]?.key ?? null;
  }, [focusedFieldIndex]);

  // ── stats summary ─────────────────────────────────────────────────────────
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

  const rows = queue.data ?? [];
  const currentUserId = user?.id ?? -1;
  const analysisData = analysisQuery.data ?? null;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Metrics strip */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 px-4 pt-3 pb-3 border-b border-divider bg-surface shrink-0">
        {summary.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} tone={m.tone} sub="Needs attention" />
        ))}
      </div>

      {/* 3-pane or idle state */}
      {activeDoc !== null ? (
        <div className="flex flex-1 min-h-0">
          {/* Left: queue */}
          <div className="w-[260px] shrink-0">
            <QueuePane
              rows={rows}
              isLoading={queue.isLoading}
              activeDocId={activeDoc.id}
              currentUserId={currentUserId}
              onSelectRow={openDoc}
              onlyLowConf={onlyLowConf}
              onToggleLowConf={setOnlyLowConf}
            />
          </div>

          {/* Center: PDF */}
          <div className="flex-1 min-w-0">
            <PdfPane
              filename={activeDoc.filename}
              analysis={analysisData}
              activeFieldKey={activeFieldKey}
              onBboxClick={handleBboxClick}
            />
          </div>

          {/* Right: fields */}
          <div className="w-[320px] shrink-0">
            <FieldPane
              documentId={activeDoc.id}
              draft={draft}
              onDraftChange={(key, val) => setDraft((d) => ({ ...d, [key]: val }))}
              onSave={() => {
                if (activeDoc !== null) {
                  saveMut.mutate({ id: activeDoc.id, patch: draftToPatch(draft) });
                }
              }}
              onRelease={handleRelease}
              isSaving={saveMut.isPending}
              saveError={saveMut.isError}
              analysis={analysisData}
              initialFocusFieldKey={initialFocusKey}
              focusedFieldIndex={focusedFieldIndex}
              setFocusedFieldIndex={setFocusedFieldIndex}
              fieldRefs={fieldRefs}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Left: queue (idle) */}
          <div className="w-[260px] shrink-0">
            <QueuePane
              rows={rows}
              isLoading={queue.isLoading}
              activeDocId={null}
              currentUserId={currentUserId}
              onSelectRow={openDoc}
              onlyLowConf={onlyLowConf}
              onToggleLowConf={setOnlyLowConf}
            />
          </div>

          {/* Center+Right: idle placeholder */}
          <div className="flex-1 flex items-center justify-center bg-page">
            <div className="text-center space-y-3">
              <LayoutPanelLeft size={40} className="mx-auto text-muted" aria-hidden="true" />
              <p className="text-md font-medium text-ink">Select a document to begin indexing</p>
              <p className="text-xs text-muted max-w-xs">
                Click any unclaimed row in the queue to open the 3-pane station. Press{' '}
                <kbd className="rounded border border-border bg-raised px-1 font-mono text-2xs">?</kbd>{' '}
                for keyboard shortcuts.
              </p>
            </div>
          </div>
        </div>
      )}

      <ShortcutHelpOverlay
        open={showHelp}
        onClose={() => setShowHelp(false)}
        keyNext={KEY_NEXT}
        keyPrev={KEY_PREV}
      />
    </div>
  );
}
