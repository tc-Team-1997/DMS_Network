/**
 * AuditLogPage — Audit Log v2 (Wave C).
 *
 * Tabs:
 *   events  — paginated filterable event list with diff drawer
 *   search  — full-text search over detail/action/entity_type
 *   pivot   — group by entity_type | document_id | customer_cid | user_id
 *
 * Persistent header:
 *   ChainVerifyBadge  — green/red chain integrity banner
 *   AnchorBadge       — last OTS anchor + "Anchor now" (Doc Admin only)
 *   ExportMenu        — JSON/CSV/PDF (Doc Admin only)
 *   AuditFilterBar    — filters persisted in URL (Events tab only)
 *
 * Route: /admin/audit
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Tabs,
  TabList,
  Tab,
  TabPanel,
  DataTable,
  Panel,
  type Column,
} from '@/components/ui';
import { Search } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { fetchAuditEvents, searchAuditEvents, verifyChain } from './api';
import type { AuditEvent } from './schemas';
import { ChainVerifyBadge } from './components/ChainVerifyBadge';
import { AuditFilterBar, useAuditFilters } from './components/AuditFilterBar';
import { EntityPivot } from './components/EntityPivot';
import { DiffDrawer } from './components/DiffDrawer';
import { ExportMenu } from './components/ExportMenu';
import { AnchorBadge } from './components/AnchorBadge';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Column definition for the events table
// ---------------------------------------------------------------------------

function ResultBadge({ result }: { result: string | null }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-badge px-2 py-0.5 text-2xs font-medium',
        result === 'allow' ? 'bg-success-bg text-success' :
        result === 'deny'  ? 'bg-danger-bg  text-danger'  :
        result === 'error' ? 'bg-warning-bg text-warning' :
                             'bg-divider    text-muted',
      )}
    >
      {result ?? '—'}
    </span>
  );
}

type EventRow = AuditEvent & { _id: string };

function buildColumns(onRowClick: (row: EventRow) => void): Column<EventRow>[] {
  return [
    {
      key: 'created_at',
      header: 'Timestamp',
      width: 160,
      render: (r) => (
        <span className="text-xs text-muted">
          {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
        </span>
      ),
    },
    {
      key: 'username',
      header: 'Actor',
      width: 120,
      render: (r) => <span className="text-xs">{r.username ?? '—'}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      width: 160,
      render: (r) => <span className="text-xs font-mono">{r.action ?? '—'}</span>,
    },
    {
      key: 'entity_type',
      header: 'Entity type',
      width: 100,
      render: (r) => <span className="text-xs">{r.entity_type ?? '—'}</span>,
    },
    {
      key: 'entity_id',
      header: 'Entity',
      width: 120,
      render: (r) => (
        <span className="text-xs">
          {r.entity ?? '—'}
          {r.entity_id != null ? ` #${r.entity_id}` : ''}
        </span>
      ),
    },
    {
      key: 'result',
      header: 'Result',
      width: 80,
      render: (r) => <ResultBadge result={r.result} />,
    },
    {
      key: 'hash',
      header: 'Hash',
      width: 120,
      render: (r) => (
        <span className="text-2xs font-mono text-muted">
          {r.hash ? `${r.hash.slice(0, 12)}…` : 'unchained'}
        </span>
      ),
    },
    {
      key: '_id',
      header: '',
      width: 60,
      render: (r) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRowClick(r); }}
          className="text-xs text-brand-blue hover:underline"
        >
          Detail
        </button>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Events tab
// ---------------------------------------------------------------------------

function EventsTab({ onRowClick }: { onRowClick: (row: AuditEvent) => void }) {
  const filters = useAuditFilters();
  const [, setParams] = useSearchParams();

  const q = useQuery({
    queryKey: ['audit', 'events', filters],
    queryFn: () => fetchAuditEvents(filters),
    staleTime: 15_000,
  });

  const rows: EventRow[] = (q.data?.events ?? []).map((e) => ({
    ...e,
    _id: String(e.id),
  }));

  const columns = buildColumns((row) => onRowClick(row));

  const setPage = (p: number) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(p));
      return next;
    });
  };

  return (
    <div className="space-y-3" data-testid="events-tab">
      <AuditFilterBar />

      {q.isError && (
        <p className="text-sm text-danger">Failed to load audit events.</p>
      )}

      <DataTable<EventRow>
        columns={columns}
        data={rows}
        empty="No audit events match the current filters."
      />

      {/* Pagination */}
      {q.data && q.data.total > (filters.per_page ?? 50) && (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            Showing {Math.min(((filters.page ?? 1) - 1) * (filters.per_page ?? 50) + 1, q.data.total)}–
            {Math.min((filters.page ?? 1) * (filters.per_page ?? 50), q.data.total)} of {q.data.total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={(filters.page ?? 1) <= 1}
              onClick={() => setPage((filters.page ?? 1) - 1)}
              className="rounded-input border border-border px-3 py-1 hover:bg-divider disabled:opacity-40 transition"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={(filters.page ?? 1) * (filters.per_page ?? 50) >= q.data.total}
              onClick={() => setPage((filters.page ?? 1) + 1)}
              className="rounded-input border border-border px-3 py-1 hover:bg-divider disabled:opacity-40 transition"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FTS Search tab
// ---------------------------------------------------------------------------

function FtsSearchTab({ onRowClick }: { onRowClick: (row: AuditEvent) => void }) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  const q = useQuery({
    queryKey: ['audit', 'fts', submitted],
    queryFn: () => searchAuditEvents(submitted),
    enabled: submitted.length > 0,
    staleTime: 30_000,
  });

  const rows: EventRow[] = (q.data?.events ?? []).map((e) => ({
    ...e,
    _id: String(e.id),
  }));

  const columns = buildColumns((row) => onRowClick(row));

  return (
    <div className="space-y-4" data-testid="fts-search-tab">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = query.trim();
          if (trimmed) setSubmitted(trimmed);
        }}
      >
        <div className="relative flex-1 max-w-md">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search audit log full text…"
            className="h-9 w-full rounded-input border border-border bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
          />
        </div>
        <button
          type="submit"
          className="rounded-input bg-brand-blue text-white px-4 py-2 text-sm font-medium hover:bg-brand-blueHover transition"
        >
          Search
        </button>
      </form>

      {submitted && q.isLoading && (
        <p className="text-sm text-muted">Searching…</p>
      )}
      {submitted && q.isError && (
        <p className="text-sm text-danger">Search failed.</p>
      )}
      {submitted && q.data && (
        <>
          <p className="text-xs text-muted">
            {q.data.total} result{q.data.total !== 1 ? 's' : ''} for "{submitted}"
          </p>
          <DataTable<EventRow>
            columns={columns}
            data={rows}
            empty="No results."
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export function AuditLogPage() {
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [activeTab, setActiveTab] = useState('events');

  // Shared verify-chain result for badge + anchor.
  const chainQ = useQuery({
    queryKey: ['audit', 'verify-chain', 1000],
    queryFn: () => verifyChain(1000),
    staleTime: 60_000,
  });

  const headHash = chainQ.data?.head_hash ?? null;

  // Derive role-based capability from session user injected into page by EJS layout.
  const role = useAuth((s) => s.user?.role) ?? '';
  const isDocAdmin = role === 'Doc Admin';

  const filters = useAuditFilters();

  return (
    <div className="space-y-4" data-testid="audit-log-page">
      {/* Chain + anchor header */}
      <div className="space-y-2">
        {chainQ.data !== undefined ? (
          <ChainVerifyBadge window={1000} serverResult={chainQ.data} />
        ) : (
          <ChainVerifyBadge window={1000} />
        )}
        <AnchorBadge headHash={headHash} canAnchor={isDocAdmin} />
      </div>

      {/* Export (Doc Admin only) */}
      {isDocAdmin && (
        <div className="flex justify-end">
          <ExportMenu filters={filters} />
        </div>
      )}

      {/* Tabs */}
      <Panel>
        <Tabs value={activeTab} onChange={setActiveTab}>
          <TabList>
            <Tab value="events">Events</Tab>
            <Tab value="search">Full-text search</Tab>
            <Tab value="pivot">Entity pivot</Tab>
          </TabList>

          <TabPanel value="events">
            <div className="pt-4">
              <EventsTab onRowClick={setSelectedEvent} />
            </div>
          </TabPanel>

          <TabPanel value="search">
            <div className="pt-4">
              <FtsSearchTab onRowClick={setSelectedEvent} />
            </div>
          </TabPanel>

          <TabPanel value="pivot">
            <div className="pt-4">
              <EntityPivot />
            </div>
          </TabPanel>
        </Tabs>
      </Panel>

      {/* Detail drawer */}
      <DiffDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}

