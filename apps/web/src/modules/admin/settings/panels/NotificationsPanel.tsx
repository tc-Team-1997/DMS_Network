/**
 * NotificationsPanel — Wave C full notification admin UI.
 *
 * Sections:
 *   1. Channel toggles   — enable/disable email / SMS / WhatsApp / in_app / push
 *   2. Provider selects  — email (local | aws) / SMS (noop | twilio | aws)
 *   3. Throttle limits   — per-channel burst + window integer inputs
 *   4. Templates         — per event-type: subject, body (en + dz locale tabs),
 *                          active channels, routing roles, test-send button
 *
 * Each save writes to tenant_config namespace "notifications" via useUpdateConfig.
 * A 20-char audit reason is required for all writes.
 * Test-send calls POST /spa/api/admin/notifications/test-send (no config write).
 */

import { useState, useId } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Mail, MessageSquare, Bell, Smartphone,
  Send, ChevronDown, ChevronRight, CheckCircle2, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useToast, Skeleton, EmptyState } from '@/components/ui';
import { Tabs, TabList, Tab, TabPanel } from '@/components/ui/Tabs';
import { useTenantConfig, useUpdateConfig } from '@/store/tenant-config';
import { HttpError } from '@/lib/http';
import { testSend } from '@/modules/notifications/api';
import type { TestSendResponse } from '@/modules/notifications/schemas';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHANNELS = [
  { id: 'email',    label: 'Email',      Icon: Mail },
  { id: 'sms',      label: 'SMS',        Icon: MessageSquare },
  { id: 'whatsapp', label: 'WhatsApp',   Icon: MessageSquare },
  { id: 'in_app',   label: 'In-app',     Icon: Bell },
  { id: 'push',     label: 'Push',       Icon: Smartphone },
] as const;

type ChannelId = typeof CHANNELS[number]['id'];

const EMAIL_PROVIDERS = ['local', 'aws'] as const;
const SMS_PROVIDERS   = ['noop', 'twilio', 'aws'] as const;

const EVENT_TYPES = [
  { id: 'expiry_alert',      label: 'Document Expiry Alert' },
  { id: 'workflow_assigned', label: 'Workflow Assigned' },
  { id: 'aml_hit',           label: 'AML Hit' },
  { id: 'user_invite',       label: 'User Invite' },
  { id: 'dsar_completed',    label: 'DSAR Completed' },
] as const;

type EventTypeId = typeof EVENT_TYPES[number]['id'];

const ROLES = ['Doc Admin', 'Maker', 'Checker', 'Viewer', 'auditor'] as const;

const AUDIT_MIN = 20;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Pill toggle switch */
function Toggle({
  id,
  checked,
  onChange,
  label,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => { if (!disabled) onChange(!checked); }}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-200 ease-in-out',
        'focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1',
        checked ? 'bg-brand-blue' : 'bg-border',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow',
          'transition duration-200 ease-in-out',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
      <span id={id} className="sr-only">{label}</span>
    </button>
  );
}

/** Inline save-row for a single config key */
function SaveRow({
  isDirty,
  reason,
  onReasonChange,
  onSave,
  isSaving,
}: {
  isDirty: boolean;
  reason: string;
  onReasonChange: (v: string) => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const reasonOk = reason.length >= AUDIT_MIN;
  if (!isDirty) return null;

  return (
    <div className="mt-3 space-y-2 rounded-input border border-divider bg-surface-alt p-3">
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => { onReasonChange(e.target.value); }}
        placeholder="Reason for change (min 20 characters)…"
        className={cn(
          'input w-full resize-none text-sm',
          reason.length > 0 && !reasonOk && 'border-danger',
        )}
      />
      <div className="flex items-center gap-3">
        <span className={cn('text-xs', reasonOk ? 'text-success' : 'text-muted')}>
          {reason.length}/{AUDIT_MIN} chars
        </span>
        <button
          type="button"
          disabled={!reasonOk || isSaving}
          onClick={onSave}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-input px-4 py-1.5 text-sm font-medium text-white',
            'bg-brand-blue hover:bg-brand-blueHover transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Channel Toggles
// ---------------------------------------------------------------------------

function ChannelToggles({ configMap, namespace }: { configMap: Record<string, unknown>; namespace: string }) {
  const { toast } = useToast();
  const updateConfig = useUpdateConfig(namespace);
  const [localValues, setLocalValues] = useState<Partial<Record<ChannelId, boolean>>>({});
  const [reason, setReason]   = useState('');
  const [dirtySet, setDirtySet] = useState<Set<ChannelId>>(new Set());

  function getEnabled(ch: ChannelId): boolean {
    if (ch in localValues) return localValues[ch] ?? false;
    const raw = configMap[`channels.${ch}.enabled`];
    return raw === true || raw === 'true';
  }

  function handleToggle(ch: ChannelId, val: boolean) {
    setLocalValues((prev) => ({ ...prev, [ch]: val }));
    setDirtySet((prev) => new Set([...prev, ch]));
  }

  async function handleSave() {
    if (reason.length < AUDIT_MIN) return;
    for (const ch of dirtySet) {
      const val = localValues[ch] ?? false;
      try {
        await updateConfig.mutateAsync({ key: `channels.${ch}.enabled`, value: val, reason });
        toast({ variant: 'success', title: `Saved channels.${ch}.enabled` });
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : 'Unknown error';
        toast({ variant: 'error', title: `Failed to save ${ch}`, message: msg });
      }
    }
    setDirtySet(new Set());
    setReason('');
  }

  return (
    <section aria-labelledby="channels-heading" className="space-y-3">
      <h3 id="channels-heading" className="text-base font-semibold text-ink">Channels</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CHANNELS.map(({ id, label, Icon }) => {
          const enabled = getEnabled(id);
          return (
            <div
              key={id}
              className="flex items-center gap-3 rounded-input border border-divider bg-white px-4 py-3"
            >
              <Icon size={15} className={enabled ? 'text-brand-blue' : 'text-muted'} />
              <span className="flex-1 text-sm font-medium text-ink">{label}</span>
              <Toggle
                id={`toggle-${id}`}
                checked={enabled}
                onChange={(v) => { handleToggle(id, v); }}
                label={`${enabled ? 'Disable' : 'Enable'} ${label} channel`}
                disabled={updateConfig.isPending}
              />
            </div>
          );
        })}
      </div>
      <SaveRow
        isDirty={dirtySet.size > 0}
        reason={reason}
        onReasonChange={setReason}
        onSave={() => { void handleSave(); }}
        isSaving={updateConfig.isPending}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Provider Selects
// ---------------------------------------------------------------------------

function ProviderSelects({ configMap, namespace }: { configMap: Record<string, unknown>; namespace: string }) {
  const { toast } = useToast();
  const updateConfig = useUpdateConfig(namespace);

  const [emailProvider, setEmailProvider] = useState<string>(
    String(configMap['email.provider'] ?? 'local'),
  );
  const [smsProvider, setSmsProvider] = useState<string>(
    String(configMap['sms.provider'] ?? 'noop'),
  );
  const [emailDirty, setEmailDirty] = useState(false);
  const [smsDirty,   setSmsDirty]   = useState(false);
  const [reason, setReason] = useState('');

  const isDirty = emailDirty || smsDirty;

  async function handleSave() {
    if (reason.length < AUDIT_MIN) return;
    const saves: Array<{ key: string; value: string }> = [];
    if (emailDirty) saves.push({ key: 'email.provider', value: emailProvider });
    if (smsDirty)   saves.push({ key: 'sms.provider',   value: smsProvider });

    for (const { key, value } of saves) {
      try {
        await updateConfig.mutateAsync({ key, value, reason });
        toast({ variant: 'success', title: `Saved ${key}` });
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : 'Unknown error';
        toast({ variant: 'error', title: `Failed to save ${key}`, message: msg });
      }
    }
    setEmailDirty(false);
    setSmsDirty(false);
    setReason('');
  }

  return (
    <section aria-labelledby="providers-heading" className="space-y-3">
      <h3 id="providers-heading" className="text-base font-semibold text-ink">Providers</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Email provider */}
        <div className="space-y-1">
          <label className="label text-sm font-medium text-ink" htmlFor="email-provider">
            Email provider
          </label>
          <select
            id="email-provider"
            value={emailProvider}
            onChange={(e) => { setEmailProvider(e.target.value); setEmailDirty(true); }}
            className="input w-full"
          >
            {EMAIL_PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* SMS provider */}
        <div className="space-y-1">
          <label className="label text-sm font-medium text-ink" htmlFor="sms-provider">
            SMS provider
          </label>
          <select
            id="sms-provider"
            value={smsProvider}
            onChange={(e) => { setSmsProvider(e.target.value); setSmsDirty(true); }}
            className="input w-full"
          >
            {SMS_PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>
      <SaveRow
        isDirty={isDirty}
        reason={reason}
        onReasonChange={setReason}
        onSave={() => { void handleSave(); }}
        isSaving={updateConfig.isPending}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Throttle limits
// ---------------------------------------------------------------------------

interface ThrottleState {
  burst: string;
  window: string;
}

function ThrottleLimits({ configMap, namespace }: { configMap: Record<string, unknown>; namespace: string }) {
  const { toast } = useToast();
  const updateConfig = useUpdateConfig(namespace);

  const [values, setValues] = useState<Record<ChannelId, ThrottleState>>(() => {
    const init = {} as Record<ChannelId, ThrottleState>;
    for (const { id } of CHANNELS) {
      init[id] = {
        burst:  String(configMap[`${id}.throttle.burst`]  ?? 10),
        window: String(configMap[`${id}.throttle.window`] ?? 3600),
      };
    }
    return init;
  });

  const [dirtySet, setDirtySet] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');

  function handleChange(ch: ChannelId, field: 'burst' | 'window', val: string) {
    setValues((prev) => ({ ...prev, [ch]: { ...prev[ch], [field]: val } }));
    setDirtySet((prev) => new Set([...prev, `${ch}.throttle.${field}`]));
  }

  async function handleSave() {
    if (reason.length < AUDIT_MIN) return;
    for (const key of dirtySet) {
      const parts = key.split('.');
      const ch = parts[0] as ChannelId;
      const field = parts[2] as 'burst' | 'window';
      const val = parseInt(values[ch][field], 10);
      if (isNaN(val)) continue;
      try {
        await updateConfig.mutateAsync({ key, value: val, reason });
        toast({ variant: 'success', title: `Saved ${key}` });
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : 'Unknown error';
        toast({ variant: 'error', title: `Failed to save ${key}`, message: msg });
      }
    }
    setDirtySet(new Set());
    setReason('');
  }

  return (
    <section aria-labelledby="throttle-heading" className="space-y-3">
      <h3 id="throttle-heading" className="text-base font-semibold text-ink">
        Rate limits (token-bucket)
      </h3>
      <p className="text-xs text-muted">
        Burst = max messages per window per user. Window = seconds.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-divider">
              <th className="py-2 text-left text-xs font-semibold text-muted pr-4">Channel</th>
              <th className="py-2 text-left text-xs font-semibold text-muted pr-4">Burst (msgs)</th>
              <th className="py-2 text-left text-xs font-semibold text-muted">Window (sec)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {CHANNELS.map(({ id, label }) => (
              <tr key={id}>
                <td className="py-2 pr-4 font-medium text-ink">{label}</td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={values[id].burst}
                    onChange={(e) => { handleChange(id, 'burst', e.target.value); }}
                    aria-label={`${label} burst limit`}
                    className="input w-24"
                  />
                </td>
                <td className="py-2">
                  <input
                    type="number"
                    min={60}
                    max={86400}
                    value={values[id].window}
                    onChange={(e) => { handleChange(id, 'window', e.target.value); }}
                    aria-label={`${label} window seconds`}
                    className="input w-28"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SaveRow
        isDirty={dirtySet.size > 0}
        reason={reason}
        onReasonChange={setReason}
        onSave={() => { void handleSave(); }}
        isSaving={updateConfig.isPending}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — Templates
// ---------------------------------------------------------------------------

interface TemplateFormState {
  subject_en:  string;
  subject_dz:  string;
  body_en:     string;
  body_dz:     string;
  channels:    string;   // JSON array string e.g. '["email","sms"]'
  routing:     string;   // JSON array string e.g. '["Doc Admin","Maker"]'
}

function TemplateEditor({
  eventType,
  eventLabel,
  configMap,
  namespace,
}: {
  eventType: EventTypeId;
  eventLabel: string;
  configMap: Record<string, unknown>;
  namespace: string;
}) {
  const { toast } = useToast();
  const updateConfig = useUpdateConfig(namespace);
  const [expanded, setExpanded] = useState(false);
  const testSendMutation = useMutation({ mutationFn: testSend });
  const [testResult, setTestResult] = useState<TestSendResponse | null>(null);

  // Local form state
  const [form, setForm] = useState<TemplateFormState>(() => ({
    subject_en: String(configMap[`templates.${eventType}.subject`]          ?? ''),
    subject_dz: String(configMap[`templates.${eventType}.locales.dz.subject`] ?? ''),
    body_en:    String(configMap[`templates.${eventType}.body`]              ?? ''),
    body_dz:    String(configMap[`templates.${eventType}.locales.dz.body`]   ?? ''),
    channels:   String(configMap[`templates.${eventType}.channels`]          ?? '["email","in_app"]'),
    routing:    String(configMap[`templates.${eventType}.routing`]           ?? '["Doc Admin"]'),
  }));

  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState('');

  function handleField(field: keyof TemplateFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  }

  // Parse routing JSON array for checkbox UI
  function parseArr(raw: string): string[] {
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }

  function toggleRole(role: string) {
    const current = parseArr(form.routing);
    const next = current.includes(role)
      ? current.filter((r) => r !== role)
      : [...current, role];
    handleField('routing', JSON.stringify(next));
  }

  function toggleChannel(ch: ChannelId) {
    const current = parseArr(form.channels);
    const next = current.includes(ch)
      ? current.filter((c) => c !== ch)
      : [...current, ch];
    handleField('channels', JSON.stringify(next));
  }

  async function handleSave() {
    if (reason.length < AUDIT_MIN) return;
    const saves: Array<[string, string]> = [
      [`templates.${eventType}.subject`,            form.subject_en],
      [`templates.${eventType}.locales.dz.subject`, form.subject_dz],
      [`templates.${eventType}.body`,               form.body_en],
      [`templates.${eventType}.locales.dz.body`,    form.body_dz],
      [`templates.${eventType}.channels`,            form.channels],
      [`routing.${eventType}`,                       form.routing],
    ];
    let allOk = true;
    for (const [key, value] of saves) {
      try {
        await updateConfig.mutateAsync({ key, value, reason });
      } catch (err) {
        allOk = false;
        const msg = err instanceof HttpError ? err.message : 'Unknown error';
        toast({ variant: 'error', title: `Failed to save ${key}`, message: msg });
      }
    }
    if (allOk) {
      toast({ variant: 'success', title: `Template saved: ${eventLabel}` });
      setDirty(false);
      setReason('');
    }
  }

  async function handleTestSend() {
    setTestResult(null);
    try {
      const res = await testSendMutation.mutateAsync({ template_id: eventType });
      setTestResult(res);
    } catch (err) {
      const msg = err instanceof HttpError ? err.message : 'Test send failed';
      toast({ variant: 'error', title: 'Test send failed', message: msg });
    }
  }

  const baseId = useId();
  const activeChannels = parseArr(form.channels) as ChannelId[];
  const activeRoles    = parseArr(form.routing);

  return (
    <div className="rounded-card border border-divider bg-white">
      {/* Accordion header */}
      <button
        type="button"
        onClick={() => { setExpanded((v) => !v); }}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-5 py-4 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-blue/30"
      >
        {expanded ? (
          <ChevronDown size={14} className="flex-shrink-0 text-muted" />
        ) : (
          <ChevronRight size={14} className="flex-shrink-0 text-muted" />
        )}
        <span className="flex-1 text-sm font-semibold text-ink">{eventLabel}</span>
        <span className="text-2xs font-mono text-muted">{eventType}</span>
        {dirty && (
          <span className="rounded-badge bg-warning-bg px-2 py-0.5 text-2xs font-medium text-warning">
            Unsaved
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-divider px-5 pb-5 pt-4 space-y-5">
          {/* Channel chips */}
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Active channels
            </p>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map(({ id, label }) => {
                const active = activeChannels.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => { toggleChannel(id); }}
                    className={cn(
                      'rounded-badge border px-3 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-brand-blue bg-brand-skyLight text-brand-blue'
                        : 'border-divider bg-white text-muted hover:border-borderMed',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Role routing checkboxes */}
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Recipient roles
            </p>
            <div className="flex flex-wrap gap-3">
              {ROLES.map((role) => {
                const checked = activeRoles.includes(role);
                const cbId = `${baseId}-role-${role}`;
                return (
                  <label key={role} htmlFor={cbId} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      id={cbId}
                      type="checkbox"
                      checked={checked}
                      onChange={() => { toggleRole(role); }}
                      className="h-3.5 w-3.5 rounded accent-brand-blue"
                    />
                    <span className="text-sm text-ink">{role}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Subject + Body — locale tabs */}
          <Tabs defaultValue="en">
            <TabList className="mb-3">
              <Tab value="en">English</Tab>
              <Tab value="dz">Dzongkha</Tab>
            </TabList>

            <TabPanel value="en" className="space-y-3">
              <div>
                <label className="label text-sm font-medium text-ink" htmlFor={`${baseId}-subject-en`}>
                  Subject
                </label>
                <input
                  id={`${baseId}-subject-en`}
                  type="text"
                  value={form.subject_en}
                  onChange={(e) => { handleField('subject_en', e.target.value); }}
                  className="input mt-1 w-full"
                  placeholder="e.g. Document Expiry Alert — {{count}} documents"
                />
              </div>
              <div>
                <label className="label text-sm font-medium text-ink" htmlFor={`${baseId}-body-en`}>
                  Body{' '}
                  <span className="text-2xs font-mono text-muted">supports {'{{var}}'}</span>
                </label>
                <textarea
                  id={`${baseId}-body-en`}
                  rows={4}
                  value={form.body_en}
                  onChange={(e) => { handleField('body_en', e.target.value); }}
                  className="input mt-1 w-full resize-y"
                  placeholder="Dear {{role}}, {{count}} document(s) have expired…"
                />
              </div>
            </TabPanel>

            <TabPanel value="dz" className="space-y-3">
              <div>
                <label className="label text-sm font-medium text-ink" htmlFor={`${baseId}-subject-dz`}>
                  Subject (Dzongkha)
                </label>
                <input
                  id={`${baseId}-subject-dz`}
                  type="text"
                  value={form.subject_dz}
                  onChange={(e) => { handleField('subject_dz', e.target.value); }}
                  className="input mt-1 w-full"
                  dir="auto"
                />
              </div>
              <div>
                <label className="label text-sm font-medium text-ink" htmlFor={`${baseId}-body-dz`}>
                  Body (Dzongkha){' '}
                  <span className="text-2xs font-mono text-muted">supports {'{{var}}'}</span>
                </label>
                <textarea
                  id={`${baseId}-body-dz`}
                  rows={4}
                  value={form.body_dz}
                  onChange={(e) => { handleField('body_dz', e.target.value); }}
                  className="input mt-1 w-full resize-y"
                  dir="auto"
                />
              </div>
            </TabPanel>
          </Tabs>

          {/* Save row */}
          <SaveRow
            isDirty={dirty}
            reason={reason}
            onReasonChange={setReason}
            onSave={() => { void handleSave(); }}
            isSaving={updateConfig.isPending}
          />

          {/* Test-send */}
          <div className="border-t border-divider pt-4">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                disabled={testSendMutation.isPending}
                onClick={() => { void handleTestSend(); }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-input border border-brand-blue',
                  'px-4 py-1.5 text-sm font-medium text-brand-blue transition-colors',
                  'hover:bg-brand-skyLight focus:outline-none focus:ring-2 focus:ring-brand-blue/40',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                <Send size={13} />
                {testSendMutation.isPending ? 'Sending…' : 'Test send'}
              </button>
              <p className="text-xs text-muted">
                Renders template with sample data and dispatches to your admin account.
              </p>
            </div>

            {/* Test-send results */}
            {testResult !== null && (
              <div className="mt-3 rounded-input border border-divider bg-surface-alt p-3 space-y-2">
                <p className="text-xs font-semibold text-ink">
                  Preview — <span className="font-mono">{testResult.subject}</span>
                </p>
                <pre className="text-2xs text-muted whitespace-pre-wrap font-mono line-clamp-4">
                  {testResult.body}
                </pre>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(testResult.results).map(([ch, res]) => (
                    <span
                      key={ch}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-2xs font-medium',
                        res.ok
                          ? 'bg-success-bg text-success'
                          : 'bg-danger-bg text-danger',
                      )}
                    >
                      {res.ok
                        ? <CheckCircle2 size={10} />
                        : <XCircle size={10} />}
                      {ch}
                      {!res.ok && res.error !== undefined && `: ${res.error}`}
                    </span>
                  ))}
                  {testResult.skipped.map((ch) => (
                    <span
                      key={ch}
                      className="inline-flex items-center gap-1 rounded-badge bg-divider px-2 py-0.5 text-2xs font-medium text-muted"
                    >
                      {ch} skipped
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TemplatesSection({
  configMap,
  namespace,
}: {
  configMap: Record<string, unknown>;
  namespace: string;
}) {
  return (
    <section aria-labelledby="templates-heading" className="space-y-3">
      <h3 id="templates-heading" className="text-base font-semibold text-ink">Templates</h3>
      <p className="text-xs text-muted">
        Configure subject, body, active channels, and recipient roles per event type.
        Use <code className="font-mono bg-divider px-1 rounded text-2xs">{'{{var}}'}</code> for interpolation.
      </p>
      <div className="space-y-2">
        {EVENT_TYPES.map(({ id, label }) => (
          <TemplateEditor
            key={id}
            eventType={id}
            eventLabel={label}
            configMap={configMap}
            namespace={namespace}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Root — NotificationsPanel
// ---------------------------------------------------------------------------

const NAMESPACE = 'notifications';

export function NotificationsPanel() {
  const configQuery = useTenantConfig(NAMESPACE);

  if (configQuery.isLoading) {
    return (
      <div className="space-y-6 py-4">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (configQuery.isError) {
    return (
      <EmptyState
        icon={<Bell size={20} />}
        title="Could not load notification config"
        body="Check your permissions or reload the page."
      />
    );
  }

  const configMap = (configQuery.data ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-10">
      {/* Panel header */}
      <div>
        <h2 className="text-xl font-semibold text-ink">Notifications</h2>
        <p className="mt-1 text-sm text-muted">
          Configure which channels are enabled, which providers deliver them, per-channel rate
          limits, message templates, and recipient role mappings.
        </p>
      </div>

      <ChannelToggles configMap={configMap} namespace={NAMESPACE} />

      <div className="border-t border-divider" />

      <ProviderSelects configMap={configMap} namespace={NAMESPACE} />

      <div className="border-t border-divider" />

      <ThrottleLimits configMap={configMap} namespace={NAMESPACE} />

      <div className="border-t border-divider" />

      <TemplatesSection configMap={configMap} namespace={NAMESPACE} />
    </div>
  );
}
