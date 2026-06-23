import type { Knex } from "knex";
import type { SearchBackend } from "../backend/SearchBackend.js";
import type { SearchDoc } from "../types.js";

type EventName = "document.indexed" | "document.cataloged" | "document.deleted";

function toSearchDoc(p: Record<string, unknown>): SearchDoc {
  return {
    doc_id: String(p.doc_id),
    ocr_text: String(p.ocr_text ?? ""),
    metadata_text: String(p.metadata_text ?? ""),
    doc_type: String(p.doc_type ?? "unknown"),
    branch: String(p.branch ?? ""),
    status: String(p.status ?? "indexed"),
    risk_band: String(p.risk_band ?? "low"),
    legal_hold: Boolean(p.legal_hold ?? false),
    expiry_status: String(p.expiry_status ?? "none"),
    uploaded_by: String(p.uploaded_by ?? ""),
    indexed_at: String(p.indexed_at ?? new Date().toISOString()),
  };
}

export async function handleDocumentEvent(
  backend: SearchBackend,
  event: EventName,
  payload: Record<string, unknown>,
): Promise<void> {
  if (event === "document.deleted") {
    await backend.delete(String(payload.doc_id));
    return;
  }
  await backend.index(toSearchDoc(payload));
}

export async function startIndexConsumer(deps: { knex: Knex; backend: SearchBackend }): Promise<void> {
  // Lazy import so unit tests that call handleDocumentEvent directly don't require a live bus.
  // @zordms/events is not yet installed; this consumer will be wired in a later plan.
  const eventsPackage = "@zordms/events";
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const eventsModule = await (Function("p", "return import(p)")(eventsPackage) as Promise<{ subscribe: (event: string, handler: (payload: Record<string, unknown>) => Promise<void>) => Promise<void> }>);
    const events: EventName[] = ["document.indexed", "document.cataloged", "document.deleted"];
    for (const ev of events) {
      await eventsModule.subscribe(ev, async (payload: Record<string, unknown>) => {
        await handleDocumentEvent(deps.backend, ev, payload);
      });
    }
  } catch {
    // @zordms/events not available (not installed); skip consumer in this environment.
    console.warn(`${eventsPackage} not available; index consumer disabled`);
  }
}
