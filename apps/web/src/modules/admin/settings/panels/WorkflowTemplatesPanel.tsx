import { ConfigPanel } from '../ConfigPanel';

export function WorkflowTemplatesPanel() {
  return (
    <ConfigPanel
      namespace="workflow_templates"
      title="Workflow Templates"
      description="Default SLA hours, calendar bindings, and stage catalog for the BPMN template designer."
    />
  );
}
