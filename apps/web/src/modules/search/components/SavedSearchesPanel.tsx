/**
 * SavedSearchesPanel — right-rail panel listing saved searches.
 *
 * Shows three sections: My searches (private), Team searches (team),
 * Tenant searches (tenant). Each entry shows the name + last-run badge +
 * run-now button + delete button (owner only).
 *
 * Top CTA: "Save current search" → opens a CC4 Modal to name + scope.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Play, Trash2, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Button, Modal, useToast } from '@/components/ui';
import { useAuth } from '@/store/auth';
import {
  fetchSavedSearches,
  createSavedSearch,
  deleteSavedSearch,
  touchSavedSearch,
} from '../api';
import type { SavedSearch, SavedSearchScope, SearchFilters } from '../schemas';

// ---------------------------------------------------------------------------
// Save current search modal
// ---------------------------------------------------------------------------

function SaveModal({
  open,
  onClose,
  currentFilters,
}: {
  open: boolean;
  onClose: () => void;
  currentFilters: SearchFilters;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<SavedSearchScope>('private');
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === 'Doc Admin';

  const mutation = useMutation({
    mutationFn: () =>
      createSavedSearch({
        name: name.trim(),
        query: currentFilters as Record<string, unknown>,
        scope,
      }),
    onSuccess: () => {
      toast({ variant: 'success', title: 'Search saved', message: `"${name}" saved successfully.` });
      void qc.invalidateQueries({ queryKey: ['saved-searches'] });
      setName('');
      setScope('private');
      onClose();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast({ variant: 'error', title: 'Save failed', message: msg });
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Save current search" size="sm">
      <div className="space-y-4">
        <div>
          <label className="label text-sm font-medium text-ink" htmlFor="save-search-name">
            Name <span className="text-danger">*</span>
          </label>
          <input
            id="save-search-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Expiring passports — Thimphu"
            className="input mt-1 w-full"
            autoFocus
          />
        </div>

        <div>
          <label className="label text-sm font-medium text-ink" htmlFor="save-search-scope">
            Visibility
          </label>
          <select
            id="save-search-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as SavedSearchScope)}
            className="input mt-1 w-full"
          >
            <option value="private">Private — only me</option>
            <option value="team">Team — same branch</option>
            {isAdmin && <option value="tenant">Tenant — all users</option>}
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!name.trim() || mutation.isPending}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Single saved search entry
// ---------------------------------------------------------------------------

function SavedSearchEntry({
  item,
  currentUserId,
  onRun,
  onDelete,
}: {
  item: SavedSearch;
  currentUserId: number | undefined;
  onRun: (item: SavedSearch) => void;
  onDelete: (id: number) => void;
}) {
  const isOwner = item.user_id === currentUserId;
  const lastRun = item.last_run_at
    ? new Date(item.last_run_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-surface-alt group/entry transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-ink truncate">{item.name}</p>
        {lastRun && (
          <p className="text-[10px] text-muted mt-0.5">Last run {lastRun}</p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover/entry:opacity-100 transition-opacity flex-shrink-0">
        <button
          type="button"
          aria-label={`Run saved search "${item.name}"`}
          onClick={() => onRun(item)}
          className="rounded p-1 text-brand-blue hover:bg-brand-skyLight focus:outline-none focus:ring-1 focus:ring-brand-blue"
        >
          <Play size={11} />
        </button>
        {isOwner && (
          <button
            type="button"
            aria-label={`Delete saved search "${item.name}"`}
            onClick={() => onDelete(item.id)}
            className="rounded p-1 text-muted hover:text-danger hover:bg-danger-bg focus:outline-none focus:ring-1 focus:ring-danger"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section header
// ---------------------------------------------------------------------------

function SectionHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-ink transition-colors"
      onClick={onToggle}
      aria-expanded={open}
    >
      <span>{label}</span>
      <span className="flex items-center gap-1">
        {count > 0 && (
          <span className="inline-block rounded-full bg-divider px-1.5 py-0.5 text-[9px] font-bold">
            {count}
          </span>
        )}
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export interface SavedSearchesPanelProps {
  currentFilters: SearchFilters;
  onApply: (filters: Partial<SearchFilters>) => void;
}

export function SavedSearchesPanel({ currentFilters, onApply }: SavedSearchesPanelProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [myOpen, setMyOpen] = useState(true);
  const [teamOpen, setTeamOpen] = useState(true);
  const [tenantOpen, setTenantOpen] = useState(true);

  const { toast } = useToast();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);

  const { data: savedSearches = [], isLoading } = useQuery({
    queryKey: ['saved-searches'],
    queryFn: fetchSavedSearches,
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSavedSearch(id),
    onSuccess: () => {
      toast({ variant: 'success', title: 'Deleted', message: 'Saved search removed.' });
      void qc.invalidateQueries({ queryKey: ['saved-searches'] });
    },
    onError: () => {
      toast({ variant: 'error', title: 'Error', message: 'Could not delete saved search.' });
    },
  });

  function handleRun(item: SavedSearch) {
    try {
      const parsed: unknown = JSON.parse(item.query_json);
      if (typeof parsed === 'object' && parsed !== null) {
        onApply(parsed as Partial<SearchFilters>);
      }
      // Touch last_run_at fire-and-forget.
      void touchSavedSearch(item.id);
    } catch {
      toast({ variant: 'error', title: 'Invalid saved search', message: 'Could not parse saved query.' });
    }
  }

  const mine   = savedSearches.filter((s) => s.scope === 'private');
  const team   = savedSearches.filter((s) => s.scope === 'team');
  const tenant = savedSearches.filter((s) => s.scope === 'tenant');

  const isEmpty = savedSearches.length === 0 && !isLoading;

  return (
    <aside
      className="w-56 flex-shrink-0 border-l border-divider bg-surface-alt overflow-y-auto rounded-r-card"
      aria-label="Saved searches"
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-divider">
        <div className="flex items-center gap-1.5">
          <Bookmark size={13} className="text-muted" />
          <span className="text-xs font-semibold text-ink">Saved searches</span>
        </div>
        <button
          type="button"
          aria-label="Save current search"
          onClick={() => setSaveOpen(true)}
          className="rounded p-1 text-brand-blue hover:bg-brand-skyLight focus:outline-none focus:ring-1 focus:ring-brand-blue"
          title="Save current search"
        >
          <Plus size={13} />
        </button>
      </div>

      {isLoading && (
        <div className="px-3 py-4 text-xs text-ink-sub flex items-center gap-1.5" aria-live="polite" aria-busy="true">
          <span className="inline-block w-3 h-3 rounded-full bg-ink-sub/30 animate-pulse" aria-hidden="true" />
          Loading…
        </div>
      )}

      {isEmpty && (
        <div className="px-3 py-6 text-center">
          <Bookmark size={20} className="mx-auto mb-2 text-muted/40" />
          <p className="text-xs text-muted">No saved searches yet.</p>
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            className="mt-2 text-xs text-brand-blue hover:underline"
          >
            Save current search
          </button>
        </div>
      )}

      {!isLoading && !isEmpty && (
        <div className="py-1">
          {mine.length > 0 && (
            <div>
              <SectionHeader label="My searches" count={mine.length} open={myOpen} onToggle={() => setMyOpen((v) => !v)} />
              {myOpen && mine.map((item) => (
                <SavedSearchEntry
                  key={item.id}
                  item={item}
                  currentUserId={user?.id}
                  onRun={handleRun}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              ))}
            </div>
          )}

          {team.length > 0 && (
            <div>
              <SectionHeader label="Team searches" count={team.length} open={teamOpen} onToggle={() => setTeamOpen((v) => !v)} />
              {teamOpen && team.map((item) => (
                <SavedSearchEntry
                  key={item.id}
                  item={item}
                  currentUserId={user?.id}
                  onRun={handleRun}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              ))}
            </div>
          )}

          {tenant.length > 0 && (
            <div>
              <SectionHeader label="Tenant searches" count={tenant.length} open={tenantOpen} onToggle={() => setTenantOpen((v) => !v)} />
              {tenantOpen && tenant.map((item) => (
                <SavedSearchEntry
                  key={item.id}
                  item={item}
                  currentUserId={user?.id}
                  onRun={handleRun}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <SaveModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        currentFilters={currentFilters}
      />
    </aside>
  );
}
