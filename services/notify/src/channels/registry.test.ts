import { describe, it, expect } from "vitest";
import { ChannelRegistry } from "./registry.js";
import { FakeAdapter } from "./fake.js";

describe("ChannelRegistry.dispatch", () => {
  it("routes a notification to every requested channel", async () => {
    const email = new FakeAdapter("email");
    const sms = new FakeAdapter("sms");
    const reg = new ChannelRegistry();
    reg.register(email);
    reg.register(sms);

    const results = await reg.dispatch(["email", "sms"], { recipient: "a@bob.bt", subject: "Hi", body: "Body" });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "sent")).toBe(true);
    expect(email.sent[0].recipient).toBe("a@bob.bt");
    expect(sms.sent[0].body).toBe("Body");
  });

  it("returns a failed result for an unregistered channel without throwing", async () => {
    const reg = new ChannelRegistry();
    reg.register(new FakeAdapter("email"));
    const results = await reg.dispatch(["email", "whatsapp"], { recipient: "x", body: "b" });
    const wa = results.find((r) => r.channel === "whatsapp")!;
    expect(wa.status).toBe("failed");
    expect(wa.error).toMatch(/no adapter/i);
  });

  it("propagates an adapter-level failure as a failed result", async () => {
    const reg = new ChannelRegistry();
    reg.register(new FakeAdapter("sms", { failOn: () => true }));
    const [r] = await reg.dispatch(["sms"], { recipient: "x", body: "b" });
    expect(r.status).toBe("failed");
  });
});
