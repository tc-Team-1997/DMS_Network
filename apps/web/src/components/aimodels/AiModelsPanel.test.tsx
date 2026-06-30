import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AiModelsPanel } from "./AiModelsPanel.js";

vi.mock("../../api/client.js", () => ({ getToken: () => "t", handleUnauthorized: () => {} }));

const FEATURES = [
  { featureKey: "classify", name: "Auto-Classification", enabled: true, threshold: 0.92, description: null, updatedBy: "system", updatedAt: "", latestMetric: { featureKey: "classify", accuracy: 0.95, throughput: 200, period: "30d", recordedAt: "" } },
  { featureKey: "fraud", name: "Fraud Detection", enabled: false, threshold: null, description: null, updatedBy: "system", updatedAt: "", latestMetric: null },
];

describe("AiModelsPanel", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("lists features with accuracy + threshold", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: FEATURES }) }) as any;
    render(<AiModelsPanel canWrite={true} />);
    await waitFor(() => expect(screen.getByText("Auto-Classification")).toBeInTheDocument());
    expect(screen.getByText("95%")).toBeInTheDocument(); // accuracy formatted
  });

  it("PATCHes enabled on toggle", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: FEATURES }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ feature: { ...FEATURES[1], enabled: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: FEATURES }) });
    globalThis.fetch = fetchMock as any;

    render(<AiModelsPanel canWrite={true} />);
    await waitFor(() => expect(screen.getByText("Fraud Detection")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("toggle fraud"));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toContain("/ai-config/features/fraud");
      expect(JSON.parse(patch![1].body).enabled).toBe(true);
    });
  });

  it("validates threshold range before PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: FEATURES }) });
    globalThis.fetch = fetchMock as any;
    render(<AiModelsPanel canWrite={true} />);
    await waitFor(() => expect(screen.getByText("Auto-Classification")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("threshold for classify"), { target: { value: "5" } });
    fireEvent.click(screen.getByLabelText("save threshold classify"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/0–1/));
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(false);
  });
});
