import { type EventBus } from "./index.js";

/**
 * Minimal producer surface this bus depends on — lets tests inject a fake
 * without standing up a broker. kafkajs's Producer satisfies it structurally.
 */
export interface KafkaProducerLike {
  send(record: { topic: string; messages: Array<{ key?: string; value: string }> }): Promise<unknown>;
}

export interface KafkaBusDeps {
  producer: KafkaProducerLike;
  topic: string;
}

/**
 * Publishes domain events to a Kafka topic. The event `type` is used as the
 * message key (so per-document ordering is preserved by partition), and the
 * full envelope is the JSON value — symmetric with RedisStreamsEventBus.
 */
export function KafkaEventBus(deps: KafkaBusDeps): EventBus {
  const { producer, topic } = deps;
  return {
    async emit(type, payload) {
      await producer.send({
        topic,
        messages: [{ key: type, value: JSON.stringify({ type, payload, at: new Date().toISOString() }) }],
      });
    },
  };
}

export interface KafkaConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
}

/**
 * Build a real Kafka bus from config using kafkajs. Returns null if the package
 * isn't installed or connecting fails, so the factory can fall back to Redis
 * Streams rather than failing boot (degraded, never down — mirrors tryCreateS3).
 */
export async function tryCreateKafka(cfg: KafkaConfig): Promise<EventBus | null> {
  if (!cfg.brokers.length) return null;
  try {
    // Non-literal specifier: keeps tsc from requiring the optional peer at
    // compile time; resolves at runtime once kafkajs is installed.
    const kafkaModule = "kafkajs";
    const { Kafka } = (await import(kafkaModule)) as {
      Kafka: new (opts: { clientId?: string; brokers: string[] }) => {
        producer(): KafkaProducerLike & { connect(): Promise<void> };
      };
    };
    const kafka = new Kafka({ clientId: cfg.clientId ?? "zordms-core", brokers: cfg.brokers });
    const producer = kafka.producer();
    await producer.connect();
    return KafkaEventBus({ producer, topic: cfg.topic });
  } catch {
    return null;
  }
}
