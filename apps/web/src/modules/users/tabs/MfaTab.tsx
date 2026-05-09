/**
 * MfaTab — per-user MFA factor list + per-role enforcement policy.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldOff, Smartphone, Fingerprint, KeyRound } from 'lucide-react';
import { Badge, Button, DataTable, useToast, Skeleton, type Column } from '@/components/ui';
import { fetchUsers, fetchFactors, disableFactor, type UserRow, type MfaFactor } from '../api';
import { useTenantConfig, useUpdateConfig } from '@/store/tenant-config';
import { HttpError } from '@/lib/http';

const KIND_ICON: Record<MfaFactor['kind'], React.ReactNode> = {
  totp:     <KeyRound size={13} />,
  sms:      <Smartphone size={13} />,
  webauthn: <Fingerprint size={13} />,
};

const ROLES_WITH_MFA = ['Doc Admin', 'Maker', 'Checker', 'Viewer'] as const;
type MfaRoleKey = (typeof ROLES_WITH_MFA)[number];

export function MfaTab() {
  const { toast } = useToast();
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  const usersQ = useQuery({ queryKey: ['users'], queryFn: fetchUsers });

  const userColumns: Column<UserRow>[] = [
    {
      key: 'username',
      header: 'User',
      render: (u) => (
        <div className="flex flex-col">
          <span className="font-mono text-md text-ink">{u.username}</span>
          <span className="text-xs text-muted">{u.full_name ?? ''}</span>
        </div>
      ),
    },
    {
      key: 'mfa',
      header: 'MFA',
      width: 70,
      render: (u) =>
        u.mfa_enabled ? <Badge tone="success">on</Badge> : <span className="text-xs text-muted">off</span>,
    },
    {
      key: 'actions',
      header: '',
      width: 120,
      align: 'right',
      render: (u) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSelectedUser(u)}
          data-testid={`mfa-manage-${String(u.id)}`}
        >
          Manage factors
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Per-role enforcement policy */}
      <MfaEnforcementPanel />

      {/* User factor list */}
      <div>
        <h3 className="text-md font-semibold text-ink mb-3">User factors</h3>
        <DataTable<UserRow>
          columns={userColumns}
          data={usersQ.data ?? []}
          empty={usersQ.isLoading ? 'Loading…' : 'No users yet'}
        />
      </div>

      {/* Factor detail drawer */}
      {selectedUser !== null && (
        <FactorDetail
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onDisabled={(factorId) => {
            toast({ variant: 'success', title: 'Factor disabled', message: factorId });
          }}
        />
      )}
    </div>
  );
}

function MfaEnforcementPanel() {
  const configQ  = useTenantConfig('auth');
  const updateQ  = useUpdateConfig('auth');
  const { toast } = useToast();

  if (configQ.isLoading) return <Skeleton className="h-24 w-full" />;

  const raw = configQ.data?.['force_mfa_for_role'];
  let policy: Partial<Record<MfaRoleKey, boolean>> = {};
  if (typeof raw === 'string') {
    try { policy = JSON.parse(raw) as Partial<Record<MfaRoleKey, boolean>>; } catch (_) {}
  } else if (raw !== null && raw !== undefined && typeof raw === 'object') {
    policy = raw as Partial<Record<MfaRoleKey, boolean>>;
  }

  const toggle = (role: MfaRoleKey) => {
    const next = { ...policy, [role]: !(policy[role] ?? false) };
    updateQ.mutate(
      {
        key:    'force_mfa_for_role',
        value:  JSON.stringify(next),
        reason: `MFA enforcement toggled for role ${role} by admin`,
      },
      {
        onSuccess: () => toast({ variant: 'success', title: 'Policy saved', message: `MFA requirement updated for ${role}` }),
        onError:   (e) => toast({ variant: 'error', title: 'Save failed', message: e instanceof HttpError ? e.message : 'Error' }),
      },
    );
  };

  return (
    <div className="rounded-card border border-divider p-4">
      <h3 className="text-md font-semibold text-ink mb-1">MFA enforcement policy</h3>
      <p className="text-sm text-muted mb-4">Require at least one MFA factor for users in this role.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ROLES_WITH_MFA.map((role) => {
          const enforced = policy[role] ?? false;
          return (
            <button
              key={role}
              type="button"
              onClick={() => toggle(role)}
              data-testid={`mfa-enforce-${role}`}
              className={`flex flex-col items-center gap-2 rounded-input border p-3 text-sm font-medium transition-colors ${
                enforced
                  ? 'border-brand-blue bg-brand-skyLight text-brand-blue'
                  : 'border-border bg-surface text-ink-sub hover:bg-divider'
              }`}
            >
              {enforced ? <Shield size={16} /> : <ShieldOff size={16} />}
              {role}
              <span className="text-xs font-normal">{enforced ? 'Required' : 'Optional'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FactorDetail({
  user,
  onClose,
  onDisabled,
}: {
  user: UserRow;
  onClose: () => void;
  onDisabled: (factorId: string) => void;
}) {
  const qc = useQueryClient();
  const factorsQ = useQuery({
    queryKey: ['user-factors', user.id],
    queryFn:  () => fetchFactors(user.id),
  });

  const disableMut = useMutation({
    mutationFn: (factorId: string) => disableFactor(user.id, factorId),
    onSuccess: (_, factorId) => {
      void qc.invalidateQueries({ queryKey: ['user-factors', user.id] });
      void qc.invalidateQueries({ queryKey: ['users'] });
      onDisabled(factorId);
    },
  });

  const factors = factorsQ.data?.factors ?? [];

  return (
    <div className="mt-4 rounded-card border border-divider p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-md font-semibold text-ink">
          Factors — {user.username}
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted hover:text-ink"
        >
          Close
        </button>
      </div>

      {factorsQ.isLoading && <Skeleton className="h-20 w-full" />}

      {!factorsQ.isLoading && factors.length === 0 && (
        <p className="text-sm text-muted">No factors found.</p>
      )}

      {factors.map((f) => (
        <div
          key={f.id}
          className="flex items-center justify-between py-2 border-b border-divider last:border-0"
          data-testid={`factor-row-${f.id}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-muted">{KIND_ICON[f.kind]}</span>
            <div>
              <p className="text-sm text-ink">{f.label}</p>
              {f.kind === 'webauthn' && f.last_used_at !== undefined && f.last_used_at !== null && (
                <p className="text-xs text-muted">Last used: {f.last_used_at}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={f.enabled ? 'success' : 'neutral'}>{f.enabled ? 'active' : 'disabled'}</Badge>
            {f.enabled && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => disableMut.mutate(f.id)}
                loading={disableMut.isPending && disableMut.variables === f.id}
                data-testid={`factor-disable-${f.id}`}
              >
                Disable
              </Button>
            )}
            {f.kind === 'webauthn' && (
              <span
                className="text-xs text-muted cursor-not-allowed"
                title="WebAuthn enrollment coming in Wave C"
              >
                Enroll (Wave C)
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
