import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, Plus, Save, UserPlus, X } from 'lucide-react';
import { Badge, Button, DataTable, Panel, type Column } from '@/components/ui';
import type { Role } from '@/lib/schemas';
import {
  createUser,
  fetchUsers,
  patchUser,
  type CreateUserInput,
  type PatchUserInput,
  type UserRow,
} from './api';

const ROLES: Role[] = ['Doc Admin', 'Maker', 'Checker', 'Viewer'];

const STATUS_TONE = {
  Active:   'success',
  Locked:   'danger',
  Disabled: 'neutral',
} as const;

export function UsersPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: fetchUsers });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['users'] }); };

  const create = useMutation({
    mutationFn: createUser,
    onSuccess: () => { invalidate(); setCreating(false); setErr(null); },
    onError:   (e: unknown) => setErr((e as Error).message),
  });
  const patch = useMutation({
    mutationFn: (args: Parameters<typeof patchUser>) => patchUser(...args),
    onSuccess: () => { invalidate(); setEditing(null); setErr(null); },
    onError:   (e: unknown) => setErr((e as Error).message),
  });

  const columns: Column<UserRow>[] = [
    { key: 'username', header: 'Username',
      render: (u) => (
        <div className="flex flex-col">
          <span className="font-mono text-md text-ink">{u.username}</span>
          <span className="text-xs text-muted">{u.full_name ?? ''}</span>
        </div>
      ) },
    { key: 'role',   header: 'Role',   width: 140, render: (u) => u.role },
    { key: 'branch', header: 'Branch', width: 140, render: (u) => u.branch ?? '—' },
    { key: 'email',  header: 'Email',              render: (u) => u.email ?? '—' },
    { key: 'mfa',    header: 'MFA',    width: 80,  render: (u) => u.mfa_enabled ? <Badge tone="success">on</Badge> : <span className="text-xs text-muted">off</span> },
    { key: 'status', header: 'Status', width: 100,
      render: (u) => <Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge> },
    { key: 'actions', header: '', width: 200, align: 'right',
      render: (u) => (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => patch.mutate([u.id, { status: u.status === 'Active' ? 'Locked' : 'Active' }])}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:bg-divider"
            data-testid={`user-${u.id}-toggle`}
            aria-label={u.status === 'Active' ? 'Lock' : 'Unlock'}
          >
            {u.status === 'Active' ? <Lock size={13} /> : <LockOpen size={13} />}
          </button>
          <Button size="sm" variant="ghost" onClick={() => { setErr(null); setEditing(u); }} data-testid={`user-${u.id}-edit`}>
            Edit
          </Button>
        </div>
      ) },
  ];

  return (
    <div className="space-y-6">
      <Panel
        title={`${users.data?.length ?? 0} users`}
        action={
          <Button size="sm" onClick={() => { setErr(null); setCreating(true); }} data-testid="user-new">
            <UserPlus size={14} /> New user
          </Button>
        }
      >
        <DataTable<UserRow>
          columns={columns}
          data={users.data ?? []}
          empty={users.isLoading ? 'Loading…' : 'No users yet'}
        />
      </Panel>

      {creating && (
        <CreateDrawer
          onCancel={() => setCreating(false)}
          onSubmit={(v) => create.mutate(v)}
          pending={create.isPending}
          error={err}
        />
      )}

      {editing && (
        <EditDrawer
          user={editing}
          onCancel={() => setEditing(null)}
          onSubmit={(v) => patch.mutate([editing.id, v])}
          pending={patch.isPending}
          error={err}
        />
      )}
    </div>
  );
}

function CreateDrawer({
  onCancel,
  onSubmit,
  pending,
  error,
}: {
  onCancel: () => void;
  onSubmit: (v: CreateUserInput) => void;
  pending: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState({
    username: '',
    password: '',
    full_name: '',
    email: '',
    role: 'Viewer' as Role,
    branch: '',
  });

  const submit = () => {
    const payload: CreateUserInput = {
      username: form.username.trim(),
      password: form.password,
      role: form.role,
      ...(form.full_name ? { full_name: form.full_name } : {}),
      ...(form.email ? { email: form.email } : {}),
      ...(form.branch ? { branch: form.branch } : {}),
    };
    onSubmit(payload);
  };

  return (
    <Panel
      title="Create user"
      action={
        <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-ink inline-flex items-center gap-1">
          <X size={12} /> Cancel
        </button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextField label="Username" value={form.username} onChange={(v) => setForm({ ...form, username: v })} testId="user-create-username" />
        <TextField label="Password" value={form.password} type="password" onChange={(v) => setForm({ ...form, password: v })} testId="user-create-password" />
        <TextField label="Full name" value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} />
        <TextField label="Email" value={form.email} type="email" onChange={(v) => setForm({ ...form, email: v })} />
        <SelectField label="Role" value={form.role} options={ROLES} onChange={(v) => setForm({ ...form, role: v as Role })} testId="user-create-role" />
        <TextField label="Branch" value={form.branch} onChange={(v) => setForm({ ...form, branch: v })} />
      </div>
      {error && <p className="mt-3 text-xs text-danger" data-testid="user-create-error">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" onClick={submit} loading={pending} data-testid="user-create-submit">
          <Plus size={14} /> Create
        </Button>
      </div>
    </Panel>
  );
}

function EditDrawer({
  user,
  onCancel,
  onSubmit,
  pending,
  error,
}: {
  user: UserRow;
  onCancel: () => void;
  onSubmit: (v: PatchUserInput) => void;
  pending: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState({
    full_name: user.full_name ?? '',
    email: user.email ?? '',
    role: user.role,
    branch: user.branch ?? '',
    status: user.status,
    password: '',
  });

  const submit = () => {
    const payload: PatchUserInput = {
      role: form.role,
      status: form.status,
      branch: form.branch || null,
      full_name: form.full_name,
      ...(form.email ? { email: form.email } : {}),
      ...(form.password ? { password: form.password } : {}),
    };
    onSubmit(payload);
  };

  return (
    <Panel
      title={`Edit — ${user.username}`}
      action={
        <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-ink inline-flex items-center gap-1">
          <X size={12} /> Cancel
        </button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextField label="Full name" value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} />
        <TextField label="Email" value={form.email} type="email" onChange={(v) => setForm({ ...form, email: v })} />
        <SelectField label="Role" value={form.role} options={ROLES} onChange={(v) => setForm({ ...form, role: v as Role })} testId="user-edit-role" />
        <TextField label="Branch" value={form.branch} onChange={(v) => setForm({ ...form, branch: v })} />
        <SelectField label="Status" value={form.status} options={['Active', 'Locked', 'Disabled']} onChange={(v) => setForm({ ...form, status: v as UserRow['status'] })} />
        <TextField label="Reset password" value={form.password} type="password" onChange={(v) => setForm({ ...form, password: v })} />
      </div>
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" onClick={submit} loading={pending} data-testid="user-edit-submit">
          <Save size={14} /> Save
        </Button>
      </div>
    </Panel>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  testId?: string;
}) {
  return (
    <label className="flex flex-col text-xs text-muted">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  testId?: string;
}) {
  return (
    <label className="flex flex-col text-xs text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="mt-0.5 h-9 rounded-input border border-border px-3 text-md text-ink"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
