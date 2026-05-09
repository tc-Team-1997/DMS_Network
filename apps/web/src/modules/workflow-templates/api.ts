/**
 * API layer for the Templates Designer feature (Wave B, Migration 0033).
 *
 * All requests go through src/lib/http.ts with zod schemas.
 * Existing endpoints (fetchTemplates, fetchTemplate, createTemplate,
 * patchTemplate, cloneTemplate, deleteTemplate) are preserved unchanged
 * so existing Playwright tests remain green.
 */

import { z } from 'zod';
import { get, post, patch, del, http } from '@/lib/http';
import { OkSchema } from '@/lib/schemas';
import {
  BusinessCalendarInputSchema,
  BusinessCalendarSchema,
  CanvasDataSchema,
  CreateVersionBodySchema,
  DmnMapSchema,
  PatchVersionBodySchema,
  PublishVersionBodySchema,
  SlaMapSchema,
  TemplateVersionSchema,
  type BusinessCalendar,
  type BusinessCalendarInput,
  type CreateVersionBody,
  type TemplateVersion,
} from './schemas';

// ---------------------------------------------------------------------------
// Re-export types that TemplatesPage.tsx still uses
// ---------------------------------------------------------------------------

export const StageSchema = z.object({
  id:   z.number().int().optional(),
  name: z.string().min(1),
  role: z.string().min(1),
});
export type Stage = z.infer<typeof StageSchema>;

export const TemplateSchema = z.object({
  id:                 z.number().int(),
  name:               z.string(),
  doc_type:           z.string().nullable(),
  active:             z.number().int(),
  steps:              z.array(StageSchema),
  created_at:         z.string(),
  current_version_id: z.number().int().nullable().optional(),
});
export type Template = z.infer<typeof TemplateSchema>;

export const TemplateInputSchema = z.object({
  name:    z.string().min(1).max(200),
  doc_type: z.string().max(100).nullable().optional(),
  steps:   z.array(z.object({
    name: z.string().min(1).max(100),
    role: z.string().min(1).max(50),
  })).min(1).max(20),
});
export type TemplateInput = z.infer<typeof TemplateInputSchema>;

// ---------------------------------------------------------------------------
// Existing template CRUD (unchanged API surface)
// ---------------------------------------------------------------------------

export const fetchTemplates = (): Promise<Template[]> =>
  get('/spa/api/workflow-templates', z.array(TemplateSchema));

export const fetchTemplate = (id: number): Promise<Template> =>
  get(`/spa/api/workflow-templates/${id}`, TemplateSchema);

export const createTemplate = (body: TemplateInput): Promise<Template> =>
  post('/spa/api/workflow-templates', TemplateInputSchema.parse(body), TemplateSchema);

export const patchTemplate = async (
  id: number,
  body: Partial<TemplateInput> & { active?: 0 | 1 },
): Promise<Template> => {
  const { data } = await http.patch(`/spa/api/workflow-templates/${id}`, body);
  return TemplateSchema.parse(data);
};

export const cloneTemplate = (id: number): Promise<Template> =>
  post(`/spa/api/workflow-templates/${id}/clone`, {}, TemplateSchema);

export const deleteTemplate = (id: number) =>
  del(`/spa/api/workflow-templates/${id}`, OkSchema);

// ---------------------------------------------------------------------------
// Template versions (Migration 0033)
// ---------------------------------------------------------------------------

export const fetchTemplateVersions = (templateId: number): Promise<TemplateVersion[]> =>
  get(`/spa/api/workflow-templates/${templateId}/versions`, z.array(TemplateVersionSchema));

export const fetchTemplateVersion = (templateId: number, versionId: number): Promise<TemplateVersion> =>
  get(`/spa/api/workflow-templates/${templateId}/versions/${versionId}`, TemplateVersionSchema);

export const createTemplateVersion = (
  templateId: number,
  body: CreateVersionBody = {},
): Promise<TemplateVersion> =>
  post(
    `/spa/api/workflow-templates/${templateId}/versions`,
    CreateVersionBodySchema.parse(body),
    TemplateVersionSchema,
  );

export const updateTemplateVersion = (
  templateId: number,
  versionId:  number,
  body:       z.infer<typeof PatchVersionBodySchema>,
): Promise<TemplateVersion> =>
  patch(
    `/spa/api/workflow-templates/${templateId}/versions/${versionId}`,
    PatchVersionBodySchema.parse(body),
    TemplateVersionSchema,
  );

const PublishResultSchema = z.object({
  ok:      z.literal(true),
  version: TemplateVersionSchema,
});

export const publishTemplateVersion = (
  templateId: number,
  versionId:  number,
  body:       z.infer<typeof PublishVersionBodySchema>,
): Promise<{ ok: true; version: TemplateVersion }> =>
  post(
    `/spa/api/workflow-templates/${templateId}/versions/${versionId}/publish`,
    PublishVersionBodySchema.parse(body),
    PublishResultSchema,
  );

// ---------------------------------------------------------------------------
// Business calendars (Migration 0033)
// ---------------------------------------------------------------------------

export const fetchCalendars = (): Promise<BusinessCalendar[]> =>
  get('/spa/api/business-calendars', z.array(BusinessCalendarSchema));

export const createCalendar = (body: BusinessCalendarInput): Promise<BusinessCalendar> =>
  post('/spa/api/business-calendars', BusinessCalendarInputSchema.parse(body), BusinessCalendarSchema);

export const updateCalendar = (
  id:   number,
  body: Partial<BusinessCalendarInput>,
): Promise<BusinessCalendar> =>
  patch(`/spa/api/business-calendars/${id}`, body, BusinessCalendarSchema);

// ---------------------------------------------------------------------------
// Version canvas/dmn/sla save helpers
// ---------------------------------------------------------------------------

export const saveCanvas = (
  templateId: number,
  versionId:  number,
  canvas:     z.infer<typeof CanvasDataSchema>,
) =>
  updateTemplateVersion(templateId, versionId, {
    bpmn_json: CanvasDataSchema.parse(canvas),
  });

export const saveDmn = (
  templateId: number,
  versionId:  number,
  dmnMap:     z.infer<typeof DmnMapSchema>,
) =>
  updateTemplateVersion(templateId, versionId, {
    dmn_json: DmnMapSchema.parse(dmnMap),
  });

export const saveSla = (
  templateId: number,
  versionId:  number,
  slaMap:     z.infer<typeof SlaMapSchema>,
) =>
  updateTemplateVersion(templateId, versionId, {
    sla_json: SlaMapSchema.parse(slaMap),
  });
