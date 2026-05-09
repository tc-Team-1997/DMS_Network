/**
 * Zod schemas for the Templates Designer feature (Wave B, Migration 0033).
 *
 * Covers:
 *  - BPMN canvas (nodes + edges)
 *  - DMN decision table
 *  - Per-stage SLA config
 *  - Business calendar
 *  - Template version
 *  - Simulation events
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Canvas node types
// ---------------------------------------------------------------------------

export const CanvasNodeTypeSchema = z.enum([
  'stage',          // Rounded rect — standard approval stage
  'decision',       // Diamond — DMN gateway
  'parallel-split', // Gateway with + (fork)
  'parallel-join',  // Gateway with + (converge)
  'edd-case',       // Double-stroke rect — Enhanced Due Diligence
  'start',          // Circle start event
  'end',            // Circle end event
]);
export type CanvasNodeType = z.infer<typeof CanvasNodeTypeSchema>;

export const CanvasNodeSchema = z.object({
  id:    z.string().min(1),
  type:  CanvasNodeTypeSchema,
  label: z.string(),
  /** Role assigned to this stage (for stage + edd-case nodes) */
  role:  z.string().optional(),
  /** DMN table id to evaluate at this decision node */
  dmn_table_id: z.string().optional(),
  x:     z.number(),
  y:     z.number(),
});
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

export const EdgeSchema = z.object({
  id:    z.string().min(1),
  from:  z.string().min(1),
  to:    z.string().min(1),
  /** Optional label shown on edge (e.g. "Yes", "No", "High risk") */
  label: z.string().optional(),
  /** DMN output value that triggers this edge (for decision nodes) */
  condition: z.string().optional(),
});
export type Edge = z.infer<typeof EdgeSchema>;

export const CanvasDataSchema = z.object({
  nodes: z.array(CanvasNodeSchema),
  edges: z.array(EdgeSchema),
});
export type CanvasData = z.infer<typeof CanvasDataSchema>;

// ---------------------------------------------------------------------------
// DMN decision table
// ---------------------------------------------------------------------------

/** A single condition in a DMN rule: equality or numeric comparison */
export const DmnConditionSchema = z.union([
  z.string(),
  z.number(),
  z.object({
    gt:  z.number().optional(),
    gte: z.number().optional(),
    lt:  z.number().optional(),
    lte: z.number().optional(),
    eq:  z.union([z.string(), z.number()]).optional(),
    neq: z.union([z.string(), z.number()]).optional(),
    in:  z.array(z.union([z.string(), z.number()])).optional(),
  }),
]);
export type DmnCondition = z.infer<typeof DmnConditionSchema>;

export const DmnRuleSchema = z.object({
  /** Map of input variable name to condition value/object. Empty = catch-all. */
  conditions: z.record(z.string(), DmnConditionSchema),
  /** Output: the stage label to route to */
  output:     z.string(),
  /** Optional annotation shown in the UI */
  annotation: z.string().optional(),
});
export type DmnRule = z.infer<typeof DmnRuleSchema>;

export const DmnTableSchema = z.object({
  id:     z.string().min(1),
  name:   z.string(),
  inputs: z.array(z.string()),
  rules:  z.array(DmnRuleSchema),
});
export type DmnTable = z.infer<typeof DmnTableSchema>;

export const DmnMapSchema = z.record(z.string(), DmnTableSchema);
export type DmnMap = z.infer<typeof DmnMapSchema>;

// ---------------------------------------------------------------------------
// SLA config — keyed by node id
// ---------------------------------------------------------------------------

export const SlaEntrySchema = z.object({
  /** Node ID this SLA applies to */
  node_id:     z.string(),
  sla_hours:   z.number().positive(),
  /** Optional override calendar ID for this stage */
  calendar_id: z.number().int().optional(),
});
export type SlaEntry = z.infer<typeof SlaEntrySchema>;

export const SlaMapSchema = z.record(z.string(), SlaEntrySchema);
export type SlaMap = z.infer<typeof SlaMapSchema>;

// ---------------------------------------------------------------------------
// Business calendar
// ---------------------------------------------------------------------------

export const BusinessHoursSchema = z.object({
  /** ISO weekday numbers: 1=Mon … 7=Sun */
  days:  z.array(z.number().int().min(1).max(7)),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end:   z.string().regex(/^\d{2}:\d{2}$/),
  tz:    z.string(),
});
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

export const BusinessCalendarSchema = z.object({
  id:                  z.number().int(),
  tenant_id:           z.string(),
  name:                z.string(),
  holidays_json:       z.array(z.string()),
  business_hours_json: BusinessHoursSchema,
  created_by:          z.number().int().nullable(),
  created_at:          z.string(),
});
export type BusinessCalendar = z.infer<typeof BusinessCalendarSchema>;

export const BusinessCalendarInputSchema = z.object({
  name:                z.string().min(1).max(200),
  holidays_json:       z.array(z.string()).optional(),
  business_hours_json: BusinessHoursSchema.optional(),
});
export type BusinessCalendarInput = z.infer<typeof BusinessCalendarInputSchema>;

// ---------------------------------------------------------------------------
// Template version
// ---------------------------------------------------------------------------

export const TemplateVersionStatusSchema = z.enum(['draft', 'published', 'archived']);
export type TemplateVersionStatus = z.infer<typeof TemplateVersionStatusSchema>;

export const TemplateVersionSchema = z.object({
  id:          z.number().int(),
  template_id: z.number().int(),
  version:     z.number().int(),
  bpmn_json:   CanvasDataSchema,
  dmn_json:    DmnMapSchema,
  sla_json:    SlaMapSchema,
  calendar_id: z.number().int().nullable(),
  created_by:  z.number().int().nullable(),
  status:      TemplateVersionStatusSchema,
  created_at:  z.string(),
});
export type TemplateVersion = z.infer<typeof TemplateVersionSchema>;

export const CreateVersionBodySchema = z.object({
  copy_from_version_id: z.number().int().optional(),
});
export type CreateVersionBody = z.infer<typeof CreateVersionBodySchema>;

export const PatchVersionBodySchema = z.object({
  bpmn_json:   CanvasDataSchema.optional(),
  dmn_json:    DmnMapSchema.optional(),
  sla_json:    SlaMapSchema.optional(),
  calendar_id: z.number().int().nullable().optional(),
});
export type PatchVersionBody = z.infer<typeof PatchVersionBodySchema>;

export const PublishVersionBodySchema = z.object({
  reason: z.string().min(20, 'Reason must be at least 20 characters'),
});
export type PublishVersionBody = z.infer<typeof PublishVersionBodySchema>;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export const SimulationEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('enter'),       nodeId: z.string(), nodeLabel: z.string() }),
  z.object({
    kind:         z.literal('decision'),
    nodeId:       z.string(),
    tableId:      z.string(),
    facts:        z.record(z.string(), z.unknown()),
    matchedRule:  z.number().int(),
    output:       z.string(),
  }),
  z.object({
    kind:         z.literal('sla-check'),
    nodeId:       z.string(),
    slaHours:     z.number(),
    calendarId:   z.number().int().nullable(),
  }),
  z.object({ kind: z.literal('parallel-fork'), nodeId: z.string(), branches: z.array(z.string()) }),
  z.object({ kind: z.literal('end') }),
  z.object({ kind: z.literal('error'),         message: z.string() }),
]);
export type SimulationEvent = z.infer<typeof SimulationEventSchema>;

export const SimulationInputSchema = z.object({
  facts: z.record(z.string(), z.unknown()),
});
export type SimulationInput = z.infer<typeof SimulationInputSchema>;

// ---------------------------------------------------------------------------
// Version diff
// ---------------------------------------------------------------------------

export type DiffKind = 'added' | 'removed' | 'modified' | 'unchanged';

export interface NodeDiff {
  node:    CanvasNode;
  kind:    DiffKind;
}
export interface EdgeDiff {
  edge:    Edge;
  kind:    DiffKind;
}
export interface CanvasDiff {
  nodes:   NodeDiff[];
  edges:   EdgeDiff[];
}
