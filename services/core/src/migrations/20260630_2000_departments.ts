import type { Knex } from "knex";
import { newId } from "@zordms/db";

/**
 * Migration: departments (§4.11 Master Data / §7).
 *
 * Organizational units for routing + master data — the missing dimension the
 * blueprint calls out (cases can route to a department; documents can carry one).
 * Self-referencing parent_id supports a simple hierarchy. Idempotent.
 */
const SEED: Array<{ code: string; name: string; parent_code: string | null }> = [
  { code: "OPS", name: "Operations", parent_code: null },
  { code: "RETAIL", name: "Retail Banking", parent_code: null },
  { code: "CREDIT", name: "Corporate Credit", parent_code: null },
  { code: "COMPLIANCE", name: "Compliance & AML", parent_code: null },
  { code: "IT", name: "Information Technology", parent_code: null },
];

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("departments");
  if (!exists) {
    await knex.schema.createTable("departments", (t) => {
      t.string("id", 36).notNullable().primary();
      t.string("code", 40).notNullable().unique();
      t.string("name", 200).notNullable();
      t.string("parent_id", 36); // self-ref (nullable = top-level)
      t.string("head", 120); // department head (username/role)
      t.string("branch", 40); // optional owning branch code
      t.string("status", 20).notNullable().defaultTo("Active");
      t.timestamp("created_at").defaultTo(knex.fn.now());
    });

    const byCode = new Map<string, string>();
    for (const d of SEED) {
      const id = newId();
      byCode.set(d.code, id);
      await knex("departments").insert({
        id,
        code: d.code,
        name: d.name,
        parent_id: d.parent_code ? byCode.get(d.parent_code) ?? null : null,
        status: "Active",
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("departments");
}
