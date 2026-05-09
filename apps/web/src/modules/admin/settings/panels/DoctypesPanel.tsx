import { ConfigPanel } from '../ConfigPanel';

export function DoctypesPanel() {
  return (
    <ConfigPanel
      namespace="doctypes"
      title="Document Types"
      description="Document type classification configuration. Wave modules will publish this schema."
    />
  );
}
