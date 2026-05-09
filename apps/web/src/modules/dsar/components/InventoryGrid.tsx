import { FileText, Brain, ClipboardList, GitBranch, Building2 } from 'lucide-react';
import type { PanelCounts } from '../schemas';

interface PanelCardProps {
  icon: React.ReactNode;
  label: string;
  count: number;
}

function PanelCard({ icon, label, count }: PanelCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-divider bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums text-ink">
        {count.toLocaleString()}
      </p>
    </div>
  );
}

interface Props {
  panels: PanelCounts;
}

export function InventoryGrid({ panels }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <PanelCard
        icon={<FileText size={14} />}
        label="Documents"
        count={panels.documents}
      />
      <PanelCard
        icon={<Brain size={14} />}
        label="AI Traces"
        count={panels.ai_traces}
      />
      <PanelCard
        icon={<ClipboardList size={14} />}
        label="Audit Events"
        count={panels.audit_events}
      />
      <PanelCard
        icon={<GitBranch size={14} />}
        label="Workflows"
        count={panels.workflows}
      />
      <PanelCard
        icon={<Building2 size={14} />}
        label="CBS Records"
        count={panels.cbs_records}
      />
    </div>
  );
}
