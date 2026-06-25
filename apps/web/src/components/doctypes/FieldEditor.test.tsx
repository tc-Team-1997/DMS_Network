/**
 * Micro-level unit tests for FieldEditor — pure helpers + component behavior.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  FieldEditor,
  FieldRow,
  makeFieldRow,
  rowsFromDocType,
  splitRows,
  validateRows,
} from "./FieldEditor.js";

// ── pure helpers ────────────────────────────────────────────────────────────

describe("FieldEditor helpers", () => {
  it("makeFieldRow defaults name='', type='string', mandatory=false with unique key", () => {
    const a = makeFieldRow();
    const b = makeFieldRow();
    expect(a.name).toBe("");
    expect(a.type).toBe("string");
    expect(a.mandatory).toBe(false);
    expect(a._key).not.toBe(b._key);
  });

  it("makeFieldRow honors partial overrides", () => {
    const r = makeFieldRow({ name: "amount", type: "number", mandatory: true });
    expect(r.name).toBe("amount");
    expect(r.type).toBe("number");
    expect(r.mandatory).toBe(true);
  });

  it("rowsFromDocType forces mandatory flags from the source list", () => {
    const rows = rowsFromDocType(
      [{ name: "cid", type: "string", mandatory: false }], // mandatory list -> coerced true
      [{ name: "notes", type: "string", mandatory: true }], // optional list -> coerced false
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.name === "cid")?.mandatory).toBe(true);
    expect(rows.find((r) => r.name === "notes")?.mandatory).toBe(false);
  });

  it("splitRows partitions rows and trims names", () => {
    const rows: FieldRow[] = [
      makeFieldRow({ name: "  cid  ", mandatory: true }),
      makeFieldRow({ name: "notes", mandatory: false }),
    ];
    const { mandatory_fields, optional_fields } = splitRows(rows);
    expect(mandatory_fields).toEqual([{ name: "cid", type: "string", mandatory: true }]);
    expect(optional_fields).toEqual([{ name: "notes", type: "string", mandatory: false }]);
  });

  it("validateRows returns [] when all names present and unique", () => {
    expect(validateRows([
      makeFieldRow({ name: "a" }),
      makeFieldRow({ name: "b" }),
    ])).toEqual([]);
  });

  it("validateRows flags blank names", () => {
    const errs = validateRows([makeFieldRow({ name: "   " })]);
    expect(errs).toContain("Every field needs a name.");
  });

  it("validateRows flags duplicate names case-insensitively", () => {
    const errs = validateRows([
      makeFieldRow({ name: "CID" }),
      makeFieldRow({ name: "cid" }),
    ]);
    expect(errs.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  it("validateRows dedupes identical error messages", () => {
    const errs = validateRows([makeFieldRow({ name: "" }), makeFieldRow({ name: "" })]);
    expect(errs.filter((e) => e === "Every field needs a name.")).toHaveLength(1);
  });
});

// ── component behaviour ─────────────────────────────────────────────────────

function setup(rows: FieldRow[]) {
  const onChange = vi.fn();
  const utils = render(<FieldEditor rows={rows} onChange={onChange} />);
  return { onChange, ...utils };
}

describe("FieldEditor component", () => {
  it("shows the empty-state hint when there are no rows", () => {
    setup([]);
    expect(screen.getByText(/No fields yet/i)).toBeInTheDocument();
  });

  it("Add field appends a new blank row via onChange", () => {
    const existing = [makeFieldRow({ name: "a" })];
    const { onChange } = setup(existing);
    fireEvent.click(screen.getByLabelText("Add field"));
    const next = onChange.mock.calls[0][0] as FieldRow[];
    expect(next).toHaveLength(2);
    expect(next[1].name).toBe("");
  });

  it("Remove drops the targeted row", () => {
    const rows = [makeFieldRow({ name: "keep" }), makeFieldRow({ name: "drop" })];
    const { onChange } = setup(rows);
    fireEvent.click(screen.getByLabelText("Remove field drop"));
    const next = onChange.mock.calls[0][0] as FieldRow[];
    expect(next.map((r) => r.name)).toEqual(["keep"]);
  });

  it("editing the name input emits a patched row", () => {
    const rows = [makeFieldRow({ name: "" })];
    const { onChange } = setup(rows);
    fireEvent.change(screen.getByLabelText(`Field name ${rows[0]._key}`), {
      target: { value: "invoice_no" },
    });
    const next = onChange.mock.calls[0][0] as FieldRow[];
    expect(next[0].name).toBe("invoice_no");
  });

  it("toggling the mandatory checkbox flips mandatory", () => {
    const rows = [makeFieldRow({ name: "cid", mandatory: false })];
    const { onChange } = setup(rows);
    fireEvent.click(screen.getByLabelText("Mandatory cid"));
    const next = onChange.mock.calls[0][0] as FieldRow[];
    expect(next[0].mandatory).toBe(true);
  });

  it("changing the type select emits the new type", () => {
    const rows = [makeFieldRow({ name: "amount", type: "string" })];
    const { onChange } = setup(rows);
    fireEvent.change(screen.getByLabelText(`Field type ${rows[0]._key}`), {
      target: { value: "number" },
    });
    const next = onChange.mock.calls[0][0] as FieldRow[];
    expect(next[0].type).toBe("number");
  });

  it("renders a validation alert when names duplicate", () => {
    setup([makeFieldRow({ name: "x" }), makeFieldRow({ name: "x" })]);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Duplicate/);
  });

  it("shows the mandatory count in the header summary", () => {
    setup([
      makeFieldRow({ name: "a", mandatory: true }),
      makeFieldRow({ name: "b", mandatory: false }),
    ]);
    expect(screen.getByText(/1 mandatory/)).toBeInTheDocument();
  });
});
