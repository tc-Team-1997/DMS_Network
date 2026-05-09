/**
 * RetentionPage — full-page admin UI for Retention + WORM (Wave B F#30-31).
 *
 * Route: /admin/retention
 * Auth gate: Doc Admin only (enforced here; also at endpoint level).
 *
 * Tabs:
 *   Overview     — scheduler health tile + trigger button
 *   Rules        — per-doctype retention rule table
 *   Legal Holds  — apply / release legal holds
 *   WORM Admin   — locked documents + extend lock
 *   Purge Log    — audit history
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, RefreshCw } from 'lucide-react';
import { Tabs, TabList, Tab, TabPanel } from '@/components/ui/Tabs';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/store/auth';
import { AccessDenied } from '@/components/AccessDenied';
import { HttpError } from '@/lib/http';
import { triggerRetention } from '@/modules/admin/api';
import { SchedulerHealthTile } from './components/SchedulerHealthTile';
import { RetentionRulesTable } from './components/RetentionRulesTable';
import { LegalHoldsTable } from './components/LegalHoldsTable';
import { WormAdminTable } from './components/WormAdminTable';
import { PurgeLogTable } from './components/PurgeLogTable';

export function RetentionPage() {
  const user = useAuth((s) => s.user);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');

  // Gate: Doc Admin only.
  if (!user || user.role !== 'Doc Admin') {
    return <AccessDenied />;
  }

  const triggerMutation = useMutation({
    mutationFn: triggerRetention,
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['retention', 'sweep-status'] });
      void qc.invalidateQueries({ queryKey: ['retention', 'purge-log'] });
      toast({
        variant: 'success',
        title: 'Retention sweep triggered',
        message: `${result.policies} policy rule(s) evaluated.`,
      });
    },
    onError: (err: unknown) => {
      const msg = err instanceof HttpError ? err.message : (err as Error).message;
      toast({ variant: 'error', title: 'Sweep trigger failed', message: msg });
    },
  });

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink flex items-center gap-2">
            <Archive size={20} className="text-brand-blue" />
            Retention &amp; WORM Admin
          </h1>
          <p className="mt-1 text-sm text-muted">
            Configure document retention policies, manage legal holds, and administer
            WORM (Write-Once-Read-Many) locks.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => triggerMutation.mutate()}
          loading={triggerMutation.isPending}
          data-testid="retention-trigger"
        >
          <RefreshCw size={13} />
          Run sweep now
        </Button>
      </div>

      <Tabs value={tab} onChange={setTab}>
        <TabList>
          <Tab value="overview">Overview</Tab>
          <Tab value="rules">Rules</Tab>
          <Tab value="legal-holds">Legal Holds</Tab>
          <Tab value="worm">WORM Admin</Tab>
          <Tab value="purge-log">Purge Log</Tab>
        </TabList>

        {/* ── Overview ────────────────────────────────────────────────────── */}
        <TabPanel value="overview">
          <Panel title="Retention scheduler health" data-testid="sweep-status-panel">
            <SchedulerHealthTile />
          </Panel>
        </TabPanel>

        {/* ── Rules ───────────────────────────────────────────────────────── */}
        <TabPanel value="rules">
          <Panel
            title="Per-doctype retention rules"
            action={
              <span className="text-xs text-muted">
                Stored in tenant_config namespace &quot;retention&quot;
              </span>
            }
            data-testid="retention-rules-panel"
          >
            <RetentionRulesTable />
          </Panel>
        </TabPanel>

        {/* ── Legal Holds ─────────────────────────────────────────────────── */}
        <TabPanel value="legal-holds">
          <Panel
            title="Legal holds"
            action={
              <span className="text-xs text-muted">
                Documents on hold are excluded from retention sweep
              </span>
            }
            data-testid="legal-holds-panel"
          >
            <LegalHoldsTable />
          </Panel>
        </TabPanel>

        {/* ── WORM Admin ──────────────────────────────────────────────────── */}
        <TabPanel value="worm">
          <Panel
            title="WORM-locked documents"
            action={
              <span className="text-xs text-muted">
                Locks can be extended but never shortened
              </span>
            }
            data-testid="worm-admin-panel"
          >
            <WormAdminTable />
          </Panel>
        </TabPanel>

        {/* ── Purge Log ───────────────────────────────────────────────────── */}
        <TabPanel value="purge-log">
          <Panel title="Retention audit log" data-testid="purge-log-panel">
            <PurgeLogTable />
          </Panel>
        </TabPanel>
      </Tabs>
    </div>
  );
}
