import type { Knex } from "knex";
import { newId } from "@zordms/db";
import type { Connector } from "./types.js";
import type { ConnectorResult } from "@zordms/types";

// Wrap any connector so every call is timed and persisted to integration_logs.
export function withLogging(inner: Connector, knex: Knex): Connector {
  return {
    system: inner.system,
    async call<T>(op: string, payload: unknown): Promise<ConnectorResult<T>> {
      const start = Date.now();
      let result: ConnectorResult<T>;
      try {
        result = await inner.call<T>(op, payload);
      } catch (err) {
        result = { ok: false, status: 0, error: (err as Error).message };
      }
      const latency = Date.now() - start;
      await knex("integration_logs").insert({
        id: newId(),
        system: inner.system,
        endpoint: op,
        method: "CALL",
        status: result.status ?? 0,
        latency_ms: latency,
        direction: "outbound",
        success: result.ok,
        error: result.ok ? null : (result.error ?? null),
      });
      return result;
    },
  };
}
