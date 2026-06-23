import { describe, it, expect, vi } from "vitest";
import { SmsAdapter } from "./sms.js";

describe("SmsAdapter", () => {
  it("sends via the injected twilio-like client", async () => {
    const create = vi.fn().mockResolvedValue({ sid: "SM123" });
    const adapter = new SmsAdapter({ messages: { create } }, "+97517000000");
    const res = await adapter.send({ channel: "sms", recipient: "+97517123456", body: "Expiring" });
    expect(res.status).toBe("sent");
    expect(res.providerId).toBe("SM123");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ to: "+97517123456", from: "+97517000000" }));
  });

  it("is stub-safe when no client is configured", async () => {
    const adapter = new SmsAdapter(null, "+97517000000");
    const res = await adapter.send({ channel: "sms", recipient: "+97517123456", body: "x" });
    expect(res.status).toBe("failed");
    expect(res.error).toBe("sms_not_configured");
  });
});
