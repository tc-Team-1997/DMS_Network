import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { EmailTemplatesPanel } from "./EmailTemplatesPanel.js";

const MOCK_TEMPLATES = {
  templates: [
    {
      id: "t1", key: "kyc_expiry", name: "KYC Expiry", category: "Compliance",
      subject_template: "Action required: {{doc.title}}",
      html_body_template: "<p>{{doc.link}}</p>", text_body_template: null,
      enabled: true, created_by: "system", created_at: "2026-06-26", updated_at: null,
    },
  ],
};
const MOCK_TAGS = { tags: [{ tag: "{{doc.link}}", label: "Open-document link", example: ".../viewer?doc=…" }] };

function makeFetch() {
  return vi.fn((url: string, options?: RequestInit) => {
    const u = String(url);
    const method = (options?.method ?? "GET").toUpperCase();
    if (u.includes("/templates/tags")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => MOCK_TAGS });
    }
    if (u.match(/\/templates\/[^/]+\/preview$/)) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ rendered: { subject: "Action required: Passport", html: "<p>x</p>", text: "x" } }) });
    }
    if (u.match(/\/templates\/[^/]+\/test-send$/)) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, sentTo: "x@y.com" }) });
    }
    if (u.endsWith("/templates")) {
      if (method === "POST") {
        return Promise.resolve({ ok: true, status: 201, json: async () => ({ id: "new1" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => MOCK_TEMPLATES });
    }
    if (u.includes("/templates/")) {
      if (method === "PATCH") return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      if (method === "DELETE") return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

beforeEach(() => {
  globalThis.fetch = makeFetch() as unknown as typeof fetch;
  globalThis.localStorage?.setItem?.("zordms_token", "test-token");
});

describe("EmailTemplatesPanel", () => {
  it("lists templates loaded from the API", async () => {
    render(<EmailTemplatesPanel canWrite />);
    await waitFor(() => expect(screen.getByText("KYC Expiry")).toBeInTheDocument());
    expect(screen.getByText("kyc_expiry")).toBeInTheDocument();
    expect(screen.getByText("Compliance")).toBeInTheDocument();
  });

  it("shows the New Template button only when canWrite", async () => {
    const { rerender } = render(<EmailTemplatesPanel canWrite={false} />);
    await waitFor(() => expect(screen.getByText("KYC Expiry")).toBeInTheDocument());
    expect(screen.queryByText("+ New Template")).not.toBeInTheDocument();
    rerender(<EmailTemplatesPanel canWrite />);
    await waitFor(() => expect(screen.getByText("+ New Template")).toBeInTheDocument());
  });

  it("opens the editor with a merge-tag palette and inserts a tag", async () => {
    render(<EmailTemplatesPanel canWrite />);
    await waitFor(() => expect(screen.getByText("+ New Template")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText("+ New Template")); });
    expect(screen.getByText("New Email Template")).toBeInTheDocument();
    // The palette chip for the doc link is present.
    const chip = screen.getByTitle(/Open-document link/i);
    expect(chip).toBeInTheDocument();
    await act(async () => { fireEvent.click(chip); });
    // The HTML body textarea is the large monospace editor in the modal.
    const body = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(body.value).toContain("{{doc.link}}");
  });

  it("creates a template via POST /templates", async () => {
    render(<EmailTemplatesPanel canWrite />);
    await waitFor(() => expect(screen.getByText("+ New Template")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText("+ New Template")); });

    fireEvent.change(screen.getByPlaceholderText("KYC Expiry Notice"), { target: { value: "New One" } });
    fireEvent.change(screen.getByPlaceholderText("kyc_expiry"), { target: { value: "new_one" } });
    fireEvent.change(screen.getByPlaceholderText(/Action required:/), { target: { value: "Hi {{recipient.name}}" } });
    await act(async () => { fireEvent.click(screen.getByText("Save")); });

    await waitFor(() => {
      const posted = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
        (c: unknown[]) => String(c[0]).endsWith("/templates") && (c[1] as RequestInit)?.method === "POST",
      );
      expect(posted).toBe(true);
    });
  });
});
