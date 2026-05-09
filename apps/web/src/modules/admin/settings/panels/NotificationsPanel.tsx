import { ConfigPanel } from '../ConfigPanel';

export function NotificationsPanel() {
  return (
    <ConfigPanel
      namespace="notifications"
      title="Notifications"
      description="Notification channel configuration (email, SMS, webhooks). Platform wave modules will publish this schema."
    />
  );
}
