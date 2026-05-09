/**
 * AskDocBrainCta — footer CTA linking to DocBrain pre-loaded with result-set IDs.
 *
 * Wave C owns the DocBrain backend integration; this component just builds the
 * link with the current result IDs as a query param and renders the prompt.
 */

import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import type { SearchResult } from '../schemas';

export interface AskDocBrainCtaProps {
  results: SearchResult[];
  total: number;
  query: string;
}

export function AskDocBrainCta({ results, total, query }: AskDocBrainCtaProps) {
  if (results.length === 0) return null;

  const ids = results.map((r) => r.id).join(',');
  const href = `/ai?doc_ids=${encodeURIComponent(ids)}&q=${encodeURIComponent(query)}`;

  return (
    <div className="mt-4 flex items-center justify-center">
      <Link
        to={href}
        className="inline-flex items-center gap-2 rounded-input border border-purple/30 bg-purple-bg px-5 py-2.5 text-sm font-medium text-purple hover:bg-purple/10 transition-colors focus:outline-none focus:ring-2 focus:ring-purple/30"
      >
        <Sparkles size={15} />
        Ask DocBrain about these {total.toLocaleString()} result{total === 1 ? '' : 's'}
      </Link>
    </div>
  );
}
