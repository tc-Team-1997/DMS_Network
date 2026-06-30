import type { ParsedRecord, SourceAdapter, MigrationRecord } from "./types.js";

/**
 * Default source adapter: one JSON object per line (JSONL). This is the
 * intermediate format a Krystal export should target until the native format is
 * confirmed (§9.6). Lenient — a malformed/invalid line yields a failure record
 * (counted as `failed`) instead of aborting the whole run.
 */
export class JsonlSourceAdapter implements SourceAdapter {
  readonly name = "jsonl";
  constructor(private readonly text: string) {}

  async *read(): AsyncIterable<ParsedRecord> {
    const lines = this.text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield mapLine(trimmed);
    }
  }
}

/** In-memory adapter for callers that already hold parsed objects (e.g. a JSON body). */
export class ObjectSourceAdapter implements SourceAdapter {
  readonly name = "objects";
  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  async *read(): AsyncIterable<ParsedRecord> {
    for (const row of this.rows) yield mapObject(row, JSON.stringify(row));
  }
}

function mapLine(raw: string): ParsedRecord {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    return { ok: false, raw, error: `invalid_json: ${(e as Error).message}` };
  }
  return mapObject(obj, raw);
}

function mapObject(obj: Record<string, unknown>, raw: string): ParsedRecord {
  const externalId = String(obj.external_id ?? obj.externalId ?? "").trim();
  if (!externalId) return { ok: false, raw, error: "missing external_id" };
  const title = String(obj.title ?? "").trim();
  if (!title) return { ok: false, raw, error: `missing title (external_id=${externalId})` };

  const record: MigrationRecord = {
    externalId,
    title,
    docType: (obj.doc_type ?? obj.docType) as string | undefined,
    filename: obj.filename as string | undefined,
    metadata: (obj.metadata as Record<string, unknown>) ?? undefined,
    sourcePath: (obj.source_path ?? obj.sourcePath) as string | undefined,
  };
  return { ok: true, record };
}
