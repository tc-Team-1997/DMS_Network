/**
 * usePdfDocument — manages all in-viewer navigation state.
 *
 * Tracks:
 *   - current page (1-based)
 *   - total page count (set by PdfCanvas once the doc loads)
 *   - zoom level (percentage, e.g. 100 = 100%)
 *   - rotation (degrees, multiples of 90)
 *   - search query + active match index
 *   - fullscreen flag
 */

import { useCallback, useState } from 'react';

export const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200] as const;
export type ZoomPreset = (typeof ZOOM_PRESETS)[number];
export type ZoomMode = ZoomPreset | 'fit-width' | 'fit-page';

export interface PdfDocumentState {
  page: number;
  numPages: number;
  zoom: ZoomMode;
  rotation: number;
  searchQuery: string;
  searchMatchIndex: number;
  searchMatchCount: number;
  isFullscreen: boolean;

  setPage: (p: number) => void;
  setNumPages: (n: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setZoom: (z: ZoomMode) => void;
  rotate: () => void;
  setSearchQuery: (q: string) => void;
  setSearchMatchIndex: (i: number) => void;
  setSearchMatchCount: (n: number) => void;
  setFullscreen: (v: boolean) => void;
}

export function usePdfDocument(): PdfDocumentState {
  const [page, setPageRaw] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState<ZoomMode>(100);
  const [rotation, setRotation] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [isFullscreen, setFullscreen] = useState(false);

  const setPage = useCallback(
    (p: number) => {
      setPageRaw((prev) => {
        if (numPages === 0) return 1;
        const clamped = Math.max(1, Math.min(numPages, p));
        return clamped === prev ? prev : clamped;
      });
    },
    [numPages],
  );

  const nextPage = useCallback(() => setPage(page + 1), [page, setPage]);
  const prevPage = useCallback(() => setPage(page - 1), [page, setPage]);

  const rotate = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
  }, []);

  return {
    page,
    numPages,
    zoom,
    rotation,
    searchQuery,
    searchMatchIndex,
    searchMatchCount,
    isFullscreen,

    setPage,
    setNumPages,
    nextPage,
    prevPage,
    setZoom,
    rotate,
    setSearchQuery,
    setSearchMatchIndex,
    setSearchMatchCount,
    setFullscreen,
  };
}
