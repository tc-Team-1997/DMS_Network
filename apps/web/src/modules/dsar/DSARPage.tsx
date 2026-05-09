/**
 * DSAR Console — Wave C
 *
 * Layout:
 *  1. Search bar — axis selector + value input → fires lookupSubject
 *  2. Subject card — shows matched customer, disambiguation list if multi-match
 *  3. 5-panel inventory grid — artifact counts for selected subject
 *  4. Action bar — 4 fulfillment buttons → opens FulfillModal
 *  5. Request history table — all requests for this tenant with SLA countdown
 *
 * RBAC: Doc Admin only (checked in this component; route guard is belt+suspenders).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  ChevronRight,
  Shield,
  RefreshCw,
} from 'lucide-react';
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

const AXIS_OPTIONS: { value: LookupAxis; label: string }[] = [
  { value: 'cid', label: 'CID' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'national_id', label: 'National ID' },
];

const REGULATOR_OPTIONS = [
  { value: 'GDPR', label: 'GDPR (30 days)' },
  { value: 'PDPL', label: 'PDPL (30 days)' },
  { value: 'RMA', label: 'RMA' },
];

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
      <div className="rounded-card border border-divider bg-surface px-5 py-8">
        <EmptyState
          icon={<Search size={20} />}
          title="No matching subjects"
          body="No customer records match the search. Try a different axis or value."
        />
      </div>
    );
  }

  return (
    <div className="rounded-card border border-divider bg-surface overflow-hidden">
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
                onClick={() => onSelect(m)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                  isSelected
                    ? 'bg-action-subtle'
                    : 'hover:bg-raised',
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
// DSARPage
// ---------------------------------------------------------------------------

export function DSARPage() {
  const user = useAuth((s) => s.user);

  // RBAC gate.
  if (!user || user.role !== 'Doc Admin') {
    return <AccessDenied />;
  }

  const [axis, setAxis] = useState<LookupAxis>('cid');
  const [searchValue, setSearchValue] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selectedSubject, setSelectedSubject] = useState<SubjectMatch | null>(null);
  const [fulfillOpen, setFulfillOpen] = useState(false);
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

  function handleSubjectSelect(m: SubjectMatch) {
    setSelectedSubject(m);
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
            Data Subject Access Request management — GDPR Art-15 / Art-17
          </p>
        </div>
        {/* Regulator selector */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted">Regulator:</span>
          <Combobox
            options={REGULATOR_OPTIONS}
            value={regulator}
            onChange={setRegulator}
            placeholder="GDPR"
            className="w-40"
          />
        </div>
      </div>

      {/* Subject search */}
      <div className="rounded-card border border-divider bg-surface p-4 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
          Subject lookup
        </p>
        <form onSubmit={handleSearch} className="flex gap-2">
          <Combobox
            options={AXIS_OPTIONS}
            value={axis}
            onChange={(v) => setAxis(v as LookupAxis)}
            placeholder="Axis"
            className="w-36 shrink-0"
          />
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
            className="inline-flex items-center gap-1.5 rounded-input bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blueHover focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1 disabled:opacity-40"
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
          onSelect={handleSubjectSelect}
        />
      )}

      {/* Inventory grid + action bar */}
      {selectedSubject !== null && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Artifact inventory
            </p>
            <button
              type="button"
              onClick={() => setFulfillOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-input border border-action bg-action-subtle px-3 py-1.5 text-sm font-medium text-action hover:bg-brand-skyLight focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1"
              data-testid="dsar-open-fulfill"
            >
              <Shield size={13} />
              Fulfillment action…
            </button>
          </div>

          {inventoryQ.isLoading && (
            <div className="grid grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          )}

          {panels !== null && <InventoryGrid panels={panels} />}
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

      {/* Fulfillment modal */}
      {selectedSubject !== null && (
        <FulfillModal
          open={fulfillOpen}
          onClose={() => setFulfillOpen(false)}
          subject={selectedSubject}
          regulator={regulator}
        />
      )}
    </div>
  );
}
