import { describe, it, expect, vi } from "vitest";
import { WhatsAppAdapter } from "./whatsapp.js";

describe("WhatsAppAdapter", () => {
  it("prefixes whatsapp: on to/from and sends", async () => {
    const create = vi.fn().mockResolvedValue({ sid: "WA9" });
    const adapter = new WhatsAppAdapter({ messages: { create } }, "+97517000000");
    const res = await adapter.send({ channel: "whatsapp", recipient: "+97517123456", body: "hi" });
    expect(res.status).toBe("sent");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ to: "whatsapp:+97517123456", from: "whatsapp:+97517000000" }));
  });
});
