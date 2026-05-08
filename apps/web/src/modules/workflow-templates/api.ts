import { z } from 'zod';
import { get, post, del, http } from '@/lib/http';
import { OkSchema } from '@/lib/schemas';

export const StageSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1),
  role: z.string().min(1),
});
export type Stage = z.infer<typeof StageSchema>;

export const TemplateSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  doc_type: z.string().nullable(),
  active: z.number().int(),
  steps: z.array(StageSchema),
  created_at: z.string(),
});
export type Template = z.infer<typeof TemplateSchema>;

export const TemplateInputSchema = z.object({
  name: z.string().min(1).max(200),
  doc_type: z.string().max(100).nullable().optional(),
  steps: z.array(z.object({ name: z.string().min(1).max(100), role: z.string().min(1).max(50) })).min(1).max(20),
});
export type TemplateInput = z.infer<typeof TemplateInputSchema>;

export const fetchTemplates = () =>
  get('/spa/api/workflow-templates', z.array(TemplateSchema));

export const fetchTemplate = (id: number) =>
  get(`/spa/api/workflow-templates/${id}`, TemplateSchema);

export const createTemplate = (body: TemplateInput) =>
  post('/spa/api/workflow-templates', TemplateInputSchema.parse(body), TemplateSchema);

export const patchTemplate = async (
  id: number,
  body: Partial<TemplateInput> & { active?: 0 | 1 },
) => {
  const { data } = await http.patch(`/spa/api/workflow-templates/${id}`, body);
  return TemplateSchema.parse(data);
};

export const cloneTemplate = (id: number) =>
  post(`/spa/api/workflow-templates/${id}/clone`, {}, TemplateSchema);

export const deleteTemplate = (id: number) =>
  del(`/spa/api/workflow-templates/${id}`, OkSchema);
