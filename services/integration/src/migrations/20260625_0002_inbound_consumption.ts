import type { Knex } from "knex";

/**
 * P7: Inbound consumption tracking.
 *
 * After an inbound webhook's HMAC is verified, the hub forwards the event to the
 * core ingest endpoint over HTTP. We record whether core actually consumed it so
 * operators can see (and retry) deliveries that failed while core was briefly down.
 */
export async function up(knex: Knex): Promise<void> {
  const hasConsumed = await knex.schema.hasColumn("integration_logs", "consumed");
  if (!hasConsumed) {
    await knex.schema.alterTable("integration_logs", (t) => {
      // null = not applicable (e.g. outbound / rejected), true/false for inbound forwards
      t.boolean("consumed").nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasConsumed = await knex.schema.hasColumn("integration_logs", "consumed");
  if (hasConsumed) {
    await knex.schema.alterTable("integration_logs", (t) => {
      t.dropColumn("consumed");
    });
  }
}
