import type { Knex } from "knex";
import { newId } from "@zordms/db";

/**
 * Reports run-engine + definitions repository (§4.10).
 *
 * Aggregations run only over core-owned tables (DB-per-service: cases live in
 * the workflow DB). Every column is whitelisted per source — no caller-supplied
 * identifier ever reaches SQL, so group-by / measures / filters are injection-safe.
 */

interface SourceSpec {
  table: string;
  groupable: string[];
  numeric: string[];
  filterable: string[];
}

const SOURCES: Record<string, SourceSpec> = {
  documents: {
    table: "documents",
    groupable: ["doc_type", "branch", "status", "catalog_category", "source_channel", "review_flag"],
    numeric: ["confidence", "file_size_bytes", "page_count"],
    filterable: ["doc_type", "branch", "status", "catalog_category", "source_channel", "review_flag"],
  },
  jobs: {
    table: "jobs",
    groupable: ["type", "status"],
    numeric: ["attempts", "max_attempts"],
    filterable: ["type", "status"],
  },
  customers: {
    table: "customers",
    groupable: ["branch", "segment", "kyc_status"],
    numeric: [],
    filterable: ["branch", "segment", "kyc_status"],
  },
};

export type MeasureFn = "count" | "sum" | "avg" | "min" | "max";
export interface Measure { fn: MeasureFn; field?: string; alias?: string }

export interface ReportSpec {
  source: string;
  groupBy?: string[];
  measures?: Measure[];
  filters?: Record<string, unknown>;
}

export interface ReportRunResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export class ReportSpecError extends Error {}

export function listSources(): Array<{ source: string; groupable: string[]; numeric: string[] }> {
  return Object.entries(SOURCES).map(([source, s]) => ({ source, groupable: s.groupable, numeric: s.numeric }));
}

/** Run an ad-hoc report. Throws ReportSpecError on any non-whitelisted input. */
export async function runReport(knex: Knex, spec: ReportSpec): Promise<ReportRunResult> {
  const src = SOURCES[spec.source];
  if (!src) throw new ReportSpecError(`unknown source: ${spec.source}`);

  const groupBy = spec.groupBy ?? [];
  for (const g of groupBy) {
    if (!src.groupable.includes(g)) throw new ReportSpecError(`invalid group_by column: ${g}`);
  }

  const measures: Measure[] = spec.measures && spec.measures.length > 0 ? spec.measures : [{ fn: "count", alias: "count" }];
  const measureAliases: string[] = [];
  for (const m of measures) {
    if (m.fn !== "count") {
      if (!m.field || !src.numeric.includes(m.field)) {
        throw new ReportSpecError(`invalid measure field for ${m.fn}: ${m.field ?? "(none)"}`);
      }
    }
    measureAliases.push(m.alias || (m.fn === "count" ? "count" : `${m.fn}_${m.field}`));
  }

  let q = knex(src.table);

  // Equality filters (whitelisted columns only).
  for (const [col, val] of Object.entries(spec.filters ?? {})) {
    if (!src.filterable.includes(col)) throw new ReportSpecError(`invalid filter column: ${col}`);
    q = q.where(col, val as any);
  }

  // Select group-by columns verbatim (already whitelisted).
  if (groupBy.length > 0) q = q.select(groupBy).groupBy(groupBy);

  // Aggregate measures.
  measures.forEach((m, i) => {
    const alias = measureAliases[i];
    if (m.fn === "count") q = q.count({ [alias]: "*" });
    else q = (q as any)[m.fn]({ [alias]: m.field });
  });

  const rows = (await q) as Array<Record<string, unknown>>;
  // Coerce aggregate values (knex returns count as string on some drivers) to numbers.
  for (const row of rows) {
    for (const alias of measureAliases) {
      if (row[alias] !== null && row[alias] !== undefined) row[alias] = Number(row[alias]);
    }
  }
  return { columns: [...groupBy, ...measureAliases], rows };
}

/** Render a run result to CSV (RFC-4180-ish: quote + escape). */
export function toCsv(result: ReportRunResult): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = result.columns.map(esc).join(",");
  const lines = result.rows.map((r) => result.columns.map((c) => esc(r[c])).join(","));
  return [header, ...lines].join("\n");
}

// ── Definitions (library) CRUD ─────────────────────────────────────────────────
export interface ReportDefinition extends ReportSpec {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

function rowToDef(row: Record<string, unknown>): ReportDefinition {
  const parse = (s: unknown, fallback: unknown) => { try { return JSON.parse(String(s)); } catch { return fallback; } };
  return {
    id: String(row.id),
    name: String(row.name),
    description: (row.description as string) ?? null,
    source: String(row.source),
    groupBy: parse(row.group_by, []),
    measures: parse(row.measures, []),
    filters: parse(row.filters, {}),
    createdBy: (row.created_by as string) ?? null,
    createdAt: (row.created_at as string) ?? null,
  };
}

export async function listDefinitions(knex: Knex): Promise<ReportDefinition[]> {
  const rows = await knex("report_definitions").select("*").orderBy("created_at", "desc");
  return rows.map(rowToDef);
}

export async function getDefinition(knex: Knex, id: string): Promise<ReportDefinition | null> {
  const row = await knex("report_definitions").where({ id }).first();
  return row ? rowToDef(row) : null;
}

export async function createDefinition(
  knex: Knex,
  input: { name: string; description?: string; source: string; groupBy?: string[]; measures?: Measure[]; filters?: Record<string, unknown>; createdBy?: string },
): Promise<ReportDefinition> {
  if (!SOURCES[input.source]) throw new ReportSpecError(`unknown source: ${input.source}`);
  const id = newId();
  await knex("report_definitions").insert({
    id,
    name: input.name,
    description: input.description ?? null,
    source: input.source,
    group_by: JSON.stringify(input.groupBy ?? []),
    measures: JSON.stringify(input.measures ?? []),
    filters: JSON.stringify(input.filters ?? {}),
    created_by: input.createdBy ?? null,
  });
  return rowToDef((await knex("report_definitions").where({ id }).first())!);
}

export async function deleteDefinition(knex: Knex, id: string): Promise<boolean> {
  return (await knex("report_definitions").where({ id }).del()) > 0;
}
