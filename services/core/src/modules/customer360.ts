import type { Knex } from "knex";
import type { CustomerProfile, KycRequirement } from "@zordms/types";
import { writeAudit } from "./audit.js";

// CBE-style KYC requirement set
const REQUIREMENTS: Array<{ key: string; label: string; accepts: string[] }> = [
  { key: "identity", label: "Identity (CID / Passport)", accepts: ["BT_CID_4G", "BT_CITIZENSHIP", "BT_PASSPORT", "FOREIGN_PASSPORT"] },
  { key: "account", label: "Account / Address proof", accepts: ["BOB_ACCOUNT_FORM", "NOMINEE_FORM"] },
  { key: "photo", label: "Photograph", accepts: ["PHOTO"] },
  { key: "signature", label: "Specimen signature", accepts: ["SIGNATURE"] },
];

export function scoreKyc(docTypes: string[]): CustomerProfile["kyc"] {
  const have = new Set(docTypes);
  const requirements: KycRequirement[] = REQUIREMENTS.map((req) => ({
    key: req.key, label: req.label, satisfied: req.accepts.some((t) => have.has(t)),
  }));
  const satisfied = requirements.filter((r) => r.satisfied).length;
  const completeness = requirements.length === 0 ? 0 : satisfied / requirements.length;
  const status: CustomerProfile["kyc"]["status"] =
    completeness === 1 ? "Complete" : completeness === 0 ? "Missing" : "Partial";
  return { requirements, completeness, status, escalated: completeness < 0.5 };
}

export async function buildCustomerProfile(knex: Knex, cid: string): Promise<CustomerProfile> {
  const documents = await knex("documents").where({ cid })
    .select("id", "doc_no", "doc_type", "status", "ingest_timestamp as created_at")
    .orderBy("ingest_timestamp", "desc");

  const docTypes = documents.map((d) => d.doc_type as string).filter(Boolean);
  const kyc = scoreKyc(docTypes);

  const portfolioMap = new Map<string, number>();
  for (const t of docTypes) portfolioMap.set(t, (portfolioMap.get(t) ?? 0) + 1);
  const portfolio = [...portfolioMap.entries()].map(([doc_type, count]) => ({ doc_type, count }));

  const docIds = documents.map((d) => String(d.id));
  let timeline: CustomerProfile["timeline"] = [];
  if (docIds.length) {
    const rows = await knex("audit_log")
      .where("entity", "document").whereIn("entity_id", docIds)
      .select("created_at as ts", "action", "entity_id", "details").orderBy("created_at", "desc");
    timeline = rows.map((r) => ({ ts: String(r.ts), action: r.action, entity_id: r.entity_id, details: r.details ?? undefined }));
  }

  // Auto-escalation hook
  if (kyc.escalated) {
    await writeAudit(knex, {
      action: "KYC_ESCALATION", entity: "customer", entityId: cid,
      details: `KYC completeness ${(kyc.completeness * 100).toFixed(0)}% — below 50% threshold`,
    });
  }

  return {
    cid,
    documents: documents.map((d) => ({
      id: d.id, doc_no: d.doc_no ?? undefined, doc_type: d.doc_type, status: d.status, created_at: d.created_at ?? undefined,
    })),
    kyc, portfolio, timeline,
  };
}
