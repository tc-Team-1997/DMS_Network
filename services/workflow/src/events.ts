export type WorkflowEvent =
  | "workflow.created"
  | "workflow.approved"
  | "workflow.rejected"
  | "workflow.escalated"
  | "case.created";

export interface EventBus {
  emit(event: WorkflowEvent, payload: Record<string, unknown>): Promise<void>;
}

export function createEventBus(): EventBus {
  return {
    async emit(event, payload) {
      console.log(JSON.stringify({ type: "event", event, payload }));
    },
  };
}

export interface RecordingBus extends EventBus {
  events: Array<{ event: WorkflowEvent; payload: Record<string, unknown> }>;
}

export function createRecordingBus(): RecordingBus {
  const events: RecordingBus["events"] = [];
  return {
    events,
    async emit(event, payload) {
      events.push({ event, payload });
    },
  };
}
