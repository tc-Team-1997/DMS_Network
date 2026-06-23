import type { Connector } from "./types.js";
import type { ConnectorResult } from "../types.js";

export interface HttpConnectorOptions {
  system: string;
  baseUrl: string;
  opMap: Record<string, { method: string; path: string }>;
  authHeader?: () => Record<string, string>;
  fetchImpl?: typeof fetch;
}

// Generic HTTP connector (httpx-equivalent via fetch/undici). The fetch impl is
// injectable so unit tests never touch the network.
export class HttpConnector implements Connector {
  readonly system: string;
  private readonly o: HttpConnectorOptions;
  private readonly doFetch: typeof fetch;

  constructor(options: HttpConnectorOptions) {
    this.o = options;
    this.system = options.system;
    this.doFetch = options.fetchImpl ?? globalThis.fetch;
  }

  async call<T = unknown>(op: string, payload: unknown): Promise<ConnectorResult<T>> {
    const mapped = this.o.opMap[op];
    if (!mapped) return { ok: false, status: 404, error: `unmapped_op:${op}` };
    const url = `${this.o.baseUrl}${mapped.path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(this.o.authHeader?.() ?? {}) };
    const hasBody = mapped.method !== "GET" && mapped.method !== "HEAD";
    try {
      const res = await this.doFetch(url, {
        method: mapped.method,
        headers,
        body: hasBody ? JSON.stringify(payload ?? {}) : undefined,
      });
      const data = (await res.json().catch(() => undefined)) as T | undefined;
      return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : `http_${res.status}` };
    } catch (err) {
      return { ok: false, status: 0, error: (err as Error).message };
    }
  }
}
