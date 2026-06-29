import type { Knex } from "knex";
import { randomUUID } from "node:crypto";
import type { RetentionPolicy, LegalHold, DisposalCandidate } from "@zordms/types";
import { newId } from "@zordms/db";
import { writeAudit } from "./audit.js";

export async function listFilePlan(knex: Knex): Promise<RetentionPolicy[]> {
  return knex<RetentionPolicy>("retention_policies").select("*").orderBy("doc_class");
}

export async function listLegalHolds(knex: Knex): Promise<LegalHold[]> {
  return knex<LegalHold>("legal_holds").select("*").orderBy("placed_at", "desc");
}

function scopeToQuery(knex: Knex, scope: string): Knex.QueryBuilder {
  const q = knex("documents");
  const colonIdx = scope.indexOf(":");
  if (colonIdx < 0) return q.whereRaw("1 = 0");
  const field = scope.slice(0, colonIdx);
  const value = scope.slice(colonIdx + 1);
  if (field === "branch") return q.where({ branch: value });
  if (field === "doc_type") return q.where({ doc_type: value });
  if (field === "cid") return q.where({ cid: value });
  return q.whereRaw("1 = 0");
}

export async function placeLegalHold(
  knex: Knex, input: { ref: string; scope: string; placed_by?: string },
): Promise<LegalHold> {
  const countRow = await scopeToQuery(knex, input.scope).count("id as c");
  const docCount = Number((countRow as any)[0].c);
  await knex("legal_holds").insert({
    id: newId(), ref: input.ref, scope: input.scope, status: "Active", doc_count: docCount, placed_by: input.placed_by ?? null,
  });
  return knex<LegalHold>("legal_holds").where({ ref: input.ref }).first() as Promise<LegalHold>;
}

export async function releaseLegalHold(knex: Knex, ref: string): Promise<LegalHold> {
  await knex("legal_holds").where({ ref }).update({ status: "Released", released_at: knex.fn.now() });
  return knex<LegalHold>("legal_holds").where({ ref }).first() as Promise<LegalHold>;
}

function scopeCoversDoc(scope: string, doc: { branch?: string; doc_type?: string; cid?: string }): boolean {
  const colonIdx = String(scope).indexOf(":");
  if (colonIdx < 0) return false;
  const field = String(scope).slice(0, colonIdx);
  const value = String(scope).slice(colonIdx + 1);
  if (field === "branch") return doc.branch === value;
  if (field === "doc_type") return doc.doc_type === value;
  if (field === "cid") return doc.cid === value;
  return false;
}

/**
 * Returns the `ref` of the first Active legal hold that covers this document,
 * or null if none. Used to enforce records lifecycle: a held document must not
 * be deletable or disposable.
 */
export async function holdsFor(knex: Knex, documentId: string): Promise<string | null> {
  const holds = await knex("legal_holds").where({ status: "Active" }).select("ref", "scope");
  if (holds.length === 0) return null;
  const doc = await knex("documents").where({ id: documentId }).first();
  if (!doc) return null;
  const hit = holds.find((h) => scopeCoversDoc(String(h.scope), doc));
  return hit ? String(hit.ref) : null;
}

/** Returns true if any Active hold covers this document. */
export async function isUnderHold(knex: Knex, documentId: string): Promise<boolean> {
  return (await holdsFor(knex, documentId)) != null;
}

/** Internal alias kept for existing callers. */
async function documentOnHold(knex: Knex, documentId: string): Promise<boolean> {
  return isUnderHold(knex, documentId);
}

/**
 * Thrown when an operation is refused because the document is covered by an
 * active legal hold. Carries the offending hold ref so the route layer can
 * return 409 { error: "under_legal_hold", hold: <ref> }.
 */
export class LegalHoldError extends Error {
  readonly hold: string;
  constructor(documentId: string, hold: string) {
    super(`refused: document ${documentId} is covered by an active legal_hold ${hold}`);
    this.name = "LegalHoldError";
    this.hold = hold;
  }
}

/** Compute the destruction date for a document given its retention policy. */
function computeDestruction(createdAt: string | null, retentionYears: number | null, now: number): Date {
  const years = retentionYears == null ? 7 : Number(retentionYears);
  const ingested = createdAt ? new Date(createdAt).getTime() : now;
  const destruction = new Date(ingested);
  destruction.setFullYear(destruction.getFullYear() + years);
  return destruction;
}

export async function disposalEligibility(knex: Knex): Promise<DisposalCandidate[]> {
  const docs = await knex("documents as d")
    .leftJoin("retention_policies as rp", "rp.doc_class", "d.doc_type")
    .whereNot("d.status", "Disposed")
    .select(
      "d.id", "d.doc_no", "d.doc_type", "d.ingest_timestamp as created_at",
      "rp.retention_years", "d.disposal_status",
    );

  const now = Date.now();
  const out: DisposalCandidate[] = [];
  for (const d of docs) {
    const destruction = computeDestruction(d.created_at ?? null, d.retention_years ?? null, now);
    if (destruction.getTime() <= now) {
      const candidate: DisposalCandidate & { disposal_status?: string | null } = {
        document_id: d.id, doc_no: d.doc_no ?? undefined, doc_type: d.doc_type,
        destruction_date: destruction.toISOString().slice(0, 10),
        on_hold: await documentOnHold(knex, d.id),
      };
      // P9: reflect the scheduled scan's eligibility marking when present.
      candidate.disposal_status = d.disposal_status ?? null;
      out.push(candidate);
    }
  }
  return out;
}

/**
 * P9 SCHEDULED DISPOSAL SCAN.
 *
 * Scans for documents whose destruction_date <= now AND that are NOT under an
 * active legal hold AND are not already disposed, and marks them
 * disposal-eligible (disposal_status = "Eligible") + emits an event for a human
 * to certify. This NEVER hard-deletes — it only produces eligibility + an audit
 * trail. Documents that become held again (or whose retention has not lapsed)
 * are un-marked so eligibility stays accurate.
 *
 * Returns the number of documents newly marked eligible this pass.
 */
export async function scanDisposalEligibility(
  knex: Knex,
  emit?: (type: string, payload: Record<string, unknown>) => Promise<void>,
  now: number = Date.now(),
): Promise<{ eligible: number; skipped: number }> {
  const docs = await knex("documents as d")
    .leftJoin("retention_policies as rp", "rp.doc_class", "d.doc_type")
    .whereNot("d.status", "Disposed")
    .select(
      "d.id", "d.doc_type", "d.disposal_status",
      "d.ingest_timestamp as created_at", "rp.retention_years",
    );

  let eligible = 0;
  let skipped = 0;
  for (const d of docs) {
    const destruction = computeDestruction(d.created_at ?? null, d.retention_years ?? null, now);
    const overRetention = destruction.getTime() <= now;
    const held = await documentOnHold(knex, d.id);

    if (overRetention && !held) {
      if (d.disposal_status !== "Eligible") {
        await knex("documents").where({ id: d.id })
          .update({ disposal_status: "Eligible", disposal_eligible_at: knex.fn.now() });
        await writeAudit(knex, {
          actorUsername: "system", action: "DISPOSAL_ELIGIBLE", entity: "document",
          entityId: String(d.id),
          details: `destruction_date=${destruction.toISOString().slice(0, 10)}`,
        });
        await emit?.("document.disposal_eligible", {
          docId: d.id, destruction_date: destruction.toISOString().slice(0, 10),
        });
      }
      eligible += 1;
    } else {
      // Held (or no longer over-retention) → ensure it is NOT marked eligible.
      if (d.disposal_status === "Eligible") {
        await knex("documents").where({ id: d.id }).update({ disposal_status: null, disposal_eligible_at: null });
      }
      if (overRetention && held) skipped += 1;
    }
  }
  return { eligible, skipped };
}

export async function certifiedDisposal(
  knex: Knex, documentId: string, actor: string,
): Promise<{ certificate: string }> {
  // Re-check holds at certify time even if the scan previously marked eligible.
  const hold = await holdsFor(knex, documentId);
  if (hold) {
    throw new LegalHoldError(documentId, hold);
  }
  const certificate = `DISPOSAL-${randomUUID()}`;
  await knex("disposal_queue").insert({
    id: newId(), document_id: documentId, disposed: true, disposed_at: knex.fn.now(), certificate,
  });
  await knex("documents").where({ id: documentId }).update({ status: "Disposed", disposal_status: "Disposed" });
  await writeAudit(knex, {
    actorUsername: actor, action: "DISPOSAL_CERTIFIED", entity: "document",
    entityId: String(documentId), details: certificate,
  });
  return { certificate };
}
