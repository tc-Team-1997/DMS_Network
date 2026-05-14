/**
 * DSAR Console — Plan 3 (Wave-E1)
 *
 * Layout (top → bottom):
 *  1. Header — page title + "New DSAR Request" button + Regulator selector +
 *     "Audit of DSARs" link.
 *  2. Search section — 4 axis chips (CID / Email / Phone / National ID),
 *     value input, submit button.
 *  3. Subject card — list of subject matches (clickable rows).
 *  4. After subject select:
 *       a. SLA preview banner (testid `dsar-sla-countdown`)
 *       b. 5-panel inventory grid
 *       c. Inline fulfillment section (4 action cards + cryptoshred two-step)
 *  5. Request history table (RequestList).
 *
 * RBAC: Doc Admin only (client-side gate; route guard is belt+suspenders).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronRight, Shield, RefreshCw, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Combobox, EmptyState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { AccessDenied } from '@/components/AccessDenied';
import { lookupSubject, fetchInventory, fetchRequests } from './api';
import { FulfillModal } from './components/FulfillModal';
import { InventoryGrid } from './components/InventoryGrid';
import { RequestList } from './components/RequestList';
import type { LookupAxis, SubjectMatch } from './schemas';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AXIS_OPTIONS: { value: LookupAxis; label: string; testIdSuffix: string }[] = [
  { value: 'cid',         label: 'CID',         testIdSuffix: 'cid' },
  { value: 'email',       label: 'Email',       testIdSuffix: 'email' },
  { value: 'phone',       label: 'Phone',       testIdSuffix: 'phone' },
  { value: 'national_id', label: 'National ID', testIdSuffix: 'national-id' },
];

const REGULATOR_OPTIONS = [
  { value: 'GDPR', label: 'GDPR (30 days)' },
  { value: 'PDPL', label: 'PDPL (30 days)' },
  { value: 'RMA',  label: 'RMA (15 days)' },
];

// Default SLA window per regulator (matches python-service/app/services/dsar.py).
const SLA_WINDOW_DAYS: Record<string, number> = {
  GDPR: 30,
  PDPL: 30,
  RMA:  15,
};

// ---------------------------------------------------------------------------
// SubjectCard
// ---------------------------------------------------------------------------

interface SubjectCardProps {
  matches: SubjectMatch[];
  selected: SubjectMatch | null;
  onSelect: (match: SubjectMatch) => void;
}

function SubjectCard({ matches, selected, onSelect }: SubjectCardProps) {
  if (matches.length === 0) {
    return (
      <div
        data-testid="dsar-subject-card"
        className="rounded-card border border-divider bg-surface px-5 py-8"
      >
        <EmptyState
          icon={<Search size={20} />}
          title="No matching subjects"
          body="No customer records match the search. Try a different axis or value."
        />
      </div>
    );
  }

  return (
    <div
      data-testid="dsar-subject-card"
      className="rounded-card border border-divider bg-surface overflow-hidden"
    >
      <div className="border-b border-divider bg-raised px-4 py-2.5">
        <p className="text-xs font-semibold text-ink-sub uppercase tracking-wider">
          {matches.length === 1 ? 'Subject matched' : `${matches.length} subjects matched — select one`}
        </p>
      </div>
      <ul className="divide-y divide-divider">
        {matches.map((m) => {
          const isSelected = selected?.cid === m.cid;
          return (
            <li key={m.cid}>
              <button
                type="button"
                data-testid={`dsar-subject-row-${m.cid}`}
                onClick={() => onSelect(m)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors min-h-[44px]',
                  isSelected ? 'bg-action-subtle' : 'hover:bg-raised',
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs font-medium text-ink truncate">
                    {m.cid}
                  </p>
                  {m.name !== null && (
                    <p className="text-xs text-ink-sub truncate">{m.name}</p>
                  )}
                  <p className="text-2xs text-muted mt-0.5">
                    {m.tenant_id ?? 'default'} · matched via {m.match_axis}
                    {m.cbs_source !== null ? ` · ${m.cbs_source}` : ''}
                  </p>
                </div>
                <ChevronRight
                  size={14}
                  className={isSelected ? 'text-action' : 'text-muted'}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SLA preview banner (Plan 3 — Wave-E1)
//
// Shows the regulator SLA window the operator will commit to if a request is
// fulfilled now. Once a request exists, RequestList renders a per-row
// dsar-sla-countdown with the live days_remaining; this banner is the page-
// level "you have N days from today" affordance.
// ---------------------------------------------------------------------------

function SlaPreviewBanner({ regulator }: { regulator: string }) {
  const days = SLA_WINDOW_DAYS[regulator] ?? 30;
  return (
    <div
      data-testid="dsar-sla-countdown"
      aria-live="polite"
      className="flex items-center justify-between rounded-card border border-divider bg-raised px-4 py-2.5 text-xs"
    >
      <span className="text-muted">
        <span className="font-semibold text-ink">{regulator}</span>{' '}
        regulator SLA window
      </span>
      <span className="font-mono font-semibold tabular-nums text-action">
        {days} d remaining
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DSARPage
// ---------------------------------------------------------------------------

export function DSARPage() {
  const user = useAuth((s) => s.user);

  // RBAC gate (client-side; server enforces in routes/spa-api/dsar.js).
  if (!user || user.role !== 'Doc Admin') {
    return <AccessDenied />;
  }

  const [axis, setAxis] = useState<LookupAxis>('cid');
  const [searchValue, setSearchValue] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selectedSubject, setSelectedSubject] = useState<SubjectMatch | null>(null);
  const [regulator, setRegulator] = useState('GDPR');

  // Lookup query — only fires when submitted is set.
  const lookupQ = useQuery({
    queryKey: ['dsar', 'lookup', axis, submitted],
    queryFn: () => lookupSubject(axis, submitted),
    enabled: submitted.trim().length > 0,
  });

  // Inventory query — only fires when a subject is selected.
  const inventoryQ = useQuery({
    queryKey: ['dsar', 'inventory', selectedSubject?.cid],
    queryFn: () => fetchInventory(selectedSubject?.cid ?? ''),
    enabled: selectedSubject !== null,
  });

  // Request list — always loaded for this tenant.
  const requestsQ = useQuery({
    queryKey: ['dsar', 'requests'],
    queryFn: fetchRequests,
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = searchValue.trim();
    if (!trimmed) return;
    setSubmitted(trimmed);
    setSelectedSubject(null);
  }

  function startNewRequest() {
    // "New DSAR Request" button — resets state and focuses the search field.
    setSearchValue('');
    setSubmitted('');
    setSelectedSubject(null);
    const el = document.querySelector<HTMLInputElement>('[data-testid="dsar-search-input"]');
    el?.focus();
  }

  const matches = lookupQ.data?.matches ?? [];
  const panels = inventoryQ.data?.panels ?? null;
  const requests = requestsQ.data?.items ?? [];

  return (
    <div className="flex h-full flex-col gap-6 px-6 py-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield size={18} className="text-brand-blue" />
            <h1 className="text-xl font-semibold text-ink">DSAR Console</h1>
          </div>
          <p className="text-sm text-muted">
            Data Subject Access Request management — GDPR Art-15 / Art-17 / PDPL / RMA
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* "Audit of DSARs" — links to audit log filtered by dsar.* actions. */}
          <Link
            to="/audit?filter=dsar."
            className="inline-flex items-center gap-1.5 rounded-input border border-divider px-3 py-2 text-xs text-ink-sub hover:bg-raised min-h-[44px]"
          >
            <ClipboardList size={13} />
            Audit of DSARs
          </Link>
          {/* "New DSAR Request" entry-point button. */}
          <button
            type="button"
            data-testid="dsar-new-request"
            onClick={startNewRequest}
            className="inline-flex items-center gap-1.5 rounded-input bg-brand-blue px-3 py-2 text-sm font-medium text-white hover:bg-brand-blueHover focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1 min-h-[44px]"
          >
            <Shield size={13} />
            New DSAR Request
          </button>
        </div>
      </div>

      {/* Regulator selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Regulator:</span>
        <Combobox
          options={REGULATOR_OPTIONS}
          value={regulator}
          onChange={setRegulator}
          placeholder="GDPR"
          className="w-48"
        />
      </div>

      {/* Subject search */}
      <div className="rounded-card border border-divider bg-surface p-4 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
          Subject lookup
        </p>

        {/* Axis chip-row — each chip is independently clickable for Playwright. */}
        <div
          role="radiogroup"
          aria-label="Lookup axis"
          className="mb-3 flex flex-wrap gap-1.5"
        >
          {AXIS_OPTIONS.map((opt) => {
            const isActive = axis === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                data-testid={`dsar-axis-${opt.testIdSuffix}`}
                onClick={() => setAxis(opt.value)}
                className={cn(
                  'min-h-[44px] rounded-badge px-3 py-1.5 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-brand-blue text-white'
                    : 'border border-divider bg-surface text-ink-sub hover:bg-raised',
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={
              axis === 'cid' ? 'Enter customer CID…'
              : axis === 'email' ? 'Enter email address…'
              : axis === 'phone' ? 'Enter phone number…'
              : 'Enter national ID…'
            }
            className="input flex-1"
            data-testid="dsar-search-input"
          />
          <button
            type="submit"
            data-testid="dsar-submit"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-input bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blueHover focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1 disabled:opacity-40"
            disabled={lookupQ.isFetching}
          >
            {lookupQ.isFetching ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <Search size={13} />
            )}
            Search
          </button>
        </form>
      </div>

      {/* Lookup results */}
      {lookupQ.isFetching && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {lookupQ.isSuccess && !lookupQ.isFetching && (
        <SubjectCard
          matches={matches}
          selected={selectedSubject}
          onSelect={setSelectedSubject}
        />
      )}

      {/* Inventory + SLA + Fulfillment — only after subject select */}
      {selectedSubject !== null && (
        <div className="space-y-4">
          <SlaPreviewBanner regulator={regulator} />

          {inventoryQ.isLoading && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          )}

          {panels !== null && <InventoryGrid panels={panels} />}

          <FulfillModal subject={selectedSubject} regulator={regulator} />
        </div>
      )}

      {/* Request history */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Request history
          </p>
          {requestsQ.isFetching && (
            <RefreshCw size={12} className="animate-spin text-muted" />
          )}
        </div>

        {requestsQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <RequestList items={requests} />
        )}
      </div>
    </div>
  );
}
