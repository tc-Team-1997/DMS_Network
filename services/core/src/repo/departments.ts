import type { Knex } from "knex";
import { newId } from "@zordms/db";

/** Departments master data (§4.11). */
export interface Department {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  head: string | null;
  branch: string | null;
  status: string;
  createdAt: string | null;
}

function rowToDept(row: Record<string, unknown>): Department {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    parentId: (row.parent_id as string) ?? null,
    head: (row.head as string) ?? null,
    branch: (row.branch as string) ?? null,
    status: String(row.status ?? "Active"),
    createdAt: (row.created_at as string) ?? null,
  };
}

export async function listDepartments(knex: Knex): Promise<Department[]> {
  const rows = await knex("departments").select("*").orderBy("code", "asc");
  return rows.map(rowToDept);
}

export async function getDepartment(knex: Knex, id: string): Promise<Department | null> {
  const row = await knex("departments").where({ id }).first();
  return row ? rowToDept(row) : null;
}

export class DuplicateCodeError extends Error {}

export async function createDepartment(
  knex: Knex,
  input: { code: string; name: string; parentId?: string | null; head?: string; branch?: string; status?: string },
): Promise<Department> {
  const existing = await knex("departments").where({ code: input.code }).first();
  if (existing) throw new DuplicateCodeError(`department code already exists: ${input.code}`);
  const id = newId();
  await knex("departments").insert({
    id,
    code: input.code,
    name: input.name,
    parent_id: input.parentId ?? null,
    head: input.head ?? null,
    branch: input.branch ?? null,
    status: input.status ?? "Active",
  });
  return rowToDept((await knex("departments").where({ id }).first())!);
}

export async function updateDepartment(
  knex: Knex,
  id: string,
  patch: { name?: string; parentId?: string | null; head?: string; branch?: string; status?: string },
): Promise<Department | null> {
  const existing = await knex("departments").where({ id }).first();
  if (!existing) return null;
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.parentId !== undefined) update.parent_id = patch.parentId;
  if (patch.head !== undefined) update.head = patch.head;
  if (patch.branch !== undefined) update.branch = patch.branch;
  if (patch.status !== undefined) update.status = patch.status;
  if (Object.keys(update).length > 0) await knex("departments").where({ id }).update(update);
  return rowToDept((await knex("departments").where({ id }).first())!);
}

export async function deleteDepartment(knex: Knex, id: string): Promise<boolean> {
  return (await knex("departments").where({ id }).del()) > 0;
}
