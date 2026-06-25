import type { Knex } from "knex";
import type { Branch, NewBranch, BranchAccess, NewBranchAccess } from "@zordms/types";
import { newId } from "@zordms/db";

export async function listBranches(knex: Knex): Promise<Branch[]> {
  return knex<Branch>("branches").select("*").orderBy("code");
}

export async function addBranch(knex: Knex, input: NewBranch): Promise<Branch> {
  const row = {
    id: newId(),
    code: input.code,
    name: input.name,
    region: input.region ?? null,
    replication_mode: input.replication_mode ?? "async",
    status: input.status ?? "Active",
  };
  await knex("branches").insert(row);
  return knex<Branch>("branches").where({ code: input.code }).first() as Promise<Branch>;
}

export async function listAccessPolicies(knex: Knex): Promise<BranchAccess[]> {
  return knex<BranchAccess>("branch_access").select("*").orderBy("id");
}

export async function setAccessPolicy(knex: Knex, input: NewBranchAccess): Promise<BranchAccess> {
  const existing = await knex("branch_access")
    .where({ source_branch: input.source_branch, target_branch: input.target_branch }).first();
  const policy = input.policy ?? "read";
  if (existing) {
    await knex("branch_access").where({ id: existing.id }).update({ policy });
    return knex<BranchAccess>("branch_access").where({ id: existing.id }).first() as Promise<BranchAccess>;
  }
  await knex("branch_access").insert({ id: newId(), source_branch: input.source_branch, target_branch: input.target_branch, policy });
  return knex<BranchAccess>("branch_access")
    .where({ source_branch: input.source_branch, target_branch: input.target_branch })
    .first() as Promise<BranchAccess>;
}
