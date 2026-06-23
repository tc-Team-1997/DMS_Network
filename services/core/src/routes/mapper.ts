import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "../middleware.js";
import { can } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { resolvePath, defaultAcls, domainForPath } from "../mapper/directory.js";
import { ROOT_PATH } from "../repo/folders.js";
import { setFolderAcls, effectiveAcls } from "../repo/acls.js";
import { getDocument } from "../repo/documents.js";

function idOf(inserted: unknown): number {
  const x = (inserted as unknown[])[0];
  return typeof x === "object" && x !== null ? (x as { id: number }).id : (x as number);
}

// Ensures every segment of `path` (relative to /BoB) exists; returns the leaf folder id.
async function ensureFolderChain(knex: Knex, path: string, createdBy: string): Promise<number> {
  const clean = path.replace(/\/+$/, ""); // strip trailing slash
  const segments = clean.split("/").filter(Boolean).slice(1); // drop "BoB"
  let parentId: number | null = null;
  let currentPath = ROOT_PATH;
  let leafId = 0;
  for (const seg of segments) {
    currentPath = `${currentPath}/${seg}`;
    let folder = await knex("folders").where({ path: currentPath }).first();
    if (!folder) {
      const inserted = await knex("folders").insert({
        name: seg,
        parent_id: parentId,
        path: currentPath,
        domain: domainForPath(currentPath),
        created_by: createdBy,
      }).returning("id");
      folder = { id: idOf(inserted) };
    }
    parentId = folder.id;
    leafId = folder.id;
  }
  return leafId;
}

export function mapperRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/:documentId", requirePermission("document:map"), async (req, res) => {
    try {
      const deps = req.app.locals.deps as CoreDeps;
      const canCrossBranch = can({ permissions: req.authUser!.permissions }, "crossbranch:read");
      const viewer = { branch: req.authUser!.branch, canCrossBranch };
      // C1: pass viewer so branch-isolation is enforced
      const document = await getDocument(deps.knex, Number(req.params.documentId), viewer);
      if (!document) { res.status(404).json({ error: "not_found" }); return; }

      const path = resolvePath(req.body.docType, req.body.fields ?? {});
      const folderId = await ensureFolderChain(deps.knex, path, req.authUser!.username);
      const domain = domainForPath(path);
      await setFolderAcls(deps.knex, folderId, defaultAcls(domain), false);
      await deps.knex("documents").where({ id: document.id }).update({ folder_id: folderId });

      const acls = await effectiveAcls(deps.knex, folderId);
      res.json({ path, folderId, acls });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  return r;
}
