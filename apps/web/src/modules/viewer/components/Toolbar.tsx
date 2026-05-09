/**
 * Toolbar — top bar of the Viewer v2 layout.
 *
 * Contains:
 *   - Page navigation (prev / current / total / next)
 *   - Zoom selector (presets + fit-width / fit-page)
 *   - Rotate 90°
 *   - In-document text search with match counter
 *   - Fullscreen toggle
 *   - Print (gated by tenant_config viewer.print_enabled)
 *   - Download (gated by tenant_config viewer.download_enabled)
 *   - "Sign and send to checker" CTA
 */

import { useCallback, useId, useRef, type KeyboardEvent } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Search,
  Maximize2,
  Minimize2,
  Printer,
  Download,
  Send,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { ZOOM_PRESETS, type ZoomMode, type PdfDocumentState } from '../hooks/usePdfDocument';

// ── props ─────────────────────────────────────────────────────────────────────

export interface ToolbarProps {
  pdfState: PdfDocumentState;
  filename: string;
  /** Raw path served by Node for download */
  downloadHref: string;
  printEnabled: boolean;
  downloadEnabled: boolean;
  /** Called when the user hits "Sign and send" */
  onSignAndSend: () => void;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const ZOOM_OPTIONS: { value: ZoomMode; label: string }[] = [
  ...ZOOM_PRESETS.map((z) => ({ value: z as ZoomMode, label: `${z}%` })),
  { value: 'fit-width', label: 'Fit width' },
  { value: 'fit-page',  label: 'Fit page' },
];

// ── component ─────────────────────────────────────────────────────────────────

export function Toolbar({
  pdfState,
  filename: _filename,
  downloadHref,
  printEnabled,
  downloadEnabled,
  onSignAndSend,
}: ToolbarProps) {
  const {
    page,
    numPages,
    zoom,
    searchQuery,
    searchMatchIndex,
    searchMatchCount,
    isFullscreen,

    prevPage,
    nextPage,
    setPage,
    setZoom,
    rotate,
    setSearchQuery,
    setSearchMatchIndex,
    setSearchMatchCount,
    setFullscreen,
  } = pdfState;

  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  const handlePageInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value, 10);
      if (Number.isFinite(v)) setPage(v);
    },
    [setPage],
  );

  const handleSearchKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        if (searchMatchCount > 0) {
          setSearchMatchIndex((searchMatchIndex + 1) % searchMatchCount);
        }
      } else if (e.key === 'Escape') {
        setSearchQuery('');
        searchRef.current?.blur();
      }
    },
    [searchMatchCount, searchMatchIndex, setSearchMatchIndex, setSearchQuery],
  );

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchMatchCount(0);
    setSearchMatchIndex(0);
  }, [setSearchQuery, setSearchMatchCount, setSearchMatchIndex]);

  return (
    <div
      className={cn(
        'flex items-center gap-2 flex-wrap px-3 py-2',
        'border-b border-divider bg-white',
      )}
      data-testid="viewer-toolbar"
    >
      {/* Page navigation */}
      <div className="flex items-center gap-1" aria-label="Page navigation">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={prevPage}
          className="inline-flex items-center justify-center w-7 h-7 rounded-input border border-border text-ink-sub hover:bg-divider disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="toolbar-prev-page"
        >
          <ChevronLeft size={14} />
        </button>

        <div className="flex items-center gap-1 text-xs">
          <input
            type="number"
            min={1}
            max={numPages || 1}
            value={page}
            onChange={handlePageInput}
            aria-label="Current page"
            data-testid="toolbar-page-input"
            className="w-10 h-7 rounded-input border border-border text-center text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
          />
          <span className="text-muted">/ {numPages || '—'}</span>
        </div>

        <button
          type="button"
          aria-label="Next page"
          disabled={numPages > 0 && page >= numPages}
          onClick={nextPage}
          className="inline-flex items-center justify-center w-7 h-7 rounded-input border border-border text-ink-sub hover:bg-divider disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="toolbar-next-page"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="w-px h-5 bg-border" aria-hidden="true" />

      {/* Zoom selector */}
      <select
        aria-label="Zoom level"
        value={zoom}
        onChange={(e) => setZoom(e.target.value as ZoomMode)}
        data-testid="toolbar-zoom-select"
        className="h-7 rounded-input border border-border bg-white px-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
      >
        {ZOOM_OPTIONS.map((opt) => (
          <option key={String(opt.value)} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Rotate */}
      <button
        type="button"
        aria-label="Rotate 90 degrees clockwise"
        onClick={rotate}
        data-testid="toolbar-rotate"
        className="inline-flex items-center justify-center w-7 h-7 rounded-input border border-border text-ink-sub hover:bg-divider"
      >
        <RotateCw size={14} />
      </button>

      <div className="w-px h-5 bg-border" aria-hidden="true" />

      {/* Text search */}
      <div className="flex items-center gap-1">
        <label htmlFor={searchId} className="sr-only">Search in document</label>
        <div className="relative flex items-center">
          <Search size={12} className="absolute left-2 text-muted pointer-events-none" />
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchMatchIndex(0);
            }}
            onKeyDown={handleSearchKey}
            data-testid="toolbar-search-input"
            className="h-7 w-36 rounded-input border border-border bg-white pl-6 pr-6 text-xs text-ink placeholder-muted focus:outline-none focus:ring-2 focus:ring-brand-blue"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clearSearch}
              className="absolute right-1.5 text-muted hover:text-ink"
            >
              <X size={11} />
            </button>
          )}
        </div>
        {searchQuery && searchMatchCount > 0 && (
          <span className="text-2xs text-muted tabular-nums" aria-live="polite">
            {searchMatchIndex + 1}/{searchMatchCount}
          </span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Fullscreen */}
      <button
        type="button"
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        aria-pressed={isFullscreen}
        onClick={() => setFullscreen(!isFullscreen)}
        data-testid="toolbar-fullscreen"
        className="inline-flex items-center justify-center w-7 h-7 rounded-input border border-border text-ink-sub hover:bg-divider"
      >
        {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>

      {/* Print */}
      {printEnabled && (
        <button
          type="button"
          aria-label="Print document"
          onClick={() => window.print()}
          data-testid="toolbar-print"
          className="inline-flex items-center justify-center w-7 h-7 rounded-input border border-border text-ink-sub hover:bg-divider"
        >
          <Printer size={14} />
        </button>
      )}

      {/* Download */}
      {downloadEnabled && (
        <a
          href={downloadHref}
          download
          aria-label="Download document"
          data-testid="toolbar-download"
          className="inline-flex items-center justify-center w-7 h-7 rounded-input border border-border text-ink-sub hover:bg-divider"
        >
          <Download size={14} />
        </a>
      )}

      <div className="w-px h-5 bg-border" aria-hidden="true" />

      {/* Sign and send CTA */}
      <Button
        size="sm"
        onClick={onSignAndSend}
        data-testid="toolbar-sign-send"
      >
        <Send size={13} />
        Sign &amp; send to checker
      </Button>
    </div>
  );
}
