/**
 * uiStore — cross-cutting UI state (Zustand)
 *
 * Add new slices here as features need them.  Keep this file the single
 * source of truth for global UI concerns so feature agents only need to
 * import `useUiStore`.
 *
 * Usage:
 *   import { useUiStore } from "../store/uiStore.js";
 *   const { captureDrawerOpen, setCaptureDrawerOpen } = useUiStore();
 */
import { create } from "zustand";

interface UiState {
  /** Capture / Upload side-drawer visibility */
  captureDrawerOpen: boolean;
  setCaptureDrawerOpen: (open: boolean) => void;
  toggleCaptureDrawer: () => void;

  /** Global loading overlay (for heavy async ops like bulk-import) */
  globalLoading: boolean;
  setGlobalLoading: (loading: boolean) => void;

  /** Active sidebar nav item key — kept in store so sub-panels can read it */
  activeNav: string;
  setActiveNav: (key: string) => void;

  /** Toast / flash message (null = hidden) */
  toast: { message: string; variant: "success" | "error" | "info" } | null;
  showToast: (message: string, variant?: "success" | "error" | "info") => void;
  clearToast: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  captureDrawerOpen: false,
  setCaptureDrawerOpen: (open) => set({ captureDrawerOpen: open }),
  toggleCaptureDrawer: () =>
    set((s) => ({ captureDrawerOpen: !s.captureDrawerOpen })),

  globalLoading: false,
  setGlobalLoading: (loading) => set({ globalLoading: loading }),

  activeNav: "",
  setActiveNav: (key) => set({ activeNav: key }),

  toast: null,
  showToast: (message, variant = "info") => set({ toast: { message, variant } }),
  clearToast: () => set({ toast: null }),
}));
