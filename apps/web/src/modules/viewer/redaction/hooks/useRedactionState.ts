import { useCallback, useState } from 'react';
import type { CanvasRegion, Reason } from '../schemas';

let _seq = 0;
function uid(): string {
  _seq += 1;
  return `region-${_seq}`;
}

export interface RedactionState {
  /** All placed regions */
  regions: CanvasRegion[];
  /** Toggle redact mode */
  redactModeActive: boolean;
  /** Enter / exit redact mode */
  setRedactMode: (on: boolean) => void;
  /** Add a new region.  Duplicates (same bounding box) are silently ignored. */
  addRegion: (r: Omit<CanvasRegion, 'id'>) => void;
  /** Remove a region by its client id */
  removeRegion: (id: string) => void;
  /** Update the reason for a specific region */
  setRegionReason: (id: string, reason: Reason) => void;
  /** Remove all regions */
  clearAll: () => void;
  /** Undo the most recently added region */
  undo: () => void;
}

const MIN_SIZE = 0.005; // 0.5% of container — noise filter

export function useRedactionState(): RedactionState {
  const [redactModeActive, setRedactModeActive] = useState(false);
  const [regions, setRegions] = useState<CanvasRegion[]>([]);

  const setRedactMode = useCallback((on: boolean) => {
    setRedactModeActive(on);
    if (!on) setRegions([]);
  }, []);

  const addRegion = useCallback((r: Omit<CanvasRegion, 'id'>) => {
    if (r.w < MIN_SIZE || r.h < MIN_SIZE) return;
    setRegions((prev) => [...prev, { ...r, id: uid() }]);
  }, []);

  const removeRegion = useCallback((id: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const setRegionReason = useCallback((id: string, reason: Reason) => {
    setRegions((prev) =>
      prev.map((r) => (r.id === id ? { ...r, reason } : r)),
    );
  }, []);

  const clearAll = useCallback(() => setRegions([]), []);

  const undo = useCallback(() => {
    setRegions((prev) => prev.slice(0, -1));
  }, []);

  return {
    regions,
    redactModeActive,
    setRedactMode,
    addRegion,
    removeRegion,
    setRegionReason,
    clearAll,
    undo,
  };
}
