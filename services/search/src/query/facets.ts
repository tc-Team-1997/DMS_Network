type FacetRow = { doc_type: string; status: string; branch: string; risk_band: string };

const DIMENSIONS: Array<keyof FacetRow> = ["doc_type", "status", "branch", "risk_band"];

export function aggregateFacets(rows: FacetRow[]): Record<string, Array<{ value: string; count: number }>> {
  const out: Record<string, Array<{ value: string; count: number }>> = {};
  for (const dim of DIMENSIONS) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r[dim];
      if (v == null) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    out[dim] = [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  }
  return out;
}
