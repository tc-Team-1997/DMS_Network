import { FileText, Brain, ClipboardList, GitBranch, Building2 } from 'lucide-react';
import type { PanelCounts } from '../schemas';

interface PanelCardProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  testId: string;
}

function PanelCard({ icon, label, count, testId }: PanelCardProps) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2 rounded-card border border-divider bg-surface p-4 shadow-card"
    >
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
  // grid-cols-1 on mobile (< 640px) per Plan 3 mockup-15 mobile requirement.
  return (
    <div
      data-testid="dsar-inventory-grid"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      <PanelCard
        testId="dsar-panel-documents"
        icon={<FileText size={14} />}
        label="Documents"
        count={panels.documents}
      />
      <PanelCard
        testId="dsar-panel-ai-traces"
        icon={<Brain size={14} />}
        label="AI Traces"
        count={panels.ai_traces}
      />
      <PanelCard
        testId="dsar-panel-audit-events"
        icon={<ClipboardList size={14} />}
        label="Audit Events"
        count={panels.audit_events}
      />
      <PanelCard
        testId="dsar-panel-workflows"
        icon={<GitBranch size={14} />}
        label="Workflows"
        count={panels.workflows}
      />
      <PanelCard
        testId="dsar-panel-cbs-records"
        icon={<Building2 size={14} />}
        label="CBS Records"
        count={panels.cbs_records}
      />
    </div>
  );
}
