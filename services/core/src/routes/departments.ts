import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import { validateBody } from "../openapi/validate.js";
import { CreateDepartmentSchema, UpdateDepartmentSchema } from "../openapi/schemas.js";
import {
  listDepartments, getDepartment, createDepartment, updateDepartment, deleteDepartment, DuplicateCodeError,
} from "../repo/departments.js";

/**
 * §4.11 Master Data — Departments CRUD.
 * Admin-only (admin:access), behind the gateway-issued JWT.
 */
export function departmentsRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.use(requirePermission("admin:access"));

  r.get("/", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      res.json({ departments: await listDepartments(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  r.get("/:id", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const dept = await getDepartment(knex, req.params.id);
      if (!dept) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ department: dept });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  r.post("/", validateBody(CreateDepartmentSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const dept = await createDepartment(knex, {
        code: req.body.code,
        name: req.body.name,
        parentId: req.body.parent_id,
        head: req.body.head,
        branch: req.body.branch,
        status: req.body.status,
      });
      res.status(201).json({ department: dept });
    } catch (e: any) {
      if (e instanceof DuplicateCodeError) { res.status(409).json({ error: "duplicate_code", detail: e.message }); return; }
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  r.put("/:id", validateBody(UpdateDepartmentSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const dept = await updateDepartment(knex, req.params.id, {
        name: req.body.name,
        parentId: req.body.parent_id,
        head: req.body.head,
        branch: req.body.branch,
        status: req.body.status,
      });
      if (!dept) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ department: dept });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  r.delete("/:id", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const ok = await deleteDepartment(knex, req.params.id);
      if (!ok) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ deleted: true });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  return r;
}
