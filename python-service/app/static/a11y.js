// Toggle WCAG 2.2 AAA compliance mode. Persists in localStorage.
// Usage: window.NBE_A11Y.toggle() or a button bound to it.

const KEY = "nbe.dms.a11y_mode";

export function getMode() {
  return localStorage.getItem(KEY) || "aa";   // "aa" (default) | "aaa"
}

export function setMode(mode) {
  localStorage.setItem(KEY, mode);
  document.documentElement.setAttribute("data-a11y", mode);
  // Live-announce the change for screen-reader users
  const live = document.getElementById("a11y-live") || (() => {
    const el = document.createElement("div");
    el.id = "a11y-live";
    el.setAttribute("aria-live", "polite");
    el.setAttribute("role", "status");
    el.className = "sr-only";
    document.body.appendChild(el);
    return el;
  })();
  live.textContent = mode === "aaa"
    ? "High-contrast accessibility mode enabled."
    : "Standard accessibility mode.";
}

export function toggle() {
  setMode(getMode() === "aaa" ? "aa" : "aaa");
}

if (typeof window !== "undefined") {
  window.NBE_A11Y = { getMode, setMode, toggle };
  // Apply persisted preference on load + respect system preferences.
  document.addEventListener("DOMContentLoaded", () => {
    const prefer = getMode();
    const systemAAA = window.matchMedia?.("(prefers-contrast: more)")?.matches;
    setMode(prefer !== "aa" ? prefer : (systemAAA ? "aaa" : "aa"));
  });
}
