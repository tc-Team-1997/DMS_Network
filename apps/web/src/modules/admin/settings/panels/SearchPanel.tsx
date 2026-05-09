/**
 * SearchPanel — admin settings for the `search` namespace.
 *
 * Wraps the generic ConfigPanel for auto-generated fields, plus a manual
 * "Rebuild FTS index" button that calls POST /spa/api/admin/search/rebuild-fts.
 *
 * The rebuild is needed whenever searchable_fields changes, because SQLite
 * FTS5 triggers cannot be regenerated automatically on config change —
 * an admin must explicitly press the button to drop + recreate the virtual
 * table and its three AFTER INSERT/UPDATE/DELETE triggers.
 */

import { useState } from 'react';
import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ConfigPanel } from '../ConfigPanel';
import { rebuildFts } from '@/modules/search/api';

type RebuildState = 'idle' | 'loading' | 'ok' | 'error';

function RebuildFtsButton() {
  const [state, setState] = useState<RebuildState>('idle');
  const [message, setMessage] = useState('');

  async function handleRebuild() {
    setState('loading');
    setMessage('');
    try {
      const result = await rebuildFts();
      setState('ok');
      setMessage(`FTS index rebuilt — ${result.fields.length} column${result.fields.length === 1 ? '' : 's'}: ${result.fields.join(', ')}.`);
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Rebuild failed.');
    }
  }

  return (
    <div className="mt-8 border-t border-divider pt-6">
      <h3 className="text-sm font-semibold text-ink mb-1">FTS index management</h3>
      <p className="text-xs text-muted mb-3">
        After changing <strong>Searchable fields</strong>, press this button to drop and recreate
        the full-text search index and its sync triggers. Existing search results will be
        unavailable for the duration of the rebuild (typically under a second for ≤100k documents).
      </p>

      <button
        type="button"
        disabled={state === 'loading'}
        onClick={() => void handleRebuild()}
        className={cn(
          'inline-flex items-center gap-2 rounded-input px-4 py-2 text-sm font-medium transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1',
          state === 'loading'
            ? 'bg-divider text-muted cursor-not-allowed'
            : 'bg-brand-blue text-white hover:bg-brand-blueHover',
        )}
      >
        <RefreshCw size={14} className={state === 'loading' ? 'animate-spin' : ''} />
        {state === 'loading' ? 'Rebuilding…' : 'Rebuild FTS index'}
      </button>

      {state === 'ok' && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-success">
          <CheckCircle size={13} />
          {message}
        </p>
      )}
      {state === 'error' && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-danger">
          <AlertCircle size={13} />
          {message}
        </p>
      )}
    </div>
  );
}

export function SearchPanel() {
  return (
    <div>
      <ConfigPanel
        namespace="search"
        title="Search"
        description="Controls which fields are full-text indexed, facet dimensions, snippet length, saved-search scopes, and the Cmd-K command palette."
      />
      <RebuildFtsButton />
    </div>
  );
}
