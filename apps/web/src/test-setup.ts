import "@testing-library/jest-dom";

// Node 25+ has a built-in localStorage that lacks a full Web Storage API.
// Replace it with a simple in-memory implementation so tests can use
// localStorage.clear(), localStorage.getItem(), etc.
const store: Record<string, string> = {};
const mockStorage: Storage = {
  get length() { return Object.keys(store).length; },
  key(index: number) { return Object.keys(store)[index] ?? null; },
  getItem(key: string) { return store[key] ?? null; },
  setItem(key: string, value: string) { store[key] = value; },
  removeItem(key: string) { delete store[key]; },
  clear() { for (const k of Object.keys(store)) delete store[k]; },
};
Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true });
