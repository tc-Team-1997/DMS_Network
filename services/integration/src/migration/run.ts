import type { Knex } from "knex";
import { newId } from "@zordms/db";
import type { DocumentSink, SourceAdapter, MigrationRecord } from "./types.js";

export interface MigrationSummary {
  total: number;
  staged: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
}

export interface MigrationRunResult {
  jobId: string;
  summary: MigrationSummary;
}

/**
 * Default sink: validate + stage a record (no real core import yet). The real
 * import — fetch the legacy file via the Krystal transport and POST to core
 * /documents — is the production plug, blocked on §9.6 (source format/access).
 */
export class StagingDocumentSink implements DocumentSink {
  readonly name = "staging";
  async upsert(record: MigrationRecord, _dryRun: boolean) {
    if (!record.title) return { ok: false, error: "missing title" };
    // A real CoreDocumentSink would resolve record.sourcePath → bytes and create
    // the document in core; here we accept the mapped record as staged.
    return { ok: true };
  }
}

/**
 * Run a migration: iterate the adapter, idempotently stage each record, track
 * per-record outcomes + a job summary. Idempotent by external_id — a record
 * already staged/imported in a prior run is skipped (dry-run previews never block
 * a later real run).
 */
export async function runMigration(
  knex: Knex,
  opts: { source: string; adapter: SourceAdapter; sink: DocumentSink; dryRun?: boolean },
): Promise<MigrationRunResult> {
  const jobId = newId();
  const dryRun = !!opts.dryRun;
  await knex("migration_jobs").insert({
    id: jobId,
    source: opts.source,
    status: "running",
    dry_run: dryRun,
    started_at: new Date().toISOString(),
  });

  let total = 0, staged = 0, skipped = 0, failed = 0;

  for await (const parsed of opts.adapter.read()) {
    total++;
    if (!parsed.ok) {
      failed++;
      await knex("migration_records").insert({
        id: newId(), job_id: jobId, external_id: `__unparsed_${total}`, status: "failed", error: parsed.error,
      });
      continue;
    }

    const rec = parsed.record;
    // Idempotency: an external_id already staged/imported (any prior real run) is skipped.
    const already = await knex("migration_records")
      .where({ external_id: rec.externalId })
      .whereIn("status", ["staged", "imported"])
      .first();
    if (already) {
      skipped++;
      await knex("migration_records").insert({ id: newId(), job_id: jobId, external_id: rec.externalId, status: "skipped" });
      continue;
    }

    const result = await opts.sink.upsert(rec, dryRun);
    if (!result.ok) {
      failed++;
      await knex("migration_records").insert({
        id: newId(), job_id: jobId, external_id: rec.externalId, status: "failed", error: result.error ?? "sink_failed",
      });
      continue;
    }

    // Dry-run records are "previewed" (informational, never block a real run).
    staged++;
    await knex("migration_records").insert({
      id: newId(), job_id: jobId, external_id: rec.externalId,
      status: dryRun ? "previewed" : "staged",
      mapped_doc_id: result.docId ?? null,
    });
  }

  await knex("migration_jobs").where({ id: jobId }).update({
    status: "completed", total, staged, skipped, failed, finished_at: new Date().toISOString(),
  });

  return { jobId, summary: { total, staged, skipped, failed, dryRun } };
}
