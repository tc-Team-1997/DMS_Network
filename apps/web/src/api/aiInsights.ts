/**
 * aiInsights.ts — AI-assisted dashboard narration (SC-01) client.
 * POST /idp/insights {metrics} → { narrative, degraded } (AI service).
 */
import { http, SVC } from "./http.js";

export interface InsightsResult { narrative: string; degraded: boolean }

export async function fetchInsights(metrics: Record<string, number>): Promise<InsightsResult> {
  return http.post<InsightsResult>(`${SVC.ai}/idp/insights`, { metrics });
}

export const aiInsightsApi = { fetchInsights };
