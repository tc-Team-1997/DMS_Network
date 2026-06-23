export type FieldType = "string" | "date" | "float" | "boolean";

export interface FieldSpec {
  name: string;
  type: FieldType;
  required: boolean;
  indexed: boolean;
  pii: boolean;
  regex?: string;
  enum?: string[];
}

const ISO_DATE = "^\\d{4}-\\d{2}-\\d{2}$";

export const SCHEMAS: Record<string, FieldSpec[]> = {
  // IDP §3.2.1 — Bhutan CID Card (4G)
  BT_CID_4G: [
    { name: "cid_no", type: "string", required: true, indexed: true, pii: true, regex: "^[0-9]{11}$" },
    { name: "full_name", type: "string", required: true, indexed: true, pii: true },
    { name: "dob", type: "date", required: true, indexed: true, pii: true, regex: ISO_DATE },
    { name: "sex", type: "string", required: false, indexed: false, pii: false, enum: ["M", "F", "O"] },
    { name: "issue_date", type: "date", required: true, indexed: true, pii: false, regex: ISO_DATE },
    { name: "expiry_date", type: "date", required: true, indexed: true, pii: false, regex: ISO_DATE },
    { name: "dzongkhag", type: "string", required: true, indexed: true, pii: false },
    { name: "village", type: "string", required: false, indexed: false, pii: false },
  ],
  // IDP §3.2.2 — Bhutan Passport
  BT_PASSPORT: [
    { name: "passport_no", type: "string", required: true, indexed: true, pii: true, regex: "^[A-Z][0-9]{7}$" },
    { name: "surname", type: "string", required: true, indexed: true, pii: true },
    { name: "given_names", type: "string", required: true, indexed: true, pii: true },
    { name: "nationality", type: "string", required: true, indexed: false, pii: false },
    { name: "dob", type: "date", required: true, indexed: true, pii: true, regex: ISO_DATE },
    { name: "sex", type: "string", required: false, indexed: false, pii: false, enum: ["M", "F"] },
    { name: "place_of_birth", type: "string", required: false, indexed: false, pii: false },
    { name: "issue_date", type: "date", required: true, indexed: true, pii: false, regex: ISO_DATE },
    { name: "expiry_date", type: "date", required: true, indexed: true, pii: false, regex: ISO_DATE },
  ],
  // IDP §3.2.3 — BoB Loan Application
  BOB_LOAN_APPLICATION: [
    { name: "application_no", type: "string", required: true, indexed: true, pii: false },
    { name: "applicant_cid", type: "string", required: true, indexed: true, pii: true, regex: "^[0-9]{11}$" },
    { name: "applicant_name", type: "string", required: true, indexed: true, pii: true },
    { name: "loan_type", type: "string", required: true, indexed: true, pii: false, enum: ["HOME", "AUTO", "AGRI", "BUSINESS", "PERSONAL"] },
    { name: "loan_amount", type: "float", required: true, indexed: true, pii: false },
    { name: "branch_code", type: "string", required: true, indexed: true, pii: false },
    { name: "submission_date", type: "date", required: true, indexed: true, pii: false, regex: ISO_DATE },
    { name: "officer_id", type: "string", required: false, indexed: true, pii: false },
  ],
};

function typeOk(spec: FieldSpec, value: unknown): boolean {
  switch (spec.type) {
    case "float": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "string":
    case "date": return typeof value === "string";
  }
}

export function validateMetadata(
  docType: string,
  fields: Record<string, unknown>,
): { ok: boolean; errors: string[]; missing: string[] } {
  const specs = SCHEMAS[docType];
  if (!specs) return { ok: false, errors: [`unknown doc_type: ${docType}`], missing: [] };

  const errors: string[] = [];
  const missing: string[] = [];

  for (const spec of specs) {
    const value = fields[spec.name];
    const present = value !== undefined && value !== null && value !== "";
    if (!present) {
      if (spec.required) missing.push(spec.name);
      continue;
    }
    if (!typeOk(spec, value)) {
      errors.push(`${spec.name}: expected ${spec.type}`);
      continue;
    }
    if (spec.regex && typeof value === "string" && !new RegExp(spec.regex).test(value)) {
      errors.push(`${spec.name}: does not match ${spec.regex}`);
    }
    if (spec.enum && !spec.enum.includes(String(value))) {
      errors.push(`${spec.name}: must be one of ${spec.enum.join("/")}`);
    }
  }

  return { ok: errors.length === 0 && missing.length === 0, errors, missing };
}
