import { ConfigPanel } from '../ConfigPanel';

/**
 * IntegrationsPanel — provider registry settings (CC6 namespace).
 *
 * Local-first by default. AWS adapters are registered but disabled —
 * switching to 'aws' will surface NotImplementedError until credentials
 * are configured in the deployment environment.
 */
export function IntegrationsPanel() {
  return (
    <ConfigPanel
      namespace="integrations"
      title="Integrations"
      description="Local-first by default. AWS adapters are registered but disabled — switching to 'aws' will surface NotImplementedError until credentials are configured."
    />
  );
}
