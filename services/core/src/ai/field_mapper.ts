/**
 * AI Field Mapper
 *
 * Translates AI-extracted key-value pairs onto the document's structured columns
 * (cid, doc_no, metadata/index fields) and returns a "mappedFields" summary for the response.
 */

export interface MappedDocumentFields {
  cid?: string;
  doc_no?: string;
  /** Full metadata object to store as JSON */
  metadata: Record<string, unknown>;
  /** Human-readable summary of what was mapped */
  mappedKeys: string[];
}

/** Normalises common aliases from AI output into canonical column names */
export function mapExtractedToDocument(
  docType: string,
  aiData: Record<string, unknown> | null,
): MappedDocumentFields {
  if (!aiData) return { metadata: {}, mappedKeys: [] };

  const meta: Record<string, unknown> = { ...aiData };
  const mappedKeys: string[] = [];
  let cid: string | undefined;
  let doc_no: string | undefined;

  // ── CID extraction ─────────────────────────────────────────────────────────
  const cidValue = aiData["cid_no"] ?? aiData["cid"] ?? aiData["applicant_cid"] ?? aiData["cid_number"];
  if (cidValue && typeof cidValue === "string") {
    cid = cidValue;
    mappedKeys.push("cid");
  }

  // ── doc_no extraction ──────────────────────────────────────────────────────
  const docNoCandidate = (() => {
    switch (docType) {
      case "BT_PASSPORT":
      case "FOREIGN_PASSPORT":
        return aiData["passport_no"] ?? aiData["document_no"];
      case "BT_CID_4G":
      case "BT_CITIZENSHIP":
        return aiData["cid_no"] ?? aiData["cid"];
      case "BOB_LOAN_APPLICATION":
        return aiData["application_no"];
      case "BOB_ACCOUNT_FORM":
        return aiData["account_no"];
      case "IN_PAN":
        return aiData["pan_no"] ?? aiData["pan"];
      case "IN_AADHAAR":
        return aiData["aadhaar_no"] ?? aiData["uid"];
      default:
        return aiData["doc_no"] ?? aiData["ref_no"] ?? aiData["document_no"] ?? aiData["application_no"];
    }
  })();

  if (docNoCandidate && typeof docNoCandidate === "string") {
    doc_no = docNoCandidate;
    mappedKeys.push("doc_no");
  }

  // ── Normalize common date fields to ISO-8601 ───────────────────────────────
  const dateFields = ["dob", "issue_date", "expiry_date", "submission_date", "filing_date"];
  for (const f of dateFields) {
    if (aiData[f] && typeof aiData[f] === "string") {
      mappedKeys.push(f);
    }
  }

  // ── Track other mapped fields ──────────────────────────────────────────────
  const nameFields = ["full_name", "surname", "given_names", "applicant_name", "staff_name"];
  for (const f of nameFields) {
    if (aiData[f]) mappedKeys.push(f);
  }

  return { cid, doc_no, metadata: meta, mappedKeys };
}
