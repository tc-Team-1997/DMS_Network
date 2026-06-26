/**
 * Micro-level unit tests for aiCopilot — askCopilot URL/body via the shared
 * http helper, default history, and error propagation.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./client.js", () => ({ getToken: () => "copilot-tok", handleUnauthorized: () => {} }));

import { askCopilot } from "./aiCopilot.js";

function mockFetch(resp: Partial<Response> & { json?: () => Promise<unknown> }) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ answer: "", citations: [], intent: "qa", model: "m" }),
    ...resp,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("askCopilot", () => {
  it("POSTs question + empty history by default to /svc/ai/idp/copilot/ask", async () => {
    const spy = mockFetch({});
    await askCopilot("What is KYC?");
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/svc/ai/idp/copilot/ask");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      question: "What is KYC?",
      history: [],
    });
    expect(((init as RequestInit).headers as Record<string, string>).Authorization)
      .toBe("Bearer copilot-tok");
  });

  it("forwards prior conversation history", async () => {
    const spy = mockFetch({});
    const history = [
      { role: "user" as const, content: "hi" },
      { role: "assistant" as const, content: "hello" },
    ];
    await askCopilot("follow up", history);
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string).history)
      .toEqual(history);
  });

  it("returns the parsed copilot response shape", async () => {
    mockFetch({
      json: async () => ({
        answer: "KYC is...",
        citations: [{ doc_id: "D1", title: "Policy", snippet: "..." }],
        intent: "qa",
        model: "anthropic/claude",
      }),
    });
    const res = await askCopilot("What is KYC?");
    expect(res.answer).toBe("KYC is...");
    expect(res.citations[0].doc_id).toBe("D1");
    expect(res.intent).toBe("qa");
  });

  it("propagates an HTTP error with status", async () => {
    mockFetch({ ok: false, status: 401, json: async () => ({ detail: "unauthorized" }) });
    await expect(askCopilot("x")).rejects.toMatchObject({ message: "HTTP 401", status: 401 });
  });
});
