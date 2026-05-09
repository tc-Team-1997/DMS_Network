import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search as SearchIcon, FileSearch } from 'lucide-react';
import { type DocumentRow } from '@/lib/schemas';
import { Badge, Button, DataTable, Input, Panel, statusTone, type Column } from '@/components/ui';
import { fetchSearch } from './api';

const columns: Column<DocumentRow>[] = [
  { key: 'name',   header: 'Document',
    render: (d) => (
      <Link to={`/viewer/${d.id}`} className="text-brand-blue hover:underline font-medium">
        {d.original_name ?? d.filename}
      </Link>
    ) },
  { key: 'type',     header: 'Type',     width: 140, render: (d) => d.doc_type ?? '—' },
  { key: 'customer', header: 'Customer',             render: (d) => d.customer_name ?? d.customer_cid ?? '—' },
  { key: 'branch',   header: 'Branch',   width: 140, render: (d) => d.branch ?? '—' },
  { key: 'expiry',   header: 'Expiry',   width: 120, render: (d) => d.expiry_date ?? '—' },
  { key: 'status',   header: 'Status',   width: 110, render: (d) => <Badge tone={statusTone(d.status)}>{d.status}</Badge> },
];

export function SearchPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');

  const result = useQuery({
    queryKey: ['search', query],
    queryFn: () => fetchSearch(query),
    enabled: query.length > 0,
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(input.trim());
  };

  return (
    <div className="space-y-6">
      <Panel title="Enterprise search">
        <form onSubmit={onSubmit} className="flex gap-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted z-10" size={16} />
            <Input
              name="q"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search by name, CID, document number, OCR text…"
              className="pl-9"
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        <p className="mt-2 text-xs text-muted">
          Full-text search spans original name, customer name, CID, doc number, OCR text, and notes.
        </p>
      </Panel>

      {!query && (
        <Panel>
          <div className="py-12 flex flex-col items-center text-center text-muted">
            <FileSearch size={36} className="mb-3 text-brand-blue/50" />
            <p className="text-md font-medium text-ink">Start a search</p>
            <p className="text-xs mt-1 max-w-xs">
              Full-text search spans document names, customer CID, OCR text, and notes across all branches you have access to.
            </p>
          </div>
        </Panel>
      )}

      {query && (
        <Panel title={result.data ? `${result.data.length} result${result.data.length === 1 ? '' : 's'} for "${query}"` : 'Searching…'}>
          {result.data?.length === 0 && !result.isLoading ? (
            <div className="py-12 flex flex-col items-center text-center text-muted">
              <FileSearch size={32} className="mb-3 text-brand-blue/40" />
              <p className="text-md font-medium text-ink">No documents match "{query}"</p>
              <p className="text-xs mt-1">Try different keywords or check the spelling.</p>
            </div>
          ) : (
            <DataTable<DocumentRow>
              columns={columns}
              data={result.data ?? []}
              empty={result.isLoading ? 'Loading…' : 'No matches'}
            />
          )}
        </Panel>
      )}
    </div>
  );
}
