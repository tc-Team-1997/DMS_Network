/**
 * ResultCard — one document search result.
 *
 * Shows: doc icon · original_name · customer chip · branch chip ·
 *        uploaded date · status badge · AI confidence badge · FTS5 snippet.
 *
 * Hover actions: Open · Download · Ask DocBrain.
 *
 * The snippet field may contain `<mark>…</mark>` HTML injected by FTS5
 * snippet(). We render it via dangerouslySetInnerHTML with the string
 * confined to the pre-approved FTS5 output — no user-controlled HTML.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Eye, Download, Sparkles, Calendar } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, statusTone } from '@/components/ui';
import type { SearchResult } from '../schemas';

export interface ResultCardProps {
  result: SearchResult;
  query: string;
}

export function ResultCard({ result, query: _query }: ResultCardProps) {
  const [hovered, setHovered] = useState(false);

  const displayName = result.original_name ?? result.filename;
  const uploadedDate = result.uploaded_at
    ? new Date(result.uploaded_at).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      })
    : null;

  return (
    <article
      className={cn(
        'group relative rounded-card border bg-surface p-4 transition-shadow',
        hovered ? 'border-brand-sky/40 shadow-card' : 'border-divider',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-3">
        {/* Doc icon */}
        <div className="flex-shrink-0 w-9 h-9 rounded-input bg-brand-skyLight flex items-center justify-center">
          <FileText size={18} className="text-brand-blue" />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <Link
              to={`/viewer/${result.id}`}
              className="text-md font-semibold text-ink hover:text-brand-blue hover:underline leading-tight truncate max-w-[360px]"
              title={displayName}
            >
              {displayName}
            </Link>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Badge tone={statusTone(result.status)}>{result.status}</Badge>
              {result.ocr_confidence != null && (
                <span
                  className="inline-block rounded-badge px-[9px] py-[3px] text-[11px] font-medium bg-purple-bg text-purple"
                  title={`OCR confidence: ${Math.round(result.ocr_confidence * 100)}%`}
                >
                  {Math.round(result.ocr_confidence * 100)}%
                </span>
              )}
            </div>
          </div>

          {/* Meta chips row */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {result.customer_name && (
              <span className="inline-flex items-center rounded-badge bg-divider px-2 py-0.5 text-xs text-ink-sub">
                {result.customer_name}
              </span>
            )}
            {result.customer_cid && !result.customer_name && (
              <span className="inline-flex items-center rounded-badge bg-divider px-2 py-0.5 text-xs font-mono text-ink-sub">
                {result.customer_cid}
              </span>
            )}
            {result.branch && (
              <span className="inline-flex items-center rounded-badge bg-brand-skyLight px-2 py-0.5 text-xs text-brand-blue">
                {result.branch}
              </span>
            )}
            {result.doc_type && (
              <span className="inline-flex items-center rounded-badge bg-purple-bg px-2 py-0.5 text-xs text-purple">
                {result.doc_type}
              </span>
            )}
            {uploadedDate && (
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <Calendar size={11} />
                {uploadedDate}
              </span>
            )}
          </div>

          {/* FTS5 snippet */}
          {result.snippet && (
            <p
              className="mt-2 text-xs text-ink-sub leading-relaxed line-clamp-2 [&_mark]:bg-warning-bg [&_mark]:text-warning [&_mark]:rounded-sm [&_mark]:px-0.5"
              /* FTS5 snippet output — only <mark> tags with no attributes, safe to inject */
              dangerouslySetInnerHTML={{ __html: result.snippet }}
            />
          )}
        </div>
      </div>

      {/* Hover action row */}
      <div
        className={cn(
          'mt-3 pt-3 border-t border-divider flex items-center gap-3 transition-opacity',
          hovered ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        aria-hidden={!hovered}
      >
        <Link
          to={`/viewer/${result.id}`}
          className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline"
          tabIndex={hovered ? 0 : -1}
        >
          <Eye size={12} /> Open
        </Link>
        <a
          href={`/spa/api/documents/${result.id}/download`}
          className="inline-flex items-center gap-1 text-xs text-ink-sub hover:text-ink"
          tabIndex={hovered ? 0 : -1}
        >
          <Download size={12} /> Download
        </a>
        <Link
          to={`/ai?doc_id=${result.id}`}
          className="inline-flex items-center gap-1 text-xs text-purple hover:underline"
          tabIndex={hovered ? 0 : -1}
        >
          <Sparkles size={12} /> Ask DocBrain
        </Link>
      </div>
    </article>
  );
}
