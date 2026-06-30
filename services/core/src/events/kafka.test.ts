/**
 * Kafka event bus — exercised against an in-memory fake producer (no broker),
 * plus the createEventBus factory's driver selection + graceful fallback.
 */
import { describe, it, expect } from "vitest";
import { KafkaEventBus, type KafkaProducerLike } from "./kafka.js";
import { createEventBus, InMemoryEventBus } from "./index.js";

function fakeProducer() {
  const sent: Array<{ topic: string; messages: Array<{ key?: string; value: string }> }> = [];
  const producer: KafkaProducerLike = {
    async send(record) {
      sent.push(record);
      return {};
    },
  };
  return { sent, producer };
}

describe("KafkaEventBus", () => {
  it("publishes the event to the topic with type as key and a JSON envelope", async () => {
    const { sent, producer } = fakeProducer();
    const bus = KafkaEventBus({ producer, topic: "zordms.events" });
    await bus.emit("document.captured", { docId: "d1", branch: "Thimphu" });

    expect(sent).toHaveLength(1);
    expect(sent[0].topic).toBe("zordms.events");
    const msg = sent[0].messages[0];
    expect(msg.key).toBe("document.captured");
    const env = JSON.parse(msg.value);
    expect(env.type).toBe("document.captured");
    expect(env.payload).toEqual({ docId: "d1", branch: "Thimphu" });
    expect(typeof env.at).toBe("string");
  });
});

describe("createEventBus factory", () => {
  it("driver 'memory' returns an in-process bus that records events", async () => {
    const bus = (await createEventBus({ driver: "memory", redisUrl: "redis://x" })) as ReturnType<
      typeof InMemoryEventBus
    >;
    await bus.emit("document.indexed", { docId: "d2" });
    expect(bus.events).toHaveLength(1);
    expect(bus.events[0].type).toBe("document.indexed");
  });

  it("driver 'kafka' with no brokers falls back to a working bus (Redis Streams)", async () => {
    // No brokers => tryCreateKafka returns null => fallback. We only assert the
    // factory returns a usable EventBus shape without throwing (no broker/redis
    // is contacted until emit, which we don't call here).
    const bus = await createEventBus({ driver: "kafka", redisUrl: "redis://x", kafkaBrokers: [] });
    expect(typeof bus.emit).toBe("function");
  });

  it("unknown driver defaults to a usable bus (Redis Streams) without throwing", async () => {
    const bus = await createEventBus({ driver: "something-else", redisUrl: "redis://x" });
    expect(typeof bus.emit).toBe("function");
  });
});
