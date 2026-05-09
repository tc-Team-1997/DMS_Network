/**
 * BranchDoctypeHeatmap — pure CSS grid heatmap (no recharts).
 *
 * Rows = branches, columns = doc types. Cell color intensity reflects backlog
 * volume relative to the max cell value. Clicking a cell navigates to
 * /workflows?branch=...&doctype=... (link; actual Workflows v2 drill-down wiring
 * is deferred to the Workflows v2 owner).
 *
 * Statically imported — no recharts, no lazy load needed.
 */

import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/ui';
import type { HeatmapCell } from '../schemas';

interface BranchDoctypeHeatmapProps {
  data: HeatmapCell[];
}

/** Returns a Tailwind bg class based on relative intensity 0–1. */
function intensityClass(ratio: number): string {
  if (ratio >= 0.75) return 'bg-brand-navy text-white';
  if (ratio >= 0.50) return 'bg-brand-blue text-white';
  if (ratio >= 0.25) return 'bg-brand-sky text-white';
  if (ratio >  0)    return 'bg-brand-skyLight text-brand-blue';
  return 'bg-divider text-muted';
}

export function BranchDoctypeHeatmap({ data }: BranchDoctypeHeatmapProps) {
  const navigate = useNavigate();

  if (data.length === 0) {
    return (
      <EmptyState
        title="No backlog data"
        body="Documents will appear here once the pipeline has activity in the selected window."
      />
    );
  }

  // Derive unique branches and doc_types (ordered by frequency)
  const branchSet = new Set<string>();
  const doctypeSet = new Set<string>();
  const cellMap = new Map<string, number>();

  for (const row of data) {
    branchSet.add(row.branch);
    doctypeSet.add(row.doc_type);
    cellMap.set(`${row.branch}|${row.doc_type}`, row.cnt);
  }

  const branches = Array.from(branchSet);
  const doctypes = Array.from(doctypeSet);
  const maxVal   = Math.max(...Array.from(cellMap.values()), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            {/* Corner */}
            <th className="text-left text-muted font-medium pb-1 pr-2 whitespace-nowrap">
              Branch
            </th>
            {doctypes.map((dt) => (
              <th
                key={dt}
                className="text-center text-muted font-medium pb-1 px-1 whitespace-nowrap max-w-[80px] overflow-hidden text-ellipsis"
                title={dt}
              >
                {dt.length > 10 ? `${dt.slice(0, 9)}…` : dt}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {branches.map((branch) => (
            <tr key={branch}>
              <td className="text-muted font-medium pr-2 whitespace-nowrap">{branch}</td>
              {doctypes.map((dt) => {
                const cnt   = cellMap.get(`${branch}|${dt}`) ?? 0;
                const ratio = cnt / maxVal;
                return (
                  <td key={dt} className="text-center">
                    <button
                      type="button"
                      title={`${branch} / ${dt}: ${cnt} document${cnt !== 1 ? 's' : ''} in backlog`}
                      onClick={() => {
                        void navigate(
                          `/workflows?branch=${encodeURIComponent(branch)}&doctype=${encodeURIComponent(dt)}`,
                        );
                      }}
                      className={`w-full min-w-[40px] rounded-input py-1.5 font-mono text-xs font-medium transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-brand-blue ${intensityClass(ratio)}`}
                    >
                      {cnt > 0 ? cnt : ''}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
