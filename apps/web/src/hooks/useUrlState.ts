/**
 * useUrlState — URL-backed state for list filters / selection.
 *
 * Reads and writes a fixed set of string parameters from the browser's
 * query string using react-router's useSearchParams.  Changing any value
 * calls `replace` so it does not push a new history entry.
 *
 * Usage:
 *   const [filters, setFilters] = useUrlState({ status: "", branch: "" });
 *   setFilters({ status: "active" }); // ?status=active&branch= (branch kept)
 *
 * @param defaults — object whose keys define the allowed params and whose
 *                   values provide fallback defaults when the param is absent.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export function useUrlState<T extends Record<string, string>>(
  defaults: T,
): [T, (patch: Partial<T>) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  // Build current state by merging URL params on top of defaults.
  const state = Object.fromEntries(
    Object.keys(defaults).map((key) => [
      key,
      searchParams.has(key) ? (searchParams.get(key) as string) : defaults[key],
    ]),
  ) as T;

  const setState = useCallback(
    (patch: Partial<T>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === "" || value === undefined || value === null) {
              next.delete(key);
            } else {
              next.set(key, String(value));
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [state, setState];
}
