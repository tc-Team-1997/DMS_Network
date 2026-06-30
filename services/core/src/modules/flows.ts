/**
 * System-flow lane definitions (SC-07). Four interactive lanes the Document
 * Lifecycle screen renders: the document pipeline, the AI processing layer, the
 * maker-checker business workflow, and the integration lifecycle. Config-driven
 * (these are the system's pipeline/flow definitions) — the UI makes nodes
 * clickable for detail.
 */
export interface FlowNode {
  id: string;
  label: string;
  detail: string;
}
export interface FlowLane {
  lane: string;
  label: string;
  description: string;
  nodes: FlowNode[];
}

const LANES: Record<string, FlowLane> = {
  document: {
    lane: "document",
    label: "Document Lifecycle",
    description: "Capture → OCR → classify → extract → validate → approve → archive.",
    nodes: [
      { id: "capture", label: "Capture", detail: "Scanner / upload / bulk / mobile ingest into MinIO; front+back supported." },
      { id: "ocr", label: "OCR", detail: "Server-side OCR (Dzongkha+English) extracts raw text." },
      { id: "classify", label: "Classify", detail: "Vision model assigns a doc type with a confidence score." },
      { id: "extract", label: "Extract", detail: "Guided-JSON field extraction against the doc-type schema." },
      { id: "validate", label: "Validate", detail: "Field + regulatory rules run; failures flag the document." },
      { id: "approve", label: "Approve", detail: "Maker-checker decision; stamp/redact burned into a new version." },
      { id: "archive", label: "Archive", detail: "Retention class applied; legal-hold blocks disposal." },
    ],
  },
  ai: {
    lane: "ai",
    label: "AI Processing Layer",
    description: "Model pipeline with confidence gates routing to auto / review.",
    nodes: [
      { id: "ingest", label: "Ingest", detail: "Document image(s) normalized to pages for the vision model." },
      { id: "vision", label: "Vision classify", detail: "qwen2.5-vl / granite-vision classify + prescreen signals." },
      { id: "guided", label: "Guided extract", detail: "Schema-guided JSON extraction with Pydantic validation." },
      { id: "route", label: "Confidence route", detail: "≥0.92 auto-approve · 0.70–0.91 sampled/supervisor · <0.70 human review." },
      { id: "review", label: "Human review", detail: "Low-confidence items enqueued with an SLA deadline." },
    ],
  },
  workflow: {
    lane: "workflow",
    label: "Business Workflow",
    description: "Maker → Checker → Approver hierarchy (branch → regional → HQ).",
    nodes: [
      { id: "maker", label: "Maker", detail: "Prepares/indexes the document and submits for review." },
      { id: "checker", label: "Checker", detail: "Reviews against authority (/authz/check); approve / reject / escalate." },
      { id: "branch", label: "Branch approver", detail: "Branch-level sign-off within SLA; auto-escalates on breach." },
      { id: "regional", label: "Regional approver", detail: "Regional sign-off for higher-value / cross-branch cases." },
      { id: "hq", label: "HQ approver", detail: "Head-office final approval; resolution closes the case." },
    ],
  },
  integration: {
    lane: "integration",
    label: "Integration Lifecycle",
    description: "Inbound sources (LOS/mBoB/GoBoB) → core → outbound (CBS/CRM) + webhooks.",
    nodes: [
      { id: "in", label: "Inbound (IN)", detail: "LOS, mBoB, GoBoB, e-KYC push documents/data via HMAC-signed webhooks." },
      { id: "ingest", label: "Core ingest", detail: "Verified payloads upsert customers / loan-intakes in core." },
      { id: "process", label: "Process", detail: "Document pipeline runs; events emitted on the bus." },
      { id: "out", label: "Outbound (OUT)", detail: "Validated metadata posted to CBS (BaNCS), CRM, Contact Center." },
      { id: "report", label: "Report (SFTP)", detail: "RMA regulatory reports submitted via the SFTP connector." },
    ],
  },
};

export function listFlowLanes(): FlowLane[] {
  return Object.values(LANES);
}

export function getFlowLane(lane: string): FlowLane | null {
  return LANES[lane] ?? null;
}
