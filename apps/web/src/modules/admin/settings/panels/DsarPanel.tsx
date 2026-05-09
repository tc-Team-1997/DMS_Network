import { ConfigPanel } from '../ConfigPanel';

export function DsarPanel() {
  return (
    <ConfigPanel
      namespace="dsar"
      title="DSAR Console"
      description="Data Subject Access Request configuration — SLA calendars per regulator, cryptoshred policy, identity verification requirements, and fulfillment letter template path."
    />
  );
}
