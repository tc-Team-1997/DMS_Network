/**
 * RMA Quarterly Compliance Report — Plan 3 (Wave-E1).
 *
 * Quarterly compliance report filed with the Royal Monetary Authority of
 * Bhutan. Five control areas (AML/KYC, CDD, Record Keeping, Reporting,
 * Governance) each with an evidence checklist. 15-day SLA per BT regulator
 * window.
 *
 * Routed at `/regulator-reports/rma/:id`. Reads the template's
 * `parameters_schema_json` (seeded by Alembic migration 0046) for the
 * control list, period options, and filing format.
 */

import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, FileDown, Send, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { Panel, Badge, Button, Skeleton, useToast } from '@/components/ui';
import { fetchTemplate, generateReport, submitToRegulator } from './api';
import { HttpError } from '@/lib/http';

// ---------------------------------------------------------------------------
// RMA-specific schema (read from template.parameters_schema_json)
// ---------------------------------------------------------------------------

interface RmaControl {
  id: string;
  label: string;
  evidence_required: string[];
}

interface RmaSchema {
  frequency: string;
  sla_days: number;
  filing_format: string;
  period_options: string[];
  controls: RmaControl[];
}

function parseRmaSchema(raw: string): RmaSchema | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.controls)) return null;
    return parsed as RmaSchema;
  } catch {
    return null;
  }
}

function currentPeriodLabel(): string {
  const m = new Date().getMonth(); // 0-11
  const q = Math.floor(m / 3) + 1;
  return `${new Date().getFullYear()}-Q${q}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RmaQuarterlyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const templateId = id ? parseInt(id, 10) : NaN;

  const [period, setPeriod] = useState<string>(currentPeriodLabel());
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [lastReceiptId, setLastReceiptId] = useState<number | null>(null);
  const [completedControls, setCompletedControls] = useState<Set<string>>(new Set());

  const tplQ = useQuery({
    queryKey: ['regulator-reports', 'template', templateId],
    queryFn: () => fetchTemplate(templateId),
    enabled: Number.isFinite(templateId),
  });

  const schema = tplQ.data ? parseRmaSchema(tplQ.data.parameters_schema_json) : null;
  const yearList = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - 1 + i);
  const periodOptions: string[] = schema
    ? yearList.flatMap((y) => schema.period_options.map((q) => `${y}-${q}`))
    : [currentPeriodLabel()];

  // ---------------------------------------------------------------------------
  // Export = POST /reports/templates/:id/generate
  // ---------------------------------------------------------------------------
  const exportMut = useMutation({
    mutationFn: () => {
      const [year, quarter] = period.split('-');
      const asOf = `${year}-${quarter === 'Q1' ? '03' : quarter === 'Q2' ? '06' : quarter === 'Q3' ? '09' : '12'}-01`;
      return generateReport(templateId, {
        as_of_date: asOf,
        params: { period, filing_format: schema?.filing_format ?? 'RMA-CR-2026' },
        format: 'pdf',
      });
    },
    onSuccess: (resp) => {
      setLastReceiptId(resp.receipt_id);
      setExportDialogOpen(false);
      toast({
        variant: 'success',
        title: 'RMA bundle exported',
        message: `Receipt #${resp.receipt_id} — SHA-256 ${resp.sha256.slice(0, 10)}… (${resp.rows} rows)`,
      });
    },
    onError: (err) => {
      const msg = err instanceof HttpError ? err.message : String(err);
      toast({ variant: 'error', title: 'Export failed', message: msg });
    },
  });

  // ---------------------------------------------------------------------------
  // Submit = POST /reports/submissions/:receipt_id/submit
  // ---------------------------------------------------------------------------
  const submitMut = useMutation({
    mutationFn: () => {
      if (lastReceiptId === null) throw new Error('No receipt to submit — export first');
      return submitToRegulator(lastReceiptId);
    },
    onSuccess: (resp) => {
      setSubmitDialogOpen(false);
      toast({
        variant: 'success',
        title: 'Submitted to RMA',
        message: `Status: ${resp.status}${resp.regulator_endpoint ? ` · ${resp.regulator_endpoint}` : ''}`,
      });
    },
    onError: (err) => {
      const msg = err instanceof HttpError ? err.message : String(err);
      toast({ variant: 'error', title: 'Submit failed', message: msg });
    },
  });

  function toggleControl(controlId: string) {
    setCompletedControls((prev) => {
      const next = new Set(prev);
      if (next.has(controlId)) next.delete(controlId);
      else next.add(controlId);
      return next;
    });
  }

  if (!Number.isFinite(templateId)) {
    return (
      <div className="p-6 text-sm text-danger">Invalid template id.</div>
    );
  }

  if (tplQ.isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton height={40} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (tplQ.isError || !tplQ.data) {
    return (
      <div className="p-6 text-sm text-danger">Could not load template.</div>
    );
  }

  const tpl = tplQ.data;
  const allControlsDone = schema !== null && completedControls.size === schema.controls.length;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            to="/regulator-reports"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-ink-sub"
          >
            <ArrowLeft size={12} />
            Back to library
          </Link>
          <h1 className="text-xl font-semibold text-ink flex items-center gap-2">
            <ShieldCheck size={20} className="text-brand-blue" />
            {tpl.name}
          </h1>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
            <Badge tone="blue">{tpl.regulator}</Badge>
            {schema && (
              <>
                <Badge tone="neutral">{schema.frequency}</Badge>
                <Badge tone="neutral">{schema.sla_days} days</Badge>
                <Badge tone="neutral">{schema.filing_format}</Badge>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Period selector */}
      <Panel>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
            Reporting period
          </span>
          <select
            data-testid="rma-period-selector"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="input min-h-[44px] w-48"
          >
            {periodOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
      </Panel>

      {/* Control checklist */}
      {schema && (
        <Panel>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Control checklist</h2>
            <span className="text-xs text-muted">
              {completedControls.size} / {schema.controls.length} complete
            </span>
          </div>
          <ul
            data-testid="rma-control-checklist"
            role="list"
            className="space-y-2"
          >
            {schema.controls.map((c) => {
              const done = completedControls.has(c.id);
              return (
                <li
                  key={c.id}
                  data-testid={`rma-control-${c.id.toLowerCase()}`}
                  className="flex items-start gap-3 rounded-input border border-divider bg-surface p-3"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    onClick={() => toggleControl(c.id)}
                    className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-input border ${
                      done
                        ? 'border-success bg-success-bg text-success'
                        : 'border-divider bg-raised text-muted hover:border-borderMed'
                    }`}
                    aria-label={`Mark ${c.label} as complete`}
                  >
                    {done && <CheckCircle2 size={16} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink">{c.label}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      Evidence required: {c.evidence_required.join(', ')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="rma-export-bundle"
          onClick={() => setExportDialogOpen(true)}
          disabled={!allControlsDone && schema !== null}
          title={allControlsDone ? '' : 'Complete all controls before exporting'}
        >
          <FileDown size={15} className="mr-1.5" />
          Export bundle
        </Button>
        <Button
          variant="outline"
          data-testid="rma-submit"
          onClick={() => setSubmitDialogOpen(true)}
          disabled={lastReceiptId === null}
          title={lastReceiptId === null ? 'Export a bundle first' : ''}
        >
          <Send size={15} className="mr-1.5" />
          Submit to RMA
        </Button>
      </div>

      {/* Export confirm dialog */}
      {exportDialogOpen && (
        <div
          data-testid="rma-export-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rma-export-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-card border border-divider bg-surface p-5 shadow-lg">
            <h3 id="rma-export-dialog-title" className="mb-2 text-sm font-semibold text-ink">
              Export RMA bundle for {period}?
            </h3>
            <p className="mb-4 text-xs text-muted">
              Generates a signed PDF + JSON manifest containing the evidence for all
              5 control areas. The export is auditable; submission to the regulator
              is a separate step.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setExportDialogOpen(false)} disabled={exportMut.isPending}>
                Cancel
              </Button>
              <Button
                data-testid="rma-export-confirm"
                onClick={() => exportMut.mutate()}
                disabled={exportMut.isPending}
              >
                {exportMut.isPending ? 'Exporting…' : 'Export now'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Submit confirm dialog */}
      {submitDialogOpen && (
        <div
          data-testid="rma-submit-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rma-submit-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-card border border-divider bg-surface p-5 shadow-lg">
            <h3 id="rma-submit-dialog-title" className="mb-2 text-sm font-semibold text-ink">
              Submit receipt #{lastReceiptId} to RMA?
            </h3>
            <p className="mb-4 text-xs text-muted">
              POSTs the signed bundle to the Royal Monetary Authority of Bhutan filing
              endpoint. This is auditable and irreversible — make sure the controls
              and evidence are correct.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSubmitDialogOpen(false)} disabled={submitMut.isPending}>
                Cancel
              </Button>
              <Button
                data-testid="rma-submit-confirm"
                onClick={() => submitMut.mutate()}
                disabled={submitMut.isPending}
              >
                {submitMut.isPending ? 'Submitting…' : 'Submit now'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
