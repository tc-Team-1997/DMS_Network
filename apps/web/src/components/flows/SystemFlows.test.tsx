import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SystemFlows } from "./SystemFlows.js";

vi.mock("../../api/client.js", () => ({ getToken: () => "t", handleUnauthorized: () => {} }));

const LANES = [
  { lane: "document", label: "Document Lifecycle", description: "capture→archive", nodes: [
    { id: "capture", label: "Capture", detail: "Scanner/upload ingest." },
    { id: "ocr", label: "OCR", detail: "Server-side OCR." },
  ] },
  { lane: "workflow", label: "Business Workflow", description: "maker-checker", nodes: [
    { id: "maker", label: "Maker", detail: "Prepares the document." },
  ] },
];

describe("SystemFlows (SC-07)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders the lanes with their nodes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lanes: LANES }) }) as any;
    render(<SystemFlows />);
    await waitFor(() => expect(screen.getByText("Document Lifecycle")).toBeInTheDocument());
    expect(screen.getByText("Business Workflow")).toBeInTheDocument();
    expect(screen.getByLabelText("document capture")).toBeInTheDocument();
  });

  it("shows a node's detail on click", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lanes: LANES }) }) as any;
    render(<SystemFlows />);
    await waitFor(() => expect(screen.getByLabelText("document ocr")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("document ocr"));
    await waitFor(() => expect(screen.getByTestId("flow-detail")).toHaveTextContent("Server-side OCR."));
  });
});
