import { ConfigPanel } from '../ConfigPanel';

export function RbacPanel() {
  return (
    <ConfigPanel
      namespace="rbac"
      title="RBAC"
      description="Role-based access control configuration. Security wave modules will publish this schema."
    />
  );
}
