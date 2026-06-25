import { Router } from "express";
import type { Knex } from "knex";
import { compileTemplate } from "../engine/compileTemplate.js";
import { writeAudit } from "../audit.js";
import type { EventBus } from "../events.js";
import { requireAuth, requirePermission, asyncHandler } from "@zordms/auth";
import { newId } from "@zordms/db";

const CASE_TYPES = ["KYC", "Loan", "Account", "AML"];

// F15: shared unwrapId removed; using insert-then-refetch (F7) throughout.
// F7: Insert-then-refetch for Oracle compatibility — no .returning("id").
async function insertAndFetch<T extends Record<string, unknown>>(
  knex: Knex,
  table: string,
  row: Record<string, unknown>,
  uniqueCol: string,
  uniqueVal: unknown,
): Promise<T> {
  await knex(table).insert(row);
  const inserted = await knex(table).where({ [uniqueCol]: uniqueVal }).first();
  if (!inserted) throw new Error(`insert_failed:${table}`);
  return inserted as T;
}

async function instantiateWorkflow(
  knex: Knex,
  templateId: string,
  title: string,
  createdByUserId?: string,
  createdByUsername?: string,
): Promise<string | null> {
  const tpl = await knex("workflow_templates").where({ id: templateId }).first();
  if (!tpl) return null;
  const steps = compileTemplate(tpl.steps_json);
  const now = Date.now();
  // F6: count-based ref code — same race-condition caveat; we try/catch at the outer level.
  const count = Number(
    (await knex("workflows").count<{ c: number }[]>("id as c"))[0].c,
  );
  const refCode = `WF-${count + 1}`;
  const wfId = newId();
  // F7: insert-then-refetch
  await insertAndFetch<{ id: string }>(
    knex,
    "workflows",
    {
      id: wfId,
      ref_code: refCode,
      title,
      template_id: templateId,
      stage: steps[0].name,
      priority: "Normal",
      status: "Active",
      created_by: createdByUsername,
      sla_due_at: steps[0].sla_minutes
        ? new Date(now + steps[0].sla_minutes * 60_000).toISOString()
        : null,
    },
    "ref_code",
    refCode,
  );
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await knex("workflow_steps").insert({
      id: newId(),
      workflow_id: wfId,
      seq: i + 1,
      name: s.name,
      required_permissions: JSON.stringify(s.required_permissions),
      min_confidence: s.min_confidence,
      status: "Pending",
      sla_minutes: s.sla_minutes ?? null,
      due_at: s.sla_minutes
        ? new Date(now + s.sla_minutes * 60_000).toISOString()
        : null,
    });
  }
  void createdByUserId; // recorded via actor in audit at the case level
  return wfId;
}

export function casesRouter(): Router {
  const r = Router();

  // NOTE on route ordering (F11): All literal/static paths (/metrics) are
  // registered BEFORE parametric paths (/:id, /:id/...) to prevent accidental
  // capture. Do not insert new /:id routes above the /metrics route.

  // POST /cases — F1: requireAuth + requirePermission("case:create")
  r.post(
    "/",
    requireAuth,
    requirePermission("case:create"),
    asyncHandler(async (req, res) => {
      const { knex, events } = req.app.locals.deps as { knex: Knex; events?: EventBus };
      const body = req.body as {
        case_type: string;
        title: string;
        assigned_to?: string;
        due_at?: string;
        template_id?: string;
        doc_confidence?: number;
        created_by?: string;
      };
      if (!CASE_TYPES.includes(body.case_type)) {
        res.status(400).json({ error: "invalid_case_type" });
        return;
      }
      if (!body.title) {
        res.status(400).json({ error: "title_required" });
        return;
      }

      const typeCount = Number(
        (
          await knex("cases")
            .where({ case_type: body.case_type })
            .count<{ c: number }[]>("id as c")
        )[0].c,
      );
      const caseRef = `CASE-${body.case_type}-${typeCount + 1}`;

      // F2: actor identity from verified JWT
      const actorId = req.authUser?.id;
      const actorUsername = req.authUser?.username;

      let workflowId: string | null = null;
      if (body.template_id) {
        try {
          workflowId = await instantiateWorkflow(
            knex,
            body.template_id,
            body.title,
            actorId,
            actorUsername,
          );
        } catch (e) {
          const msg = String((e as Error).message ?? "");
          if (msg.includes("UNIQUE") || msg.includes("unique")) {
            res.status(409).json({ error: "workflow_ref_conflict" });
            return;
          }
          throw e;
        }
      }

      const caseId = newId();
      // F7: insert-then-refetch
      let created: Record<string, unknown>;
      try {
        created = await insertAndFetch(
          knex,
          "cases",
          {
            id: caseId,
            case_ref: caseRef,
            case_type: body.case_type,
            title: body.title,
            status: "Open",
            assigned_to: body.assigned_to,
            due_at: body.due_at,
            workflow_id: workflowId,
            created_by: actorUsername,
          },
          "case_ref",
          caseRef,
        );
      } catch (e) {
        const msg = String((e as Error).message ?? "");
        if (msg.includes("UNIQUE") || msg.includes("unique")) {
          res.status(409).json({ error: "case_ref_conflict" });
          return;
        }
        throw e;
      }

      await writeAudit(knex, {
        actor_id: actorId,
        actor_username: actorUsername,
        action: "CASE_CREATE",
        entity: "case",
        entity_id: String((created as { id: string }).id),
        details: caseRef,
      });
      await events?.emit("case.created", {
        id: (created as { id: string }).id,
        case_ref: caseRef,
        case_type: body.case_type,
      });

      res.status(201).json({ case: created });
    }),
  );

  // POST /cases/:id/documents — F1: requireAuth + requirePermission("case:manage")
  r.post(
    "/:id/documents",
    requireAuth,
    requirePermission("case:manage"),
    asyncHandler(async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const { doc_id, label } = req.body as { doc_id: string; label?: string };
      if (!doc_id) {
        res.status(400).json({ error: "doc_id_required" });
        return;
      }
      const caseId = req.params.id;
      const exists = await knex("cases").where({ id: caseId }).first();
      if (!exists) {
        res.status(404).json({ error: "case_not_found" });
        return;
      }
      const docId = newId();
      await knex("case_documents").insert({
        id: docId,
        case_id: caseId,
        doc_id,
        label,
      });
      const doc = await knex("case_documents")
        .where({ case_id: caseId, doc_id })
        .orderBy("attached_at", "desc")
        .first();
      res.status(201).json({ document: doc });
    }),
  );

  // GET /cases/metrics — F1: requireAuth
  // IMPORTANT: This static route MUST be registered before /:id to avoid param capture.
  r.get(
    "/metrics",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const all = await knex("cases").select("case_type", "status", "created_at", "resolved_at");
      const total = all.length;
      const open = all.filter((c) => c.status === "Open" || c.status === "InReview").length;
      const resolved = all.filter((c) => c.status === "Resolved").length;
      const by_type: Record<string, number> = {};
      for (const c of all) by_type[c.case_type] = (by_type[c.case_type] ?? 0) + 1;
      const durations = all
        .filter((c) => c.resolved_at && c.created_at)
        .map(
          (c) =>
            (new Date(c.resolved_at).getTime() - new Date(c.created_at).getTime()) / 60_000,
        );
      const avg_resolution_minutes = durations.length
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;
      res.json({ total, open, resolved, by_type, avg_resolution_minutes });
    }),
  );

  // GET /cases — F1: requireAuth
  r.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const cases = await knex("cases").orderBy("created_at", "desc");
      res.json({ cases });
    }),
  );

  // GET /cases/:id — F1: requireAuth
  r.get(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const c = await knex("cases").where({ id: req.params.id }).first();
      if (!c) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const documents = await knex("case_documents").where({ case_id: c.id });
      const workflow = c.workflow_id
        ? await knex("workflows").where({ id: c.workflow_id }).first()
        : null;
      res.json({ case: c, documents, workflow });
    }),
  );

  // POST /cases/:id/resolve — F1: requireAuth + requirePermission("case:manage")
  r.post(
    "/:id/resolve",
    requireAuth,
    requirePermission("case:manage"),
    asyncHandler(async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const { status, resolution } = req.body as {
        status: "Resolved" | "Rejected";
        resolution: string;
      };
      if (!["Resolved", "Rejected"].includes(status)) {
        res.status(400).json({ error: "invalid_status" });
        return;
      }
      const c = await knex("cases").where({ id: req.params.id }).first();
      if (!c) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      await knex("cases")
        .where({ id: c.id })
        .update({ status, resolution, resolved_at: new Date().toISOString() });
      await writeAudit(knex, {
        actor_id: req.authUser?.id,
        actor_username: req.authUser?.username,
        action: "CASE_RESOLVE",
        entity: "case",
        entity_id: String(c.id),
        details: `${status}: ${resolution}`,
      });
      res.json({ case: await knex("cases").where({ id: c.id }).first() });
    }),
  );

  return r;
}
