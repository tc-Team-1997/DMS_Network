/**
 * UsersPanel — admin settings for Users & Auth namespace.
 * Renders auth config (magic link TTL, password policy, MFA enforcement, SSO toggle)
 * and rbac config (session TTL, SoD pairs) via the generic ConfigPanel.
 */

import { ConfigPanel } from '../ConfigPanel';

export function UsersPanel() {
  return (
    <div className="space-y-10">
      <ConfigPanel
        namespace="auth"
        title="Authentication policy"
        description="Magic-link invite TTL, password strength rules, MFA enforcement, and SSO enforcement."
      />
      <div className="border-t border-divider" />
      <ConfigPanel
        namespace="rbac"
        title="RBAC &amp; session policy"
        description="Session time-to-live and segregation-of-duties forbidden role pairs."
      />
    </div>
  );
}
