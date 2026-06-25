/**
 * New-type suggestion logic
 *
 * If the AI returns a doc_type not in our registry (or confidence is very low),
 * we construct a suggestion object so the UI can offer "Create new doc type".
 */

export interface SuggestedNewType {
  proposedName: string;
  reason: string;
  sampleFields: string[];
}

const VERY_LOW_CONFIDENCE = 0.4;

export function buildNewTypeSuggestion(
  docType: string,
  confidence: number,
  knownCodes: Set<string>,
  aiData: Record<string, unknown> | null,
): SuggestedNewType | null {
  const isUnknown = !knownCodes.has(docType) || docType === "UNKNOWN";
  const isVeryLow = confidence < VERY_LOW_CONFIDENCE;

  if (!isUnknown && !isVeryLow) return null;

  const sampleFields = aiData ? Object.keys(aiData).slice(0, 10) : [];

  if (isUnknown && docType !== "UNKNOWN") {
    return {
      proposedName: docType,
      reason: `AI classified document as "${docType}" which is not in the ZorDMS registry. Add it as a new type to enable schema validation and auto-catalog.`,
      sampleFields,
    };
  }

  if (docType === "UNKNOWN" || isVeryLow) {
    return {
      proposedName: "CUSTOM_DOCUMENT_TYPE",
      reason: `AI confidence (${(confidence * 100).toFixed(0)}%) is too low to classify this document. Human review required. Consider registering a new document type if this is a recurring document class.`,
      sampleFields,
    };
  }

  return null;
}
