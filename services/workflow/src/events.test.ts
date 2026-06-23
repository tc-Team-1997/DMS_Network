import { describe, it, expect } from "vitest";
import { createRecordingBus } from "./events.js";

describe("recording event bus", () => {
  it("records emitted events in order", async () => {
    const bus = createRecordingBus();
    await bus.emit("workflow.created", { id: 1, ref: "WF-1" });
    await bus.emit("workflow.approved", { id: 1 });
    expect(bus.events.map((e) => e.event)).toEqual(["workflow.created", "workflow.approved"]);
    expect(bus.events[0].payload).toEqual({ id: 1, ref: "WF-1" });
  });
});
