import { describe, it, expect } from "vitest";
import { InAppAdapter } from "./inapp.js";
import { RealtimeHub } from "../realtime/hub.js";

describe("InAppAdapter", () => {
  it("broadcasts the notification and reports sent", async () => {
    const hub = new RealtimeHub();
    const sent: string[] = [];
    hub.add({ send: (d: string) => sent.push(d), readyState: 1 });
    const adapter = new InAppAdapter(undefined as any, hub);
    const res = await adapter.send({ channel: "inapp", recipient: "user:42", subject: "Hi", body: "B", meta: { alertId: 7 } });
    expect(res.status).toBe("sent");
    expect(JSON.parse(sent[0]).body).toBe("B");
  });
});
