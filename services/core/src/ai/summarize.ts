/**
 * Document summary builder.
 *
 * Produces a concise, plain-language summary of a document from its classified
 * type and extracted metadata. This is deterministic (no external dependency)
 * so it always works; when the Python AI service is available a richer
 * vision-based summary could replace it, but the heuristic is a reliable
 * baseline surfaced in indexing / discovery.
 */

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface SummaryInput {
  docType?: string | null;
  category?: string | null;
  branch?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
}

/** The metadata keys most worth mentioning, in priority order. */
const HIGHLIGHT_KEYS = [
  "full_name", "applicant_name", "customer_name", "name",
  "cid", "cid_no", "applicant_cid", "account_no", "acct_no",
  "loan_type", "loan_amount", "amount", "amount_btu",
  "issue_date", "expiry_date", "submission_date", "application_date", "date",
  "doc_no", "reference", "invoice_number",
];

export function buildSummary(input: SummaryInput): string {
  const meta = input.metadata ?? {};
  const typeLabel = input.docType ? titleCase(input.docType) : "document";
  const parts: string[] = [];

  let lead = `This is a ${typeLabel}`;
  if (input.category) lead += ` (${input.category})`;
  if (input.branch) lead += ` from ${input.branch}`;
  lead += ".";
  parts.push(lead);

  // Pull the most meaningful extracted fields.
  const seen = new Set<string>();
  const highlights: string[] = [];
  for (const key of HIGHLIGHT_KEYS) {
    if (seen.has(key)) continue;
    const v = meta[key];
    if (v != null && String(v).trim() !== "") {
      highlights.push(`${titleCase(key)}: ${String(v)}`);
      seen.add(key);
    }
    if (highlights.length >= 5) break;
  }
  if (highlights.length) {
    parts.push(`Key details — ${highlights.join("; ")}.`);
  } else {
    const keys = Object.keys(meta).filter((k) => meta[k] != null && String(meta[k]).trim() !== "");
    if (keys.length) parts.push(`Captured ${keys.length} metadata field(s).`);
  }

  if (typeof input.confidence === "number") {
    const pct = Math.round(input.confidence * 100);
    parts.push(`AI classification confidence ${pct}%.`);
  }

  return parts.join(" ");
}
