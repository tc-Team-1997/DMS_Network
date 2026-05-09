/**
 * UsersPage v2 — tabbed admin surface for Users, MFA, SAML, Sessions.
 * Replaces the single-panel v1 that accepted admin-typed passwords.
 */

import { useSearchParams } from 'react-router-dom';
import { Users, Shield, Link2, MonitorCheck } from 'lucide-react';
import { Tabs, TabList, Tab, TabPanel } from '@/components/ui';
import { UsersTab }    from './tabs/UsersTab';
import { MfaTab }     from './tabs/MfaTab';
import { SamlTab }    from './tabs/SamlTab';
import { SessionsTab } from './tabs/SessionsTab';

type TabValue = 'users' | 'mfa' | 'saml' | 'sessions';
const VALID_TABS: TabValue[] = ['users', 'mfa', 'saml', 'sessions'];

function isTabValue(v: string): v is TabValue {
  return (VALID_TABS as string[]).includes(v);
}

export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab') ?? 'users';
  const active: TabValue = isTabValue(rawTab) ? rawTab : 'users';

  const go = (tab: TabValue) => {
    setParams({ tab }, { replace: true });
  };

  return (
    <div className="space-y-0">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Users &amp; Access</h1>
        <p className="text-sm text-muted mt-0.5">
          Manage users, MFA factors, SAML single sign-on, and active sessions.
        </p>
      </div>

      <Tabs value={active} onChange={(v) => go(v as TabValue)}>
        <TabList>
          <Tab value="users" data-testid="tab-users">
            <Users size={13} /> Users
          </Tab>
          <Tab value="mfa" data-testid="tab-mfa">
            <Shield size={13} /> MFA
          </Tab>
          <Tab value="saml" data-testid="tab-saml">
            <Link2 size={13} /> SAML
          </Tab>
          <Tab value="sessions" data-testid="tab-sessions">
            <MonitorCheck size={13} /> Sessions
          </Tab>
        </TabList>

        <div className="pt-6">
          <TabPanel value="users">
            <UsersTab />
          </TabPanel>
          <TabPanel value="mfa">
            <MfaTab />
          </TabPanel>
          <TabPanel value="saml">
            <SamlTab />
          </TabPanel>
          <TabPanel value="sessions">
            <SessionsTab />
          </TabPanel>
        </div>
      </Tabs>
    </div>
  );
}
