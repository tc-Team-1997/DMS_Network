import { Router } from "express";
import type { Knex } from "knex";
import { compileTemplate, passesConfidenceGate } from "../engine/compileTemplate.js";
import { nextStateForAction, ACTION_PERMISSION, type WorkflowAction } from "../engine/transitions.js";
import { writeAudit } from "../audit.js";
import type { EventBus } from "../events.js";
import type { AuthorityClient } from "../authority.js";
import { requireAuth, requirePermission, asyncHandler } from "@zordms/auth";
import { newId } from "@zordms/db";

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
      const templateId = newId();
      // F7: insert-then-refetch instead of .returning("id")
      const template = await insertAndFetch(
        knex,
        "workflow_templates",
        { id: templateId, name, doc_type, steps_json, active: true },
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
        .orderBy("created_at", "desc");
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
        template_id: string;
        priority?: string;
        assigned_to?: string;
        doc_confidence?: number;
        created_by?: string;
        branch?: string;
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
      const workflowId = newId();

      // F7: insert-then-refetch for Oracle compatibility.
      let workflow: Record<string, unknown>;
      try {
        workflow = await insertAndFetch(
          knex,
          "workflows",
          {
            id: workflowId,
            ref_code: refCode,
            title: body.title,
            doc_id: body.doc_id,
            template_id: body.template_id,
            stage: steps[0].name,
            priority: body.priority ?? "Normal",
            status: "Active",
            sla_due_at: slaDue,
            assigned_to: body.assigned_to,
            branch: body.branch ?? req.authUser?.branch,
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

      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const dueAt = s.sla_minutes
          ? new Date(now + s.sla_minutes * 60_000).toISOString()
          : null;
        await knex("workflow_steps").insert({
          id: newId(),
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
        entity_id: workflowId,
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
  //
  // P3 CROSS-STATUS REVIEW QUEUE. Returns workflows enriched with their current
  // (Pending) step + document ref + assignee + sla, filterable by ?status= and
  // branch-scoped (a non-cross-branch user only sees their own branch).
  //
  // The UI ReviewQueue tabs map to ?status=:
  //   Pending   → workflows that are Active with an unclaimed current step
  //   Claimed   → Active workflows whose current step has claimed_by set
  //   Approved  → status=Approved
  //   Rejected  → status=Rejected
  //   Escalated → status=Escalated
  //   OnHold    → status=OnHold
  const VALID_QUEUE_STATUS = new Set([
    "Pending",
    "Claimed",
    "Approved",
    "Rejected",
    "Escalated",
    "OnHold",
  ]);

  r.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;

      // Branch scoping: fail-closed unless the caller can read cross-branch.
      const canCrossBranch = req.authUser?.permissions.includes("crossbranch:read") ?? false;
      const callerBranch = req.authUser?.branch;

      let q = knex("workflows")
        .orderByRaw("CASE WHEN status = 'Active' THEN 0 ELSE 1 END")
        .orderBy("created_at", "desc");

      if (!canCrossBranch && callerBranch) {
        // Show only the caller's branch OR legacy rows with no branch recorded.
        q = q.where((b) => b.where("branch", callerBranch).orWhereNull("branch"));
      }

      // Pending/Claimed are derived from the current step; everything else maps
      // directly to the workflow status column.
      if (statusFilter && statusFilter !== "Pending" && statusFilter !== "Claimed") {
        if (!VALID_QUEUE_STATUS.has(statusFilter)) {
          res.status(400).json({ error: "invalid_status" });
          return;
        }
        q = q.where("status", statusFilter);
      } else if (statusFilter === "Pending" || statusFilter === "Claimed") {
        q = q.where("status", "Active");
      }

      const workflows = await q;
      const ids = workflows.map((w: { id: string }) => w.id);
      const steps = ids.length
        ? await knex("workflow_steps").whereIn("workflow_id", ids).orderBy("seq")
        : [];
      const stepsByWf = new Map<string, Array<Record<string, unknown>>>();
      for (const s of steps) {
        const arr = stepsByWf.get(s.workflow_id as string) ?? [];
        arr.push(s);
        stepsByWf.set(s.workflow_id as string, arr);
      }

      const items = workflows
        .map((w: Record<string, unknown>) => {
          const wfSteps = stepsByWf.get(w.id as string) ?? [];
          const currentStep =
            wfSteps.find((s) => s.status === "Pending") ??
            wfSteps[wfSteps.length - 1] ??
            null;
          const claimed = Boolean(currentStep?.claimed_by);
          // Derive the queue-facing status for this item.
          let queueStatus = w.status as string;
          if (w.status === "Active") queueStatus = claimed ? "Claimed" : "Pending";
          return {
            id: w.id,
            ref_code: w.ref_code,
            title: w.title,
            doc_id: w.doc_id ?? null,
            branch: w.branch ?? null,
            priority: w.priority,
            status: w.status,
            queue_status: queueStatus,
            stage: w.stage,
            sla_due_at: w.sla_due_at ?? null,
            assignee: (currentStep?.claimed_by as string | undefined) ?? (w.assigned_to as string | undefined) ?? null,
            created_by: w.created_by ?? null,
            created_at: w.created_at ?? null,
            current_step: currentStep
              ? {
                  id: currentStep.id,
                  seq: currentStep.seq,
                  name: currentStep.name,
                  status: currentStep.status,
                  claimed_by: currentStep.claimed_by ?? null,
                  claimed_at: currentStep.claimed_at ?? null,
                  due_at: currentStep.due_at ?? null,
                  required_permissions: JSON.parse(
                    (currentStep.required_permissions as string) || "[]",
                  ),
                }
              : null,
          };
        })
        // Pending/Claimed are post-filtered because they depend on the step.
        .filter((it: { queue_status: string }) => {
          if (statusFilter === "Pending") return it.queue_status === "Pending";
          if (statusFilter === "Claimed") return it.queue_status === "Claimed";
          return true;
        });

      res.json({ workflows: items });
    }),
  );

  // POST /workflows/:id/claim — F1: requireAuth
  //
  // P3 CLAIM. Assigns the current Pending step to the acting JWT user. Guards
  // against claiming an already-claimed step, a non-pending step, or a workflow
  // that is closed/inactive. Returns the updated workflow + steps.
  r.post(
    "/:id/claim",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const actorUsername = req.authUser!.username;

      const workflow = await knex("workflows").where({ id: req.params.id }).first();
      if (!workflow) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (["Approved", "Rejected"].includes(workflow.status)) {
        res.status(409).json({ error: "workflow_closed" });
        return;
      }
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
      if (currentStep.claimed_by) {
        // Idempotent re-claim by the same user is allowed; a different user is blocked.
        if (currentStep.claimed_by !== actorUsername) {
          res.status(409).json({ error: "already_claimed", claimed_by: currentStep.claimed_by });
          return;
        }
      }

      await knex("workflow_steps").where({ id: currentStep.id }).update({
        claimed_by: actorUsername,
        claimed_at: new Date().toISOString(),
      });

      await writeAudit(knex, {
        actor_id: req.authUser?.id,
        actor_username: actorUsername,
        action: "WORKFLOW_CLAIM",
        entity: "workflow",
        entity_id: String(workflow.id),
        details: currentStep.name,
      });

      const updated = await knex("workflows").where({ id: workflow.id }).first();
      const updatedSteps = await knex("workflow_steps")
        .where({ workflow_id: workflow.id })
        .orderBy("seq");
      res.json({ workflow: updated, steps: updatedSteps });
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
