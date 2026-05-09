import { ConfigPanel } from '../ConfigPanel';

export function LocalesPanel() {
  return (
    <ConfigPanel
      namespace="locales"
      title="Locales"
      description="Locale and language configuration. Dzongkha and RTL support ships in Wave D."
    />
  );
}
