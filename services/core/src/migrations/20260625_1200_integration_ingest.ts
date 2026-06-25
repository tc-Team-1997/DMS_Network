import type { Knex } from "knex";

/**
 * P7: Integration inbound ingest.
 *
 * The integration hub consumes external INBOUND webhooks (CBS customer-updated,
 * LOS loan-application) and forwards them to core over HTTP using the internal
 * service token. Core persists the data idempotently:
 *  - `customers`     : upserted from CBS customer-updated events (Customer 360 master).
 *  - `loan_intakes`  : upserted from LOS loan-application events (case stub + customer link).
 */
export async function up(knex: Knex): Promise<void> {
  const hasCustomers = await knex.schema.hasTable("customers");
  if (!hasCustomers) {
    await knex.schema.createTable("customers", (t) => {
      t.string("cid", 80).notNullable().primary();
      t.string("name", 200);
      t.string("branch", 120);
      t.string("segment", 80);
      t.string("kyc_status", 40);
      t.string("source", 40).notNullable().defaultTo("cbs");
      t.timestamp("created_at").defaultTo(knex.fn.now());
      t.timestamp("updated_at").defaultTo(knex.fn.now());
    });
  }

  const hasLoans = await knex.schema.hasTable("loan_intakes");
  if (!hasLoans) {
    await knex.schema.createTable("loan_intakes", (t) => {
      t.string("application_id", 80).notNullable().primary(); // external ref (idempotency key)
      t.string("cid", 80);
      t.decimal("amount", 18, 2);
      t.string("product", 80);
      t.string("state", 40).notNullable().defaultTo("RECEIVED");
      t.string("source", 40).notNullable().defaultTo("los");
      t.timestamp("created_at").defaultTo(knex.fn.now());
      t.timestamp("updated_at").defaultTo(knex.fn.now());
      t.index(["cid"]);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("loan_intakes");
  await knex.schema.dropTableIfExists("customers");
}
