/**
 * SimulationPanel — run a simulation against a template version and display
 * the step-by-step event trace.
 */

import { useState, useCallback } from 'react';
import { Play, AlertCircle, CheckCircle2, Clock, GitFork } from 'lucide-react';
import { Button } from '@/components/ui';
import { simulateWorkflow } from '../dmn';
import type { CanvasData, DmnMap, SlaMap, SimulationEvent } from '../schemas';
import { cn } from '@/lib/cn';

interface SimulationPanelProps {
  canvas:            CanvasData;
  dmnMap:            DmnMap;
  slaMap:            SlaMap;
  onHighlightNodes?: (ids: ReadonlySet<string>) => void;
}

export function SimulationPanel({
  canvas,
  dmnMap,
  slaMap,
  onHighlightNodes,
}: SimulationPanelProps) {
  const [factsText, setFactsText] = useState(
    JSON.stringify({ risk_band: 'HIGH', amount: 75000, doctype: 'Passport' }, null, 2),
  );
  const [events, setEvents]       = useState<SimulationEvent[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [ran, setRan]             = useState(false);

  const runSim = useCallback(() => {
    setParseError(null);
    let facts: Record<string, unknown>;
    try {
      facts = JSON.parse(factsText) as Record<string, unknown>;
    } catch {
      setParseError('Invalid JSON — check your input facts.');
      return;
    }
    const result = simulateWorkflow({ canvas, dmnMap, slaMap, facts });
    setEvents(result);
    setRan(true);
    // Highlight all entered nodes.
    const entered = new Set(
      result.flatMap((e) => (e.kind === 'enter' ? [e.nodeId] : [])),
    );
    onHighlightNodes?.(entered);
  }, [canvas, dmnMap, slaMap, factsText, onHighlightNodes]);

  const clearSim = useCallback(() => {
    setEvents([]);
    setRan(false);
    onHighlightNodes?.(new Set());
  }, [onHighlightNodes]);

  return (
    <div className="flex flex-col gap-4">
      {/* Facts input */}
      <div>
        <label className="label text-xs text-muted block mb-1">
          Workflow input facts (JSON)
        </label>
        <textarea
          value={factsText}
          onChange={(e) => setFactsText(e.target.value)}
          rows={6}
          className="input w-full resize-y font-mono text-xs"
          aria-label="Simulation input facts"
          data-testid="simulation-facts"
          spellCheck={false}
        />
        {parseError && (
          <p className="mt-1 text-xs text-danger flex items-center gap-1">
            <AlertCircle size={11} /> {parseError}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={runSim} data-testid="simulation-run">
          <Play size={13} /> Run simulation
        </Button>
        {ran && (
          <Button size="sm" variant="ghost" onClick={clearSim}>
            Clear
          </Button>
        )}
      </div>

      {/* Event trace */}
      {ran && (
        <div className="space-y-1" aria-live="polite" aria-label="Simulation trace">
          {events.length === 0 && (
            <p className="text-xs text-muted py-3 text-center">No events produced.</p>
          )}
          {events.map((ev, i) => (
            <EventRow key={i} event={ev} step={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event, step }: { event: SimulationEvent; step: number }) {
  switch (event.kind) {
    case 'enter':
      return (
        <div className="flex items-center gap-2 rounded-input border border-divider px-3 py-2 bg-brand-skyLight">
          <CheckCircle2 size={13} className="text-brand-blue flex-shrink-0" />
          <span className="text-2xs text-muted font-mono w-5">{step}</span>
          <span className="text-xs font-semibold text-brand-blue">Enter</span>
          <span className="text-xs text-ink ml-1">{event.nodeLabel}</span>
        </div>
      );
    case 'decision':
      return (
        <div className="rounded-input border border-warning/40 px-3 py-2 bg-warning/10 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-2xs text-muted font-mono w-5">{step}</span>
            <span className="text-xs font-semibold text-warning">Decision</span>
            <span className="text-xs text-ink-sub">{event.tableId}</span>
            <span className="ml-auto text-xs text-ink font-medium">→ {event.output}</span>
          </div>
          <div className="text-2xs text-muted font-mono pl-7">
            {event.matchedRule === -1
              ? 'No rule matched'
              : `Rule #${event.matchedRule + 1} matched`}
          </div>
        </div>
      );
    case 'sla-check':
      return (
        <div className="flex items-center gap-2 rounded-input border border-divider px-3 py-2">
          <Clock size={13} className="text-muted flex-shrink-0" />
          <span className="text-2xs text-muted font-mono w-5">{step}</span>
          <span className="text-xs text-ink-sub">SLA check</span>
          <span className="text-xs font-medium text-ink ml-auto">{event.slaHours}h</span>
          {event.calendarId && (
            <span className="text-2xs text-muted">(cal #{event.calendarId})</span>
          )}
        </div>
      );
    case 'parallel-fork':
      return (
        <div className="flex items-center gap-2 rounded-input border border-purple/40 px-3 py-2 bg-purple/10">
          <GitFork size={13} className="text-purple flex-shrink-0" />
          <span className="text-2xs text-muted font-mono w-5">{step}</span>
          <span className="text-xs font-semibold text-purple">Fork</span>
          <span className="text-xs text-muted ml-1">{event.branches.length} branches</span>
        </div>
      );
    case 'end':
      return (
        <div className={cn(
          'flex items-center gap-2 rounded-input border px-3 py-2',
          'border-success/40 bg-success/10',
        )}>
          <CheckCircle2 size={13} className="text-success flex-shrink-0" />
          <span className="text-2xs text-muted font-mono w-5">{step}</span>
          <span className="text-xs font-semibold text-success">End reached</span>
        </div>
      );
    case 'error':
      return (
        <div className={cn(
          'flex items-center gap-2 rounded-input border px-3 py-2',
          'border-danger/40 bg-danger/10',
        )}>
          <AlertCircle size={13} className="text-danger flex-shrink-0" />
          <span className="text-2xs text-muted font-mono w-5">{step}</span>
          <span className="text-xs font-semibold text-danger">Error</span>
          <span className="text-xs text-danger ml-1">{event.message}</span>
        </div>
      );
  }
}
