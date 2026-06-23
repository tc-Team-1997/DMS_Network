import { describe, it, expect } from "vitest";
import { InMemoryEventSink } from "./sink.js";

describe("InMemoryEventSink", () => {
  it("records emitted events in order", async () => {
    const sink = new InMemoryEventSink();
    await sink.emit("cbs.customer.updated", { cid: "C1" });
    await sink.emit("kyc.result", { ok: true });
    expect(sink.emitted.map((e) => e.event)).toEqual(["cbs.customer.updated", "kyc.result"]);
    expect(sink.emitted[0].payload).toEqual({ cid: "C1" });
  });
});
