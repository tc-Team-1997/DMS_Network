import { ConfigPanel } from '../ConfigPanel';

export function AmlPanel() {
  return (
    <ConfigPanel
      namespace="aml"
      title="AML"
      description="Anti-money laundering screening configuration. Compliance wave modules will publish this schema."
    />
  );
}
