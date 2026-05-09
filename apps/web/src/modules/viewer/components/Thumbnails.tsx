/**
 * Thumbnails — left-rail lazy thumbnail strip for PDF.js.
 *
 * Each thumbnail is a small canvas rendered via PDF.js at scale 0.15.
 * Thumbnails are only rendered when within 200 px of the viewport
 * (IntersectionObserver with rootMargin "200px").
 * Rendered canvases are cached in a WeakMap keyed by the canvas element
 * to avoid re-rendering on scroll-back.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/cn';

// ── types ─────────────────────────────────────────────────────────────────────

type PdfjsLib = typeof import('pdfjs-dist');
type PdfDocumentProxy = import('pdfjs-dist').PDFDocumentProxy;

// ── module-level singletons ───────────────────────────────────────────────────

let pdfjsPromise: Promise<PdfjsLib> | null = null;

function getPdfjs(): Promise<PdfjsLib> {
  if (pdfjsPromise === null) {
    pdfjsPromise = import('pdfjs-dist').then((lib) => {
      // Worker may already be set by PdfCanvas — safe to set again.
      lib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url,
      ).toString();
      return lib;
    });
  }
  return pdfjsPromise;
}

// Thumbnail cache: canvas element → "already rendered"
const renderedSet = new WeakSet<HTMLCanvasElement>();

// ── props ─────────────────────────────────────────────────────────────────────

export interface ThumbnailsProps {
  /** PDF source URL (same as PdfCanvas) */
  url: string;
  numPages: number;
  currentPage: number;
  onPageSelect: (page: number) => void;
  className?: string;
}

// ── component ─────────────────────────────────────────────────────────────────

export function Thumbnails({
  url,
  numPages,
  currentPage,
  onPageSelect,
  className,
}: ThumbnailsProps) {
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentProxy | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load the PDF document once
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const doc = await pdfjs.getDocument({ url, withCredentials: true }).promise;
        if (!cancelled) setPdfDoc(doc);
      } catch {
        // Non-fatal: thumbnails just stay blank
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (numPages === 0) {
    return (
      <div className={cn('w-24 flex-shrink-0 border-r border-divider bg-surface-alt overflow-y-auto', className)}>
        <div className="p-2 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="w-full h-28 rounded-input bg-divider animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'w-24 flex-shrink-0 border-r border-divider bg-surface-alt overflow-y-auto',
        className,
      )}
      data-testid="pdf-thumbnails"
    >
      <div className="p-2 space-y-2">
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
          <ThumbnailItem
            key={pageNum}
            pageNum={pageNum}
            pdfDoc={pdfDoc}
            isActive={pageNum === currentPage}
            onClick={onPageSelect}
            scrollRoot={containerRef.current}
          />
        ))}
      </div>
    </div>
  );
}

// ── ThumbnailItem ─────────────────────────────────────────────────────────────

interface ThumbnailItemProps {
  pageNum: number;
  pdfDoc: PdfDocumentProxy | null;
  isActive: boolean;
  onClick: (page: number) => void;
  scrollRoot: HTMLElement | null;
}

function ThumbnailItem({
  pageNum,
  pdfDoc,
  isActive,
  onClick,
  scrollRoot,
}: ThumbnailItemProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  // IntersectionObserver for lazy rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: scrollRoot, rootMargin: '200px' },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [scrollRoot]);

  // Render once the thumbnail becomes visible and pdfDoc is ready
  const renderThumbnail = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !pdfDoc || renderedSet.has(canvas)) return;

    try {
      const pg = await pdfDoc.getPage(pageNum);
      const viewport = pg.getViewport({ scale: 0.15 });

      canvas.width  = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const renderTask = pg.render({ canvasContext: ctx, viewport });
      await renderTask.promise;
      renderedSet.add(canvas);
      pg.cleanup();
    } catch {
      // Non-fatal
    }
  }, [pdfDoc, pageNum]);

  useEffect(() => {
    if (visible) void renderThumbnail();
  }, [visible, renderThumbnail]);

  return (
    <button
      type="button"
      aria-label={`Go to page ${pageNum}`}
      aria-current={isActive ? 'true' : undefined}
      onClick={() => onClick(pageNum)}
      data-testid={`thumbnail-${pageNum}`}
      className={cn(
        'w-full rounded-input overflow-hidden border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue',
        isActive
          ? 'border-brand-blue shadow-card'
          : 'border-transparent hover:border-borderMed',
      )}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-auto block bg-white"
        aria-hidden="true"
      />
      <p className="text-center text-2xs text-muted py-0.5 bg-surface-alt">
        {pageNum}
      </p>
    </button>
  );
}
