/**
 * PdfPane — center pane of the Indexing Station.
 *
 * Renders the PDF using the reusable PdfCanvas from the viewer module.
 * BboxOverlay sits on top of the canvas to draw per-field confidence boxes.
 *
 * Clicking a bbox → fires onBboxClick(fieldKey) so FieldPane can auto-focus
 * the corresponding input.
 *
 * PdfCanvas is imported directly from its module path (not a barrel re-export)
 * per the single-import rule for components used in fewer than 3 modules.
 */

import { useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { PdfCanvas } from '@/modules/viewer/components/PdfCanvas';
import { usePdfDocument } from '@/modules/viewer/hooks/usePdfDocument';
import { BboxOverlay } from './BboxOverlay';
import type { AnalysisResponse } from '../schemas';

export interface PdfPaneProps {
  filename: string;
  analysis: AnalysisResponse | null;
  activeFieldKey: string | null;
  onBboxClick: (fieldKey: string) => void;
}

export function PdfPane({ filename, analysis, activeFieldKey, onBboxClick }: PdfPaneProps) {
  const pdf = usePdfDocument();
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Track canvas dimensions for the overlay sizing.
  const onCanvasReady = useCallback(() => {
    const canvas = containerRef.current?.querySelector<HTMLCanvasElement>('[data-testid="pdf-canvas"]');
    if (canvas) {
      setCanvasSize({ width: canvas.width, height: canvas.height });
    }
  }, []);

  const pdfUrl = `/uploads/${filename}`;

  return (
    <div className="flex flex-col h-full bg-page">
      {/* Mini toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-divider bg-raised">
        <Button
          size="sm"
          variant="ghost"
          onClick={pdf.prevPage}
          disabled={pdf.page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </Button>
        <span className="text-xs text-muted tabular-nums">
          {pdf.numPages > 0 ? `${pdf.page} / ${pdf.numPages}` : '—'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={pdf.nextPage}
          disabled={pdf.numPages > 0 && pdf.page >= pdf.numPages}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </Button>
      </div>

      {/* PDF + bbox overlay */}
      <div ref={containerRef} className="relative flex-1 overflow-auto" data-testid="pdf-pane-scroll">
        <PdfCanvas
          url={pdfUrl}
          page={pdf.page}
          zoom={pdf.zoom}
          rotation={pdf.rotation}
          searchQuery=""
          highlight={null}
          onNumPages={pdf.setNumPages}
          onMatchCount={() => undefined}
          className="min-h-full"
        />

        {/* Bbox overlay — absolute over the canvas */}
        {canvasSize.width > 0 && (
          <BboxOverlay
            canvasWidth={canvasSize.width}
            canvasHeight={canvasSize.height}
            analysis={analysis}
            currentPage={pdf.page}
            activeFieldKey={activeFieldKey}
            onBboxClick={onBboxClick}
          />
        )}
      </div>

      {/* Hidden sentinel used by onCanvasReady */}
      <span ref={useCallback((el: HTMLSpanElement | null) => { if (el) onCanvasReady(); }, [onCanvasReady])} style={{ display: 'none' }} />
    </div>
  );
}
