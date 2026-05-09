/**
 * AbacPage — ABAC Editor.
 *
 * Rendered at /admin/settings/abac via SettingsLayout → AbacPanel.
 *
 * Three tabs:
 *   Rules          — list of rules with New / Edit / Delete actions
 *   Test Policy    — simulate an authorization decision
 *   Decision Trace — past decisions from audit_log
 *
 * Top action: "Compile & Push" — generates dms.rego from current rules
 * and pushes to OPA sidecar. Shows compile result (ok/error, OPA push status).
 *
 * Safety: compile failure (server 500) shows error; existing dms.rego untouched.
 */
import { useState } from 'react';
import { Zap, Loader2, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Tabs, TabList, Tab, TabPanel, Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useCompileAndPush } from './api';
import { RuleList }              from './components/RuleList';
import { TestPolicyPanel }       from './components/TestPolicyPanel';
import { DecisionTraceViewer }   from './components/DecisionTraceViewer';
import type { CompileResult }    from './schemas';

// ---------------------------------------------------------------------------
// Compile result banner
// ---------------------------------------------------------------------------

function CompileBanner({ result }: { result: CompileResult }) {
  const ok = result.ok === true;
  return (
    <div className={cn(
      'mt-3 rounded-card border p-3 text-sm',
      ok ? 'border-success bg-success-bg' : 'border-danger bg-danger-bg',
    )}>
      <div className="flex items-start gap-2">
        {ok
          ? <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0 text-success" />
          : <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-danger" />}
        <div className="min-w-0">
          {ok ? (
            <>
              <p className="font-medium text-ink">
                Compiled {result.rules_compiled ?? 0} rule{(result.rules_compiled ?? 0) === 1 ? '' : 's'} — dms.rego updated.
              </p>
              {result.opa_push !== undefined && result.opa_push !== null && (
                result.opa_push.ok
                  ? <p className="mt-0.5 text-xs text-ink-sub">OPA push succeeded (HTTP {result.opa_push.status}).</p>
                  : <p className="mt-0.5 text-xs text-warning">{`OPA push non-fatal: ${result.opa_push.error ?? 'unknown'}. File written; restart OPA or wait for hot-reload.`}</p>
              )}
              {(result.opa_push === undefined || result.opa_push === null) && (
                <p className="mt-0.5 text-xs text-muted">OPA_URL not configured — file written only.</p>
              )}
            </>
          ) : (
            <p className="font-medium text-danger">{result.error ?? 'Compile failed'}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AbacPage
// ---------------------------------------------------------------------------

export function AbacPage() {
  const { toast }    = useToast();
  const compile      = useCompileAndPush();
  const [lastResult, setLastResult] = useState<CompileResult | null>(null);

  async function handleCompile() {
    setLastResult(null);
    try {
      const result = await compile.mutateAsync(undefined);
      setLastResult(result);
      if (result.ok) {
        toast({
          variant: 'success',
          title:   'Policy compiled',
          message: `${result.rules_compiled ?? 0} rule(s) → dms.rego`,
        });
      } else {
        toast({
          variant: 'error',
          title:   'Compile failed',
          message: result.error ?? 'Unknown error — dms.rego unchanged',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setLastResult({ ok: false, error: msg });
      toast({ variant: 'error', title: 'Compile failed', message: msg });
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-ink">ABAC Policy Editor</h2>
        <p className="mt-1 text-sm text-muted">
          Compose attribute-based access control rules. Save rules, then compile
          to regenerate <code className="rounded bg-divider px-1 text-xs">opa/policies/dms.rego</code> and push to the OPA sidecar.
        </p>
      </div>

      {/* Compile action + result */}
      <div className="mb-5 rounded-card border border-divider bg-surface-alt p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-brand-blue flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-ink">Compile &amp; Push</p>
              <p className="text-xs text-muted">
                Generates <code className="rounded bg-divider px-1">dms.rego</code> from current rules and pushes to OPA. Any compile error leaves the existing policy untouched.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => { void handleCompile(); }}
            disabled={compile.isPending}
            className="flex-shrink-0"
          >
            {compile.isPending
              ? <Loader2 size={13} className="animate-spin" />
              : <Zap size={13} />}
            {compile.isPending ? 'Compiling…' : 'Compile & Push'}
          </Button>
        </div>
        {lastResult !== null && <CompileBanner result={lastResult} />}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="rules">
        <TabList>
          <Tab value="rules">Rules</Tab>
          <Tab value="test">Test Policy</Tab>
          <Tab value="trace">Decision Trace</Tab>
        </TabList>

        <TabPanel value="rules">
          <div className="pt-4">
            <RuleList />
          </div>
        </TabPanel>

        <TabPanel value="test">
          <div className="pt-4">
            <TestPolicyPanel />
          </div>
        </TabPanel>

        <TabPanel value="trace">
          <div className="pt-4">
            <DecisionTraceViewer />
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
}
