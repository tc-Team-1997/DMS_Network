import type { Knex } from "knex";
import { newId } from "@zordms/db";
import { fieldObjectsForType } from "../catalog/quality.js";

/**
 * Seed: populate doc_type_registry with the canonical IDP types.
 * Idempotent — skips rows that already exist by code.
 */
interface DocTypeRow {
  code: string;
  description: string;
  jurisdiction: string;
  issuer: string;
  category: string;
  system: boolean;
}

const REGISTRY_ROWS: DocTypeRow[] = [
  // ── Bhutan national identity ───────────────────────────────────────────────
  { code: "BT_CID_4G",           description: "Bhutan CID Card (4G, 2025+)",      jurisdiction: "BT",  issuer: "DCRC",             category: "KYC / Identity",  system: true },
  { code: "BT_CITIZENSHIP",      description: "Bhutan Citizenship Certificate",   jurisdiction: "BT",  issuer: "DCRC",             category: "KYC / Identity",  system: true },
  { code: "BT_PASSPORT",         description: "Bhutan Passport (biometric)",      jurisdiction: "BT",  issuer: "DoI / MoFA",       category: "KYC / Identity",  system: true },
  { code: "FOREIGN_PASSPORT",    description: "Non-Bhutan passport",              jurisdiction: "INT", issuer: "Foreign state",    category: "KYC / Identity",  system: true },
  { code: "IN_PAN",              description: "Indian PAN Card",                  jurisdiction: "IN",  issuer: "CBDT / NSDL",      category: "KYC / Identity",  system: true },
  { code: "IN_AADHAAR",          description: "Indian Aadhaar Card",              jurisdiction: "IN",  issuer: "UIDAI",            category: "KYC / Identity",  system: true },
  // ── Bank of Bhutan forms ───────────────────────────────────────────────────
  { code: "BOB_ACCOUNT_FORM",    description: "BoB Account Opening Form",         jurisdiction: "BT",  issuer: "Bank of Bhutan",   category: "Account Opening", system: true },
  { code: "BOB_LOAN_APPLICATION",description: "BoB Loan Application",             jurisdiction: "BT",  issuer: "Bank of Bhutan",   category: "Loan & Credit",   system: true },
  { code: "BOB_INVOICE",         description: "BoB-related Invoice",              jurisdiction: "BT",  issuer: "Vendor",           category: "General Corr.",   system: true },
  { code: "PURCHASE_ORDER",      description: "Bank Purchase Order",              jurisdiction: "BT",  issuer: "Bank of Bhutan",   category: "General Corr.",   system: true },
  // ── Compliance ─────────────────────────────────────────────────────────────
  { code: "SAR_REPORT",          description: "Suspicious Activity Report",       jurisdiction: "BT",  issuer: "FIU / FID",        category: "Compliance & AML",system: true },
  { code: "CTR",                 description: "Cash Transaction Report",          jurisdiction: "BT",  issuer: "RMA / FIU",        category: "Compliance & AML",system: true },
  { code: "WIRE_TRANSFER_LOG",   description: "Wire Transfer Log",                jurisdiction: "BT",  issuer: "Bank of Bhutan",   category: "Compliance & AML",system: true },
  // ── HR & Staff ─────────────────────────────────────────────────────────────
  { code: "EMPLOYMENT_CONTRACT", description: "Staff Employment Contract",        jurisdiction: "BT",  issuer: "Bank of Bhutan HR",category: "HR & Staff",      system: true },
  // ── Legal & Audit ──────────────────────────────────────────────────────────
  { code: "BOARD_RESOLUTION",    description: "Board Resolution",                 jurisdiction: "BT",  issuer: "BoB Board Sec.",   category: "Legal & Audit",   system: true },
  { code: "RMA_INSPECTION",      description: "RMA Inspection Report",            jurisdiction: "BT",  issuer: "RMA",              category: "Legal & Audit",   system: true },
  { code: "RMA_INSPECTION_REPORT",description:"RMA Inspection Report (alias)",   jurisdiction: "BT",  issuer: "RMA",              category: "Legal & Audit",   system: true },
  { code: "RAA_AUDIT_REPORT",    description: "RAA Audit Report",                 jurisdiction: "BT",  issuer: "RAA",              category: "Legal & Audit",   system: true },
  // ── General ────────────────────────────────────────────────────────────────
  { code: "GENERAL_LETTER",      description: "General Correspondence",           jurisdiction: "ANY", issuer: "Various",          category: "General Corr.",   system: true },
  { code: "LETTER",              description: "Letter",                           jurisdiction: "ANY", issuer: "Various",          category: "General Corr.",   system: true },
  { code: "MEMO",                description: "Internal Memorandum",              jurisdiction: "ANY", issuer: "Various",          category: "General Corr.",   system: true },
  { code: "CIRCULAR",            description: "Circular",                         jurisdiction: "ANY", issuer: "Various",          category: "General Corr.",   system: true },
  // ── Collateral & Security ──────────────────────────────────────────────────
  { code: "COLLATERAL_DEED",     description: "Collateral Deed",                  jurisdiction: "BT",  issuer: "Various",          category: "Loan & Credit",   system: true },
  { code: "MORTGAGE_DEED",       description: "Mortgage Deed",                    jurisdiction: "BT",  issuer: "Various",          category: "Loan & Credit",   system: true },
  // ── Unknown / fallback ────────────────────────────────────────────────────
  { code: "UNKNOWN",             description: "Unclassified / Unreadable",        jurisdiction: "ANY", issuer: "-",                category: "General Corr.",   system: true },
];

export async function seed(knex: Knex): Promise<void> {
  for (const row of REGISTRY_ROWS) {
    const { mandatoryFields, optionalFields } = fieldObjectsForType(row.code, row.category);
    const fieldCols = {
      mandatory_fields: JSON.stringify(mandatoryFields),
      optional_fields: JSON.stringify(optionalFields),
    };

    const exists = await knex("doc_type_registry").where({ code: row.code }).first();
    if (!exists) {
      await knex("doc_type_registry").insert({ id: newId(), ...row, ...fieldCols });
    } else if (exists.mandatory_fields == null && exists.optional_fields == null) {
      // Backfill stored field schemas onto rows seeded before the columns existed.
      await knex("doc_type_registry").where({ code: row.code }).update(fieldCols);
    }
  }
}
