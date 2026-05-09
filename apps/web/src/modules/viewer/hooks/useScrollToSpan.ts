/**
 * useScrollToSpan — subscribes to the `viewer:scroll-to-span` event bus event.
 *
 * When fired:
 *  1. If documentId !== currentDocumentId, caller handles navigation externally.
 *  2. Calls setPage(span.page) on the PDF state.
 *  3. Calls onHighlight({ page, x, y, w, h }) so PdfCanvas can draw a
 *     temporary yellow highlight rect for 2 seconds.
 *
 * Returns the current highlight (or null) so PdfCanvas can render it.
 */

import { useEffect, useState } from 'react';
import { eventBus } from '@/lib/events';
import type { PdfDocumentState } from './usePdfDocument';

export interface SpanHighlight {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const HIGHLIGHT_DURATION_MS = 2000;

export function useScrollToSpan(
  currentDocumentId: number,
  pdfState: Pick<PdfDocumentState, 'setPage'>,
): SpanHighlight | null {
  const [highlight, setHighlight] = useState<SpanHighlight | null>(null);

  useEffect(() => {
    const unsub = eventBus.on('viewer:scroll-to-span', (payload) => {
      const incomingId = Number(payload.documentId);
      if (!Number.isNaN(incomingId) && incomingId !== currentDocumentId) {
        // Cross-document navigation is handled by the router — not our job here.
        return;
      }

      const { page, x = 0, y = 0, w = 0, h = 0 } = payload.span;
      pdfState.setPage(page);

      setHighlight({ page, x, y, w, h });
    });

    return unsub;
  }, [currentDocumentId, pdfState]);

  // Auto-clear after HIGHLIGHT_DURATION_MS
  useEffect(() => {
    if (highlight === null) return;
    const timer = window.setTimeout(() => setHighlight(null), HIGHLIGHT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  return highlight;
}
