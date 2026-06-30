/**
 * flowsApi.ts — system-flow lanes (SC-07) client. GET /flows (core).
 */
import { http, SVC } from "./http.js";

export interface FlowNode { id: string; label: string; detail: string }
export interface FlowLane { lane: string; label: string; description: string; nodes: FlowNode[] }

export async function listFlows(): Promise<FlowLane[]> {
  return (await http.get<{ lanes: FlowLane[] }>(`${SVC.core}/flows`)).lanes ?? [];
}

export const flowsApi = { listFlows };
