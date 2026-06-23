import { Router } from "express";
import type { Knex } from "knex";
import { compileTemplate, passesConfidenceGate } from "../engine/compileTemplate.js";
import { nextStateForAction, ACTION_PERMISSION, type WorkflowAction } from "../engine/transitions.js";
import { writeAudit } from "../audit.js";
import type { EventBus } from "../events.js";
import type { AuthorityClient } from "../authority.js";

function unwrapId(inserted: unknown): number {
  const v = Array.isArray(inserted) ? inserted[0] : inserted;
  return typeof v === "object" && v !== null ? (v as { id: number }).id : (v as number);
}

export function workflowRouter(): Router {
  const r = Router();

  r.post("/templates", async (req, res) => {
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
    const id = unwrapId(
      await knex("workflow_templates")
        .insert({ name, doc_type, steps_json, active: true })
        .returning("id"),
    );
    const template = await knex("workflow_templates").where({ id }).first();
    res.status(201).json({ template });
  });

  r.get("/templates", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const templates = await knex("workflow_templates")
      .where({ active: true })
      .orderBy("id", "desc");
    res.json({ templates });
  });

  return r;
}

export function workflowsRouter(): Router {
  const r = Router();

  r.post("/", async (req, res) => {
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

    const count = Number(
      (await knex("workflows").count<{ c: number }[]>("id as c"))[0].c,
    );
    const refCode = `WF-${count + 1}`;

    const workflowId = unwrapId(
      await knex("workflows")
        .insert({
          ref_code: refCode,
          title: body.title,
          doc_id: body.doc_id,
          template_id: body.template_id,
          stage: steps[0].name,
          priority: body.priority ?? "Normal",
          status: "Active",
          sla_due_at: slaDue,
          assigned_to: body.assigned_to,
          created_by: body.created_by,
        })
        .returning("id"),
    );

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
      actor_username: body.created_by,
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

    const workflow = await knex("workflows").where({ id: workflowId }).first();
    const createdSteps = await knex("workflow_steps")
      .where({ workflow_id: workflowId })
      .orderBy("seq");
    res.status(201).json({ workflow, steps: createdSteps, requires_manual_review: requiresManualReview });
  });

  r.get("/", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const workflows = await knex("workflows")
      .orderByRaw("CASE WHEN status = 'Active' THEN 0 ELSE 1 END")
      .orderBy("created_at", "desc");
    res.json({ workflows });
  });

  r.post("/:id/act", async (req, res) => {
    const { knex, events, authority } = req.app.locals.deps as {
      knex: Knex;
      events?: EventBus;
      authority?: AuthorityClient;
    };
    if (!authority) {
      res.status(500).json({ error: "authority_unavailable" });
      return;
    }

    const { userId, action, comment } = req.body as {
      userId: number;
      action: WorkflowAction;
      comment?: string;
    };
    if (!userId || !action || !ACTION_PERMISSION[action]) {
      res.status(400).json({ error: "userId_and_valid_action_required" });
      return;
    }

    const workflow = await knex("workflows").where({ id: req.params.id }).first();
    if (!workflow) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (["Approved", "Rejected"].includes(workflow.status)) {
      res.status(409).json({ error: "workflow_closed" });
      return;
    }

    const steps = await knex("workflow_steps")
      .where({ workflow_id: workflow.id })
      .orderBy("seq");
    const currentStep = steps.find((s) => s.status === "Pending");
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
      ? (steps.find((s) => s.seq === result.nextSeq)?.name ?? workflow.stage)
      : workflow.stage;

    await knex("workflows").where({ id: workflow.id }).update({
      status: result.workflowStatus,
      stage: result.workflowStatus === "Approved" ? "Completed" : nextStage,
    });

    await writeAudit(knex, {
      actor_id: userId,
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
  });

  r.get("/:id", async (req, res) => {
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
  });

  return r;
}
