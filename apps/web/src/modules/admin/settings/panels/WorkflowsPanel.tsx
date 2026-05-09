import { ConfigPanel } from '../ConfigPanel';

export function WorkflowsPanel() {
  return (
    <ConfigPanel
      namespace="workflows"
      title="Workflows"
      description="Workflow engine configuration. Workflow wave modules will publish this schema."
    />
  );
}
