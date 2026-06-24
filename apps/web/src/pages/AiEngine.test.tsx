/**
 * AiEngine screen tests — mock fetch, assert key elements render and correct endpoints hit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AiEngine from "./AiEngine.js";
import { bandFor } from "../components/ai/ConfidenceBadge.js";
import * as aiApi from "../api/aiEngine.js";

/* ── Polyfill ResizeObserver (recharts uses it in jsdom) ── */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", { value: FakeResizeObserver, writable: true });

/* ── Stub AuthContext ── */
vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["ai:read", "ai:write"] },
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

/* ── Stub health endpoint ── */
beforeEach(() => {
  vi.spyOn(aiApi, "getAiHealth").mockResolvedValue({
    status: "ok",
    service: "ai-idp",
    mode: "gpu",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ════════════════════════════════════════════════
   bandFor unit tests
═════════════════════════════════════════════════= */
describe("bandFor", () => {
  it("maps ≥0.92 to green / Auto-Approve", () => {
    expect(bandFor(0.95).tone).toBe("green");
    expect(bandFor(0.95).action).toBe("AUTO_APPROVE");
    expect(bandFor(0.92).tone).toBe("green");
  });

  it("maps 0.85–0.91 to teal / Auto-Verified", () => {
    expect(bandFor(0.88).tone).toBe("teal");
    expect(bandFor(0.88).action).toBe("AUTO_VERIFIED");
    expect(bandFor(0.85).tone).toBe("teal");
  });

  it("maps 0.70–0.84 to amber / Supervisor Review", () => {
    expect(bandFor(0.75).tone).toBe("amber");
    expect(bandFor(0.75).action).toBe("SUPERVISOR_REVIEW");
    expect(bandFor(0.70).tone).toBe("amber");
  });

  it("maps 0.50–0.69 to orange / Human Review", () => {
    expect(bandFor(0.60).tone).toBe("orange");
    expect(bandFor(0.60).action).toBe("HUMAN_REVIEW");
    expect(bandFor(0.50).tone).toBe("orange");
  });

  it("maps <0.50 to red / Reject", () => {
    expect(bandFor(0.49).tone).toBe("red");
    expect(bandFor(0.49).action).toBe("REJECT");
    expect(bandFor(0.0).tone).toBe("red");
  });
});

/* ════════════════════════════════════════════════
   AiEngine screen render tests
═════════════════════════════════════════════════= */
describe("AiEngine screen", () => {
  it("renders the page header and KPI cards", async () => {
    render(<AiEngine />);
    await waitFor(() => {
      expect(screen.getByText("AI Processing Engine")).toBeInTheDocument();
    });
    expect(screen.getByText("AI Queue Size")).toBeInTheDocument();
    expect(screen.getByText("Processed Today")).toBeInTheDocument();
    expect(screen.getByText("Avg Confidence")).toBeInTheDocument();
    expect(screen.getByText("Manual Review")).toBeInTheDocument();
  });

  it("calls getAiHealth on mount", async () => {
    render(<AiEngine />);
    await waitFor(() => {
      expect(aiApi.getAiHealth).toHaveBeenCalledWith();
    });
  });

  it("shows the upload tab by default with file input and process button", async () => {
    render(<AiEngine />);
    await waitFor(() => {
      expect(screen.getByLabelText("document")).toBeInTheDocument();
    });
    // Process button initially disabled (no file)
    const processBtn = screen.getByRole("button", { name: "process document" });
    expect(processBtn).toBeDisabled();
  });

  it("enables process button after a file is selected", async () => {
    render(<AiEngine />);
    await waitFor(() => expect(screen.getByLabelText("document")).toBeInTheDocument());

    const input = screen.getByLabelText("document") as HTMLInputElement;
    const file = new File(["fake pdf content"], "test-cid.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    const processBtn = screen.getByRole("button", { name: "process document" });
    expect(processBtn).not.toBeDisabled();
  });

  it("calls processDoc with the file and shows the doc_type result", async () => {
    const mockResult = {
      handoff: {
        doc_id: "d1",
        doc_type: "BT_CID_4G",
        confidence: 0.95,
        catalog_assignment: "full",
        review_required: false,
        metadata: {
          doc_type: "BT_CID_4G",
          cid_no: "10112345678",
          full_name: "Sonam Wangchuk",
          dob: "1990-04-12",
          confidence: 0.95,
        },
      },
      decision: {
        band: ">=0.92",
        action: "AUTO_APPROVE",
        proceed_to_extract: true,
        review_required: false,
        sla_hours: null,
        catalog_assignment: "full",
      },
      review_item_id: null,
    };

    vi.spyOn(aiApi, "processDoc").mockResolvedValue(mockResult);

    render(<AiEngine />);
    await waitFor(() => expect(screen.getByLabelText("document")).toBeInTheDocument());

    const input = screen.getByLabelText("document") as HTMLInputElement;
    const file = new File(["x"], "cid.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    // Click the process button (aria-label="process document")
    fireEvent.click(screen.getByRole("button", { name: "process document" }));

    // Should call processDoc with the file
    await waitFor(() => expect(aiApi.processDoc).toHaveBeenCalled());

    // Should switch to results tab — doc type label shows in the card header
    await waitFor(() => {
      // "Bhutan CID 4G" is the display label for BT_CID_4G
      const els = screen.getAllByText(/bhutan cid 4g/i);
      expect(els.length).toBeGreaterThan(0);
    });

    // Should show auto-approve text somewhere
    const autoApproveEls = screen.getAllByText(/auto.approve/i);
    expect(autoApproveEls.length).toBeGreaterThan(0);
  });

  it("shows review-required notice for low confidence doc", async () => {
    const lowConfResult = {
      handoff: {
        doc_id: "d2",
        doc_type: "BT_PASSPORT",
        confidence: 0.60,
        catalog_assignment: "pending",
        review_required: true,
        metadata: null,
      },
      decision: {
        band: "0.50-0.69",
        action: "HUMAN_REVIEW",
        proceed_to_extract: false,
        review_required: true,
        sla_hours: 24,
        catalog_assignment: "pending",
      },
      review_item_id: 42,
    };

    vi.spyOn(aiApi, "processDoc").mockResolvedValue(lowConfResult);

    render(<AiEngine />);
    await waitFor(() => expect(screen.getByLabelText("document")).toBeInTheDocument());

    const input = screen.getByLabelText("document") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "p.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "process document" }));

    await waitFor(() => expect(aiApi.processDoc).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByTestId("review-notice")).toBeInTheDocument();
    });
  });

  it("renders status tab with engine status info", async () => {
    render(<AiEngine />);
    await waitFor(() => expect(screen.getByText("AI Processing Engine")).toBeInTheDocument());

    // Click status tab
    const statusTab = screen.getByRole("button", { name: /engine status/i });
    fireEvent.click(statusTab);

    await waitFor(() => {
      expect(screen.getByText("AI Engine Status")).toBeInTheDocument();
    });
    expect(screen.getByText("Performance SLOs (IDP §7.3)")).toBeInTheDocument();
  });
});
