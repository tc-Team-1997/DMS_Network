/**
 * Email-template admin API — talks to /svc/notify (proxy -> :4003).
 * Admins (email_template:manage) curate formatted HTML emails with {{merge tags}}.
 */
import { http, SVC } from "./http.js";

const BASE = SVC.notify;

export interface EmailTemplate {
  id: string;
  key: string;
  name: string;
  category?: string | null;
  description?: string | null;
  subject_template: string;
  html_body_template: string;
  text_body_template?: string | null;
  enabled: boolean;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CreateEmailTemplatePayload {
  key: string;
  name: string;
  category?: string | null;
  description?: string | null;
  subjectTemplate: string;
  htmlBodyTemplate: string;
  textBodyTemplate?: string | null;
  enabled?: boolean;
}

export type UpdateEmailTemplatePayload = Partial<Omit<CreateEmailTemplatePayload, "key">>;

export interface MergeTag { tag: string; label: string; example: string; }

export interface RenderedEmail { subject: string; html: string; text: string; }

export const emailTemplatesApi = {
  list: () => http.get<{ templates: EmailTemplate[] }>(`${BASE}/templates`),

  tags: () => http.get<{ tags: MergeTag[] }>(`${BASE}/templates/tags`),

  create: (payload: CreateEmailTemplatePayload) =>
    http.post<{ id: string }>(`${BASE}/templates`, payload),

  update: (id: string, payload: UpdateEmailTemplatePayload) =>
    http.patch<{ ok: boolean }>(`${BASE}/templates/${id}`, payload),

  remove: (id: string) => http.delete<{ ok: boolean }>(`${BASE}/templates/${id}`),

  preview: (id: string, context?: Record<string, unknown>) =>
    http.post<{ rendered: RenderedEmail }>(`${BASE}/templates/${id}/preview`, { context }),

  testSend: (id: string, to: string, context?: Record<string, unknown>) =>
    http.post<{ ok: boolean; sentTo: string; providerId?: string }>(`${BASE}/templates/${id}/test-send`, { to, context }),
};
