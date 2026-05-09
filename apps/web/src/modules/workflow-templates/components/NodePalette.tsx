/**
 * NodePalette — drag-from-palette node type selector.
 * Drop onto the canvas to add a new node at the drop position.
 * Uses HTML5 drag-and-drop to pass the node type to the canvas drop handler.
 */

import type { CanvasNodeType } from '../schemas';

interface PaletteEntry {
  type:  CanvasNodeType;
  label: string;
  icon:  string;
  desc:  string;
}

const ENTRIES: PaletteEntry[] = [
  { type: 'stage',          label: 'Stage',          icon: '▭', desc: 'Approval stage' },
  { type: 'edd-case',       label: 'EDD Case',       icon: '▬', desc: 'Enhanced Due Diligence' },
  { type: 'decision',       label: 'DMN Gateway',    icon: '◇', desc: 'Decision table gateway' },
  { type: 'parallel-split', label: 'Parallel Split', icon: '⊕', desc: 'Fork into parallel branches' },
  { type: 'parallel-join',  label: 'Parallel Join',  icon: '⊕', desc: 'Merge parallel branches' },
  { type: 'start',          label: 'Start',          icon: '○', desc: 'Start event' },
  { type: 'end',            label: 'End',            icon: '●', desc: 'End event' },
];

export function NodePalette() {
  const handleDragStart = (type: CanvasNodeType) => (e: React.DragEvent) => {
    e.dataTransfer.setData('application/bpmn-node-type', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside
      className="w-44 flex-shrink-0 border-r border-divider bg-surface-alt overflow-y-auto"
      aria-label="Node palette"
    >
      <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Palette
      </p>
      <ul className="space-y-1 px-2 pb-4">
        {ENTRIES.map((entry) => (
          <li key={entry.type}>
            <div
              draggable
              onDragStart={handleDragStart(entry.type)}
              className="flex items-center gap-2 rounded-input border border-divider bg-surface px-2 py-2 cursor-grab hover:border-brand-blue hover:bg-brand-skyLight transition-colors select-none"
              title={entry.desc}
            >
              <span className="text-base text-ink-sub w-5 text-center" aria-hidden>
                {entry.icon}
              </span>
              <span className="text-xs text-ink font-medium">{entry.label}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="px-3 pb-3">
        <p className="text-[10px] text-muted leading-snug">
          Drag nodes onto the canvas. Click a node to edit its properties.
        </p>
      </div>
    </aside>
  );
}
