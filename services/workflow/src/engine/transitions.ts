import type { WorkflowEvent } from "../events.js";

export type WorkflowAction = "approve" | "reject" | "escalate" | "hold";

export interface TransitionResult {
  workflowStatus: "Active" | "Approved" | "Rejected" | "Escalated" | "OnHold";
  stepStatus: "Approved" | "Rejected" | "Pending";
  nextSeq: number | null;
  event: WorkflowEvent | null;
}

export const ACTION_PERMISSION: Record<WorkflowAction, string> = {
  approve: "document:approve",
  reject: "document:reject",
  escalate: "workflow:escalate",
  hold: "workflow:hold",
};

export function nextStateForAction(
  action: WorkflowAction,
  currentStep: { seq: number },
  totalSteps: number,
): TransitionResult {
  switch (action) {
    case "approve": {
      const hasNext = currentStep.seq < totalSteps;
      return {
        workflowStatus: hasNext ? "Active" : "Approved",
        stepStatus: "Approved",
        nextSeq: hasNext ? currentStep.seq + 1 : null,
        event: "workflow.approved",
      };
    }
    case "reject":
      return {
        workflowStatus: "Rejected",
        stepStatus: "Rejected",
        nextSeq: null,
        event: "workflow.rejected",
      };
    case "escalate":
      return {
        workflowStatus: "Escalated",
        stepStatus: "Pending",
        nextSeq: currentStep.seq,
        event: "workflow.escalated",
      };
    case "hold":
      return {
        workflowStatus: "OnHold",
        stepStatus: "Pending",
        nextSeq: currentStep.seq,
        event: null,
      };
    default:
      throw new Error(`unknown_action:${action as string}`);
  }
}
