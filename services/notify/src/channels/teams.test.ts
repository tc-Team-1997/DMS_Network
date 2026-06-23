import { describe, it, expect, vi } from "vitest";
import { TeamsAdapter } from "./teams.js";

describe("TeamsAdapter", () => {
  it("posts a card to the incoming webhook", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const adapter = new TeamsAdapter("https://outlook.office.com/webhook/abc", fetchFn as any);
    const res = await adapter.send({ channel: "teams", recipient: "compliance-channel", subject: "SLA breach", body: "Workflow escalated" });
    expect(res.status).toBe("sent");
    expect(fetchFn).toHaveBeenCalledWith("https://outlook.office.com/webhook/abc", expect.objectContaining({ method: "POST" }));
  });

  it("fails cleanly when no webhook url is set", async () => {
    const adapter = new TeamsAdapter(null);
    const res = await adapter.send({ channel: "teams", recipient: "c", body: "x" });
    expect(res.status).toBe("failed");
    expect(res.error).toBe("teams_not_configured");
  });
});
