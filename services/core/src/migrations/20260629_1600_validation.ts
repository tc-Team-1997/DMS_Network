import type { Knex } from "knex";
import { newId } from "@zordms/db";

/**
 * Migration: validation_rules + validation_results (§4.6/§7 Validation module).
 *
 * A data-driven field-validation engine: admins define rules per doc-type +
 * field; the engine evaluates extracted metadata against them and records
 * pass/fail results (also run best-effort after extraction). Idempotent.
 *
 * rule_type ∈ required | regex | min_length | max_length | range | enum
 * severity  ∈ error | warning
 * params is JSON-encoded (e.g. {"pattern":"^[0-9]{11}$"} or {"min":0,"max":1}).
 */
const SEED_RULES: Array<{
  doc_type: string | null;
  field_key: string;
  rule_type: string;
  params: unknown;
  severity: string;
  message: string;
}> = [
  { doc_type: "BT_CID_4G", field_key: "cid_no", rule_type: "regex", params: { pattern: "^[0-9]{11}$" }, severity: "error", message: "CID must be 11 digits." },
  { doc_type: "BOB_LOAN_APPLICATION", field_key: "amount", rule_type: "required", params: {}, severity: "error", message: "Loan amount is required." },
];

export async function up(knex: Knex): Promise<void> {
  const hasRules = await knex.schema.hasTable("validation_rules");
  if (!hasRules) {
    await knex.schema.createTable("validation_rules", (t) => {
      t.string("id", 36).notNullable().primary();
      // null doc_type ⇒ applies to documents of any type
      t.string("doc_type", 80).index();
      t.string("field_key", 120).notNullable();
      t.string("rule_type", 30).notNullable();
      t.text("params").notNullable().defaultTo("{}");
      t.string("severity", 16).notNullable().defaultTo("error");
      t.text("message");
      t.boolean("enabled").notNullable().defaultTo(true);
      t.string("created_by", 100);
      t.timestamp("created_at").defaultTo(knex.fn.now());
    });

    for (const rl of SEED_RULES) {
      await knex("validation_rules").insert({
        id: newId(),
        doc_type: rl.doc_type,
        field_key: rl.field_key,
        rule_type: rl.rule_type,
        params: JSON.stringify(rl.params),
        severity: rl.severity,
        message: rl.message,
        enabled: true,
        created_by: "system",
      });
    }
  }

  const hasResults = await knex.schema.hasTable("validation_results");
  if (!hasResults) {
    await knex.schema.createTable("validation_results", (t) => {
      t.string("id", 36).notNullable().primary();
      t.string("document_id", 36).index();
      t.string("rule_id", 36);
      t.string("doc_type", 80);
      t.string("field_key", 120).notNullable();
      t.string("rule_type", 30).notNullable();
      t.boolean("passed").notNullable();
      t.string("severity", 16).notNullable();
      t.text("message");
      t.timestamp("created_at").defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("validation_results");
  await knex.schema.dropTableIfExists("validation_rules");
}
