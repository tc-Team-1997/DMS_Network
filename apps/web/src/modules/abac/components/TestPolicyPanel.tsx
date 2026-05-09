/**
 * TestPolicyPanel — "Will user X be allowed to do Y on resource Z?"
 *
 * Subject attributes (branch, tenant, roles) are inferred from the logged-in
 * session on the Python side — the caller only needs to provide:
 *   action:   string  (one of the known action names)
 *   resource: object  (optional — e.g. { risk_band: "critical", branch: "HQ" })
 *   context:  object  (optional — e.g. { stepup_valid: true })
 *
 * The test call goes through POST /spa/api/admin/abac/test which proxies to
 * Python's POST /api/v1/abac/check.
 */
import { useState } from 'react';
import { PlayCircle, Loader2, ShieldCheck, ShieldX } from 'lucide-react';
import { Badge, Button, Combobox } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useTestPolicy } from '../api';
import { KNOWN_ACTIONS } from '../schemas';

const ACTION_OPTIONS = KNOWN_ACTIONS.map(v => ({ value: v, label: v }));

function JsonTextarea({
  label,
  value,
  onChange,
  placeholder,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  error?: string;
}) {
  return (
    <div>
      <label className="label mb-1 block text-sm font-medium text-ink">{label}</label>
      <textarea
        value={value}
        onChange={e => { onChange(e.target.value); }}
        rows={4}
        placeholder={placeholder}
        className={cn(
          'input w-full resize-y font-mono text-xs',
          error && 'border-danger',
        )}
        spellCheck={false}
      />
      {error && <p className="mt-0.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function TestPolicyPanel() {
  const testPolicy = useTestPolicy();

  const [action, setAction]   = useState('approve');
  const [resourceStr, setResourceStr] = useState('{\n  "risk_band": "critical",\n  "branch": "HQ"\n}');
  const [contextStr, setContextStr]   = useState('{\n  "stepup_valid": false\n}');
  const [resourceErr, setResourceErr] = useState('');
  const [contextErr, setContextErr]   = useState('');

  function parseOptionalJson(raw: string, setErr: (e: string) => void): Record<string, unknown> | undefined {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '{}') return undefined;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setErr('Must be a JSON object');
        return undefined;
      }
      setErr('');
      return parsed as Record<string, unknown>;
    } catch {
      setErr('Invalid JSON');
      return undefined;
    }
  }

  async function handleRun() {
    setResourceErr('');
    setContextErr('');
    const resource = parseOptionalJson(resourceStr, setResourceErr);
    const context  = parseOptionalJson(contextStr, setContextErr);
    if (resourceErr || contextErr) return;

    await testPolicy.mutateAsync({
      action,
      resource,
      context,
    });
  }

  const result = testPolicy.data;
  const isAllow = result?.allow === true;

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-sub">
        Simulate an authorization decision against the current OPA policy.
        The subject (roles, branch, tenant) comes from your logged-in session.
      </p>

      {/* Action picker */}
      <div>
        <label className="label mb-1 block text-sm font-medium text-ink">Action</label>
        <Combobox
          options={ACTION_OPTIONS}
          value={action}
          onChange={setAction}
          placeholder="approve"
          className="max-w-xs"
        />
      </div>

      {/* Resource JSON */}
      <JsonTextarea
        label="Resource attributes (JSON)"
        value={resourceStr}
        onChange={v => { setResourceStr(v); setResourceErr(''); }}
        placeholder={'{\n  "risk_band": "critical",\n  "branch": "HQ",\n  "tenant": "nbe"\n}'}
        error={resourceErr}
      />

      {/* Context JSON */}
      <JsonTextarea
        label="Context attributes (JSON)"
        value={contextStr}
        onChange={v => { setContextStr(v); setContextErr(''); }}
        placeholder={'{\n  "stepup_valid": true\n}'}
        error={contextErr}
      />

      <Button
        onClick={() => { void handleRun(); }}
        disabled={testPolicy.isPending}
        size="sm"
      >
        {testPolicy.isPending
          ? <Loader2 size={13} className="animate-spin" />
          : <PlayCircle size={13} />}
        Run test
      </Button>

      {/* Result */}
      {result !== undefined && !testPolicy.isPending && (
        <div className={cn(
          'rounded-card border p-4',
          isAllow ? 'border-success bg-success-bg' : 'border-danger bg-danger-bg',
        )}>
          <div className="flex items-center gap-3 mb-2">
            {isAllow
              ? <ShieldCheck size={18} className="text-success flex-shrink-0" />
              : <ShieldX    size={18} className="text-danger flex-shrink-0" />}
            <div>
              <p className="text-sm font-semibold text-ink">
                Decision: <Badge tone={isAllow ? 'success' : 'danger'}>
                  {isAllow ? 'ALLOW' : 'DENY'}
                </Badge>
              </p>
              {result.reason && (
                <p className="mt-0.5 text-xs text-ink-sub font-mono">{result.reason}</p>
              )}
            </div>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {result.via !== undefined && (
              <>
                <dt className="text-muted">Via</dt>
                <dd className="font-mono text-ink">{result.via}</dd>
              </>
            )}
            <dt className="text-muted">Action</dt>
            <dd className="font-mono text-ink">{action}</dd>
          </dl>
        </div>
      )}

      {testPolicy.isError && (
        <div className="rounded-card border border-danger bg-danger-bg p-3 text-sm text-danger">
          {testPolicy.error instanceof Error ? testPolicy.error.message : 'Request failed'}
        </div>
      )}
    </div>
  );
}
