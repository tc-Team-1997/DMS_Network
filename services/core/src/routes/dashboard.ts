import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware.js";
import { can } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";

export function dashboardRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/summary", requirePermission("document:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    const canCrossBranch = can({ permissions: req.authUser!.permissions }, "crossbranch:read");
    const base = () => {
      const q = knex("documents").where({ status: "Active" });
      if (!canCrossBranch && req.authUser!.branch) q.andWhere({ branch: req.authUser!.branch });
      return q;
    };

    const totalRow = await base().count("id as c");
    const pendingRow = await base().andWhere({ review_flag: true }).count("id as c");

    const catRows = (await base()
      .whereNotNull("catalog_category")
      .select("catalog_category")
      .count("id as c")
      .groupBy("catalog_category")) as Array<{ catalog_category: string; c: number }>;
    const byCategory: Record<string, number> = {};
    for (const row of catRows) byCategory[row.catalog_category] = Number(row.c);

    const today = new Date().toISOString().slice(0, 10);
    const indexedRow = await base()
      .whereNotNull("doc_type")
      .andWhereRaw("substr(ingest_timestamp,1,10) = ?", [today])
      .count("id as c");

    res.json({
      totalDocuments: Number(totalRow[0].c),
      byCategory,
      pendingReview: Number(pendingRow[0].c),
      indexedToday: Number(indexedRow[0].c),
    });
  });

  return r;
}
