/**
 * Micro-level unit tests for uiStore — state transitions on the Zustand store.
 * Exercises the store directly via getState()/setState (no React render).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "./uiStore.js";

// Snapshot of the initial state so each test starts clean.
const INITIAL = useUiStore.getState();

describe("uiStore", () => {
  beforeEach(() => {
    useUiStore.setState(INITIAL, true);
  });

  it("starts with sensible defaults", () => {
    const s = useUiStore.getState();
    expect(s.captureDrawerOpen).toBe(false);
    expect(s.globalLoading).toBe(false);
    expect(s.activeNav).toBe("");
    expect(s.toast).toBeNull();
  });

  it("setCaptureDrawerOpen sets the flag", () => {
    useUiStore.getState().setCaptureDrawerOpen(true);
    expect(useUiStore.getState().captureDrawerOpen).toBe(true);
    useUiStore.getState().setCaptureDrawerOpen(false);
    expect(useUiStore.getState().captureDrawerOpen).toBe(false);
  });

  it("toggleCaptureDrawer flips the flag from its current value", () => {
    expect(useUiStore.getState().captureDrawerOpen).toBe(false);
    useUiStore.getState().toggleCaptureDrawer();
    expect(useUiStore.getState().captureDrawerOpen).toBe(true);
    useUiStore.getState().toggleCaptureDrawer();
    expect(useUiStore.getState().captureDrawerOpen).toBe(false);
  });

  it("setGlobalLoading toggles the loading overlay flag", () => {
    useUiStore.getState().setGlobalLoading(true);
    expect(useUiStore.getState().globalLoading).toBe(true);
  });

  it("setActiveNav records the active nav key", () => {
    useUiStore.getState().setActiveNav("capture");
    expect(useUiStore.getState().activeNav).toBe("capture");
  });

  it("showToast defaults variant to info", () => {
    useUiStore.getState().showToast("Saved");
    expect(useUiStore.getState().toast).toEqual({ message: "Saved", variant: "info" });
  });

  it("showToast honors an explicit variant", () => {
    useUiStore.getState().showToast("Boom", "error");
    expect(useUiStore.getState().toast).toEqual({ message: "Boom", variant: "error" });
  });

  it("clearToast resets the toast to null", () => {
    useUiStore.getState().showToast("hi", "success");
    expect(useUiStore.getState().toast).not.toBeNull();
    useUiStore.getState().clearToast();
    expect(useUiStore.getState().toast).toBeNull();
  });

  it("showToast replaces a previous toast rather than queuing", () => {
    useUiStore.getState().showToast("first", "info");
    useUiStore.getState().showToast("second", "error");
    expect(useUiStore.getState().toast).toEqual({ message: "second", variant: "error" });
  });
});
