/**
 * Quality / Completeness Scoring
 *
 * Computes a quality score (0-100) and completeness ratio (0-1) for a document
 * based on how many mandatory fields (per catalog category) are present.
 */

import { MANDATORY } from "./engine.js";

export interface QualityResult {
  /** 0-100 overall quality score */
  score: number;
  /** 0-1 ratio of mandatory fields that are present */
  completeness: number;
  /** mandatory fields that are missing */
  mandatoryMissing: string[];
  /** AI confidence passed through */
  confidence: number;
}

/**
 * Per-type optional fields that the UI should show in the metadata form.
 * These are in addition to the mandatory fields for the category.
 */
export const PER_TYPE_OPTIONAL_FIELDS: Record<string, string[]> = {
  // KYC
  BT_CID_4G: ["sex", "dzongkhag", "gewog", "issue_date"],
  BT_CITIZENSHIP: ["sex", "dzongkhag", "gewog", "issue_date"],
  BT_PASSPORT: ["sex", "nationality", "place_of_issue", "issue_date"],
  FOREIGN_PASSPORT: ["sex", "nationality", "place_of_issue", "issue_date"],
  IN_PAN: ["name"],
  IN_AADHAAR: ["name", "address"],
  // Account Opening
  BOB_ACCOUNT_FORM: ["account_type", "currency", "date_opened", "officer"],
  // Loan & Credit
  BOB_LOAN_APPLICATION: ["loan_type", "loan_amount", "purpose", "officer", "branch_code"],
  COLLATERAL_DEED: ["plot_no", "area_sqft", "registered_value"],
  MORTGAGE_DEED: ["plot_no", "area_sqft", "registered_value"],
  // Compliance
  SAR_REPORT: ["case_count", "total_flagged"],
  CTR: ["transaction_date", "amount"],
  WIRE_TRANSFER_LOG: ["sender", "receiver", "amount", "transaction_date"],
  // HR
  EMPLOYMENT_CONTRACT: ["position", "department", "salary_grade"],
  // Legal
  BOARD_RESOLUTION: ["resolution_no", "meeting_date"],
  RMA_INSPECTION: ["inspector_name", "inspection_date"],
  RMA_INSPECTION_REPORT: ["inspector_name", "inspection_date"],
  RAA_AUDIT_REPORT: ["auditor", "period", "findings_count"],
  // General
  GENERAL_LETTER: ["date", "subject"],
  LETTER: ["date", "subject"],
  MEMO: ["date", "subject", "department"],
  CIRCULAR: ["circular_no", "effective_date"],
};

/**
 * Returns { mandatoryFields, optionalFields } for a given doc_type
 * (based on catalog category mandatory + per-type optional extras).
 */
export function fieldSchemaForType(
  docType: string,
  category: string | null | undefined,
): { mandatoryFields: string[]; optionalFields: string[] } {
  const mandatoryFields = MANDATORY[category ?? ""] ?? [];
  // Always add cid, doc_no as optional if not already mandatory
  const baseOptional = ["cid", "doc_no", "expiry_date", "name"];
  const typeOptional = PER_TYPE_OPTIONAL_FIELDS[docType] ?? [];
  const combined = [...new Set([...baseOptional, ...typeOptional])];
  const optionalFields = combined.filter((f) => !mandatoryFields.includes(f));
  return { mandatoryFields, optionalFields };
}

/**
 * Compute quality score for a document given its extracted fields and category.
 */
export function computeQuality(
  category: string | null | undefined,
  fields: Record<string, unknown>,
  confidence: number,
): QualityResult {
  const mandatory = MANDATORY[category ?? ""] ?? [];

  const mandatoryMissing = mandatory.filter((f) => {
    const v = fields[f];
    return v === undefined || v === null || v === "";
  });

  const completeness = mandatory.length === 0
    ? 1
    : (mandatory.length - mandatoryMissing.length) / mandatory.length;

  // Score formula:
  //   40% weight from completeness (mandatory fields)
  //   60% weight from AI confidence
  //   Penalise heavily if any mandatory is missing (floor at 0)
  const rawScore = completeness * 40 + confidence * 60;
  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  return {
    score,
    completeness: Math.round(completeness * 1000) / 1000,
    mandatoryMissing,
    confidence,
  };
}
