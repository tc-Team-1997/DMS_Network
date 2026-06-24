import type { Knex } from "knex";
import { randomUUID } from "node:crypto";
import type { RetentionPolicy, LegalHold, DisposalCandidate } from "@zordms/types";

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
    ref: input.ref, scope: input.scope, status: "Active", doc_count: docCount, placed_by: input.placed_by ?? null,
  });
  return knex<LegalHold>("legal_holds").where({ ref: input.ref }).first() as Promise<LegalHold>;
}

export async function releaseLegalHold(knex: Knex, ref: string): Promise<LegalHold> {
  await knex("legal_holds").where({ ref }).update({ status: "Released", released_at: knex.fn.now() });
  return knex<LegalHold>("legal_holds").where({ ref }).first() as Promise<LegalHold>;
}

/** Returns true if any Active hold covers this document. */
async function documentOnHold(knex: Knex, documentId: number): Promise<boolean> {
  const holds = await knex("legal_holds").where({ status: "Active" }).select("scope");
  if (holds.length === 0) return false;
  const doc = await knex("documents").where({ id: documentId }).first();
  if (!doc) return false;
  return holds.some((h) => {
    const colonIdx = String(h.scope).indexOf(":");
    if (colonIdx < 0) return false;
    const field = String(h.scope).slice(0, colonIdx);
    const value = String(h.scope).slice(colonIdx + 1);
    if (field === "branch") return doc.branch === value;
    if (field === "doc_type") return doc.doc_type === value;
    if (field === "cid") return doc.cid === value;
    return false;
  });
}

export async function disposalEligibility(knex: Knex): Promise<DisposalCandidate[]> {
  const docs = await knex("documents as d")
    .leftJoin("retention_policies as rp", "rp.doc_class", "d.doc_type")
    .select("d.id", "d.doc_no", "d.doc_type", "d.ingest_timestamp as created_at", "rp.retention_years");

  const now = Date.now();
  const out: DisposalCandidate[] = [];
  for (const d of docs) {
    const years = d.retention_years == null ? 7 : Number(d.retention_years);
    const ingested = d.created_at ? new Date(d.created_at).getTime() : now;
    const destruction = new Date(ingested);
    destruction.setFullYear(destruction.getFullYear() + years);
    if (destruction.getTime() <= now) {
      out.push({
        document_id: d.id, doc_no: d.doc_no ?? undefined, doc_type: d.doc_type,
        destruction_date: destruction.toISOString().slice(0, 10),
        on_hold: await documentOnHold(knex, d.id),
      });
    }
  }
  return out;
}

export async function certifiedDisposal(
  knex: Knex, documentId: number, actor: string,
): Promise<{ certificate: string }> {
  if (await documentOnHold(knex, documentId)) {
    throw new Error(`refused: document ${documentId} is covered by an active legal_hold`);
  }
  const certificate = `DISPOSAL-${randomUUID()}`;
  await knex("disposal_queue").insert({
    document_id: documentId, disposed: true, disposed_at: knex.fn.now(), certificate,
  });
  await knex("documents").where({ id: documentId }).update({ status: "Disposed" });
  await knex("audit_log").insert({
    actor_username: actor, action: "DISPOSAL_CERTIFIED", entity: "document",
    entity_id: String(documentId), details: certificate,
  });
  return { certificate };
}
