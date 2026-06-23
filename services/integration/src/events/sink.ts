export interface EventSink {
  emit(event: string, payload: unknown): Promise<void>;
}

// Default in-memory sink. Production swaps in the @zordms/events Redis-Streams
// client with the same `emit` shape — route code never changes.
export class InMemoryEventSink implements EventSink {
  readonly emitted: Array<{ event: string; payload: unknown }> = [];
  async emit(event: string, payload: unknown): Promise<void> {
    this.emitted.push({ event, payload });
  }
}
