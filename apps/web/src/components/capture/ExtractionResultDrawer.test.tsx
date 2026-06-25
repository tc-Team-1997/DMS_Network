/**
 * Micro-level unit tests for ExtractionResultDrawer — field normalization
 * (FieldObject vs plain-string schema entries), mandatory checklist, the
 * extracted-fields fallback, and the save/patch flow.
 *
 * captureApi is mocked so getDocTypes / patchDocument never hit the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const getDocTypes = vi.fn();
const patchDocument = vi.fn();

vi.mock("../../api/captureApi.js", () => ({
  getDocTypes: (...a: unknown[]) => getDocTypes(...a),
  patchDocument: (...a: unknown[]) => patchDocument(...a),
}));

import { ExtractionResultDrawer } from "./ExtractionResultDrawer.js";
import type { ExtractionResult } from "../../api/captureApi.js";

function baseResult(over: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    classification: { doc_type: "BT_CID", confidence: 0.9, review_flag: false },
    mappedFields: { data: {}, errors: [], partial: false },
    catalog: { category: "National ID", route: "AUTO", retentionYears: 7 },
    folder: null,
    source: "ai",
    quality: { score: 88, completeness: 1, mandatoryMissing: [], confidence: 0.9 },
    ...over,
  } as unknown as ExtractionResult;
}

function makeDocType(over: Record<string, unknown> = {}) {
  return {
    code: "BT_CID",
    description: "Citizen ID",
    jurisdiction: "BT",
    issuer: "DoR",
    category: "National ID",
    system: true,
    created_at: "2026-01-01",
    mandatoryFields: [],
    optionalFields: [],
    ...over,
  };
}

beforeEach(() => {
  getDocTypes.mockReset().mockResolvedValue({ docTypes: [], total: 0 });
  patchDocument.mockReset().mockResolvedValue({
    quality: { score: 95, completeness: 1, mandatoryMissing: [], confidence: 0.95 },
  });
});
afterEach(() => cleanup());

function renderDrawer(result: ExtractionResult, onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <ExtractionResultDrawer docId="doc-1" result={result} onClose={onClose} />
    </MemoryRouter>,
  );
}

describe("ExtractionResultDrawer field normalization", () => {
  it("normalizes FieldObject schema entries to field names", async () => {
    getDocTypes.mockResolvedValue({
      docTypes: [makeDocType({
        mandatoryFields: [{ name: "full_name", type: "string", mandatory: true }],
        optionalFields: [{ name: "dob", type: "date", mandatory: false }],
      })],
      total: 1,
    });
    renderDrawer(baseResult());
    // Mandatory field rendered with " *" suffix + humanized name.
    expect(await screen.findByLabelText("Field full_name")).toBeInTheDocument();
    expect(screen.getByLabelText("Field dob")).toBeInTheDocument();
    expect(screen.getByText("full name *")).toBeInTheDocument();
  });

  it("normalizes plain-string (legacy) schema entries to field names", async () => {
    getDocTypes.mockResolvedValue({
      docTypes: [makeDocType({
        mandatoryFields: ["passport_no"],
        optionalFields: ["issue_date"],
      })],
      total: 1,
    });
    renderDrawer(baseResult());
    expect(await screen.findByLabelText("Field passport_no")).toBeInTheDocument();
    expect(screen.getByLabelText("Field issue_date")).toBeInTheDocument();
  });

  it("drops malformed schema entries (no name) after normalization", async () => {
    getDocTypes.mockResolvedValue({
      docTypes: [makeDocType({
        mandatoryFields: [{ type: "string", mandatory: true }, { name: "ok" }],
        optionalFields: [],
      })],
      total: 1,
    });
    renderDrawer(baseResult());
    expect(await screen.findByLabelText("Field ok")).toBeInTheDocument();
    // Only one schema field row rendered (the nameless one filtered out).
    expect(screen.queryByLabelText("Field ")).toBeNull();
  });

  it("falls back to raw extracted keys when the doc-type schema is unknown", async () => {
    getDocTypes.mockResolvedValue({ docTypes: [], total: 0 });
    const result = baseResult({
      mappedFields: { cid: null, doc_no: null, mappedKeys: [], data: { invoice_number: "INV-1", amount: 99 }, errors: [], partial: false },
    });
    renderDrawer(result);
    // No matching doc-type => render each extracted key, pre-filled.
    const inv = (await screen.findByLabelText("Field invoice_number")) as HTMLInputElement;
    expect(inv.value).toBe("INV-1");
    const amt = screen.getByLabelText("Field amount") as HTMLInputElement;
    expect(amt.value).toBe("99"); // numeric coerced to string
  });

  it("renders the mandatory checklist with missing markers from quality", async () => {
    getDocTypes.mockResolvedValue({
      docTypes: [makeDocType({ mandatoryFields: [{ name: "full_name", mandatory: true }] })],
      total: 1,
    });
    renderDrawer(baseResult({
      quality: { score: 40, completeness: 0.5, mandatoryMissing: ["full_name"], confidence: 0.5 },
    }));
    await screen.findByLabelText("mandatory fields checklist");
    expect(screen.getByLabelText("missing")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });
});

describe("ExtractionResultDrawer save flow", () => {
  it("PATCHes corrections (empty string -> null) and shows recomputed quality", async () => {
    getDocTypes.mockResolvedValue({
      docTypes: [makeDocType({ mandatoryFields: [{ name: "full_name", mandatory: true }] })],
      total: 1,
    });
    const result = baseResult({
      mappedFields: { cid: null, doc_no: null, mappedKeys: [], data: { full_name: "" }, errors: [], partial: false },
    });
    renderDrawer(result);
    await screen.findByLabelText("Field full_name");

    fireEvent.click(screen.getByLabelText("Save corrections"));

    await waitFor(() => expect(patchDocument).toHaveBeenCalledOnce());
    const [docId, payload] = patchDocument.mock.calls[0];
    expect(docId).toBe("doc-1");
    expect(payload.doc_type).toBe("BT_CID");
    expect(payload.metadata.full_name).toBeNull(); // "" coerced to null
    // recomputed quality score surfaces.
    expect(await screen.findByText("95")).toBeInTheDocument();
  });

  it("surfaces a save error alert when patchDocument rejects", async () => {
    getDocTypes.mockResolvedValue({ docTypes: [], total: 0 });
    patchDocument.mockRejectedValue(new Error("network down"));
    renderDrawer(baseResult({
      mappedFields: { cid: null, doc_no: null, mappedKeys: [], data: { a: "1" }, errors: [], partial: false },
    }));
    await screen.findByLabelText("Field a");
    fireEvent.click(screen.getByLabelText("Save corrections"));
    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
  });

  it("renders suggestedNewType sample fields normalized via toFieldName", async () => {
    getDocTypes.mockResolvedValue({ docTypes: [], total: 0 });
    renderDrawer(baseResult({
      suggestedNewType: {
        proposedName: "BT_NEW",
        reason: "novel layout",
        sampleFields: ["plain_field", { name: "object_field" } as unknown as string],
      },
    }));
    expect(await screen.findByText("plain_field")).toBeInTheDocument();
    expect(screen.getByText("object_field")).toBeInTheDocument();
  });
});
