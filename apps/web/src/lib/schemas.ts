import { z } from 'zod';

export const RoleSchema = z.enum(['Doc Admin', 'Maker', 'Checker', 'Viewer']);
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  full_name: z.string().nullable(),
  role: RoleSchema,
  branch: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const DocStatusSchema = z.enum(['Valid', 'Expiring', 'Expired', 'Archived', 'Pending']);

export const DocumentSchema = z.object({
  id: z.number().int(),
  filename: z.string(),
  original_name: z.string().nullable(),
  doc_type: z.string().nullable(),
  customer_cid: z.string().nullable(),
  customer_name: z.string().nullable(),
  doc_number: z.string().nullable(),
  expiry_date: z.string().nullable(),
  branch: z.string().nullable(),
  folder_id: z.number().int().nullable(),
  status: z.string(),
  version: z.string().nullable(),
  size: z.number().int().nullable(),
  mime_type: z.string().nullable(),
  ocr_confidence: z.number().nullable(),
  uploaded_at: z.string(),
});
export type DocumentRow = z.infer<typeof DocumentSchema>;

export const FolderSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  parent_id: z.number().int().nullable(),
});
export type Folder = z.infer<typeof FolderSchema>;

export const WorkflowSchema = z.object({
  id: z.number().int(),
  ref_code: z.string().nullable(),
  title: z.string().nullable(),
  doc_id: z.number().int().nullable(),
  stage: z.string(),
  priority: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const AlertLevelSchema = z.enum(['critical', 'warning', 'info', 'success']);
export const AlertSchema = z.object({
  id: z.number().int(),
  level: AlertLevelSchema,
  title: z.string(),
  meta: z.string().nullable(),
  is_read: z.number().int(),
  created_at: z.string(),
});
export type Alert = z.infer<typeof AlertSchema>;

export const StatsSchema = z.object({
  total: z.number().int(),
  expired: z.number().int(),
  expiring: z.number().int(),
  pending_workflows: z.number().int(),
  valid: z.number().int(),
  unread_alerts: z.number().int(),
});
export type Stats = z.infer<typeof StatsSchema>;

export const OkSchema = z.object({ ok: z.literal(true) });

export const LoginResponseSchema = z.object({
  ok: z.literal(true),
  user: UserSchema,
});
