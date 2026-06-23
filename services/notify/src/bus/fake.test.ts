import { describe, it, expect } from "vitest";
import { InMemoryBus } from "./fake.js";

describe("InMemoryBus", () => {
  it("delivers a published event to subscribers of that type", async () => {
    const bus = new InMemoryBus();
    const received: string[] = [];
    bus.subscribe("document.expiring", (e) => { received.push((e.payload as any).docId); });
    await bus.publish({ type: "document.expiring", payload: { docId: "D-1" } });
    expect(received).toEqual(["D-1"]);
  });

  it("does not deliver to subscribers of other types", async () => {
    const bus = new InMemoryBus();
    let hits = 0;
    bus.subscribe("workflow.escalated", () => { hits++; });
    await bus.publish({ type: "document.expiring", payload: {} });
    expect(hits).toBe(0);
  });

  it("awaits async handlers", async () => {
    const bus = new InMemoryBus();
    let done = false;
    bus.subscribe("x", async () => { await Promise.resolve(); done = true; });
    await bus.publish({ type: "x", payload: {} });
    expect(done).toBe(true);
  });
});
