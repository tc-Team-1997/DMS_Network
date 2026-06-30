export const EVENTS = {
  DOCUMENT_CAPTURED: "document.captured",
  DOCUMENT_INDEXED: "document.indexed",
  DOCUMENT_CATALOGED: "document.cataloged",
  DOCUMENT_STAMPED: "document.stamped",
  DOCUMENT_REDACTED: "document.redacted",
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

export interface EventBusConfig {
  /** "kafka" | "redis" | "memory"; anything else defaults to redis. */
  driver?: string;
  redisUrl: string;
  kafkaBrokers?: string[];
  kafkaTopic?: string;
}

/**
 * Pick an event bus from config. With `driver: "kafka"` and brokers, build a
 * Kafka bus; if kafkajs is missing or the connect fails, log a degraded warning
 * and fall back to Redis Streams so boot never fails on the bus. "memory" gives
 * the in-process bus (used outside tests only if explicitly requested).
 */
export async function createEventBus(cfg: EventBusConfig): Promise<EventBus> {
  if (cfg.driver === "memory") return InMemoryEventBus();

  if (cfg.driver === "kafka") {
    const { tryCreateKafka } = await import("./kafka.js");
    const bus = await tryCreateKafka({
      brokers: cfg.kafkaBrokers ?? [],
      topic: cfg.kafkaTopic ?? "zordms.events",
    });
    if (bus) return bus;
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "events_kafka_unavailable_fallback_redis",
        detail: "EVENT_BUS=kafka but kafkajs or KAFKA_BROKERS is missing / unreachable; using Redis Streams.",
      }),
    );
  }
  return RedisStreamsEventBus(cfg.redisUrl);
}
