import { describe, it, expect } from "vitest";
import { findOverdueSteps } from "./sla.js";

const now = new Date("2026-06-23T12:00:00Z");

describe("findOverdueSteps", () => {
  it("returns pending steps past their due date", () => {
    const overdue = findOverdueSteps(
      [
        { id: "019100000000000000000000000001", workflow_id: "019100000000000000000000000011", status: "Pending", due_at: "2026-06-23T11:00:00Z" }, // overdue
        { id: "019100000000000000000000000002", workflow_id: "019100000000000000000000000012", status: "Pending", due_at: "2026-06-23T13:00:00Z" }, // future
        { id: "019100000000000000000000000003", workflow_id: "019100000000000000000000000013", status: "Approved", due_at: "2026-06-23T10:00:00Z" }, // not pending
        { id: "019100000000000000000000000004", workflow_id: "019100000000000000000000000014", status: "Pending", due_at: null }, // no SLA
      ],
      now,
    );
    expect(overdue.map((s) => s.id)).toEqual(["019100000000000000000000000001"]);
  });

  it("returns empty when nothing is overdue", () => {
    expect(
      findOverdueSteps(
        [{ id: "019100000000000000000000000001", workflow_id: "019100000000000000000000000011", status: "Pending", due_at: "2026-06-23T13:00:00Z" }],
        now,
      ),
    ).toEqual([]);
  });
});
