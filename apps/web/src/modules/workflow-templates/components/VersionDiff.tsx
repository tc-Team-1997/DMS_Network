/**
 * VersionDiff — visual diff between two CanvasData snapshots.
 * Added nodes → green, removed → red, modified → amber, unchanged → muted.
 */

import type { CanvasData } from '../schemas';
import type { CanvasDiff, DiffKind, NodeDiff, EdgeDiff } from '../schemas';

function computeDiff(prev: CanvasData, next: CanvasData): CanvasDiff {
  const prevNodeMap = new Map(prev.nodes.map((n) => [n.id, n]));
  const nextNodeMap = new Map(next.nodes.map((n) => [n.id, n]));
  const prevEdgeMap = new Map(prev.edges.map((e) => [e.id, e]));
  const nextEdgeMap = new Map(next.edges.map((e) => [e.id, e]));

  const nodes: NodeDiff[] = [];
  const edges: EdgeDiff[] = [];

  // Check next nodes.
  for (const [id, node] of nextNodeMap) {
    const prev_ = prevNodeMap.get(id);
    if (!prev_) {
      nodes.push({ node, kind: 'added' });
    } else if (JSON.stringify(prev_) !== JSON.stringify(node)) {
      nodes.push({ node, kind: 'modified' });
    } else {
      nodes.push({ node, kind: 'unchanged' });
    }
  }
  // Removed nodes.
  for (const [id, node] of prevNodeMap) {
    if (!nextNodeMap.has(id)) {
      nodes.push({ node, kind: 'removed' });
    }
  }

  // Check next edges.
  for (const [id, edge] of nextEdgeMap) {
    const prev_ = prevEdgeMap.get(id);
    if (!prev_) {
      edges.push({ edge, kind: 'added' });
    } else if (JSON.stringify(prev_) !== JSON.stringify(edge)) {
      edges.push({ edge, kind: 'modified' });
    } else {
      edges.push({ edge, kind: 'unchanged' });
    }
  }
  for (const [id, edge] of prevEdgeMap) {
    if (!nextEdgeMap.has(id)) {
      edges.push({ edge, kind: 'removed' });
    }
  }

  return { nodes, edges };
}

const kindStyles: Record<DiffKind, { badge: string; row: string }> = {
  added:     { badge: 'bg-success text-white',               row: 'bg-success/10 border-success/30' },
  removed:   { badge: 'bg-danger text-white',                row: 'bg-danger/10 border-danger/30' },
  modified:  { badge: 'bg-warning text-white',               row: 'bg-warning/10 border-warning/30' },
  unchanged: { badge: 'bg-divider text-muted',               row: 'border-divider' },
};

const kindLabel: Record<DiffKind, string> = {
  added:     '+ added',
  removed:   '− removed',
  modified:  '~ modified',
  unchanged: '· unchanged',
};

interface VersionDiffProps {
  prev: CanvasData;
  next: CanvasData;
  prevLabel?: string;
  nextLabel?: string;
}

export function VersionDiff({
  prev,
  next,
  prevLabel = 'Previous version',
  nextLabel = 'This version',
}: VersionDiffProps) {
  const diff = computeDiff(prev, next);

  const changed = diff.nodes.filter((n) => n.kind !== 'unchanged');
  const changedEdges = diff.edges.filter((e) => e.kind !== 'unchanged');

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted">{prevLabel} → {nextLabel}</span>
        {(['added', 'removed', 'modified', 'unchanged'] as DiffKind[]).map((k) => (
          <span
            key={k}
            className={`text-2xs px-2 py-0.5 rounded-badge font-medium ${kindStyles[k].badge}`}
          >
            {kindLabel[k]}
          </span>
        ))}
      </div>

      {/* Nodes */}
      <div>
        <h4 className="text-xs font-semibold text-ink mb-2">
          Stages / Nodes{' '}
          <span className="text-muted font-normal">({diff.nodes.length} total, {changed.length} changed)</span>
        </h4>
        {diff.nodes.length === 0 && (
          <p className="text-xs text-muted">No nodes.</p>
        )}
        <ul className="space-y-1">
          {diff.nodes.map((nd, i) => (
            <DiffRow key={`node-${i}`} kind={nd.kind} label={nd.node.label} sub={nd.node.type} />
          ))}
        </ul>
      </div>

      {/* Edges */}
      {(diff.edges.length > 0) && (
        <div>
          <h4 className="text-xs font-semibold text-ink mb-2">
            Edges{' '}
            <span className="text-muted font-normal">({diff.edges.length} total, {changedEdges.length} changed)</span>
          </h4>
          <ul className="space-y-1">
            {diff.edges
              .filter((ed) => ed.kind !== 'unchanged')
              .map((ed, i) => (
                <DiffRow
                  key={`edge-${i}`}
                  kind={ed.kind}
                  label={ed.edge.label ?? `${ed.edge.from} → ${ed.edge.to}`}
                  sub="edge"
                />
              ))}
          </ul>
        </div>
      )}

      {changed.length === 0 && changedEdges.length === 0 && (
        <p className="text-xs text-muted py-2">No differences between these versions.</p>
      )}
    </div>
  );
}

function DiffRow({ kind, label, sub }: { kind: DiffKind; label: string; sub: string }) {
  const s = kindStyles[kind];
  return (
    <li className={`flex items-center gap-2 rounded-input border px-3 py-1.5 ${s.row}`}>
      <span className={`text-2xs px-1.5 py-0.5 rounded-badge font-semibold flex-shrink-0 ${s.badge}`}>
        {kindLabel[kind]}
      </span>
      <span className="text-xs font-medium text-ink">{label}</span>
      <span className="text-2xs text-muted ml-auto">{sub}</span>
    </li>
  );
}
