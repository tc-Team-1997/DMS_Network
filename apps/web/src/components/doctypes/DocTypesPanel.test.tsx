import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { DocTypesPanel } from "./DocTypesPanel.js";

/* ─── mock data ─── */
const MOCK_TYPES = {
  docTypes: [
    {
      code: "BT_CID_4G",
      description: "Bhutan CID Card (4G, 2025+)",
      jurisdiction: "BT",
      issuer: "DCRC",
      category: "KYC / Identity",
      system: true,
      created_at: "2026-01-01",
      updated_at: null,
      mandatoryFields: [{ name: "full_name", type: "string", mandatory: true }],
      optionalFields: [{ name: "dzongkhag", type: "string", mandatory: false }],
    },
    {
      code: "CUSTOM_INVOICE",
      description: "Vendor invoice",
      jurisdiction: "",
      issuer: "",
      category: "Finance",
      system: false,
      created_at: "2026-02-01",
      updated_at: null,
      mandatoryFields: [{ name: "amount", type: "number", mandatory: true }],
      optionalFields: [],
    },
  ],
  total: 2,
};

const MOCK_INFER = {
  doc_type_hint: "invoice",
  fields: [
    { name: "invoice_number", label: "Invoice Number", type: "string", mandatory: true, sample_value: "INV-1001" },
    { name: "invoice_date", label: "Invoice Date", type: "date", mandatory: true, sample_value: "2026-01-15" },
  ],
  degraded: false,
  note: null,
};

function makeFetch() {
  return vi.fn((url: string, options?: RequestInit) => {
    const u = String(url);
    const method = (options?.method ?? "GET").toUpperCase();
    if (u.includes("/idp/infer-fields")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => MOCK_INFER });
    }
    if (u.includes("/doc-types")) {
      if (method === "POST") {
        const body = options?.body ? JSON.parse(String(options.body)) : {};
        return Promise.resolve({ ok: true, status: 201, json: async () => ({ docType: { ...body, system: false } }) });
      }
      if (method === "PUT") {
        const body = options?.body ? JSON.parse(String(options.body)) : {};
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ docType: body }) });
      }
      if (method === "DELETE") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ deleted: true }) });
      }
      // GET list
      return Promise.resolve({ ok: true, status: 200, json: async () => MOCK_TYPES });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

function calls() {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => ({
    url: String(c[0]),
    method: ((c[1] as RequestInit)?.method ?? "GET").toUpperCase(),
    body: (c[1] as RequestInit)?.body,
  }));
}

describe("DocTypesPanel", () => {
  beforeEach(() => {
    globalThis.fetch = makeFetch() as any;
    // jsdom window.confirm
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("lists doc types with category and field counts", async () => {
    render(<DocTypesPanel canWrite />);
    await waitFor(() => {
      expect(screen.getByText("BT_CID_4G")).toBeInTheDocument();
      expect(screen.getByText("CUSTOM_INVOICE")).toBeInTheDocument();
    });
    // category tag + mandatory/optional counts
    expect(screen.getByText("KYC / Identity")).toBeInTheDocument();
    expect(screen.getAllByText(/1 mandatory/).length).toBeGreaterThan(0);
    // GET was called against /doc-types
    expect(calls().some((c) => c.url.includes("/doc-types") && c.method === "GET")).toBe(true);
  });

  it("hides Delete for system types but shows it for custom types", async () => {
    render(<DocTypesPanel canWrite />);
    await waitFor(() => screen.getByText("BT_CID_4G"));
    expect(screen.queryByLabelText("Delete BT_CID_4G")).toBeNull();
    expect(screen.getByLabelText("Delete CUSTOM_INVOICE")).toBeInTheDocument();
  });

  it("creates a new type via POST /doc-types", async () => {
    render(<DocTypesPanel canWrite />);
    await waitFor(() => screen.getByText("BT_CID_4G"));

    fireEvent.click(screen.getByLabelText("New doc type"));
    await waitFor(() => screen.getByPlaceholderText("e.g. BT_TRADE_LICENSE"));

    fireEvent.change(screen.getByPlaceholderText("e.g. BT_TRADE_LICENSE"), { target: { value: "NEW_TYPE" } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Save doc type"));
    });

    await waitFor(() => {
      const post = calls().find((c) => c.url.includes("/doc-types") && c.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse(String(post!.body));
      expect(body.code).toBe("NEW_TYPE");
    });
  });

  it("field editor: add a row, toggle mandatory, then remove it", async () => {
    render(<DocTypesPanel canWrite />);
    await waitFor(() => screen.getByText("BT_CID_4G"));

    fireEvent.click(screen.getByLabelText("New doc type"));
    await waitFor(() => screen.getByPlaceholderText("e.g. BT_TRADE_LICENSE"));

    // initially no field rows
    expect(screen.queryAllByTestId("field-row").length).toBe(0);

    // add a field
    fireEvent.click(screen.getByLabelText("Add field"));
    await waitFor(() => expect(screen.getAllByTestId("field-row").length).toBe(1));

    // set name
    const row = screen.getByTestId("field-row");
    const nameInput = within(row).getByPlaceholderText("field_name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "vendor_name" } });

    // toggle mandatory on
    const mandatory = within(row).getByLabelText(/Mandatory/) as HTMLInputElement;
    expect(mandatory.checked).toBe(false);
    fireEvent.click(mandatory);
    await waitFor(() => {
      expect((within(screen.getByTestId("field-row")).getByLabelText(/Mandatory/) as HTMLInputElement).checked).toBe(true);
    });

    // remove the field
    fireEvent.click(screen.getByLabelText("Remove field vendor_name"));
    await waitFor(() => expect(screen.queryAllByTestId("field-row").length).toBe(0));
  });

  it("auto-detect calls /idp/infer-fields and populates fields", async () => {
    render(<DocTypesPanel canWrite />);
    await waitFor(() => screen.getByText("BT_CID_4G"));

    fireEvent.click(screen.getByLabelText("New doc type"));
    await waitFor(() => screen.getByPlaceholderText("e.g. BT_TRADE_LICENSE"));

    // open auto-detect modal
    fireEvent.click(screen.getByLabelText("Auto-detect fields"));
    await waitFor(() => screen.getByLabelText("Sample document"));

    // pick a file
    const file = new File(["dummy"], "invoice.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Sample document"), { target: { files: [file] } });

    // run detect
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Run auto-detect"));
    });

    // infer endpoint was hit
    await waitFor(() => {
      expect(calls().some((c) => c.url.includes("/idp/infer-fields") && c.method === "POST")).toBe(true);
    });

    // proposed fields rendered
    await waitFor(() => {
      expect(screen.getAllByTestId("proposed-field").length).toBe(2);
      expect(screen.getByText("invoice_number")).toBeInTheDocument();
    });

    // apply selected fields
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Apply selected fields"));
    });

    // fields now populated into the editor (2 rows)
    await waitFor(() => {
      expect(screen.getAllByTestId("field-row").length).toBe(2);
    });
  });

  it("does not show write actions when canWrite is false", async () => {
    render(<DocTypesPanel canWrite={false} />);
    await waitFor(() => screen.getByText("BT_CID_4G"));
    expect(screen.queryByLabelText("New doc type")).toBeNull();
    expect(screen.queryByLabelText("Delete CUSTOM_INVOICE")).toBeNull();
  });
});
