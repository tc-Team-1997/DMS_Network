/**
 * UsersTab — user list + invite drawer (no plaintext password).
 * Replaces the old CreateDrawer that accepted admin-typed passwords.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, Mail, UserPlus } from 'lucide-react';
import { Badge, Button, DataTable, Drawer, useToast, type Column } from '@/components/ui';
import { Combobox } from '@/components/ui';
import type { Role } from '@/lib/schemas';
import { fetchUsers, inviteUser, patchUser, type UserRow, type InviteUserInput } from '../api';
import { HttpError } from '@/lib/http';

const ROLES: Role[] = ['Doc Admin', 'Maker', 'Checker', 'Viewer'];

const STATUS_TONE: Record<UserRow['status'], 'success' | 'danger' | 'neutral'> = {
  Active:   'success',
  Locked:   'danger',
  Disabled: 'neutral',
};

export function UsersTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const usersQ = useQuery({ queryKey: ['users'], queryFn: fetchUsers });

  const [inviting, setInviting] = useState(false);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['users'] }); };

  const invite = useMutation({
    mutationFn: inviteUser,
    onSuccess: (data) => {
      invalidate();
      setInviting(false);
      toast({ variant: 'success', title: 'Invite sent', message: `Magic link sent to ${data.email}` });
    },
    onError: (e: unknown) => {
      const msg = e instanceof HttpError ? e.message : 'Unknown error';
      toast({ variant: 'error', title: 'Invite failed', message: msg });
    },
  });

  const patchMut = useMutation({
    mutationFn: ([id, body]: [number, Parameters<typeof patchUser>[1]]) => patchUser(id, body),
    onSuccess: () => { invalidate(); },
    onError: (e: unknown) => {
      const msg = e instanceof HttpError ? e.message : 'Unknown error';
      toast({ variant: 'error', title: 'Update failed', message: msg });
    },
  });

  const columns: Column<UserRow>[] = [
    {
      key: 'username',
      header: 'User',
      render: (u) => (
        <div className="flex flex-col">
          <span className="font-mono text-md text-ink">{u.username}</span>
          <span className="text-xs text-muted">{u.full_name ?? ''}</span>
          {u.invite_pending === true && (
            <span className="text-2xs text-warning mt-0.5">Invite pending</span>
          )}
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      render: (u) => <span className="text-sm text-ink-sub">{u.email ?? '—'}</span>,
    },
    {
      key: 'role',
      header: 'Role',
      width: 130,
      render: (u) => (
        <Combobox
          options={ROLES.map((r) => ({ value: r, label: r }))}
          value={u.role}
          onChange={(v) => {
            patchMut.mutate([u.id, { role: v as Role }]);
          }}
          placeholder="Role"
          className="w-full"
        />
      ),
    },
    { key: 'branch', header: 'Branch', width: 130, render: (u) => u.branch ?? '—' },
    {
      key: 'mfa',
      header: 'MFA',
      width: 60,
      render: (u) =>
        u.mfa_enabled ? <Badge tone="success">on</Badge> : <span className="text-xs text-muted">off</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: 100,
      render: (u) => <Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      width: 80,
      align: 'right',
      render: (u) => (
        <button
          type="button"
          onClick={() => patchMut.mutate([u.id, { status: u.status === 'Active' ? 'Locked' : 'Active' }])}
          className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:bg-divider"
          data-testid={`user-${String(u.id)}-toggle`}
          aria-label={u.status === 'Active' ? 'Lock user' : 'Unlock user'}
        >
          {u.status === 'Active' ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
      ),
    },
  ];

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted">{usersQ.data?.length ?? 0} users</p>
        <Button
          size="sm"
          onClick={() => setInviting(true)}
          data-testid="user-invite-btn"
        >
          <UserPlus size={14} /> Invite user
        </Button>
      </div>

      <DataTable<UserRow>
        columns={columns}
        data={usersQ.data ?? []}
        empty={usersQ.isLoading ? 'Loading…' : 'No users yet'}
      />

      <Drawer
        open={inviting}
        onClose={() => setInviting(false)}
        title="Invite new user"
        width="420px"
      >
        <InviteForm
          onSubmit={(v) => invite.mutate(v)}
          pending={invite.isPending}
        />
      </Drawer>
    </>
  );
}

function InviteForm({
  onSubmit,
  pending,
}: {
  onSubmit: (v: InviteUserInput) => void;
  pending: boolean;
}) {
  const [email, setEmail]   = useState('');
  const [role, setRole]     = useState<Role>('Viewer');
  const [branch, setBranch] = useState('');
  const [reason, setReason] = useState('');

  const submit = () => {
    onSubmit({ email, role, branch: branch || undefined, reason });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-input bg-brand-skyLight px-3 py-2 text-sm text-brand-blue flex gap-2 items-start">
        <Mail size={14} className="mt-0.5 flex-shrink-0" />
        <span>A magic link will be emailed to the user. No admin-typed passwords.</span>
      </div>

      <label className="flex flex-col gap-1 text-sm text-ink-sub">
        Email address
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@bank.bt"
          className="input"
          data-testid="invite-email"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-sub">
        Role
        <Combobox
          options={ROLES.map((r) => ({ value: r, label: r }))}
          value={role}
          onChange={(v) => setRole(v as Role)}
          placeholder="Select role"
          data-testid="invite-role"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-sub">
        Branch <span className="text-muted text-xs">(optional)</span>
        <input
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="e.g. Thimphu Main"
          className="input"
          data-testid="invite-branch"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-sub">
        Reason <span className="text-danger text-xs">*</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Why is this user being added? (min 10 chars)"
          className="input resize-none"
          data-testid="invite-reason"
        />
        <span className="text-xs text-muted">{reason.length}/10 min</span>
      </label>

      <Button
        size="sm"
        onClick={submit}
        loading={pending}
        disabled={!email || reason.length < 10}
        data-testid="invite-submit"
        className="w-full justify-center"
      >
        <Mail size={14} /> Send invite
      </Button>
    </div>
  );
}
