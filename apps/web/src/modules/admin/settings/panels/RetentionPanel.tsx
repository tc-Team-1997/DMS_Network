import { ConfigPanel } from '../ConfigPanel';

export function RetentionPanel() {
  return (
    <ConfigPanel
      namespace="retention"
      title="Retention"
      description="Document retention policy configuration. Compliance wave modules will publish this schema."
    />
  );
}
