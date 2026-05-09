import { get, post, put } from '@/lib/http';
import {
  TemplateListSchema,
  TemplateSchema,
  TemplateCreateResponseSchema,
  TemplateUpdateResponseSchema,
  PreflightResultSchema,
  GenerateResponseSchema,
  SubmissionListSchema,
  SubmitResponseSchema,
  type TemplateIn,
  type ReportFormat,
} from './schemas';

const BASE = '/spa/api/reports';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function fetchTemplates(params?: {
  regulator?: string;
  active_only?: boolean;
}) {
  const qs = new URLSearchParams();
  if (params?.regulator) qs.set('regulator', params.regulator);
  if (params?.active_only === false) qs.set('active_only', 'false');
  const query = qs.toString();
  return get(`${BASE}/templates${query ? `?${query}` : ''}`, TemplateListSchema);
}

export function fetchTemplate(id: number) {
  return get(`${BASE}/templates/${id}`, TemplateSchema);
}

export function createTemplate(body: TemplateIn) {
  return post(`${BASE}/templates`, body, TemplateCreateResponseSchema);
}

export function updateTemplate(id: number, body: TemplateIn) {
  return put(`${BASE}/templates/${id}`, body, TemplateUpdateResponseSchema);
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

export function fetchPreflight(templateId: number) {
  return get(`${BASE}/templates/${templateId}/preflight`, PreflightResultSchema);
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export function generateReport(
  templateId: number,
  body: { as_of_date: string; params: Record<string, unknown>; format: ReportFormat },
) {
  return post(`${BASE}/templates/${templateId}/generate`, body, GenerateResponseSchema);
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export function fetchSubmissions(params?: {
  template_id?: number;
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.template_id !== undefined) qs.set('template_id', String(params.template_id));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  if (params?.offset !== undefined) qs.set('offset', String(params.offset));
  const query = qs.toString();
  return get(`${BASE}/submissions${query ? `?${query}` : ''}`, SubmissionListSchema);
}

export function submitToRegulator(receiptId: number) {
  return post(`${BASE}/submissions/${receiptId}/submit`, {}, SubmitResponseSchema);
}
