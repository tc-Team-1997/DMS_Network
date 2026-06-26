/**
 * SearchableSelect — a lightweight, accessible type-to-search combobox.
 *
 * Options can be grouped (e.g. "Roles" and "People"). Filters by label/subLabel
 * as the user types, supports keyboard navigation (↑/↓/Enter/Esc), and reports
 * the selected option's value. Used for workflow escalation / assignment so the
 * user can pick a role OR a specific person by searching, instead of typing a
 * free-text string.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  subLabel?: string;
  group?: string;
}

export interface SearchableSelectProps {
  options: SelectOption[];
  value: string | null;
  onChange: (value: string | null, option: SelectOption | null) => void;
  placeholder?: string;
  /** aria-label for the trigger. */
  ariaLabel?: string;
  disabled?: boolean;
  allowClear?: boolean;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
  ariaLabel = "Search and select",
  disabled,
  allowClear = true,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.subLabel?.toLowerCase().includes(q) ?? false) ||
        (o.group?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) { setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
    else setQuery("");
  }, [open]);

  function choose(opt: SelectOption) {
    onChange(opt.value, opt);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) choose(filtered[active]); }
    else if (e.key === "Escape") { setOpen(false); }
  }

  // Group the filtered options while preserving order.
  const groups: { group: string | undefined; items: SelectOption[] }[] = [];
  for (const o of filtered) {
    const g = groups.find((x) => x.group === o.group);
    if (g) g.items.push(o);
    else groups.push({ group: o.group, items: [o] });
  }

  let flatIndex = -1;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="field"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8, textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer", justifyContent: "space-between",
        }}
      >
        <span style={{ flex: 1, color: selected ? "var(--wh)" : "var(--sil)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : placeholder}
        </span>
        {allowClear && selected && !disabled && (
          <X
            size={14}
            style={{ color: "var(--sil)", flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); onChange(null, null); }}
          />
        )}
        <ChevronDown size={14} style={{ color: "var(--sil)", flexShrink: 0 }} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute", zIndex: 50, top: "calc(100% + 4px)", left: 0, right: 0,
            background: "var(--ink2)", border: "1px solid var(--bd)", borderRadius: 8,
            boxShadow: "0 10px 30px rgba(15,23,42,.18)", maxHeight: 280, overflow: "auto",
          }}
        >
          <div style={{ position: "sticky", top: 0, background: "var(--ink2)", padding: 8, borderBottom: "1px solid var(--bd)" }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--sil)" }} />
              <input
                ref={inputRef}
                className="field"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onKeyDown}
                placeholder="Type to search…"
                style={{ width: "100%", paddingLeft: 28, boxSizing: "border-box" }}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "12px 12px", fontSize: 12, color: "var(--sil)" }}>No matches</div>
          ) : (
            groups.map((grp) => (
              <div key={grp.group ?? "_"}>
                {grp.group && (
                  <div style={{ padding: "6px 12px 2px", fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", color: "var(--sil)" }}>
                    {grp.group}
                  </div>
                )}
                {grp.items.map((o) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  const isActive = idx === active;
                  const isSelected = o.value === value;
                  return (
                    <div
                      key={o.value}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => choose(o)}
                      style={{
                        padding: "7px 12px", cursor: "pointer", fontSize: 12.5,
                        background: isActive ? "var(--ink3)" : "transparent",
                        color: isSelected ? "var(--gold3)" : "var(--mist)",
                        display: "flex", flexDirection: "column", gap: 1,
                      }}
                    >
                      <span style={{ fontWeight: isSelected ? 700 : 500 }}>{o.label}</span>
                      {o.subLabel && <span style={{ fontSize: 10.5, color: "var(--sil)" }}>{o.subLabel}</span>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
