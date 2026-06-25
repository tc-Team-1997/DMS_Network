import type { Knex } from "knex";
import { newId } from "@zordms/db";
import { signBody } from "./hmac.js";

export interface DispatchReport { delivered: number; failed: number; attempts: number; }

// F7 (minor): delayMs defaults to 0 (test-friendly) but can be set to ~1000 in production
// to avoid rapid-fire retries against a target that just returned 5xx.
interface DispatchDeps { knex: Knex; fetchImpl?: typeof fetch; maxAttempts?: number; delayMs?: number; }

export async function dispatchEvent(deps: DispatchDeps, event: string, payload: unknown): Promise<DispatchReport> {
  const { knex } = deps;
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const maxAttempts = deps.maxAttempts ?? 3;
  const delayMs = deps.delayMs ?? 0;

  const hooks = await knex("outbound_webhooks").where({ enabled: true });
  const subscribers = hooks.filter((h) =>
    String(h.events).split(",").map((s: string) => s.trim()).includes(event),
  );

  const report: DispatchReport = { delivered: 0, failed: 0, attempts: 0 };
  const body = JSON.stringify({ event, payload });

  for (const hook of subscribers) {
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-ZorDMS-Event": event };
    if (hook.auth_method === "hmac" && hook.secret) {
      headers["X-ZorDMS-Signature"] = signBody(body, hook.secret);
    }

    let ok = false; let lastStatus = 0; let attempt = 0;
    for (attempt = 1; attempt <= maxAttempts; attempt++) {
      report.attempts++;
      try {
        const res = await doFetch(hook.url, { method: "POST", headers, body });
        lastStatus = res.status;
        if (res.ok) { ok = true; break; }
      } catch {
        lastStatus = 0;
      }
      // F7: Configurable inter-retry delay (0 in tests, set to ~1000ms in production).
      if (!ok && attempt < maxAttempts && delayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, delayMs));
      }
    }

    await knex("integration_logs").insert({
      id: newId(), system: "outbound", endpoint: event, method: "POST",
      status: lastStatus, latency_ms: 0, direction: "outbound",
      success: ok, error: ok ? null : `delivery_failed_after_${attempt - 1}_attempts`,
    });
    if (ok) report.delivered++; else report.failed++;
  }

  return report;
}
