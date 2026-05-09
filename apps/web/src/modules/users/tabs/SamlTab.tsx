/**
 * SamlTab — SAML IdP management.
 * Create/edit IdP metadata XML + claim mapping. Test-SSO shows request XML.
 * Approved deviation: test returns XML for display; no live IdP roundtrip.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';
import { Badge, Button, DataTable, Drawer, useToast, type Column } from '@/components/ui';
import {
  fetchSamlIdps,
  createSamlIdp,
  updateSamlIdp,
  testSamlIdp,
  type SamlIdpRow,
  type CreateSamlIdpInput,
} from '../api';
import { HttpError } from '@/lib/http';

export function SamlTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const idpsQ = useQuery({ queryKey: ['saml-idps'], queryFn: fetchSamlIdps });

  const [creating, setCreating] = useState(false);
  const [editing,  setEditing]  = useState<SamlIdpRow | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testingId,  setTestingId]  = useState<number | null>(null);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['saml-idps'] }); };

  const createMut = useMutation({
    mutationFn: createSamlIdp,
    onSuccess: () => { invalidate(); setCreating(false); toast({ variant: 'success', title: 'IdP created' }); },
    onError: (e) => toast({ variant: 'error', title: 'Create failed', message: e instanceof HttpError ? e.message : 'Error' }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateSamlIdp>[1] }) =>
      updateSamlIdp(id, body),
    onSuccess: () => { invalidate(); setEditing(null); toast({ variant: 'success', title: 'IdP updated' }); },
    onError: (e) => toast({ variant: 'error', title: 'Update failed', message: e instanceof HttpError ? e.message : 'Error' }),
  });

  const testMut = useMutation({
    mutationFn: testSamlIdp,
    onSuccess: (data) => { setTestResult(data.saml_request_xml); setTestingId(null); },
    onError: (e) => { toast({ variant: 'error', title: 'Test failed', message: e instanceof HttpError ? e.message : 'Error' }); setTestingId(null); },
  });

  const columns: Column<SamlIdpRow>[] = [
    {
      key: 'name',
      header: 'IdP name',
      render: (r) => (
        <div>
          <p className="text-sm font-medium text-ink">{r.name}</p>
          {r.enforce_only && <span className="text-2xs text-warning">SSO only</span>}
        </div>
      ),
    },
    {
      key: 'is_active',
      header: 'Status',
      width: 80,
      render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'active' : 'off'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      width: 200,
      align: 'right',
      render: (r) => (
        <div className="flex gap-1 justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setTestingId(r.id); testMut.mutate(r.id); }}
            loading={testMut.isPending && testingId === r.id}
            data-testid={`saml-test-${String(r.id)}`}
          >
            <RefreshCw size={12} /> Test SSO
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(r)}
            data-testid={`saml-edit-${String(r.id)}`}
          >
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{idpsQ.data?.length ?? 0} IdP(s) configured</p>
        <Button size="sm" onClick={() => setCreating(true)} data-testid="saml-new-btn">
          <Plus size={14} /> Add IdP
        </Button>
      </div>

      <DataTable<SamlIdpRow>
        columns={columns}
        data={idpsQ.data ?? []}
        empty={idpsQ.isLoading ? 'Loading…' : 'No SAML IdPs configured'}
      />

      {testResult !== null && (
        <div className="rounded-card border border-divider p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-ink">SAMLRequest XML (preview — no request sent)</h4>
            <button type="button" onClick={() => setTestResult(null)} className="text-xs text-muted hover:text-ink">
              Close
            </button>
          </div>
          <pre className="text-xs text-ink-sub bg-surface-alt rounded-input p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all">
            {testResult}
          </pre>
        </div>
      )}

      <Drawer
        open={creating}
        onClose={() => setCreating(false)}
        title="Add SAML IdP"
        width="520px"
      >
        <IdpForm
          onSubmit={(v) => createMut.mutate(v)}
          pending={createMut.isPending}
        />
      </Drawer>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing !== null ? `Edit — ${editing.name}` : 'Edit IdP'}
        width="520px"
      >
        {editing !== null && (
          <IdpForm
            initial={editing}
            onSubmit={(v) => updateMut.mutate({ id: editing.id, body: v })}
            pending={updateMut.isPending}
          />
        )}
      </Drawer>
    </div>
  );
}

function IdpForm({
  initial,
  onSubmit,
  pending,
}: {
  initial?: SamlIdpRow;
  onSubmit: (v: CreateSamlIdpInput) => void;
  pending: boolean;
}) {
  const [name,        setName]        = useState(initial?.name ?? '');
  const [xml,         setXml]         = useState(initial?.metadata_xml ?? '');
  const [emailClaim,  setEmailClaim]  = useState(initial?.claim_map?.['email'] ?? 'email');
  const [groupsClaim, setGroupsClaim] = useState(initial?.claim_map?.['groups'] ?? 'groups');
  const [enforceOnly, setEnforceOnly] = useState(initial?.enforce_only ?? false);
  const [isActive,    setIsActive]    = useState(initial?.is_active ?? true);

  const submit = () => {
    onSubmit({
      name,
      metadata_xml: xml,
      claim_map:    { email: emailClaim, groups: groupsClaim },
      enforce_only: enforceOnly,
      is_active:    isActive,
    });
  };

  return (
    <div className="space-y-4">
      <label className="flex flex-col gap-1 text-sm text-ink-sub">
        IdP name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Azure AD"
          className="input"
          data-testid="saml-name"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink-sub">
        IdP metadata XML
        <textarea
          value={xml}
          onChange={(e) => setXml(e.target.value)}
          rows={8}
          placeholder="Paste your IdP metadata XML here…"
          className="input resize-y font-mono text-xs"
          data-testid="saml-xml"
        />
      </label>

      <div className="rounded-card border border-divider p-3 space-y-3">
        <p className="text-xs font-semibold text-ink-sub uppercase tracking-wide">Claim mapping</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink-sub">
            Email claim
            <input
              type="text"
              value={emailClaim}
              onChange={(e) => setEmailClaim(e.target.value)}
              className="input"
              data-testid="saml-email-claim"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-sub">
            Groups claim
            <input
              type="text"
              value={groupsClaim}
              onChange={(e) => setGroupsClaim(e.target.value)}
              className="input"
              data-testid="saml-groups-claim"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-input border border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium text-ink">Enforce SSO only</p>
          <p className="text-xs text-muted">Block password login for this tenant</p>
        </div>
        <button
          type="button"
          onClick={() => setEnforceOnly(!enforceOnly)}
          className="text-brand-blue"
          data-testid="saml-enforce-toggle"
        >
          {enforceOnly ? <ToggleRight size={24} /> : <ToggleLeft size={24} className="text-border" />}
        </button>
      </div>

      <div className="flex items-center justify-between rounded-input border border-border px-3 py-2">
        <p className="text-sm font-medium text-ink">Active</p>
        <button
          type="button"
          onClick={() => setIsActive(!isActive)}
          className="text-brand-blue"
          data-testid="saml-active-toggle"
        >
          {isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} className="text-border" />}
        </button>
      </div>

      <Button
        size="sm"
        onClick={submit}
        loading={pending}
        disabled={!name || xml.length < 50}
        className="w-full justify-center"
        data-testid="saml-form-submit"
      >
        {initial !== undefined ? 'Save changes' : 'Add IdP'}
      </Button>
    </div>
  );
}
