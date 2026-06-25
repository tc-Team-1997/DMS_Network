/**
 * ZorDMS AI Copilot API client.
 *
 * Calls POST /svc/ai/idp/copilot/ask (proxied to http://localhost:8000).
 * Uses the shared `http` helper which injects the Bearer token automatically.
 */
import { http, SVC } from "./http.js";

const AI = SVC.ai;

/* ─── Types ─── */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CopilotCitation {
  doc_id: string;
  title: string;
  snippet: string;
}

export type CopilotIntent = "search" | "summarize" | "navigate" | "qa";

export interface CopilotAskRequest {
  question: string;
  history?: ChatTurn[];
}

export interface CopilotAskResponse {
  answer: string;
  citations: CopilotCitation[];
  intent: CopilotIntent;
  model: string;
}

/* ─── API call ─── */

/**
 * Send a question to the RAG copilot endpoint.
 *
 * @param question  The user's question.
 * @param history   Previous conversation turns (optional).
 * @returns         { answer, citations, intent, model }
 */
export async function askCopilot(
  question: string,
  history: ChatTurn[] = [],
): Promise<CopilotAskResponse> {
  return http.post<CopilotAskResponse>(`${AI}/idp/copilot/ask`, {
    question,
    history,
  });
}
