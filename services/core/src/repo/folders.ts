import type { Knex } from "knex";

export const ROOT_PATH = "/BoB";

export interface FolderNode {
  id: number;
  parent_id?: number | null;
  name: string;
  path: string;
  domain?: string;
  created_by?: string;
  created_at?: string;
  children: FolderNode[];
}

function idOf(inserted: unknown): number {
  const x = (inserted as unknown[])[0];
  return typeof x === "object" && x !== null ? (x as { id: number }).id : (x as number);
}

export async function createFolder(
  knex: Knex,
  args: { name: string; parentId?: number | null; domain?: string; createdBy?: string },
): Promise<{ id: number; parent_id?: number | null; name: string; path: string; domain?: string; created_by?: string; created_at?: string }> {
  let path = `${ROOT_PATH}/${args.name}`;
  if (args.parentId != null) {
    const parent = await knex("folders").where({ id: args.parentId }).first();
    if (!parent) throw new Error("parent_not_found");
    path = `${parent.path}/${args.name}`;
  }
  const existing = await knex("folders").where({ path }).first();
  if (existing) throw new Error(`duplicate_path:${path}`);

  const inserted = await knex("folders").insert({
    name: args.name, parent_id: args.parentId ?? null, path,
    domain: args.domain ?? null, created_by: args.createdBy ?? null,
  }).returning("id");
  const id = idOf(inserted);
  return knex("folders").where({ id }).first();
}

export async function listTree(knex: Knex): Promise<FolderNode[]> {
  const rows = (await knex("folders").select("*").orderBy("path")) as FolderNode[];
  const byId = new Map<number, FolderNode>();
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
  id: number,
  newParentId: number,
): Promise<{ id: number; parent_id?: number | null; name: string; path: string }> {
  const node = await knex("folders").where({ id }).first();
  if (!node) throw new Error("not_found");
  const parent = await knex("folders").where({ id: newParentId }).first();
  if (!parent) throw new Error("parent_not_found");
  if (parent.path === node.path || parent.path.startsWith(`${node.path}/`)) {
    throw new Error("cannot_move_into_own_subtree");
  }

  const oldPath = node.path as string;
  const newPath = `${parent.path}/${node.name}`;
  const descendants = await knex("folders").where("path", "like", `${oldPath}/%`);

  await knex.transaction(async (tx) => {
    await tx("folders").where({ id }).update({ parent_id: newParentId, path: newPath });
    for (const d of descendants) {
      await tx("folders").where({ id: d.id }).update({ path: newPath + (d.path as string).slice(oldPath.length) });
    }
  });
  return knex("folders").where({ id }).first();
}
