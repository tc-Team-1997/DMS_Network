/**
 * WorkflowsPage — Workflows v2 redesign.
 *
 * Replaces the v1 icon-only approve/reject buttons (SOX material weakness
 * §3.6 and §10.1 item 4) with a full drawer-based action surface including
 * reason codes, comments, step-up auth, and a bulk-action bar.
 */

import { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  DataTable,
  Panel,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  useToast,
  type Column,
  type SelectionState,
  type PaginationState,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { AlertTriangle, Clock } from 'lucide-react';

import { fetchWorkflows, type WorkflowRow, type WorkflowFilters } from './api';
import { useUrlState } from './hooks/useUrlState';
import { FilterChips } from './components/FilterChips';
import { StageTimelinePills } from './components/StageTimelinePills';
import { ActionDrawer } from './components/ActionDrawer';
import { BulkActionBar } from './components/BulkActionBar';
import type { ComboboxOption } from '@/components/ui';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAB_VALUES = ['assigned', 'team', 'all', 'approved', 'rejected'] as const;
type TabValue = (typeof TAB_VALUES)[number];

const TAB_LABELS: Record<TabValue, string> = {
  assigned: 'Assigned to me',
  team:     'Team queue',
  all:      'All',
  approved: 'Approved',
  rejected: 'Rejected',
};

const SLA_HOURS = 48;

const BRANCH_OPTIONS: ComboboxOption[] = [
  { value: 'Cairo West',   label: 'Cairo West' },
  { value: 'Giza',         label: 'Giza' },
  { value: 'Alexandria',   label: 'Alexandria' },
  { value: 'Cairo East',   label: 'Cairo East' },
];

const DOC_TYPE_OPTIONS: ComboboxOption[] = [
  { value: 'Passport',         label: 'Passport' },
  { value: 'National ID',      label: 'National ID' },
  { value: 'Loan Application', label: 'Loan Application' },
  { value: 'Utility Bill',     label: 'Utility Bill' },
  { value: 'Contract',         label: 'Contract' },
  { value: 'KYC',              label: 'KYC' },
];

const RISK_BAND_OPTIONS: ComboboxOption[] = [
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
];

// ---------------------------------------------------------------------------
// SLA helpers
// ---------------------------------------------------------------------------

function slaRemainingMs(createdAt: string): number {
  const created  = new Date(createdAt).getTime();
  const deadline = created + SLA_HOURS * 60 * 60 * 1000;
  return deadline - Date.now();
}

function formatSla(remainingMs: number): { label: string; tone: 'success' | 'warning' | 'danger' } {
  const abs = Math.abs(remainingMs);
  const h   = Math.floor(abs / (1000 * 60 * 60));
  const m   = Math.floor((abs % (1000 * 60 * 60)) / (1000 * 60));
  const parts = h > 0 ? `${h}h ${m}m` : `${m}m`;

  if (remainingMs < 0) return { label: `OVERDUE by ${parts}`, tone: 'danger' };
  if (remainingMs < 4 * 60 * 60 * 1000) return { label: `${parts} remaining`, tone: 'danger' };
  if (remainingMs < 24 * 60 * 60 * 1000) return { label: `${parts} remaining`, tone: 'warning' };
  return { label: `${parts} remaining`, tone: 'success' };
}

function SlaBadge({ createdAt, stage }: { createdAt: string; stage: string }) {
  if (stage === 'Approved' || stage.startsWith('Rejected')) return null;
  const remaining = slaRemainingMs(createdAt);
  const { label, tone } = formatSla(remaining);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-badge px-1.5 py-0.5 text-2xs font-medium',
        tone === 'success' && 'bg-success-bg text-success',
        tone === 'warning' && 'bg-warning-bg text-warning',
        tone === 'danger'  && 'bg-danger-bg text-danger',
      )}
    >
      {remaining < 0 ? <AlertTriangle size={9} /> : <Clock size={9} />}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Default filter + URL state
// ---------------------------------------------------------------------------

/**
 * PageState must satisfy UrlParams (index signature) so useUrlState<T>
 * accepts it.  exactOptionalPropertyTypes requires the undefined-able fields
 * to be typed as `string | undefined` (not just `string`), and we satisfy
 * the index signature by widening with an intersection.
 */
type PageState = {
  tab:       string;
  search?:   string;
  branch?:   string;
  doc_type?: string;
  risk_band?: string;
  page:      number;
  pageSize:  number;
} & Record<string, string | number | boolean | null | undefined>;

const DEFAULT_STATE: PageState = {
  tab:      'all',
  page:     1,
  pageSize: 50,
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function WorkflowsPage() {
  const role        = useAuth((s) => s.user?.role);
  const canApprove  = role === 'Doc Admin' || role === 'Checker';
  const canEscalate = role === 'Doc Admin';
  const { toast }   = useToast();
  const qc          = useQueryClient();

  const [urlState, setUrlState] = useUrlState(DEFAULT_STATE);

  const [selectedKeys,   setSelectedKeys]   = useState<Set<string | number>>(new Set());
  const [drawerWorkflow, setDrawerWorkflow] = useState<WorkflowRow | null>(null);

  // Extract from urlState, narrowing from UrlParams-widened type to the
  // concrete WorkflowFilters type expected by fetchWorkflows.
  function asStr(v: unknown): string | undefined {
    return typeof v === 'string' ? v : undefined;
  }
  function asNum(v: unknown, fallback: number): number {
    return typeof v === 'number' ? v : fallback;
  }

  // Build filters — only include optional keys that have a real string value
  // to satisfy exactOptionalPropertyTypes (undefined values must be absent).
  const filters: WorkflowFilters = Object.assign(
    {
      tab:      asStr(urlState.tab) ?? 'all',
      page:     asNum(urlState.page, 1),
      pageSize: asNum(urlState.pageSize, 50),
    } satisfies WorkflowFilters,
    asStr(urlState.search)    != null ? { search:    asStr(urlState.search)    } : {},
    asStr(urlState.branch)    != null ? { branch:    asStr(urlState.branch)    } : {},
    asStr(urlState.doc_type)  != null ? { doc_type:  asStr(urlState.doc_type)  } : {},
    asStr(urlState.risk_band) != null ? { risk_band: asStr(urlState.risk_band) } : {},
  ) as WorkflowFilters;

  const { data, isLoading } = useQuery({
    queryKey: ['workflows', filters],
    queryFn:  () => fetchWorkflows(filters),
    placeholderData: (prev) => prev,
  });

  const rows     = data?.data     ?? [];
  const total    = data?.total    ?? 0;
  const page     = data?.page     ?? 1;
  const pageSize = data?.pageSize ?? 50;

  const pagination: PaginationState = useMemo(() => ({
    page,
    pageSize,
    total,
    onPageChange:     (p)  => setUrlState({ page: p }),
    onPageSizeChange: (ps) => setUrlState({ pageSize: ps, page: 1 }),
  }), [page, pageSize, total, setUrlState]);

  const selection: SelectionState = useMemo(() => ({
    selectedKeys,
    onChange: setSelectedKeys,
  }), [selectedKeys]);

  const selectedIds = useMemo(
    () => Array.from(selectedKeys).map((k) => Number(k)),
    [selectedKeys],
  );

  const clearSelection = useCallback(() => setSelectedKeys(new Set()), []);

  function handleFilterChange(patch: Partial<PageState>) {
    setUrlState(patch);
    clearSelection();
  }

  function handleTabChange(tab: string) {
    setUrlState({ tab, page: 1 });
    clearSelection();
  }

  function handleRowClick(row: WorkflowRow) {
    setDrawerWorkflow(row);
  }

  function handleActionSuccess(msg: string) {
    toast({ variant: 'success', title: 'Done', message: msg });
    void qc.invalidateQueries({ queryKey: ['workflows'] });
    setDrawerWorkflow(null);
  }

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------

  const columns = useMemo<Column<WorkflowRow>[]>(() => [
    {
      key:    'ref',
      header: 'Ref',
      width:  100,
      render: (w) => (
        <span className="font-mono text-xs text-ink">{w.ref_code ?? '—'}</span>
      ),
    },
    {
      key:    'title',
      header: 'Title / Document',
      render: (w) => (
        <div className="flex flex-col min-w-0">
          <span className="text-md text-ink truncate">{w.title ?? '—'}</span>
          {w.document_name && (
            <span className="text-xs text-muted truncate">{w.document_name}</span>
          )}
          {w.customer_name && (
            <span className="text-xs text-muted truncate">{w.customer_name}</span>
          )}
        </div>
      ),
    },
    {
      key:    'stage',
      header: 'Stage',
      render: (w) => (
        <span data-testid={`workflow-${w.id}-stage`}>
          <StageTimelinePills stage={w.stage} />
        </span>
      ),
    },
    {
      key:    'sla',
      header: 'SLA',
      width:  160,
      render: (w) => (
        <span data-testid={`workflow-${w.id}-sla`}>
          <SlaBadge createdAt={w.created_at} stage={w.stage} />
        </span>
      ),
    },
    {
      key:    'priority',
      header: 'Priority',
      width:  90,
      render: (w) => (
        <Badge
          tone={
            w.priority === 'High' ? 'danger'
            : w.priority === 'Low' ? 'neutral'
            : 'warning'
          }
        >
          {w.priority}
        </Badge>
      ),
    },
    {
      key:    'risk',
      header: 'Risk',
      width:  80,
      render: (w) =>
        w.risk_band ? (
          <Badge
            tone={
              w.risk_band === 'critical' ? 'danger'
              : w.risk_band === 'high'   ? 'warning'
              : 'neutral'
            }
          >
            {w.risk_band}
          </Badge>
        ) : (
          <span className="text-muted text-xs">—</span>
        ),
    },
    {
      key:    'branch',
      header: 'Branch',
      width:  110,
      render: (w) => (
        <span className="text-xs text-ink-sub">{w.branch ?? '—'}</span>
      ),
    },
    {
      key:    'updated',
      header: 'Updated',
      width:  130,
      render: (w) => (
        <span className="text-xs text-muted tabular-nums">
          {new Date(w.updated_at).toLocaleString()}
        </span>
      ),
    },
  ], []);

  return (
    <div className="space-y-4">
      <Panel>
        <Tabs value={urlState.tab} onChange={handleTabChange}>
          <TabList className="-mx-5 -mt-5 px-5 mb-4">
            {TAB_VALUES.map((t) => (
              <Tab key={t} value={t} data-testid={`queue-${t}`}>
                {TAB_LABELS[t]}
              </Tab>
            ))}
          </TabList>

          {/* Filter chips — shared across all tabs, server-side */}
          <FilterChips
            filters={filters}
            onChange={handleFilterChange}
            branchOptions={BRANCH_OPTIONS}
            docTypeOptions={DOC_TYPE_OPTIONS}
            riskBandOptions={RISK_BAND_OPTIONS}
          />

          {/* All tabs render the same table; filtering is server-side via query param */}
          {TAB_VALUES.map((t) => (
            <TabPanel key={t} value={t} className="mt-4">
              <DataTable<WorkflowRow>
                columns={columns}
                data={rows}
                onRowClick={handleRowClick}
                selection={selection}
                selectionMode="multi"
                pagination={pagination}
                stickyHeader
                density="compact"
                empty={isLoading ? 'Loading…' : 'No workflows in this queue.'}
              />
            </TabPanel>
          ))}
        </Tabs>
      </Panel>

      {/* Sticky bulk-action bar — appears only when rows are selected */}
      <BulkActionBar
        selectedIds={selectedIds}
        onClear={clearSelection}
        canApprove={canApprove}
        canEscalate={canEscalate}
      />

      <div className="flex justify-end">
        <Link to="/workflows/templates">
          <Button size="sm" variant="ghost" data-testid="templates-link">
            Workflow templates
          </Button>
        </Link>
      </div>

      <ActionDrawer
        workflow={drawerWorkflow}
        onClose={() => setDrawerWorkflow(null)}
        canApprove={canApprove}
        canEscalate={canEscalate}
        onActionSuccess={handleActionSuccess}
      />
    </div>
  );
}

