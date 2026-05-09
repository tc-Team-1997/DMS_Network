import { ConfigPanel } from '../ConfigPanel';

export function AbacPanel() {
  return (
    <ConfigPanel
      namespace="abac"
      title="ABAC"
      description="Attribute-based access control configuration. OPA policy wave modules will publish this schema."
    />
  );
}
