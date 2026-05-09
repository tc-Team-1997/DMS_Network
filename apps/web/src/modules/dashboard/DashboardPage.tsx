/**
 * Dashboard v2 — redesigned KPI dashboard.
 *
 * Design decisions:
 * - Single GET /spa/api/dashboard/kpis fetches all data in one request.
 * - Timeframe and comparator are local state; changing them invalidates the query key.
 * - Per-user tile visibility persists in localStorage (key: dashboard_prefs_{userId}).
 *   Admin-driven tile catalog comes from tenant_config namespace 'dashboard'.
 *   Deferred upgrade: user_dashboards table (BRD #26) can back this in Wave B.
 * - Recharts charts (ThroughputChart, FunnelChart, AiConfidenceHealth) are
 *   lazy-loaded so the recharts bundle does not block first paint.
 * - BranchDoctypeHeatmap is pure CSS grid — no recharts, statically imported.
 * - Sparkline is hand-rolled SVG — no recharts, statically imported.
 * - Refresh interval reads from tenant_config.dashboard.refresh_interval_seconds.
 *   Falls back to 300 s (5 min). Reads are debounced by staleTime in useKpis.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Panel, Skeleton, EmptyState } from '@/components/ui';
import { useTenantConfig } from '@/store/tenant-config';
import { useAuth } from '@/store/auth';
import { useKpis, dashboardKeys } from './api';
import {
  TILE_IDS,
  TIMEFRAMES,
  COMPARATORS,
  type Comparator,
  type TileId,
  type Timeframe,
} from './schemas';
import { KpiTile } from './components/KpiTile';
import { DashboardToolbar } from './components/DashboardToolbar';
import { CustomizeDrawer } from './components/CustomizeDrawer';
import { BranchDoctypeHeatmap } from './components/BranchDoctypeHeatmap';

// ── Lazy recharts charts ───────────────────────────────────────────────────────

const ThroughputChart = lazy(() =>
  import('./components/ThroughputChart').then((m) => ({ default: m.ThroughputChart })),
);
const FunnelChart = lazy(() =>
  import('./components/FunnelChart').then((m) => ({ default: m.FunnelChart })),
);
const AiConfidenceHealth = lazy(() =>
  import('./components/AiConfidenceHealth').then((m) => ({ default: m.AiConfidenceHealth })),
);

// ── localStorage helpers ───────────────────────────────────────────────────────

const DEFAULT_CATALOG: TileId[] = [...TILE_IDS];
const DEFAULT_REFRESH_MS = 300_000; // 5 minutes

function prefsKey(userId: number): string {
  return `dashboard_prefs_${userId}`;
}

function loadPrefs(userId: number, catalog: TileId[]): TileId[] {
  try {
    const raw = localStorage.getItem(prefsKey(userId));
    if (!raw) return catalog;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return catalog;
    // Only keep ids that are still in catalog
    const valid = parsed.filter(
      (v): v is TileId => typeof v === 'string' && (TILE_IDS as readonly string[]).includes(v),
    );
    return valid.length > 0 ? valid : catalog;
  } catch {
    return catalog;
  }
}

function savePrefs(userId: number, visible: TileId[]): void {
  try {
    localStorage.setItem(prefsKey(userId), JSON.stringify(visible));
  } catch {
    // localStorage might be blocked in restrictive iframe contexts
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtHours(v: number | null): string {
  if (v === null) return '—';
  if (v >= 24) return `${(v / 24).toFixed(1)}d`;
  return `${v.toFixed(1)}h`;
}

function fmtPct(v: number | null): string {
  if (v === null) return '—';
  return `${v.toFixed(1)}%`;
}

function fmtCount(v: number | null): string {
  if (v === null) return '—';
  return v.toLocaleString();
}

function fmtDelta(v: number | null, formatter: (n: number) => string): string | null {
  if (v === null) return null;
  return formatter(Math.abs(v));
}

// ── Main component ─────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { user } = useAuth();
  const userId = user?.id ?? 0;

  // ── Tenant config (namespace 'dashboard') ─────────────────────────────────
  const { data: cfg } = useTenantConfig('dashboard');

  const refreshIntervalMs = useMemo(() => {
    const v = cfg?.['refresh_interval_seconds'];
    return typeof v === 'number' && v >= 5 ? v * 1000 : DEFAULT_REFRESH_MS;
  }, [cfg]);

  const tenantCatalog = useMemo((): TileId[] => {
    const v = cfg?.['tile_catalog'];
    if (!Array.isArray(v)) return DEFAULT_CATALOG;
    const valid = v.filter(
      (s): s is TileId => typeof s === 'string' && (TILE_IDS as readonly string[]).includes(s),
    );
    return valid.length > 0 ? valid : DEFAULT_CATALOG;
  }, [cfg]);

  const defaultTimeframe = useMemo((): Timeframe => {
    const v = cfg?.['default_timeframe'];
    return typeof v === 'string' && (TIMEFRAMES as readonly string[]).includes(v)
      ? (v as Timeframe)
      : '30d';
  }, [cfg]);

  const defaultComparator = useMemo((): Comparator => {
    const v = cfg?.['default_comparator'];
    return typeof v === 'string' && (COMPARATORS as readonly string[]).includes(v)
      ? (v as Comparator)
      : 'none';
  }, [cfg]);

  // ── Toolbar state ─────────────────────────────────────────────────────────
  const [timeframe, setTimeframe]   = useState<Timeframe>(defaultTimeframe);
  const [comparator, setComparator] = useState<Comparator>(defaultComparator);

  // Sync when config loads (only once — config may not be present on first render)
  const [syncedDefaults, setSyncedDefaults] = useState(false);
  useEffect(() => {
    if (!syncedDefaults && cfg !== undefined) {
      setTimeframe(defaultTimeframe);
      setComparator(defaultComparator);
      setSyncedDefaults(true);
    }
  }, [cfg, syncedDefaults, defaultTimeframe, defaultComparator]);

  // ── Per-user tile visibility ───────────────────────────────────────────────
  const [visibleTiles, setVisibleTiles] = useState<TileId[]>(() =>
    loadPrefs(userId, DEFAULT_CATALOG),
  );

  // When catalog changes (admin removes a tile), strip hidden tiles
  useEffect(() => {
    setVisibleTiles((prev) => {
      const next = prev.filter((id) => tenantCatalog.includes(id));
      return next.length > 0 ? next : tenantCatalog;
    });
  }, [tenantCatalog]);

  const handleVisibleChange = useCallback(
    (next: TileId[]) => {
      setVisibleTiles(next);
      savePrefs(userId, next);
    },
    [userId],
  );

  // ── Customize drawer ───────────────────────────────────────────────────────
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // ── KPI query ─────────────────────────────────────────────────────────────
  const { data, isLoading, isError, isFetching, refetch } = useKpis(
    timeframe,
    comparator,
    refreshIntervalMs,
  );
  const queryClient = useQueryClient();

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: dashboardKeys.kpis(timeframe, comparator),
    });
    void refetch();
  }, [queryClient, refetch, timeframe, comparator]);

  // ── Tile render helpers ───────────────────────────────────────────────────
  const tiles = data?.tiles;

  const aiThresholdPct = tiles?.ai_confidence.threshold !== undefined
    ? Math.round(tiles.ai_confidence.threshold * 100)
    : 70;

  const tileProps = useMemo(() => {
    if (!tiles) return null;
    return {
      kyc_cycle: {
        label:          'KYC cycle time p50',
        subline:        'Hours from submission to approval',
        value:          fmtHours(tiles.kyc_cycle.value),
        delta:          fmtDelta(tiles.kyc_cycle.delta, (n) => fmtHours(n)),
        higherIsBetter: false,
        sparkline:      tiles.kyc_cycle.sparkline,
        status:         tiles.kyc_cycle.status,
      },
      percent_automated: {
        label:          '% Automated',
        subline:        '% of docs OCR-classified without manual indexing',
        value:          fmtPct(tiles.percent_automated.value),
        delta:          fmtDelta(tiles.percent_automated.delta, (n) => fmtPct(n)),
        higherIsBetter: true,
        sparkline:      tiles.percent_automated.sparkline,
        status:         tiles.percent_automated.status,
      },
      ai_confidence: {
        label:          `AI confidence ≥${aiThresholdPct}%`,
        subline:        `% of docs with extraction confidence ≥${aiThresholdPct}% (model self-reported)`,
        value:          fmtPct(tiles.ai_confidence.value),
        delta:          fmtDelta(tiles.ai_confidence.delta, (n) => fmtPct(n)),
        higherIsBetter: true,
        sparkline:      tiles.ai_confidence.sparkline,
        status:         tiles.ai_confidence.status,
      },
      expiring_30d: {
        label:          'Expiring 30d',
        subline:        'Documents expiring within the next 30 days',
        value:          fmtCount(tiles.expiring_30d.value),
        delta:          fmtDelta(tiles.expiring_30d.delta, (n) => fmtCount(n)),
        higherIsBetter: false,
        sparkline:      tiles.expiring_30d.sparkline,
        status:         tiles.expiring_30d.status,
      },
      audit_failures_ytd: {
        label:          'Audit failures YTD',
        subline:        'YTD, action contains fail/error/denied',
        value:          fmtCount(tiles.audit_failures_ytd.value),
        delta:          fmtDelta(tiles.audit_failures_ytd.delta, (n) => fmtCount(n)),
        higherIsBetter: false,
        sparkline:      tiles.audit_failures_ytd.sparkline,
        status:         tiles.audit_failures_ytd.status,
      },
    } as const;
  }, [tiles, aiThresholdPct]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <DashboardToolbar
        timeframe={timeframe}
        comparator={comparator}
        onTimeframe={setTimeframe}
        onComparator={setComparator}
        onRefresh={handleRefresh}
        isRefreshing={isFetching}
        onCustomize={() => setCustomizeOpen(true)}
      />

      {/* KPI Tiles */}
      {isError && !isLoading ? (
        <div className="rounded-card border border-divider bg-page px-4 py-3 text-sm text-muted" data-testid="kpi-error">
          Dashboard data could not be loaded. Check your connection or try refreshing.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {TILE_IDS
            .filter((id) => tenantCatalog.includes(id) && visibleTiles.includes(id))
            .map((id) => {
              if (isLoading || !tileProps) {
                return <KpiTile key={id} loading label="" subline="" value="" delta={null} higherIsBetter sparkline={[]} status="on-track" />;
              }
              return <KpiTile key={id} {...tileProps[id]} />;
            })}
        </div>
      )}

      {/* No-data state when nothing is visible */}
      {!isLoading && tenantCatalog.filter((id) => visibleTiles.includes(id)).length === 0 && (
        <EmptyState
          title="All tiles hidden"
          body="Open Customize to re-enable at least one KPI tile."
          action={{ label: 'Customize', onClick: () => setCustomizeOpen(true) }}
        />
      )}

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Panel title="Throughput vs SLA breach" className="xl:col-span-2">
          {isLoading ? (
            <Skeleton height={240} />
          ) : (
            <Suspense fallback={<Skeleton height={240} />}>
              <ThroughputChart data={data?.throughput ?? []} />
            </Suspense>
          )}
        </Panel>

        <Panel title="Capture to approve funnel">
          {isLoading ? (
            <Skeleton height={180} />
          ) : (
            <Suspense fallback={<Skeleton height={180} />}>
              <FunnelChart data={data?.funnel ?? []} />
            </Suspense>
          )}
        </Panel>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title="Branch document type backlog">
          {isLoading ? (
            <Skeleton height={160} />
          ) : (
            <BranchDoctypeHeatmap data={data?.heatmap ?? []} />
          )}
        </Panel>

        <Panel title="AI confidence health (last 7 days)">
          {isLoading ? (
            <Skeleton height={180} />
          ) : (
            <Suspense fallback={<Skeleton height={180} />}>
              <AiConfidenceHealth data={data?.confidence_histogram ?? { lt40: 0, c40to70: 0, c70to90: 0, gte90: 0 }} />
            </Suspense>
          )}
        </Panel>
      </div>

      {/* Customize drawer */}
      <CustomizeDrawer
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        catalog={tenantCatalog}
        visible={visibleTiles}
        onVisibleChange={handleVisibleChange}
      />
    </div>
  );
}
