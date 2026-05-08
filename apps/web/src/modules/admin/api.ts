import { z } from 'zod';
import { get, post, put } from '@/lib/http';
import { OkSchema } from '@/lib/schemas';

export const AdminHealthSchema = z.object({
  node: z.object({
    ok: z.boolean(),
    uptime_seconds: z.number().int(),
    node_version: z.string(),
    memory_mb: z.number().int(),
  }),
  python: z.object({
    ok: z.boolean(),
    status: z.number().int().optional(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }).passthrough(),
  storage: z.object({
    db_bytes: z.number().int(),
    uploads_bytes: z.number().int(),
  }),
  counts: z.object({
    users: z.number().int(),
    documents: z.number().int(),
    workflows: z.number().int(),
    alerts: z.number().int(),
  }),
});
export type AdminHealth = z.infer<typeof AdminHealthSchema>;

export const AuditRowSchema = z.object({
  id: z.number().int(),
  action: z.string().nullable(),
  entity: z.string().nullable(),
  entity_id: z.number().int().nullable(),
  details: z.string().nullable(),
  created_at: z.string(),
  username: z.string().nullable(),
  role: z.string().nullable(),
});
export type AuditRow = z.infer<typeof AuditRowSchema>;

export const fetchAdminHealth = () => get('/spa/api/admin/health', AdminHealthSchema);
export const fetchAuditLog = (limit = 100) =>
  get('/spa/api/admin/audit-log', z.array(AuditRowSchema), { limit });

export const RetentionResultSchema = z.object({
  ok: z.literal(true),
  policies: z.number().int(),
});
export const triggerRetention = () =>
  post('/spa/api/admin/retention/trigger', {}, RetentionResultSchema);

export const ReindexResultSchema = z.object({
  total:   z.number().int(),
  ok:      z.number().int(),
  failed:  z.number().int(),
  skipped: z.number().int(),
  errors:  z.array(z.object({ id: z.number().int(), reason: z.string() })),
});
export type ReindexResult = z.infer<typeof ReindexResultSchema>;

export const reindexAllDocBrain = () =>
  post('/spa/api/admin/docbrain/reindex-all', {}, ReindexResultSchema);

// ── Dedup settings ─────────────────────────────────────────────────────────────

export const DedupSettingsSchema = z.object({
  fuzzy_threshold: z.number().min(0).max(100),
  phash_distance: z.number().min(0).max(64),
  updated_at: z.string(),
  updated_by: z.string(),
});
export type DedupSettings = z.infer<typeof DedupSettingsSchema>;

export const DedupSettingsInputSchema = z.object({
  fuzzy_threshold: z.number().min(0).max(100),
  phash_distance: z.number().min(0).max(64),
});
export type DedupSettingsInput = z.infer<typeof DedupSettingsInputSchema>;

export const DedupDecisionSchema = z.object({
  id: z.number().int(),
  doc_id: z.number().int(),
  matched_doc_id: z.number().int(),
  score: z.number(),
  decision: z.string(),
  created_at: z.string(),
});
export type DedupDecision = z.infer<typeof DedupDecisionSchema>;

export const fetchDedupSettings = () =>
  get('/spa/api/admin/dedup-settings', DedupSettingsSchema);

export const updateDedupSettings = (body: DedupSettingsInput) =>
  put('/spa/api/admin/dedup-settings', DedupSettingsInputSchema.parse(body), DedupSettingsSchema);

export const fetchDedupDecisions = () =>
  get('/spa/api/admin/dedup-decisions', z.array(DedupDecisionSchema));

export { OkSchema };
