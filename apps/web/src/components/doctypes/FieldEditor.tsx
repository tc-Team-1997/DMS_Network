/**
 * FieldEditor — per-type metadata field editor.
 *
 * Renders a flat list of field rows (mandatory + optional combined). Each row
 * has a name, a type select, and a mandatory/optional toggle. Add/remove rows,
 * and the editor surfaces validation errors (duplicate names, blank names).
 *
 * The parent owns the field array; this is a controlled component.
 */
import { Trash2, Plus } from "lucide-react";
import type { FieldObject } from "../../api/docTypesApi.js";

export const FIELD_TYPES = ["string", "date", "number", "enum"] as const;

export interface FieldRow extends FieldObject {
  /** stable client key for React list rendering */
  _key: string;
}

export function makeFieldRow(partial?: Partial<FieldObject>): FieldRow {
  return {
    _key: `f_${Math.random().toString(36).slice(2)}_${Date.now()}`,
    name: partial?.name ?? "",
    type: partial?.type ?? "string",
    mandatory: partial?.mandatory ?? false,
  };
}

/** Build editor rows from a doc type's two stored lists. */
export function rowsFromDocType(
  mandatory: FieldObject[],
  optional: FieldObject[],
): FieldRow[] {
  return [
    ...mandatory.map((f) => makeFieldRow({ ...f, mandatory: true })),
    ...optional.map((f) => makeFieldRow({ ...f, mandatory: false })),
  ];
}

/** Split editor rows back into the two API lists. */
export function splitRows(rows: FieldRow[]): {
  mandatory_fields: FieldObject[];
  optional_fields: FieldObject[];
} {
  const clean = (r: FieldRow): FieldObject => ({
    name: r.name.trim(),
    type: r.type,
    mandatory: r.mandatory,
  });
  return {
    mandatory_fields: rows.filter((r) => r.mandatory).map(clean),
    optional_fields: rows.filter((r) => !r.mandatory).map(clean),
  };
}

/**
 * Validate field rows. Returns an array of error strings (empty = valid).
 * Catches blank names and duplicate names (a field in both mandatory + optional
 * lists is, by construction here, simply a duplicate name).
 */
export function validateRows(rows: FieldRow[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const name = r.name.trim().toLowerCase();
    if (!name) {
      errors.push("Every field needs a name.");
      continue;
    }
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) errors.push(`Duplicate field "${name}" — names must be unique.`);
  }
  return Array.from(new Set(errors));
}

export interface FieldEditorProps {
  rows: FieldRow[];
  onChange: (rows: FieldRow[]) => void;
  /** read-only display (e.g. while saving) */
  disabled?: boolean;
}

export function FieldEditor({ rows, onChange, disabled }: FieldEditorProps) {
  const errors = validateRows(rows);

  function update(key: string, patch: Partial<FieldRow>) {
    onChange(rows.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }
  function remove(key: string) {
    onChange(rows.filter((r) => r._key !== key));
  }
  function add() {
    onChange([...rows, makeFieldRow()]);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--sil)" }}>
          {rows.length} field{rows.length === 1 ? "" : "s"} ·{" "}
          {rows.filter((r) => r.mandatory).length} mandatory
        </span>
        <button className="btn bs xs" type="button" onClick={add} disabled={disabled} aria-label="Add field">
          <Plus size={12} /> Add field
        </button>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 16, textAlign: "center", color: "var(--sil)", fontSize: 11, border: "1px dashed var(--bd)", borderRadius: 8 }}>
          No fields yet — add one or use Auto-detect.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="field-rows">
          {rows.map((r) => (
            <div
              key={r._key}
              data-testid="field-row"
              style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 8, padding: "6px 8px" }}
            >
              <input
                className="field"
                style={{ flex: 1, minWidth: 0 }}
                placeholder="field_name"
                value={r.name}
                disabled={disabled}
                aria-label={`Field name ${r._key}`}
                onChange={(e) => update(r._key, { name: e.target.value })}
              />
              <select
                className="field"
                style={{ width: 110 }}
                value={r.type ?? "string"}
                disabled={disabled}
                aria-label={`Field type ${r._key}`}
                onChange={(e) => update(r._key, { type: e.target.value })}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={r.mandatory}
                  disabled={disabled}
                  aria-label={`Mandatory ${r.name || r._key}`}
                  onChange={(e) => update(r._key, { mandatory: e.target.checked })}
                />
                <span style={{ color: r.mandatory ? "var(--G)" : "var(--sil)" }}>
                  {r.mandatory ? "Mandatory" : "Optional"}
                </span>
              </label>
              <button
                className="ic"
                type="button"
                onClick={() => remove(r._key)}
                disabled={disabled}
                aria-label={`Remove field ${r.name || r._key}`}
                style={{ color: "var(--R)", flexShrink: 0 }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div role="alert" style={{ marginTop: 8, fontSize: 10.5, color: "var(--R)" }}>
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
