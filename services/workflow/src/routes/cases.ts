import { Router } from "express";
import type { Knex } from "knex";
import { compileTemplate } from "../engine/compileTemplate.js";
import { writeAudit } from "../audit.js";
import type { EventBus } from "../events.js";

const CASE_TYPES = ["KYC", "Loan", "Account", "AML"];

function unwrapId(inserted: unknown): number {
  const v = Array.isArray(inserted) ? inserted[0] : inserted;
  return typeof v === "object" && v !== null ? (v as { id: number }).id : (v as number);
}

async function instantiateWorkflow(
  knex: Knex,
  templateId: number,
  title: string,
): Promise<number | null> {
  const tpl = await knex("workflow_templates").where({ id: templateId }).first();
  if (!tpl) return null;
  const steps = compileTemplate(tpl.steps_json);
  const now = Date.now();
  const count = Number(
    (await knex("workflows").count<{ c: number }[]>("id as c"))[0].c,
  );
  const refCode = `WF-${count + 1}`;
  const wfId = unwrapId(
    await knex("workflows")
      .insert({
        ref_code: refCode,
        title,
        template_id: templateId,
        stage: steps[0].name,
        priority: "Normal",
        status: "Active",
        sla_due_at: steps[0].sla_minutes
          ? new Date(now + steps[0].sla_minutes * 60_000).toISOString()
          : null,
      })
      .returning("id"),
  );
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await knex("workflow_steps").insert({
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
  return wfId;
}

export function casesRouter(): Router {
  const r = Router();

  r.post("/", async (req, res) => {
    const { knex, events } = req.app.locals.deps as { knex: Knex; events?: EventBus };
    const body = req.body as {
      case_type: string;
      title: string;
      assigned_to?: string;
      due_at?: string;
      template_id?: number;
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

    let workflowId: number | null = null;
    if (body.template_id) {
      workflowId = await instantiateWorkflow(knex, body.template_id, body.title);
    }

    const caseId = unwrapId(
      await knex("cases")
        .insert({
          case_ref: caseRef,
          case_type: body.case_type,
          title: body.title,
          status: "Open",
          assigned_to: body.assigned_to,
          due_at: body.due_at,
          workflow_id: workflowId,
          created_by: body.created_by,
        })
        .returning("id"),
    );

    await writeAudit(knex, {
      actor_username: body.created_by,
      action: "CASE_CREATE",
      entity: "case",
      entity_id: String(caseId),
      details: caseRef,
    });
    await events?.emit("case.created", {
      id: caseId,
      case_ref: caseRef,
      case_type: body.case_type,
    });

    const created = await knex("cases").where({ id: caseId }).first();
    res.status(201).json({ case: created });
  });

  r.post("/:id/documents", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const { doc_id, label } = req.body as { doc_id: string; label?: string };
    if (!doc_id) {
      res.status(400).json({ error: "doc_id_required" });
      return;
    }
    const exists = await knex("cases").where({ id: req.params.id }).first();
    if (!exists) {
      res.status(404).json({ error: "case_not_found" });
      return;
    }
    const id = unwrapId(
      await knex("case_documents")
        .insert({ case_id: Number(req.params.id), doc_id, label })
        .returning("id"),
    );
    res.status(201).json({ document: await knex("case_documents").where({ id }).first() });
  });

  r.get("/metrics", async (req, res) => {
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
  });

  r.get("/", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const cases = await knex("cases").orderBy("created_at", "desc");
    res.json({ cases });
  });

  r.get("/:id", async (req, res) => {
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
  });

  r.post("/:id/resolve", async (req, res) => {
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
      action: "CASE_RESOLVE",
      entity: "case",
      entity_id: String(c.id),
      details: `${status}: ${resolution}`,
    });
    res.json({ case: await knex("cases").where({ id: c.id }).first() });
  });

  return r;
}
