import type { Knex } from "knex";
import { newId } from "@zordms/db";

export const ROOT_PATH = "/BoB";

export interface FolderNode {
  id: string;
  parent_id?: string | null;
  name: string;
  path: string;
  domain?: string;
  created_by?: string;
  created_at?: string;
  children: FolderNode[];
}

export async function createFolder(
  knex: Knex,
  args: { name: string; parentId?: string | null; domain?: string; createdBy?: string },
): Promise<{ id: string; parent_id?: string | null; name: string; path: string; domain?: string; created_by?: string; created_at?: string }> {
  let path = `${ROOT_PATH}/${args.name}`;
  if (args.parentId != null) {
    const parent = await knex("folders").where({ id: args.parentId }).first();
    if (!parent) throw new Error("parent_not_found");
    path = `${parent.path}/${args.name}`;
  }
  const existing = await knex("folders").where({ path }).first();
  if (existing) throw new Error(`duplicate_path:${path}`);

  const id = newId();
  await knex("folders").insert({
    id,
    name: args.name, parent_id: args.parentId ?? null, path,
    domain: args.domain ?? null, created_by: args.createdBy ?? null,
  });
  return knex("folders").where({ id }).first();
}

export async function listTree(knex: Knex): Promise<FolderNode[]> {
  const rows = (await knex("folders").select("*").orderBy("path")) as FolderNode[];
  const byId = new Map<string, FolderNode>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id != null && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export async function moveFolder(
  knex: Knex,
  id: string,
  newParentId: string,
): Promise<{ id: string; parent_id?: string | null; name: string; path: string }> {
  const node = await knex("folders").where({ id }).first();
  if (!node) throw new Error("not_found");
  const parent = await knex("folders").where({ id: newParentId }).first();
  if (!parent) throw new Error("parent_not_found");
  if (parent.path === node.path || parent.path.startsWith(`${node.path}/`)) {
    throw new Error("cannot_move_into_own_subtree");
  }

  const oldPath = node.path as string;
  const newPath = `${parent.path}/${node.name}`;

  // I6: check for path conflict at destination before moving
  const conflicting = await knex("folders").where({ path: newPath }).whereNot({ id }).first();
  if (conflicting) throw new Error(`duplicate_path:${newPath}`);

  // M4: escape LIKE metacharacters in oldPath to avoid unintended wildcard matches
  const escapedOldPath = oldPath.replace(/[%_\\]/g, "\\$&");
  const descendants = await knex("folders").whereRaw("path LIKE ? ESCAPE '\\'", [`${escapedOldPath}/%`]);

  await knex.transaction(async (tx) => {
    await tx("folders").where({ id }).update({ parent_id: newParentId, path: newPath });
    for (const d of descendants) {
      await tx("folders").where({ id: d.id }).update({ path: newPath + (d.path as string).slice(oldPath.length) });
    }
  });
  return knex("folders").where({ id }).first();
}
