/**
 * PdfCanvas — renders one PDF page using PDF.js.
 *
 * pdfjs-dist is lazy-imported inside the component on first mount so that
 * the ~280 KB bundle is not included in the first-paint chunk.
 * The worker is configured via the URL() pattern recommended by PDF.js v4:
 *   pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()
 *
 * Props:
 *   url        — `/uploads/<filename>` — served by Node, streamed directly
 *   page       — 1-based page number to render
 *   zoom       — ZoomMode from usePdfDocument
 *   rotation   — degrees (multiples of 90)
 *   searchQuery — highlights text matches on the page
 *   highlight  — temporary yellow bbox from viewer:scroll-to-span
 *
 * Emits:
 *   onNumPages  — called once with total page count
 *   onMatchCount — called with number of text matches on the page
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/cn';
import type { ZoomMode } from '../hooks/usePdfDocument';
import type { SpanHighlight } from '../hooks/useScrollToSpan';

// ── types ─────────────────────────────────────────────────────────────────────

type PdfjsLib = typeof import('pdfjs-dist');
type PdfDocumentProxy = import('pdfjs-dist').PDFDocumentProxy;
type PdfPageProxy = import('pdfjs-dist').PDFPageProxy;

// ── module-level singletons — one loader, one doc cache ───────────────────────

let pdfjsPromise: Promise<PdfjsLib> | null = null;

function getPdfjs(): Promise<PdfjsLib> {
  if (pdfjsPromise === null) {
    pdfjsPromise = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url,
      ).toString();
      return lib;
    });
  }
  return pdfjsPromise;
}

// Simple LRU: keyed by URL, stores the resolved PDFDocumentProxy.
const docCache = new Map<string, PdfDocumentProxy>();
const MAX_CACHE = 5;

async function loadDoc(pdfjs: PdfjsLib, url: string): Promise<PdfDocumentProxy> {
  const cached = docCache.get(url);
  if (cached !== undefined) return cached;

  const loadingTask = pdfjs.getDocument({ url, withCredentials: true });
  const doc = await loadingTask.promise;

  if (docCache.size >= MAX_CACHE) {
    const oldest = docCache.keys().next();
    if (oldest.value !== undefined) {
      const oldDoc = docCache.get(oldest.value);
      void oldDoc?.destroy();
      docCache.delete(oldest.value);
    }
  }
  docCache.set(url, doc);
  return doc;
}

// ── zoom → scale ──────────────────────────────────────────────────────────────

function zoomToScale(
  zoom: ZoomMode,
  viewport: { width: number; height: number },
  container: HTMLElement | null,
): number {
  if (typeof zoom === 'number') return zoom / 100;
  if (container === null) return 1;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  if (zoom === 'fit-width') return Math.max(0.1, cw / viewport.width);
  // fit-page: fit both dimensions
  const scaleW = cw / viewport.width;
  const scaleH = ch / viewport.height;
  return Math.max(0.1, Math.min(scaleW, scaleH));
}

// ── props ─────────────────────────────────────────────────────────────────────

export interface PdfCanvasProps {
  url: string;
  page: number;
  zoom: ZoomMode;
  rotation: number;
  searchQuery: string;
  highlight: SpanHighlight | null;
  onNumPages: (n: number) => void;
  onMatchCount: (n: number) => void;
  className?: string;
}

// ── component ─────────────────────────────────────────────────────────────────

export function PdfCanvas({
  url,
  page,
  zoom,
  rotation,
  searchQuery,
  highlight,
  onNumPages,
  onMatchCount,
  className,
}: PdfCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hlCanvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Stable callbacks — won't cause re-render loops
  const onNumPagesRef = useRef(onNumPages);
  onNumPagesRef.current = onNumPages;
  const onMatchCountRef = useRef(onMatchCount);
  onMatchCountRef.current = onMatchCount;

  // Render the current page
  const renderPage = useCallback(async () => {
    if (!canvasRef.current || !containerRef.current) return;

    setStatus('loading');
    setErrorMsg('');

    let pdfjs: PdfjsLib;
    let doc: PdfDocumentProxy;
    let pg: PdfPageProxy;

    try {
      pdfjs = await getPdfjs();
      doc = await loadDoc(pdfjs, url);
      onNumPagesRef.current(doc.numPages);
      const clampedPage = Math.max(1, Math.min(doc.numPages, page));
      pg = await doc.getPage(clampedPage);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return;
    }

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const baseViewport = pg.getViewport({ scale: 1, rotation });
    const scale = zoomToScale(zoom, baseViewport, container);
    const viewport = pg.getViewport({ scale, rotation });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;

    // Also size the highlight overlay canvas
    const hlCanvas = hlCanvasRef.current;
    if (hlCanvas) {
      hlCanvas.width = canvas.width;
      hlCanvas.height = canvas.height;
      hlCanvas.style.width = `${canvas.width}px`;
      hlCanvas.style.height = `${canvas.height}px`;
    }

    try {
      const renderTask = pg.render({ canvasContext: ctx, viewport });
      await renderTask.promise;
    } catch {
      // Cancelled render (e.g. fast page-flip) — not an error
    }

    // ── text layer for search highlighting ───────────────────────────────────
    const textLayer = textLayerRef.current;
    if (textLayer) {
      textLayer.innerHTML = '';
      textLayer.style.width = `${canvas.width}px`;
      textLayer.style.height = `${canvas.height}px`;

      try {
        const textContent = await pg.getTextContent();
        const { TextLayer } = await import('pdfjs-dist');
        const tl = new TextLayer({
          textContentSource: textContent,
          container:         textLayer,
          viewport,
        });
        await tl.render();

        // Count matches
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          let count = 0;
          const spans = textLayer.querySelectorAll('span');
          spans.forEach((span) => {
            const text = span.textContent?.toLowerCase() ?? '';
            if (text.includes(q)) {
              span.classList.add('viewer-search-match');
              count++;
            }
          });
          onMatchCountRef.current(count);
        } else {
          onMatchCountRef.current(0);
        }
      } catch {
        // Text layer failures are non-fatal
      }
    }

    pg.cleanup();
    setStatus('ready');
  }, [url, page, zoom, rotation, searchQuery]);

  useEffect(() => {
    void renderPage();
  }, [renderPage]);

  // ── span highlight overlay ────────────────────────────────────────────────
  useLayoutEffect(() => {
    const hlCanvas = hlCanvasRef.current;
    if (!hlCanvas) return;
    const ctx = hlCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, hlCanvas.width, hlCanvas.height);

    if (highlight !== null && highlight.page === page - 1) {
      // highlight coords are 0-1 normalised
      const x = highlight.x * hlCanvas.width;
      const y = highlight.y * hlCanvas.height;
      const w = highlight.w * hlCanvas.width;
      const h = highlight.h * hlCanvas.height;

      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#EF9F27'; // warning token
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#EF9F27';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();

      // Scroll into view
      hlCanvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlight, page, status]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-start justify-center overflow-auto bg-page min-h-0',
        className,
      )}
      data-testid="pdf-canvas-container"
    >
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-page/80 z-20">
          <span className="text-sm text-muted animate-pulse">Rendering…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <p className="text-sm text-danger font-medium">Could not load PDF</p>
          <p className="text-xs text-muted mt-1">{errorMsg}</p>
        </div>
      )}

      {/* Main PDF canvas — max-w-full ensures no horizontal scroll on mobile */}
      <div className="relative inline-block max-w-full" style={{ lineHeight: 0 }}>
        <canvas
          ref={canvasRef}
          data-testid="pdf-canvas"
          aria-label={`PDF page ${page}`}
          className="max-w-full"
        />

        {/* Text layer — transparent spans for search/select */}
        <div
          ref={textLayerRef}
          data-testid="pdf-text-layer"
          className="absolute inset-0 overflow-hidden pointer-events-none select-text"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        />

        {/* Highlight overlay canvas */}
        <canvas
          ref={hlCanvasRef}
          data-testid="pdf-highlight-canvas"
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}
