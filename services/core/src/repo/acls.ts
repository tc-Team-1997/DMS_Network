import type { Knex } from "knex";
import { newId } from "@zordms/db";

type Acl = { role: string; access: "read" | "write" | "delete" };
type EffectiveAcl = Acl & { inherited: boolean };

export async function setFolderAcls(
  knex: Knex,
  folderId: string,
  acls: Acl[],
  inherited: boolean,
): Promise<void> {
  for (const a of acls) {
    const exists = await knex("folder_acls")
      .where({ folder_id: folderId, role: a.role, access: a.access })
      .first();
    if (!exists) {
      await knex("folder_acls").insert({ id: newId(), folder_id: folderId, role: a.role, access: a.access, inherited });
    }
  }
}

async function ancestorIds(knex: Knex, folderId: string): Promise<string[]> {
  const ids: string[] = [];
  let current = await knex("folders").where({ id: folderId }).first();
  while (current?.parent_id != null) {
    ids.push(current.parent_id);
    current = await knex("folders").where({ id: current.parent_id }).first();
  }
  return ids;
}

export async function effectiveAcls(knex: Knex, folderId: string): Promise<EffectiveAcl[]> {
  const own = (await knex("folder_acls").where({ folder_id: folderId })) as Array<Acl & { inherited: boolean }>;
  const ancestors = await ancestorIds(knex, folderId);
  const inheritedRows = ancestors.length
    ? ((await knex("folder_acls").whereIn("folder_id", ancestors)) as Array<Acl>)
    : [];

  const map = new Map<string, EffectiveAcl>();
  for (const a of own) map.set(`${a.role}:${a.access}`, { role: a.role, access: a.access, inherited: false });
  for (const a of inheritedRows) {
    const key = `${a.role}:${a.access}`;
    if (!map.has(key)) map.set(key, { role: a.role, access: a.access, inherited: true });
  }
  return [...map.values()];
}
