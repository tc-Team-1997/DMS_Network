import type { ConnectorResult } from "@zordms/types";

/**
 * P7: Core ingest client.
 *
 * After the hub verifies an inbound webhook's HMAC it forwards the event to the
 * CORE service's internal ingest endpoints, authenticated with the shared
 * INTERNAL_SERVICE_TOKEN (x-internal-token) — the same service-to-service pattern
 * the workflow service uses against the gateway.
 *
 * Best-effort: a transport error or non-2xx is returned (never thrown) so the
 * webhook handler can record consumed=false without 500-ing the sender.
 */

export interface CoreIngestOptions {
  coreUrl: string;            // e.g. http://localhost:4001
  internalServiceToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface IngestResult {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

// Maps an inbound webhook event to the core ingest path.
const PATH_FOR_EVENT: Record<string, string> = {
  "cbs.customer.updated": "/integration/customer-upsert",
  "los.loan.created": "/integration/loan-intake",
};

export function pathForEvent(event: string): string | undefined {
  return PATH_FOR_EVENT[event];
}

export class CoreIngestClient {
  private readonly o: CoreIngestOptions;
  private readonly doFetch: typeof fetch;

  constructor(options: CoreIngestOptions) {
    this.o = options;
    this.doFetch = options.fetchImpl ?? globalThis.fetch;
  }

  // Forward an inbound event's payload to the matching core ingest endpoint.
  // Returns ok=false (without throwing) when core is unreachable or rejects.
  async forward(event: string, payload: unknown): Promise<IngestResult> {
    const path = pathForEvent(event);
    if (!path) return { ok: false, status: 0, error: `no_ingest_route:${event}` };

    const url = `${this.o.coreUrl.replace(/\/$/, "")}${path}`;
    const controller = new AbortController();
    const timer = this.o.timeoutMs ? setTimeout(() => controller.abort(), this.o.timeoutMs) : undefined;
    try {
      const res = await this.doFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": this.o.internalServiceToken,
        },
        body: JSON.stringify(payload ?? {}),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => undefined)) as unknown;
      return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : `http_${res.status}` };
    } catch (err) {
      return { ok: false, status: 0, error: (err as Error).message };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

// Convenience: builds a result-shaped object for symmetry with connectors.
export function asConnectorResult(r: IngestResult): ConnectorResult {
  return { ok: r.ok, status: r.status, data: r.data, error: r.error };
}
