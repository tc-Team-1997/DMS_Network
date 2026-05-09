import { ConfigPanel } from '../ConfigPanel';

export function CapturePanel() {
  return (
    <ConfigPanel
      namespace="capture"
      title="Capture"
      description="Document capture configuration. Wave A modules will publish this schema."
    />
  );
}
