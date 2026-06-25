import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission, makeViewer } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { resolvePath, defaultAcls, domainForPath } from "../mapper/directory.js";
import { ROOT_PATH } from "../repo/folders.js";
import { setFolderAcls, effectiveAcls } from "../repo/acls.js";
import { getDocument } from "../repo/documents.js";
import { newId } from "@zordms/db";

// Ensures every segment of `path` (relative to /BoB) exists; returns the leaf folder id.
async function ensureFolderChain(knex: Knex, path: string, createdBy: string): Promise<string> {
  const clean = path.replace(/\/+$/, ""); // strip trailing slash
  const segments = clean.split("/").filter(Boolean).slice(1); // drop "BoB"
  let parentId: string | null = null;
  let currentPath = ROOT_PATH;
  let leafId = "";
  for (const seg of segments) {
    currentPath = `${currentPath}/${seg}`;
    let folder = await knex("folders").where({ path: currentPath }).first();
    if (!folder) {
      const id = newId();
      await knex("folders").insert({
        id,
        name: seg,
        parent_id: parentId,
        path: currentPath,
        domain: domainForPath(currentPath),
        created_by: createdBy,
      });
      folder = { id };
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
      // C1: pass viewer so branch-isolation is enforced
      const document = await getDocument(deps.knex, req.params.documentId, makeViewer(req));
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
