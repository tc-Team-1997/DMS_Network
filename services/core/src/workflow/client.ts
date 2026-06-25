/**
 * ZorDMS Workflow Service Client (Capture→Workflow handoff)
 *
 * Calls the Node Workflow service (services/workflow) over HTTP to create a
 * maker-checker workflow case for a document that has been flagged for review.
 *
 * Base URL is read from WORKFLOW_URL env (default: http://localhost:4002).
 * The caller's Bearer JWT is forwarded so the workflow service's requireAuth +
 * requirePermission("workflow:act") gate passes.
 *
 * Best-effort by design: every helper that throws is caught at the call site in
 * extraction.ts — a workflow outage must NOT fail document extraction.
 */

export interface CreateWorkflowCaseInput {
  /** Document id this review case is about. */
  docId: string;
  /** Human-readable workflow title (usually the document title). */
  title: string;
  /** Document branch — forwarded so the review queue can be branch-scoped. */
  branch?: string;
  /** Classification confidence (0..1) — drives the workflow's manual-review gate. */
  confidence?: number;
  /** Priority hint (Normal/High/Critical). */
  priority?: string;
}

export interface CreatedWorkflow {
  id: string;
  ref_code?: string;
  [k: string]: unknown;
}

function workflowBaseUrl(): string {
  return (process.env["WORKFLOW_URL"] ?? "http://localhost:4002").replace(/\/$/, "");
}

/** Name of the seeded maker-checker template used as the default review workflow. */
export const DEFAULT_REVIEW_TEMPLATE_NAME = "KYC & Account Opening";

async function getJson(url: string, bearer: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearer}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`workflow GET ${url} HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(
  url: string,
  bearer: string,
  payload: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`workflow POST ${url} HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the default maker-checker template id by name.
 * Returns null if the template cannot be found (so the caller can degrade).
 */
export async function resolveDefaultTemplateId(
  bearer: string,
  templateName: string = DEFAULT_REVIEW_TEMPLATE_NAME,
  timeoutMs = 8_000,
): Promise<string | null> {
  const data = (await getJson(`${workflowBaseUrl()}/templates`, bearer, timeoutMs)) as {
    templates?: Array<{ id: string; name: string }>;
  };
  const templates = data.templates ?? [];
  const exact = templates.find((t) => t.name === templateName);
  if (exact) return exact.id;
  // Fallback: any template whose name contains "Account" / "KYC" (maker-checker).
  const fuzzy = templates.find((t) => /kyc|account|maker/i.test(t.name));
  return fuzzy?.id ?? templates[0]?.id ?? null;
}

/**
 * Create a maker-checker workflow case for a flagged document.
 * Throws on any failure (network, non-2xx, missing template) — callers MUST
 * catch and degrade, never let this fail extraction.
 */
export async function createWorkflowCase(
  bearer: string,
  input: CreateWorkflowCaseInput,
  timeoutMs = 8_000,
): Promise<CreatedWorkflow> {
  const templateId = await resolveDefaultTemplateId(bearer, DEFAULT_REVIEW_TEMPLATE_NAME, timeoutMs);
  if (!templateId) throw new Error("no_review_template");

  const data = (await postJson(
    `${workflowBaseUrl()}/workflows`,
    bearer,
    {
      title: input.title,
      doc_id: input.docId,
      template_id: templateId,
      branch: input.branch,
      priority: input.priority ?? "Normal",
      doc_confidence: input.confidence,
    },
    timeoutMs,
  )) as { workflow?: CreatedWorkflow };

  if (!data.workflow?.id) throw new Error("workflow_create_no_id");
  return data.workflow;
}
