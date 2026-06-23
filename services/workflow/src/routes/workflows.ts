import { Router } from "express";
import type { Knex } from "knex";
import { compileTemplate, passesConfidenceGate } from "../engine/compileTemplate.js";
import { nextStateForAction, ACTION_PERMISSION, type WorkflowAction } from "../engine/transitions.js";
import { writeAudit } from "../audit.js";
import type { EventBus } from "../events.js";
import type { AuthorityClient } from "../authority.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { asyncHandler } from "../app.js";

// F7: Insert-then-refetch pattern for Oracle compatibility.
// Returns the inserted row by querying on the unique column after insert.
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

export function workflowRouter(): Router {
  const r = Router();

  // F12: Normalize SQLite boolean 0/1 to true/false on template rows.
  function normalizeTemplate(tpl: Record<string, unknown>) {
    return { ...tpl, active: Boolean(tpl.active) };
  }

  // POST /templates — F1: requireAuth + requirePermission("workflow:act")
  r.post(
    "/templates",
    requireAuth,
    requirePermission("workflow:act"),
    asyncHandler(async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const { name, doc_type, steps_json } = req.body as {
        name: string;
        doc_type?: string;
        steps_json: string;
      };
      if (!name || !steps_json) {
        res.status(400).json({ error: "name_and_steps_required" });
        return;
      }
      try {
        compileTemplate(steps_json);
      } catch (e) {
        res.status(400).json({ error: String((e as Error).message) });
        return;
      }
      // F7: insert-then-refetch instead of .returning("id")
      const template = await insertAndFetch(
        knex,
        "workflow_templates",
        { name, doc_type, steps_json, active: true },
        "name",
        name,
      );
      res.status(201).json({ template: normalizeTemplate(template) });
    }),
  );

  // GET /templates — F1: requireAuth
  r.get(
    "/templates",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const templates = await knex("workflow_templates")
        .where({ active: true })
        .orderBy("id", "desc");
      // F12: normalize boolean active field
      res.json({ templates: templates.map(normalizeTemplate) });
    }),
  );

  return r;
}

export function workflowsRouter(): Router {
  const r = Router();

  // POST /workflows — F1: requireAuth + requirePermission("workflow:act")
  r.post(
    "/",
    requireAuth,
    requirePermission("workflow:act"),
    asyncHandler(async (req, res) => {
      const { knex, events } = req.app.locals.deps as { knex: Knex; events?: EventBus };
      const body = req.body as {
        title: string;
        doc_id?: string;
        template_id: number;
        priority?: string;
        assigned_to?: string;
        doc_confidence?: number;
        created_by?: string;
      };
      if (!body.title || !body.template_id) {
        res.status(400).json({ error: "title_and_template_required" });
        return;
      }

      const tpl = await knex("workflow_templates").where({ id: body.template_id }).first();
      if (!tpl) {
        res.status(404).json({ error: "template_not_found" });
        return;
      }

      let steps;
      try {
        steps = compileTemplate(tpl.steps_json);
      } catch (e) {
        res.status(400).json({ error: String((e as Error).message) });
        return;
      }

      const now = Date.now();
      const firstSla = steps[0].sla_minutes;
      const slaDue = firstSla ? new Date(now + firstSla * 60_000).toISOString() : null;

      const requiresManualReview =
        typeof body.doc_confidence === "number" &&
        !passesConfidenceGate(steps[0].min_confidence, body.doc_confidence);

      // F6: unique ref_code generation — count+insert race is guarded by a
      // unique constraint. We wrap in try/catch and return 409 on conflict
      // instead of letting the DB error propagate. A production deployment should
      // use a DB SEQUENCE; this is safe enough for the SQLite/pg dual-target.
      const count = Number(
        (await knex("workflows").count<{ c: number }[]>("id as c"))[0].c,
      );
      const refCode = `WF-${count + 1}`;

      // F7: insert-then-refetch for Oracle compatibility.
      let workflow: Record<string, unknown>;
      try {
        workflow = await insertAndFetch(
          knex,
          "workflows",
          {
            ref_code: refCode,
            title: body.title,
            doc_id: body.doc_id,
            template_id: body.template_id,
            stage: steps[0].name,
            priority: body.priority ?? "Normal",
            status: "Active",
            sla_due_at: slaDue,
            assigned_to: body.assigned_to,
            // F2: actor identity from verified JWT, NOT from body
            created_by: req.authUser?.username ?? body.created_by,
          },
          "ref_code",
          refCode,
        );
      } catch (e) {
        const msg = String((e as Error).message ?? "");
        if (msg.includes("UNIQUE") || msg.includes("unique")) {
          res.status(409).json({ error: "ref_code_conflict" });
          return;
        }
        throw e;
      }

      const workflowId = (workflow as { id: number }).id;

      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const dueAt = s.sla_minutes
          ? new Date(now + s.sla_minutes * 60_000).toISOString()
          : null;
        await knex("workflow_steps").insert({
          workflow_id: workflowId,
          seq: i + 1,
          name: s.name,
          required_permissions: JSON.stringify(s.required_permissions),
          min_confidence: s.min_confidence,
          status: "Pending",
          sla_minutes: s.sla_minutes ?? null,
          due_at: dueAt,
        });
      }

      await writeAudit(knex, {
        actor_id: req.authUser?.id,
        actor_username: req.authUser?.username,
        action: "WORKFLOW_CREATE",
        entity: "workflow",
        entity_id: String(workflowId),
        details: refCode,
      });
      await events?.emit("workflow.created", {
        id: workflowId,
        ref_code: refCode,
        doc_id: body.doc_id,
      });

      const createdSteps = await knex("workflow_steps")
        .where({ workflow_id: workflowId })
        .orderBy("seq");
      res.status(201).json({ workflow, steps: createdSteps, requires_manual_review: requiresManualReview });
    }),
  );

  // GET /workflows — F1: requireAuth
  r.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const workflows = await knex("workflows")
        .orderByRaw("CASE WHEN status = 'Active' THEN 0 ELSE 1 END")
        .orderBy("created_at", "desc");
      res.json({ workflows });
    }),
  );

  // POST /workflows/:id/act — F1: requireAuth (authority client handles per-action RBAC)
  // F4: Block OnHold and Escalated workflows (not just Approved/Rejected)
  // F2: Actor identity from verified JWT (req.authUser.id), NOT from request body
  r.post(
    "/:id/act",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { knex, events, authority } = req.app.locals.deps as {
        knex: Knex;
        events?: EventBus;
        authority?: AuthorityClient;
      };
      if (!authority) {
        res.status(500).json({ error: "authority_unavailable" });
        return;
      }

      // F2: actor from verified JWT — NEVER from request body
      const userId = req.authUser!.id;

      const { action, comment } = req.body as {
        action: WorkflowAction;
        comment?: string;
      };
      if (!action || !ACTION_PERMISSION[action]) {
        res.status(400).json({ error: "valid_action_required" });
        return;
      }

      const workflow = await knex("workflows").where({ id: req.params.id }).first();
      if (!workflow) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      // F4: terminal-status guard
      if (["Approved", "Rejected"].includes(workflow.status)) {
        res.status(409).json({ error: "workflow_closed" });
        return;
      }
      // F4: inactive-status guard (OnHold / Escalated cannot receive act actions)
      if (["OnHold", "Escalated"].includes(workflow.status)) {
        res.status(409).json({ error: "workflow_inactive", status: workflow.status });
        return;
      }

      const steps = await knex("workflow_steps")
        .where({ workflow_id: workflow.id })
        .orderBy("seq");
      const currentStep = steps.find((s: { status: string }) => s.status === "Pending");
      if (!currentStep) {
        res.status(409).json({ error: "no_pending_step" });
        return;
      }

      const stepPerms: string[] = JSON.parse(currentStep.required_permissions || "[]");
      const required = Array.from(new Set([...stepPerms, ACTION_PERMISSION[action]]));
      const decision = await authority.check(userId, required);
      if (!decision.allowed) {
        res.status(403).json({ error: "forbidden", missing: decision.missing });
        return;
      }

      const result = nextStateForAction(action, { seq: currentStep.seq }, steps.length);

      await knex("workflow_steps").where({ id: currentStep.id }).update({
        status: result.stepStatus,
        actor_id: userId,
        acted_at: new Date().toISOString(),
      });

      const nextStage = result.nextSeq
        ? (steps.find((s: { seq: number }) => s.seq === result.nextSeq)?.name ?? workflow.stage)
        : workflow.stage;

      await knex("workflows").where({ id: workflow.id }).update({
        status: result.workflowStatus,
        stage: result.workflowStatus === "Approved" ? "Completed" : nextStage,
      });

      await writeAudit(knex, {
        actor_id: userId,
        actor_username: req.authUser?.username,
        action: `WORKFLOW_${action.toUpperCase()}`,
        entity: "workflow",
        entity_id: String(workflow.id),
        details: comment,
      });
      if (result.event) {
        await events?.emit(result.event, {
          id: workflow.id,
          ref_code: workflow.ref_code,
          action,
          actor_id: userId,
        });
      }

      const updated = await knex("workflows").where({ id: workflow.id }).first();
      const updatedSteps = await knex("workflow_steps")
        .where({ workflow_id: workflow.id })
        .orderBy("seq");
      res.json({ workflow: updated, steps: updatedSteps });
    }),
  );

  // GET /workflows/:id — F1: requireAuth
  r.get(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const workflow = await knex("workflows").where({ id: req.params.id }).first();
      if (!workflow) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const steps = await knex("workflow_steps")
        .where({ workflow_id: workflow.id })
        .orderBy("seq");
      res.json({ workflow, steps });
    }),
  );

  return r;
}
