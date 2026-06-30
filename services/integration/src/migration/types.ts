/**
 * Krystal legacy-migration contracts (§6.15).
 *
 * The legacy DMS export format + file transport are Krystal-specific and not yet
 * confirmed (§9.6). They are isolated behind SourceAdapter / DocumentSink so the
 * pipeline (validate → idempotent stage → track) is real and testable today, and
 * the real Krystal export plugs in as one SourceAdapter implementation later.
 */

/** A normalized legacy document record (the intermediate format the pipeline maps to). */
export interface MigrationRecord {
  externalId: string;
  title: string;
  docType?: string;
  filename?: string;
  metadata?: Record<string, unknown>;
  /** Where the legacy file lives — resolved by the file transport (Krystal-specific, TBD). */
  sourcePath?: string;
}

/** A parsed line: a valid record, or a parse/validation failure carrying the raw input. */
export type ParsedRecord =
  | { ok: true; record: MigrationRecord }
  | { ok: false; raw: string; error: string };

/** Yields parsed records from some legacy export. The default is JSONL; the real
 *  Krystal adapter (their export format/transport) implements the same interface. */
export interface SourceAdapter {
  readonly name: string;
  read(): AsyncIterable<ParsedRecord>;
}

export interface SinkResult {
  ok: boolean;
  docId?: string;
  error?: string;
}

/** Where mapped records go. The default stages them; a CoreDocumentSink that
 *  fetches the legacy file and POSTs to core /documents is the production plug. */
export interface DocumentSink {
  readonly name: string;
  upsert(record: MigrationRecord, dryRun: boolean): Promise<SinkResult>;
}
