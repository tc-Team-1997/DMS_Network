import type { Connector } from "./types.js";
import type { ConnectorResult } from "@zordms/types";

export class MockConnector implements Connector {
  constructor(
    public readonly system: string,
    private readonly responses: Record<string, ConnectorResult> = {},
  ) {}

  async call<T = unknown>(op: string, _payload: unknown): Promise<ConnectorResult<T>> {
    const canned = this.responses[op];
    if (canned) return { ...canned, mock: true } as ConnectorResult<T>;
    return { ok: false, status: 501, error: "unhandled_mock_op", mock: true };
  }
}
