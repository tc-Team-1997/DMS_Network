/**
 * SlaEditor — per-stage SLA hours editor.
 * Renders a list of stage nodes and lets the admin set SLA hours for each.
 */

import type { CanvasNode, SlaMap } from '../schemas';

interface SlaEditorProps {
  stageNodes:  CanvasNode[];
  slaMap:      SlaMap;
  calendars:   Array<{ id: number; name: string }>;
  onChange:    (slaMap: SlaMap) => void;
  readonly?:   boolean;
}

export function SlaEditor({
  stageNodes,
  slaMap,
  calendars,
  onChange,
  readonly = false,
}: SlaEditorProps) {
  const updateHours = (nodeId: string, hours: number) => {
    const current = slaMap[nodeId];
    onChange({
      ...slaMap,
      [nodeId]: { node_id: nodeId, sla_hours: hours, calendar_id: current?.calendar_id },
    });
  };

  const updateCalendar = (nodeId: string, calendarId: number | undefined) => {
    const current = slaMap[nodeId];
    if (!current) return;
    onChange({
      ...slaMap,
      [nodeId]: { ...current, calendar_id: calendarId },
    });
  };

  if (stageNodes.length === 0) {
    return (
      <p className="text-xs text-muted py-4 text-center">
        Add stages to the canvas to configure SLA hours.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_80px_160px] gap-2 px-2">
        <span className="text-2xs font-semibold text-muted uppercase">Stage</span>
        <span className="text-2xs font-semibold text-muted uppercase">SLA (h)</span>
        <span className="text-2xs font-semibold text-muted uppercase">Calendar</span>
      </div>
      {stageNodes.map((node) => {
        const entry  = slaMap[node.id];
        const hours  = entry?.sla_hours ?? 24;
        const calId  = entry?.calendar_id;
        return (
          <div
            key={node.id}
            className="grid grid-cols-[1fr_80px_160px] gap-2 items-center rounded-input border border-divider px-2 py-1.5"
          >
            <div>
              <p className="text-xs font-medium text-ink">{node.label}</p>
              <p className="text-2xs text-muted">{node.type} · {node.role ?? '—'}</p>
            </div>
            <input
              type="number"
              min={1}
              max={8760}
              value={hours}
              readOnly={readonly}
              onChange={(e) => updateHours(node.id, Math.max(1, parseInt(e.target.value, 10) || 24))}
              className="input h-8 text-xs text-right"
              aria-label={`SLA hours for ${node.label}`}
            />
            <select
              value={calId ?? ''}
              disabled={readonly}
              onChange={(e) => {
                const v = e.target.value;
                updateCalendar(node.id, v ? parseInt(v, 10) : undefined);
              }}
              className="input h-8 text-xs"
              aria-label={`Calendar for ${node.label}`}
            >
              <option value="">Default calendar</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
