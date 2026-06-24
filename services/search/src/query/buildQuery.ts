import type { Knex } from "knex";
import type { SearchFilters, SearchMode, SearchScope } from "@zordms/types";

export function applyScope(qb: Knex.QueryBuilder, scope: SearchScope): Knex.QueryBuilder {
  if (scope.crossBranch) return qb;
  if (scope.branch) {
    qb.where("branch", scope.branch);
  } else {
    // No branch assigned and no crossbranch permission: deny everything (fail closed).
    qb.whereRaw("1 = 0");
  }
  return qb;
}

export function applyFilters(qb: Knex.QueryBuilder, filters: SearchFilters = {}): Knex.QueryBuilder {
  if (filters.doc_type) qb.where("doc_type", filters.doc_type);
  if (filters.status) qb.where("status", filters.status);
  if (filters.branch) qb.where("branch", filters.branch);
  if (filters.uploaded_by) qb.where("uploaded_by", filters.uploaded_by);
  if (filters.risk_band) qb.where("risk_band", filters.risk_band);
  if (typeof filters.legal_hold === "boolean") qb.where("legal_hold", filters.legal_hold);
  if (filters.expiry_status) qb.where("expiry_status", filters.expiry_status);
  if (filters.date_from) qb.where("indexed_at", ">=", filters.date_from);
  if (filters.date_to) qb.where("indexed_at", "<=", filters.date_to);
  return qb;
}

const STOP = new Set(["and", "or", "not"]);

function terms(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
}

export function applyTextMatch(qb: Knex.QueryBuilder, text: string, mode: SearchMode): Knex.QueryBuilder {
  if (!text.trim()) return qb;

  if (mode === "boolean") {
    const toks = text.split(/\s+/);
    // Wrap all OR/AND positive terms in a grouped sub-clause so the outer branch
    // scope filter (set by applyScope) cannot be short-circuited by a top-level OR.
    qb.where((group) => {
      let i = 0;
      while (i < toks.length) {
        const t = toks[i];
        const up = t.toUpperCase();
        if (up === "OR") {
          const next = toks[i + 1];
          if (next) group.orWhereILike("tokens", `%${next.toLowerCase()}%`);
          i += 2; continue;
        }
        if (up === "NOT") {
          const next = toks[i + 1];
          if (next) group.whereNot((b) => b.whereILike("tokens", `%${next.toLowerCase()}%`));
          i += 2; continue;
        }
        if (up === "AND") { i += 1; continue; }
        group.whereILike("tokens", `%${t.toLowerCase()}%`);
        i += 1;
      }
    });
    return qb;
  }

  if (mode === "wildcard") {
    for (const raw of terms(text)) {
      if (STOP.has(raw)) continue;
      const pat = raw.replace(/\*/g, "%").replace(/\?/g, "_");
      qb.whereILike("tokens", `%${pat}%`);
    }
    return qb;
  }

  // fulltext | fuzzy | semantic (Phase-1 placeholder) -> AND of LIKE terms
  for (const raw of terms(text)) {
    if (STOP.has(raw)) continue;
    qb.whereILike("tokens", `%${raw}%`);
  }
  return qb;
}

export function scoreHit(tokens: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;
  const lc = tokens.toLowerCase();
  let matched = 0;
  for (const t of queryTerms) if (t && lc.includes(t.toLowerCase())) matched += 1;
  return Math.min(1, matched / queryTerms.length);
}

export function paginate(page = 1, pageSize = 20, maxSize = 100): { limit: number; offset: number } {
  const size = Math.min(Math.max(1, pageSize), maxSize);
  const p = Math.max(1, page);
  return { limit: size, offset: (p - 1) * size };
}
