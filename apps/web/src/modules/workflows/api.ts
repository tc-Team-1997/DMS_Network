import { post } from '@/lib/http';
import { get } from '@/lib/http';
import { OkSchema, WorkflowSchema } from '@/lib/schemas';
import { z } from 'zod';

export interface WorkflowFilters {
  stage?: string;
  limit?: number;
}

export const fetchWorkflows = (f: WorkflowFilters = {}) =>
  get('/spa/api/workflows', z.array(WorkflowSchema), f as Record<string, unknown>);

export const WorkflowActionSchema = z.object({
  ok: z.literal(true),
  stage: z.string(),
});
export type WorkflowActionResult = z.infer<typeof WorkflowActionSchema>;

export type WorkflowAction = 'approve' | 'reject' | 'escalate';

export const actOnWorkflow = (id: number, action: WorkflowAction) =>
  post(`/spa/api/workflows/${id}/actions`, { action }, WorkflowActionSchema);

export { OkSchema };
