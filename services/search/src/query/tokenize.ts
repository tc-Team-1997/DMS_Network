import type { SearchDoc } from "../types.js";

export function tokenize(parts: Array<string | undefined | null>): string {
  return parts
    .filter((p): p is string => typeof p === "string")
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9_\--￿]+/g, " ") // keep word chars + unicode (Dzongkha), drop punctuation
    .replace(/\s+/g, " ")
    .trim();
}

export function buildTokensForDoc(doc: SearchDoc): string {
  return tokenize([doc.ocr_text, doc.metadata_text, doc.doc_type]);
}
