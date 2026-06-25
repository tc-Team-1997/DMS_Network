const PERMANENT = 9999;

export interface CatalogResult {
  category: string;
  route: "AUTO" | "TENTATIVE" | "HUMAN_REVIEW";
  mandatoryOk: boolean;
  missing: string[];
  retentionYears: number;
  reviewFlag?: boolean;
  alertRule?: string;
}

// IDP §4.1 — mandatory index fields per catalog category
export const MANDATORY: Record<string, string[]> = {
  "KYC / Identity": ["full_name", "dob", "expiry_date"],
  "Account Opening": ["account_no", "applicant_cid", "branch_code", "submission_date"],
  "Loan & Credit": ["application_no", "loan_type", "loan_amount", "applicant_cid"],
  "Compliance & AML": ["report_no", "reporting_officer", "filing_date", "status"],
  "HR & Staff": ["staff_id", "staff_name", "contract_start", "contract_end"],
  "Legal & Audit": ["ref_no", "issue_date", "subject"],
  "General Corr.": ["from_org", "to_org", "ref_no", "date"],
};

// IDP §4.1 + Retention_Compliance — retention years per category
export const RETENTION: Record<string, number> = {
  "KYC / Identity": 10,
  "Account Opening": 10,
  "Loan & Credit": 15,
  "Compliance & AML": 10,
  "HR & Staff": 7,
  "Legal & Audit": PERMANENT,
  "General Corr.": 7,
  "_Review/Pending": 1,
};

const ALERT_RULE: Record<string, string> = {
  "KYC / Identity": "60/30/7 days before expiry_date",
  "Loan & Credit": "alert if pending review > 5 days",
  "HR & Staff": "90 days before contract_end",
};

export function categoryFor(docType: string): string {
  if (docType === "BT_CID_4G" || docType === "BT_CITIZENSHIP") return "KYC / Identity";
  if (docType === "BT_PASSPORT" || docType === "FOREIGN_PASSPORT") return "KYC / Identity";
  if (/^BOB_LOAN_/.test(docType)) return "Loan & Credit";
  if (["SAR_REPORT", "CTR", "WIRE_TRANSFER_LOG"].includes(docType)) return "Compliance & AML";
  if (/^STAFF_/.test(docType) || /^EMPLOYMENT_/.test(docType)) return "HR & Staff";
  return "General Corr.";
}

function missingMandatory(category: string, fields: Record<string, unknown>): string[] {
  const required = MANDATORY[category] ?? [];
  return required.filter((f) => {
    const v = fields[f];
    return v === undefined || v === null || v === "";
  });
}

export function catalog(input: { docType: string; confidence: number; fields: Record<string, unknown> }): CatalogResult {
  const category = categoryFor(input.docType);
  const missing = missingMandatory(category, input.fields);

  // Rule 1 — Blocked
  if (input.confidence < 0.5 || missing.length > 0) {
    return {
      category: "_Review/Pending",
      route: "HUMAN_REVIEW",
      mandatoryOk: missing.length === 0,
      missing,
      retentionYears: RETENTION["_Review/Pending"],
      reviewFlag: true,
    };
  }

  const base: CatalogResult = {
    category,
    route: "AUTO",
    mandatoryOk: true,
    missing: [],
    retentionYears: RETENTION[category] ?? 7,
    alertRule: ALERT_RULE[category],
  };

  // Rule 2 — Low confidence
  if (input.confidence < 0.85) {
    return { ...base, route: "TENTATIVE", reviewFlag: true };
  }

  return base;
}
