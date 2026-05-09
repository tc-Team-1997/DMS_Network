import { ConfigPanel } from '../ConfigPanel';

export function AuditPanel() {
  return (
    <ConfigPanel
      namespace="audit"
      title="Audit"
      description="Audit log configuration. Security wave modules will publish this schema."
    />
  );
}
