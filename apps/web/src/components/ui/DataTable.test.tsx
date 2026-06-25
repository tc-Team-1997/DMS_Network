import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataTable } from "./DataTable.js";

interface Row {
  id:   number;
  name: string;
  dept: string;
}

const COLUMNS = [
  { key: "name", header: "Name",       sortable: true  },
  { key: "dept", header: "Department", sortable: false },
];

const ROWS: Row[] = [
  { id: 1, name: "Alice",   dept: "Engineering" },
  { id: 2, name: "Bob",     dept: "Design"      },
  { id: 3, name: "Charlie", dept: "Engineering" },
  { id: 4, name: "Diana",   dept: "Product"     },
  { id: 5, name: "Eve",     dept: "Engineering" },
  { id: 6, name: "Frank",   dept: "Design"      },
  { id: 7, name: "Grace",   dept: "Product"     },
];

const rowKey = (r: Row) => r.id;

// ── Basic rendering ─────────────────────────────────────────────────────────

describe("DataTable — basic rendering", () => {
  it("renders column headers", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Department")).toBeInTheDocument();
  });

  it("column headers have font-weight 700", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} />);
    const th = screen.getByText("Name").closest("th");
    expect(th).not.toBeNull();
    expect((th as HTMLElement).style.fontWeight).toBe("700");
  });

  it("renders all row data", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("shows emptyMessage when rows is empty", () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        rowKey={rowKey}
        emptyMessage="Nothing here"
      />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("calls onRowClick when a row is clicked", () => {
    const onClick = vi.fn();
    render(
      <DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} onRowClick={onClick} />,
    );
    fireEvent.click(screen.getByText("Alice").closest("tr")!);
    expect(onClick).toHaveBeenCalledWith(ROWS[0]);
  });
});

// ── Sorting ─────────────────────────────────────────────────────────────────

describe("DataTable — sorting", () => {
  it("sorts ascending when a sortable header is clicked once", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} />);
    fireEvent.click(screen.getByText("Name"));
    const cells = screen.getAllByRole("cell");
    // First name cell should be Alice (first alphabetically)
    expect(cells[0].textContent).toBe("Alice");
  });

  it("sorts descending when same header is clicked twice", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} />);
    const header = screen.getByText("Name");
    fireEvent.click(header);
    fireEvent.click(header);
    const cells = screen.getAllByRole("cell");
    // First name cell should be Grace (last alphabetically in our set)
    expect(cells[0].textContent).toBe("Grace");
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────

describe("DataTable — pagination", () => {
  it("does NOT render pager when pageSize is omitted", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} />);
    expect(screen.queryByLabelText("Next page")).toBeNull();
    expect(screen.queryByLabelText("Previous page")).toBeNull();
  });

  it("renders pager when pageSize is set and rows exceed one page", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} pageSize={3} />);
    expect(screen.getByLabelText("Next page")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
  });

  it("shows only pageSize rows on first page", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} pageSize={3} />);
    // Only 3 name cells visible
    const nameCells = screen.getAllByRole("cell").filter(
      (_, i) => i % COLUMNS.length === 0,
    );
    expect(nameCells).toHaveLength(3);
  });

  it("shows 'Page 1 of N · M items' text", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} pageSize={3} />);
    const totalPages = Math.ceil(ROWS.length / 3); // 3
    expect(
      screen.getByText(`Page 1 of ${totalPages} · ${ROWS.length} items`),
    ).toBeInTheDocument();
  });

  it("Prev button is disabled on first page", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} pageSize={3} />);
    expect(screen.getByLabelText("Previous page")).toBeDisabled();
  });

  it("Next button advances to page 2 and shows correct rows", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} pageSize={3} />);
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(screen.getByText("Page 2 of 3 · 7 items")).toBeInTheDocument();
    // Row 4 = Diana should be visible on page 2 (rows 4-6)
    expect(screen.getByText("Diana")).toBeInTheDocument();
  });

  it("Next button is disabled on the last page", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={rowKey} pageSize={3} />);
    // Navigate to last page (page 3 of 3)
    fireEvent.click(screen.getByLabelText("Next page"));
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(screen.getByLabelText("Next page")).toBeDisabled();
  });

  it("does NOT render pager when all rows fit in one page", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS.slice(0, 2)} rowKey={rowKey} pageSize={5} />);
    // 2 rows < pageSize 5, pager should not appear
    expect(screen.queryByLabelText("Next page")).toBeNull();
  });
});

// ── KpiCard ──────────────────────────────────────────────────────────────────
// Kept here intentionally-separate so a future split is easy.
