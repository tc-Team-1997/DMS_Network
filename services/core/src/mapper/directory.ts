type Acl = { role: string; access: "read" | "write" | "delete" };

function yearOf(fields: Record<string, unknown>): string {
  const src = (fields.submission_date ?? fields.issue_date ?? fields.filing_date ?? fields.ingest) as string | undefined;
  const d = src ? new Date(src) : new Date();
  return String(d.getFullYear());
}

function quarterOf(fields: Record<string, unknown>): string {
  const src = (fields.filing_date ?? fields.ingest) as string | undefined;
  const d = src ? new Date(src) : new Date();
  return `Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function today(fields: Record<string, unknown>): string {
  const src = (fields.ingest) as string | undefined;
  const d = src ? new Date(src) : new Date();
  return d.toISOString().slice(0, 10);
}

/** Path-safe a token value (no slashes / control chars). */
function safeSeg(v: unknown): string {
  return String(v ?? "").replace(/[\/\\\r\n]+/g, "-").replace(/\.\.+/g, "-").trim() || "UNK";
}

/**
 * Substitute {tokens} in an admin-defined folder template using extracted
 * fields. Built-ins: {cid} {year} {quarter} {date}; any other {name} resolves
 * to fields[name] (or cid_no for {cid}). Returns null if the template is empty.
 */
export function applyFolderTemplate(template: string | null | undefined, fields: Record<string, unknown>): string | null {
  if (!template) return null;
  const cid = (fields.cid_no ?? fields.applicant_cid ?? fields.cid ?? "UNK");
  const built: Record<string, string> = {
    cid: safeSeg(cid),
    year: yearOf(fields),
    quarter: quarterOf(fields),
    date: today(fields),
  };
  const path = template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    if (key in built) return built[key];
    return safeSeg(fields[key]);
  });
  return path.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || null;
}

// IDP §5.2 — directory mapping rules (first match wins)
export function resolvePath(docType: string, fields: Record<string, unknown>): string {
  const cid = (fields.cid_no ?? fields.applicant_cid ?? "UNK") as string;
  const year = yearOf(fields);

  if (docType === "BT_CID_4G" || docType === "BT_CITIZENSHIP")
    return `/BoB/Customers/${cid}/KYC/Identity/${year}/`;
  if (docType === "BT_PASSPORT" || docType === "FOREIGN_PASSPORT")
    return `/BoB/Customers/${cid}/KYC/Travel/${year}/`;
  if (docType === "BOB_ACCOUNT_FORM")
    return `/BoB/Customers/${cid}/Accounts/${fields.acct_no ?? "UNK"}/${year}/`;
  if (docType === "BOB_LOAN_APPLICATION")
    return `/BoB/Customers/${cid}/Loans/${fields.loan_type ?? "GEN"}/${fields.application_no ?? "UNK"}/`;
  if (docType === "COLLATERAL_DEED" || docType === "MORTGAGE_DEED")
    return `/BoB/Customers/${cid}/Loans/${fields.loan_no ?? "UNK"}/Security/`;
  if (docType === "EMPLOYMENT_CONTRACT")
    return `/BoB/Operations/${fields.branch_code ?? "HQ"}/HR/Contracts/${year}/`;
  if (docType === "PURCHASE_ORDER" || docType === "BOB_INVOICE")
    return `/BoB/Operations/${fields.branch_code ?? "HQ"}/Procurement/${year}/`;
  if (docType === "SAR_REPORT")
    return `/BoB/Compliance/AML/SAR/${year}/${quarterOf(fields)}/`;
  if (docType === "CTR")
    return `/BoB/Compliance/AML/CTR/${year}/${quarterOf(fields)}/`;
  if (docType === "RMA_INSPECTION" || docType === "RMA_INSPECTION_REPORT")
    return `/BoB/Compliance/RMA/${year}/`;
  if (docType === "RAA_AUDIT_REPORT")
    return `/BoB/Legal/RAA_Audit/${year}/`;
  if (docType === "BOARD_RESOLUTION")
    return `/BoB/Legal/BoardResolutions/${year}/`;
  if (["LETTER", "MEMO", "CIRCULAR", "GENERAL_LETTER"].includes(docType))
    return `/BoB/General/${fields.from_org ?? "Unknown"}/${year}/`;

  return `/BoB/_Review/Pending/${today(fields)}/`;
}

export function domainForPath(path: string): string {
  const parts = path.split("/").filter(Boolean); // ["BoB","Customers",...]
  return parts[1] ?? "General";
}

// IDP §5.3 — per-domain baseline ACLs (role → access)
const ACL_TABLE: Record<string, Acl[]> = {
  Customers: [
    { role: "RM", access: "read" }, { role: "BranchManager", access: "read" }, { role: "Compliance", access: "read" },
    { role: "DMSOperator", access: "write" }, { role: "ComplianceManager", access: "delete" },
  ],
  Operations: [
    { role: "BranchManager", access: "read" }, { role: "InitiatingOfficer", access: "write" }, { role: "Supervisor", access: "delete" },
  ],
  Compliance: [
    { role: "ComplianceOfficer", access: "read" }, { role: "Audit", access: "read" },
    { role: "ComplianceOfficer", access: "write" }, { role: "CISO", access: "delete" },
  ],
  Legal: [
    { role: "Legal", access: "read" }, { role: "BoardSecretary", access: "read" },
    { role: "Legal", access: "write" }, { role: "CEO", access: "delete" },
  ],
  IT: [
    { role: "CISO", access: "read" }, { role: "InternalAudit", access: "read" }, { role: "SYSTEM", access: "write" },
  ],
  General: [
    { role: "BranchStaff", access: "read" }, { role: "InitiatingOfficer", access: "write" }, { role: "Supervisor", access: "delete" },
  ],
  _Review: [
    { role: "DMSAdmin", access: "read" }, { role: "Supervisor", access: "read" }, { role: "DMSAdmin", access: "write" }, { role: "DMSAdmin", access: "delete" },
  ],
};

export function defaultAcls(domain: string): Acl[] {
  return ACL_TABLE[domain] ?? ACL_TABLE.General;
}
