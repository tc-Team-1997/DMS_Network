import { describe, it, expect } from "vitest";
import { findOverdueSteps } from "./sla.js";

const now = new Date("2026-06-23T12:00:00Z");

describe("findOverdueSteps", () => {
  it("returns pending steps past their due date", () => {
    const overdue = findOverdueSteps(
      [
        { id: 1, workflow_id: 1, status: "Pending", due_at: "2026-06-23T11:00:00Z" }, // overdue
        { id: 2, workflow_id: 2, status: "Pending", due_at: "2026-06-23T13:00:00Z" }, // future
        { id: 3, workflow_id: 3, status: "Approved", due_at: "2026-06-23T10:00:00Z" }, // not pending
        { id: 4, workflow_id: 4, status: "Pending", due_at: null }, // no SLA
      ],
      now,
    );
    expect(overdue.map((s) => s.id)).toEqual([1]);
  });

  it("returns empty when nothing is overdue", () => {
    expect(
      findOverdueSteps(
        [{ id: 1, workflow_id: 1, status: "Pending", due_at: "2026-06-23T13:00:00Z" }],
        now,
      ),
    ).toEqual([]);
  });
});
