/**
 * P8: Job-type → handler registry.
 *
 * A handler receives the decoded job payload + CoreDeps and returns a result
 * (JSON-serializable) on success or throws on failure (→ retry / dead-letter).
 */
import type { CoreDeps } from "../deps.js";
import { runExtraction } from "../extraction/run.js";

export type JobHandler = (payload: any, deps: CoreDeps) => Promise<unknown>;

/** Idempotency key for an extract job: one in-flight extraction per document. */
export function extractIdempotencyKey(docId: string): string {
  return `extract:${docId}`;
}

export interface ExtractJobPayload {
  docId: string;
  bearer?: string;
  callerUsername?: string;
}

/** Runs the EXISTING extraction pipeline (shared with the sync route). */
export const extractHandler: JobHandler = async (payload: ExtractJobPayload, deps) => {
  const outcome = await runExtraction(deps, payload.docId, {
    bearer: payload.bearer ?? "",
    callerUsername: payload.callerUsername ?? "system",
    viewer: { canCrossBranch: true }, // background job runs without a branch scope
  });
  if (!outcome.ok) {
    // not_found / no_version are terminal — throw so the job records the reason.
    throw new Error(`extract_${outcome.reason}`);
  }
  return {
    docId: payload.docId,
    docType: outcome.result.classification.doc_type,
    confidence: outcome.result.classification.confidence,
    reviewFlag: outcome.result.classification.review_flag,
    workflowId: outcome.result.workflow_id,
  };
};

/** Build the default handler registry. */
export function defaultHandlers(): Record<string, JobHandler> {
  return {
    extract: extractHandler,
  };
}
