import { describe, it, expect } from "vitest";
import { nextStateForAction } from "./transitions.js";

describe("nextStateForAction", () => {
  it("approve advances to the next step when one remains", () => {
    const r = nextStateForAction("approve", { seq: 1 }, 2);
    expect(r.stepStatus).toBe("Approved");
    expect(r.nextSeq).toBe(2);
    expect(r.workflowStatus).toBe("Active");
    expect(r.event).toBe("workflow.approved");
  });

  it("approve completes the workflow on the final step", () => {
    const r = nextStateForAction("approve", { seq: 2 }, 2);
    expect(r.workflowStatus).toBe("Approved");
    expect(r.nextSeq).toBeNull();
    expect(r.event).toBe("workflow.approved");
  });

  it("reject terminates the workflow", () => {
    const r = nextStateForAction("reject", { seq: 1 }, 3);
    expect(r.workflowStatus).toBe("Rejected");
    expect(r.stepStatus).toBe("Rejected");
    expect(r.event).toBe("workflow.rejected");
  });

  it("escalate marks escalated and keeps the step pending owner", () => {
    const r = nextStateForAction("escalate", { seq: 1 }, 3);
    expect(r.workflowStatus).toBe("Escalated");
    expect(r.event).toBe("workflow.escalated");
  });

  it("hold pauses the workflow", () => {
    const r = nextStateForAction("hold", { seq: 1 }, 3);
    expect(r.workflowStatus).toBe("OnHold");
    expect(r.event).toBeNull();
  });
});
