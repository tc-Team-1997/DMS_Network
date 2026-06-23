import { describe, it, expect } from "vitest";
import { RealtimeHub } from "./hub.js";

describe("RealtimeHub", () => {
  it("broadcasts a JSON payload to all connected clients", () => {
    const hub = new RealtimeHub();
    const sent: string[] = [];
    const client = { send: (d: string) => sent.push(d), readyState: 1 };
    hub.add(client);
    hub.broadcast({ type: "alert.raised", alert: { id: 1, title: "X" } });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]).alert.title).toBe("X");
  });

  it("skips clients that are not open and supports removal", () => {
    const hub = new RealtimeHub();
    const sent: string[] = [];
    const closed = { send: (d: string) => sent.push(d), readyState: 3 };
    hub.add(closed);
    hub.broadcast({ a: 1 });
    expect(sent).toHaveLength(0);
    hub.remove(closed);
    expect(hub.size).toBe(0);
  });
});
