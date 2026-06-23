import type { Knex } from "knex";
import type { ConnectorResult } from "../types.js";

export type { ConnectorResult };

export interface ConnectorContext {
  knex: Knex;
}

export interface Connector {
  readonly system: string;
  call<T = unknown>(op: string, payload: unknown): Promise<ConnectorResult<T>>;
}
