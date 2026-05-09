/**
 * Pure-JS DMN evaluation engine (no npm deps).
 *
 * Evaluates a DMN decision table against a set of facts and returns
 * the first matching rule's output ("hit policy: FIRST").
 *
 * Supported condition operators:
 *   - string/number literal  → equality
 *   - { eq }                 → equality
 *   - { neq }                → not-equal
 *   - { gt, gte, lt, lte }   → numeric comparison (can combine)
 *   - { in: [...] }          → array membership
 *
 * An empty conditions map {} is a catch-all that always matches.
 */

import type {
  CanvasData,
  CanvasNode,
  DmnMap,
  DmnRule,
  DmnTable,
  SlaMap,
  SimulationEvent,
} from './schemas';
import type { DmnCondition } from './schemas';

// ---------------------------------------------------------------------------
// Single-condition evaluation
// ---------------------------------------------------------------------------

function evalCondition(fact: unknown, condition: DmnCondition): boolean {
  // Primitive literal — simple equality.
  if (typeof condition === 'string' || typeof condition === 'number') {
    return fact === condition;
  }

  // Object operator form.
  const c = condition;

  if ('eq' in c && c.eq !== undefined) {
    if (fact !== c.eq) return false;
  }
  if ('neq' in c && c.neq !== undefined) {
    if (fact === c.neq) return false;
  }
  if ('gt' in c && c.gt !== undefined) {
    if (typeof fact !== 'number' || fact <= c.gt) return false;
  }
  if ('gte' in c && c.gte !== undefined) {
    if (typeof fact !== 'number' || fact < c.gte) return false;
  }
  if ('lt' in c && c.lt !== undefined) {
    if (typeof fact !== 'number' || fact >= c.lt) return false;
  }
  if ('lte' in c && c.lte !== undefined) {
    if (typeof fact !== 'number' || fact > c.lte) return false;
  }
  if ('in' in c && c.in !== undefined) {
    if (!c.in.includes(fact as string | number)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

function evalRule(rule: DmnRule, facts: Record<string, unknown>): boolean {
  for (const [variable, condition] of Object.entries(rule.conditions)) {
    const fact = facts[variable];
    if (!evalCondition(fact, condition)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Table evaluation — FIRST hit policy
// ---------------------------------------------------------------------------

export interface DmnEvalResult {
  matched:     boolean;
  ruleIndex:   number;
  output:      string;
}

export function evaluateDmn(
  table: DmnTable,
  facts: Record<string, unknown>,
): DmnEvalResult {
  for (let i = 0; i < table.rules.length; i++) {
    const rule = table.rules[i];
    if (rule !== undefined && evalRule(rule, facts)) {
      return { matched: true, ruleIndex: i, output: rule.output };
    }
  }
  return { matched: false, ruleIndex: -1, output: '' };
}

// ---------------------------------------------------------------------------
// Simulation runner
// ---------------------------------------------------------------------------

const MAX_HOPS = 100; // guard against infinite loops in circular graphs

/**
 * Simulate a workflow traversal given a canvas + DMN tables + SLA map + facts.
 * Returns an ordered array of SimulationEvents.
 */
export function simulateWorkflow({
  canvas,
  dmnMap,
  slaMap,
  facts,
}: {
  canvas:  CanvasData;
  dmnMap:  DmnMap;
  slaMap:  SlaMap;
  facts:   Record<string, unknown>;
}): SimulationEvent[] {
  const events: SimulationEvent[] = [];

  // Index nodes and edges for O(1) lookup.
  const nodeById = new Map<string, CanvasNode>(
    canvas.nodes.map((n) => [n.id, n]),
  );
  const edgesFrom = new Map<string, typeof canvas.edges[number][]>();
  for (const edge of canvas.edges) {
    const bucket = edgesFrom.get(edge.from) ?? [];
    bucket.push(edge);
    edgesFrom.set(edge.from, bucket);
  }

  // Find start node — prefer explicit 'start' type, fall back to first stage node.
  const startNode =
    canvas.nodes.find((n) => n.type === 'start') ??
    canvas.nodes.find((n) => n.type === 'stage' || n.type === 'edd-case');

  if (!startNode) {
    events.push({ kind: 'error', message: 'No start node found in canvas' });
    return events;
  }

  let currentNodeId: string | null = startNode.id;
  let hops = 0;

  while (currentNodeId !== null && hops < MAX_HOPS) {
    hops++;
    const node = nodeById.get(currentNodeId);
    if (!node) {
      events.push({ kind: 'error', message: `Node ${currentNodeId} not found` });
      break;
    }

    // End node — terminate.
    if (node.type === 'end') {
      events.push({ kind: 'end' });
      break;
    }

    // Emit enter event for stage / edd-case / start.
    if (node.type === 'stage' || node.type === 'edd-case' || node.type === 'start') {
      events.push({ kind: 'enter', nodeId: node.id, nodeLabel: node.label });

      // SLA check.
      const sla = slaMap[node.id];
      if (sla !== undefined) {
        events.push({
          kind:       'sla-check',
          nodeId:     node.id,
          slaHours:   sla.sla_hours,
          calendarId: sla.calendar_id ?? null,
        });
      }
    }

    // Decision gateway — evaluate DMN table.
    if (node.type === 'decision') {
      const tableId = node.dmn_table_id ?? '';
      const table   = dmnMap[tableId];
      if (!table) {
        events.push({ kind: 'error', message: `DMN table "${tableId}" not found` });
        break;
      }
      const result = evaluateDmn(table, facts);
      events.push({
        kind:        'decision',
        nodeId:      node.id,
        tableId,
        facts:       { ...facts },
        matchedRule: result.ruleIndex,
        output:      result.output,
      });

      if (!result.matched) {
        events.push({ kind: 'error', message: `No DMN rule matched for table "${tableId}"` });
        break;
      }

      // Follow the edge matching the output condition.
      const outEdges = edgesFrom.get(node.id) ?? [];
      const matchedEdge = outEdges.find(
        (e) => e.condition === result.output || e.label === result.output,
      ) ?? outEdges[0];

      if (!matchedEdge) {
        events.push({ kind: 'error', message: `No outgoing edge from decision node ${node.id}` });
        break;
      }
      currentNodeId = matchedEdge.to;
      continue;
    }

    // Parallel split — emit fork event and follow all branches (first branch only
    // for linear simulation; a full parallel trace would require recursion).
    if (node.type === 'parallel-split') {
      const outEdges = edgesFrom.get(node.id) ?? [];
      const branches = outEdges.map((e) => e.to);
      events.push({ kind: 'parallel-fork', nodeId: node.id, branches });
      currentNodeId = branches[0] ?? null;
      continue;
    }

    // Parallel join — just pass through to next.
    // All other node types: follow the first outgoing edge.
    const outEdges = edgesFrom.get(node.id) ?? [];
    const nextEdge = outEdges[0];
    if (!nextEdge) {
      // No outgoing edge = implicit end.
      events.push({ kind: 'end' });
      break;
    }
    currentNodeId = nextEdge.to;
  }

  if (hops >= MAX_HOPS) {
    events.push({ kind: 'error', message: 'Simulation exceeded maximum steps — possible cycle' });
  }

  return events;
}
