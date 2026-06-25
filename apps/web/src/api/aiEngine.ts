/**
 * Typed API client for the ZorDMS AI / IDP service.
 * All requests go to /svc/ai (proxied to http://localhost:8000).
 *
 * Transport conventions:
 *  - JSON endpoints  (GET, and POST with JSON body): use the `http` helper.
 *  - Multipart upload endpoints (file uploads, claim, resolve): use `postFormData`.
 *    These hit FastAPI Form() parameters and MUST be sent as multipart/form-data.
 *    Do NOT accidentally call http.post() for any endpoint listed under postFormData.
 */
import { http, SVC } from "./http.js";
import { getToken } from "./client.js";

const AI = SVC.ai;

/* ─── Shared types ─── */

export interface ClassifyResult {
  doc_type: string;
  confidence: number;
  signals: string[];
}

export interface DecisionInfo {
  band: string;
  action: string;
  proceed_to_extract: boolean;
  review_required: boolean;
  sla_hours: number | null;
  catalog_assignment: string;
}

export interface CatalogHandoff {
  doc_id: string;
  doc_type: string;
  confidence: number;
  catalog_assignment: string;
  review_required: boolean;
  metadata: Record<string, unknown> | null;
}

export interface ProcessResult {
  handoff: CatalogHandoff;
  decision: DecisionInfo;
  review_item_id: string | null;
}

export interface ReviewRow {
  id: string;
  doc_id: string;
  doc_type: string;
  confidence: number;
  band: string;
  sla_hours: number | null;
  sla_deadline: string | null;
  status: "PENDING" | "CLAIMED" | "RESOLVED";
  claimed_by?: string | null;
  resolution?: string | null;
}

export interface AiHealthStatus {
  status: string;
  service: string;
  mode: string;
}

export interface AiStats {
  queue_size: number;
  processed_today: number;
  avg_confidence: number;
  manual_review_count: number;
  throughput_per_hour: number;
  avg_processing_ms: number;
  classifier_p95_ms: number;
  extractor_p95_ms: number;
}

/* ─── Multipart helper ─── */

async function postFormData<T>(url: string, fd: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { method: "POST", headers, body: fd });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
  }
  return res.json() as Promise<T>;
}

/* ─── IDP upload endpoints ─── */

export async function classifyDoc(file: File, ocrText = ""): Promise<ClassifyResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("ocr_text", ocrText);
  return postFormData<ClassifyResult>(`${AI}/idp/classify`, fd);
}

export async function extractDoc(file: File, docType: string): Promise<{
  doc_type: string;
  valid: boolean;
  review_flag: boolean;
  data: Record<string, unknown> | null;
  partial: Record<string, unknown> | null;
  errors: string[];
}> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("doc_type", docType);
  return postFormData(`${AI}/idp/extract`, fd);
}

export async function processDoc(file: File, docId: string, ocrText = ""): Promise<ProcessResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("doc_id", docId);
  if (ocrText) fd.append("ocr_text", ocrText);
  return postFormData<ProcessResult>(`${AI}/idp/process`, fd);
}

export async function ocrDoc(file: File): Promise<{ engine: string; text: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return postFormData(`${AI}/ocr`, fd);
}

/* ─── Review queue endpoints ─── */

/** @deprecated Use listAllReviews() — this only returns PENDING items from the backend. */
export async function listPendingReviews(): Promise<ReviewRow[]> {
  return http.get<ReviewRow[]>(`${AI}/idp/review/pending`);
}

/**
 * Fetch review items across all statuses (PENDING, CLAIMED, RESOLVED).
 * Calls GET /idp/review/items?status=ALL when available; falls back to
 * /idp/review/pending for backward compatibility with older API deployments
 * that only expose the pending endpoint.
 */
export async function listAllReviews(): Promise<ReviewRow[]> {
  try {
    return await http.get<ReviewRow[]>(`${AI}/idp/review/items?status=ALL`);
  } catch {
    // Older deployments: fall back to pending-only endpoint.
    return http.get<ReviewRow[]>(`${AI}/idp/review/pending`);
  }
}

/* ─── Throughput series type ─── */

export interface ThroughputPoint {
  time: string;
  pages: number;
}

/**
 * Derive an hourly throughput series from the AiStats aggregate.
 * The backend `/stats` endpoint returns throughput_per_hour (current rolling
 * average). We project a plausible 8-hour window by distributing the daily
 * processed count across hours with a realistic intra-day curve.
 *
 * This function is intentionally pure so it can be unit-tested without I/O.
 */
export function derivethroughputSeries(stats: AiStats): ThroughputPoint[] {
  // Realistic intra-day load factors (0 = 08:00 … 7 = 15:00)
  const factors = [0.62, 0.85, 0.91, 1.00, 0.82, 0.78, 1.05, 0.97];
  const base = stats.throughput_per_hour;
  const now = new Date();
  return factors.map((f, i) => {
    const h = new Date(now);
    h.setHours(8 + i, 0, 0, 0);
    return {
      time: h.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      pages: Math.round(base * f),
    };
  });
}

export async function getAiStats(): Promise<AiStats> {
  return http.get<AiStats>(`${AI}/stats`);
}

export async function claimReview(id: string, userId: string): Promise<ReviewRow> {
  const fd = new FormData();
  fd.append("user_id", userId);
  return postFormData<ReviewRow>(`${AI}/idp/review/${id}/claim`, fd);
}

export async function resolveReview(id: string, resolution: string): Promise<ReviewRow> {
  const fd = new FormData();
  fd.append("resolution", resolution);
  return postFormData<ReviewRow>(`${AI}/idp/review/${id}/resolve`, fd);
}

/* ─── Health / stats ─── */

export async function getAiHealth(): Promise<AiHealthStatus> {
  return http.get<AiHealthStatus>(`${AI}/health`);
}

/* ─── Confidence band logic (mirrors IDP §6.4) ─── */

export type BandTone = "green" | "teal" | "amber" | "orange" | "red";

export interface ConfidenceBand {
  label: string;
  shortLabel: string;
  tone: BandTone;
  action: string;
}

export function bandFor(confidence: number): ConfidenceBand {
  if (confidence >= 0.92)
    return { label: "Auto-Approve (≥ 92%)", shortLabel: "Auto-Approve", tone: "green", action: "AUTO_APPROVE" };
  if (confidence >= 0.85)
    return { label: "Auto-Verified (85–91%)", shortLabel: "Auto-Verified", tone: "teal", action: "AUTO_VERIFIED" };
  if (confidence >= 0.70)
    return { label: "Supervisor Review (70–84%)", shortLabel: "Supervisor", tone: "amber", action: "SUPERVISOR_REVIEW" };
  if (confidence >= 0.50)
    return { label: "Human Review (50–69%)", shortLabel: "Human Review", tone: "orange", action: "HUMAN_REVIEW" };
  return { label: "Reject (< 50%)", shortLabel: "Reject", tone: "red", action: "REJECT" };
}
