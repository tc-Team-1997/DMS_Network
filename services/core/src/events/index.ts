export const EVENTS = {
  DOCUMENT_CAPTURED: "document.captured",
  DOCUMENT_INDEXED: "document.indexed",
  DOCUMENT_CATALOGED: "document.cataloged",
} as const;

export interface DomainEvent {
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface EventBus {
  emit(type: string, payload: Record<string, unknown>): Promise<void>;
}

export function InMemoryEventBus(): EventBus & { events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  return {
    events,
    async emit(type, payload) {
      events.push({ type, payload, at: new Date().toISOString() });
    },
  };
}

export function RedisStreamsEventBus(redisUrl: string, stream = "zordms:events"): EventBus {
  // Lazy import to avoid requiring Redis in tests
  let client: import("ioredis").default | null = null;
  return {
    async emit(type, payload) {
      if (!client) {
        const Redis = (await import("ioredis")).default;
        client = new Redis(redisUrl);
      }
      await client.xadd(stream, "*", "type", type, "payload", JSON.stringify(payload), "at", new Date().toISOString());
    },
  };
}
