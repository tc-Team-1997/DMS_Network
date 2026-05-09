/**
 * BpmnCanvas — pure-SVG BPMN-style workflow canvas.
 *
 * Renders nodes (stages, decisions, parallel gateways, EDD case, start/end)
 * and directional edges between them. Supports drag-to-reposition nodes when
 * `readonly` is false. No external dependencies.
 *
 * Accessibility:
 *  - Each node is a <g role="button" aria-label="..."> when editable.
 *  - Arrow marker defined once in <defs>.
 *  - High-contrast Tailwind tokens only (no raw hex).
 */

import { useCallback, useId, useRef } from 'react';
import { cn } from '@/lib/cn';
import type { CanvasData, CanvasNode } from '../schemas';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const NODE_W = 140;
const NODE_H = 48;
const DIAMOND_SIZE = 44;
const GATEWAY_SIZE = 40;
const CIRCLE_R = 20;

/** Centre point of a node bounding box (used for edge routing). */
function nodeCentre(node: CanvasNode): [number, number] {
  switch (node.type) {
    case 'start':
    case 'end':
      return [node.x + CIRCLE_R, node.y + CIRCLE_R];
    case 'decision':
      return [node.x + DIAMOND_SIZE, node.y + DIAMOND_SIZE];
    case 'parallel-split':
    case 'parallel-join':
      return [node.x + GATEWAY_SIZE / 2, node.y + GATEWAY_SIZE / 2];
    default:
      return [node.x + NODE_W / 2, node.y + NODE_H / 2];
  }
}

/** Build an SVG path string for an edge between two nodes. */
function edgePath(from: CanvasNode, to: CanvasNode): string {
  const [x1, y1] = nodeCentre(from);
  const [x2, y2] = nodeCentre(to);
  // Step-route: horizontal mid-point with a vertical jog.
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Individual node renderers
// ---------------------------------------------------------------------------

function StageRect({
  node,
  selected,
  highlighted,
  onPointerDown,
  isEdd,
}: {
  node: CanvasNode;
  selected: boolean;
  highlighted: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  isEdd: boolean;
}) {
  const baseClasses = cn(
    'cursor-grab active:cursor-grabbing',
  );
  const fillColor    = highlighted ? '#E3EFFF' : selected ? '#DBEAFE' : '#FFFFFF';
  const strokeColor  = highlighted ? '#1565C0' : selected ? '#1565C0' : isEdd ? '#7F77DD' : '#D3D1C7';
  const strokeWidth  = isEdd ? 3 : selected || highlighted ? 2 : 1.5;

  return (
    <g
      className={baseClasses}
      onPointerDown={onPointerDown}
      role="button"
      aria-label={`Stage: ${node.label}`}
      tabIndex={0}
    >
      <rect
        x={node.x}
        y={node.y}
        width={NODE_W}
        height={NODE_H}
        rx={8}
        ry={8}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
      {/* Inner ring for EDD */}
      {isEdd && (
        <rect
          x={node.x + 4}
          y={node.y + 4}
          width={NODE_W - 8}
          height={NODE_H - 8}
          rx={5}
          ry={5}
          fill="none"
          stroke="#7F77DD"
          strokeWidth={1}
        />
      )}
      <text
        x={node.x + NODE_W / 2}
        y={node.y + NODE_H / 2 - 6}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={12}
        fontWeight={600}
        fill="#2C2C2A"
        pointerEvents="none"
      >
        {node.label.length > 18 ? `${node.label.slice(0, 16)}…` : node.label}
      </text>
      {node.role && (
        <text
          x={node.x + NODE_W / 2}
          y={node.y + NODE_H / 2 + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={10}
          fill="#888780"
          pointerEvents="none"
        >
          {node.role}
        </text>
      )}
    </g>
  );
}

function DecisionDiamond({
  node,
  selected,
  highlighted,
  onPointerDown,
}: {
  node: CanvasNode;
  selected: boolean;
  highlighted: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const cx = node.x + DIAMOND_SIZE;
  const cy = node.y + DIAMOND_SIZE;
  const s  = DIAMOND_SIZE;
  const pts = `${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`;
  const fill   = highlighted ? '#E3EFFF' : selected ? '#FEF3C7' : '#FFFBEB';
  const stroke = highlighted ? '#1565C0' : selected ? '#EF9F27' : '#D3D1C7';

  return (
    <g
      onPointerDown={onPointerDown}
      role="button"
      aria-label={`Decision: ${node.label}`}
      tabIndex={0}
      className="cursor-grab active:cursor-grabbing"
    >
      <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={10}
        fill="#2C2C2A"
        pointerEvents="none"
      >
        {node.label.length > 12 ? `${node.label.slice(0, 10)}…` : node.label}
      </text>
    </g>
  );
}

function GatewayNode({
  node,
  selected,
  highlighted,
  onPointerDown,
}: {
  node: CanvasNode;
  selected: boolean;
  highlighted: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const s = GATEWAY_SIZE;
  const cx = node.x + s / 2;
  const cy = node.y + s / 2;
  const pts = `${cx},${cy - s / 2} ${cx + s / 2},${cy} ${cx},${cy + s / 2} ${cx - s / 2},${cy}`;
  const fill   = highlighted ? '#E0F5EE' : selected ? '#D1FAE5' : '#F0FDF4';
  const stroke = highlighted ? '#1565C0' : selected ? '#1D9E75' : '#D3D1C7';

  return (
    <g
      onPointerDown={onPointerDown}
      role="button"
      aria-label={`Gateway: ${node.label}`}
      tabIndex={0}
      className="cursor-grab active:cursor-grabbing"
    >
      <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={1.5} />
      {/* Plus sign */}
      <line x1={cx} y1={cy - 10} x2={cx} y2={cy + 10} stroke={stroke} strokeWidth={2} />
      <line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} stroke={stroke} strokeWidth={2} />
    </g>
  );
}

function CircleNode({
  node,
  selected,
  highlighted,
  onPointerDown,
}: {
  node: CanvasNode;
  selected: boolean;
  highlighted: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const cx = node.x + CIRCLE_R;
  const cy = node.y + CIRCLE_R;
  const isEnd = node.type === 'end';
  const fill   = isEnd ? (highlighted ? '#E24B4A' : '#FCEBEB') : (highlighted ? '#E3EFFF' : '#F7F6F2');
  const stroke = highlighted ? '#1565C0' : selected ? '#1565C0' : isEnd ? '#E24B4A' : '#D3D1C7';

  return (
    <g
      onPointerDown={onPointerDown}
      role="button"
      aria-label={`${isEnd ? 'End' : 'Start'} event`}
      tabIndex={0}
      className="cursor-grab active:cursor-grabbing"
    >
      <circle cx={cx} cy={cy} r={CIRCLE_R} fill={fill} stroke={stroke} strokeWidth={isEnd ? 3 : 1.5} />
      {isEnd && <circle cx={cx} cy={cy} r={CIRCLE_R - 5} fill={stroke} />}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface BpmnCanvasProps {
  data:              CanvasData;
  onChange?:         (data: CanvasData) => void;
  readonly?:         boolean;
  highlightedNodes?: ReadonlySet<string>;
  selectedNodeId?:   string | null;
  onSelectNode?:     (id: string | null) => void;
  className?:        string;
}

export function BpmnCanvas({
  data,
  onChange,
  readonly = false,
  highlightedNodes,
  selectedNodeId,
  onSelectNode,
  className,
}: BpmnCanvasProps) {
  const markerId = useId();
  const svgRef   = useRef<SVGSVGElement>(null);

  // Drag state.
  const dragRef = useRef<{
    nodeId:   string;
    offsetX:  number;
    offsetY:  number;
  } | null>(null);

  // Build lookup maps.
  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));

  // Calculate SVG dimensions from node positions.
  const maxX = data.nodes.reduce((m, n) => Math.max(m, n.x + 200), 600);
  const maxY = data.nodes.reduce((m, n) => Math.max(m, n.y + 120), 300);

  // ---------------------------------------------------------------------------
  // Drag handlers
  // ---------------------------------------------------------------------------

  const handlePointerDown = useCallback(
    (nodeId: string) => (e: React.PointerEvent) => {
      if (readonly) return;
      e.stopPropagation();
      onSelectNode?.(nodeId);
      const svg = svgRef.current;
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
      const node = nodeById.get(nodeId);
      if (!node || !svgPt) return;
      dragRef.current = {
        nodeId,
        offsetX: svgPt.x - node.x,
        offsetY: svgPt.y - node.y,
      };
      svg.setPointerCapture(e.pointerId);
    },
    [readonly, nodeById, onSelectNode],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragRef.current || readonly) return;
      const svg = svgRef.current;
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
      if (!svgPt) return;
      const { nodeId, offsetX, offsetY } = dragRef.current;
      const newX = Math.max(0, svgPt.x - offsetX);
      const newY = Math.max(0, svgPt.y - offsetY);
      onChange?.({
        ...data,
        nodes: data.nodes.map((n) =>
          n.id === nodeId ? { ...n, x: newX, y: newY } : n,
        ),
      });
    },
    [readonly, data, onChange],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragRef.current) return;
      const svg = svgRef.current;
      svg?.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    },
    [],
  );

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.target === svgRef.current) onSelectNode?.(null);
    },
    [onSelectNode],
  );

  return (
    <svg
      ref={svgRef}
      className={cn(
        'w-full border border-divider rounded-card bg-surface select-none',
        className,
      )}
      style={{ minHeight: Math.max(maxY + 80, 300) }}
      viewBox={`0 0 ${maxX + 80} ${maxY + 80}`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleSvgClick}
      aria-label="Workflow BPMN canvas"
      role="img"
    >
      <defs>
        <marker
          id={`${markerId}-arrow`}
          markerWidth={10}
          markerHeight={7}
          refX={9}
          refY={3.5}
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="#888780" />
        </marker>
      </defs>

      {/* Grid dots (subtle background) */}
      <pattern id={`${markerId}-grid`} width={24} height={24} patternUnits="userSpaceOnUse">
        <circle cx={1} cy={1} r={1} fill="#D3D1C7" opacity={0.5} />
      </pattern>
      <rect
        width="100%"
        height="100%"
        fill={`url(#${markerId}-grid)`}
        className="pointer-events-none"
      />

      {/* Edges layer */}
      {data.edges.map((edge) => {
        const fromNode = nodeById.get(edge.from);
        const toNode   = nodeById.get(edge.to);
        if (!fromNode || !toNode) return null;
        return (
          <g key={edge.id}>
            <path
              d={edgePath(fromNode, toNode)}
              fill="none"
              stroke="#888780"
              strokeWidth={1.5}
              markerEnd={`url(#${markerId}-arrow)`}
            />
            {edge.label && (
              <text
                x={(nodeCentre(fromNode)[0] + nodeCentre(toNode)[0]) / 2}
                y={(nodeCentre(fromNode)[1] + nodeCentre(toNode)[1]) / 2 - 6}
                textAnchor="middle"
                fontSize={10}
                fill="#5F5E5A"
              >
                {edge.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Nodes layer */}
      {data.nodes.map((node) => {
        const selected    = selectedNodeId === node.id;
        const highlighted = highlightedNodes?.has(node.id) ?? false;
        const baseProps = { node, selected, highlighted };
        const onPointerDown = readonly ? undefined : handlePointerDown(node.id);
        const interactiveProps = onPointerDown ? { ...baseProps, onPointerDown } : baseProps;

        switch (node.type) {
          case 'stage':
            return (
              <StageRect key={node.id} {...interactiveProps} isEdd={false} />
            );
          case 'edd-case':
            return (
              <StageRect key={node.id} {...interactiveProps} isEdd />
            );
          case 'decision':
            return <DecisionDiamond key={node.id} {...interactiveProps} />;
          case 'parallel-split':
          case 'parallel-join':
            return <GatewayNode key={node.id} {...interactiveProps} />;
          case 'start':
          case 'end':
            return <CircleNode key={node.id} {...interactiveProps} />;
          default:
            return null;
        }
      })}
    </svg>
  );
}
