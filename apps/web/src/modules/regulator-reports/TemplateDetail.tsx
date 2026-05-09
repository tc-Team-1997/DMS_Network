/**
 * TemplateDetail — detail page for a single report template.
 * Shows: template metadata, pre-flight panel, generate form, submissions log.
 */
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Settings, FileText, Clock, RefreshCw } from 'lucide-react';
import {
  Panel, Badge, Button, Tabs, TabList, Tab, TabPanel,
  EmptyState, Skeleton, useToast,
} from '@/components/ui';
import { useAuth } from '@/store/auth';
import { fetchTemplate, fetchPreflight, generateReport, updateTemplate } from './api';
import { PreflightPanel } from './components/PreflightPanel';
import { ParamForm } from './components/ParamForm';
import { TemplateEditor } from './components/TemplateEditor';
import { SubmissionsTab } from './SubmissionsTab';
import { SignedReceiptBadge } from './components/SignedReceiptBadge';
import type { ReportFormat, GenerateResponse, TemplateIn } from './schemas';

const FORMAT_LABELS: Record<ReportFormat, string> = {
  pdf:    'PDF',
  csv:    'CSV (XLSX unavailable — SheetJS absent)',
  jsonld: 'JSON-LD (W3C DPV)',
};

export function TemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const templateId = parseInt(id ?? '0', 10);
  const qc = useQueryClient();
  const { toast } = useToast();
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === 'Doc Admin';

  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<ReportFormat>('pdf');
  const [lastReceipt, setLastReceipt] = useState<GenerateResponse | null>(null);

  const templateQ = useQuery({
    queryKey: ['regulator-reports', 'template', templateId],
    queryFn: () => fetchTemplate(templateId),
    enabled: Number.isFinite(templateId) && templateId > 0,
  });

  const preflightQ = useQuery({
    queryKey: ['regulator-reports', 'preflight', templateId],
    queryFn: () => fetchPreflight(templateId),
    enabled: Number.isFinite(templateId) && templateId > 0,
  });

  const generateMut = useMutation({
    mutationFn: (body: { as_of_date: string; params: Record<string, unknown>; format: ReportFormat }) =>
      generateReport(templateId, body),
    onSuccess: (resp) => {
      setLastReceipt(resp);
      toast({
        variant: 'success',
        title: 'Report generated',
        message: `${resp.rows} row(s) — SHA-256: ${resp.sha256.slice(0, 16)}…`,
      });
      void qc.invalidateQueries({ queryKey: ['regulator-reports', 'submissions'] });
      void qc.invalidateQueries({ queryKey: ['regulator-reports', 'preflight', templateId] });
    },
    onError: (err) => {
      toast({ variant: 'error', title: 'Generation failed', message: String(err) });
    },
  });

  const updateMut = useMutation({
    mutationFn: (body: TemplateIn) => updateTemplate(templateId, body),
    onSuccess: () => {
      toast({ variant: 'success', title: 'Template updated' });
      void qc.invalidateQueries({ queryKey: ['regulator-reports', 'template', templateId] });
      void qc.invalidateQueries({ queryKey: ['regulator-reports', 'templates'] });
    },
  });

  const template = templateQ.data;

  if (templateQ.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton height={24} width={200} />
        <Skeleton height={120} />
        <Skeleton height={80} />
      </div>
    );
  }

  if (templateQ.isError || !template) {
    return (
      <EmptyState
        icon={<RefreshCw size={24} className="text-muted" />}
        title="Template not found"
        body="The template may have been deleted or you do not have access."
      />
    );
  }

  const formats: ReportFormat[] = ['pdf', 'csv', 'jsonld'];

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link to="/regulator-reports" className="mt-1 text-muted hover:text-ink transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge tone="blue">{template.regulator}</Badge>
              <Badge tone={template.is_active ? 'success' : 'neutral'}>
                {template.is_active ? 'Active' : 'Inactive'}
              </Badge>
              {template.schedule_cron && (
                <Badge tone="purple">
                  <Clock size={10} className="mr-1 inline" />
                  {template.schedule_cron}
                </Badge>
              )}
            </div>
            <h1 className="text-xl font-semibold text-ink">{template.name}</h1>
            <p className="text-xs text-muted mt-0.5">
              Default format: {FORMAT_LABELS[template.format]}
              {' · '}Created {new Date(template.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button variant="ghost" size="sm" onClick={() => setEditorOpen(true)}>
            <Settings size={14} className="mr-1.5" />
            Edit template
          </Button>
        )}
      </div>

      <Tabs defaultValue="generate">
        <TabList>
          <Tab value="generate">Generate</Tab>
          <Tab value="submissions">Submission log</Tab>
        </TabList>

        {/* Generate tab */}
        <TabPanel value="generate">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
            {/* Left: pre-flight + param form */}
            <Panel>
              <div className="space-y-6">
                <div>
                  <p className="mb-3 text-sm font-semibold text-ink">Pre-flight checks</p>
                  <PreflightPanel
                    result={preflightQ.data}
                    isLoading={preflightQ.isLoading}
                  />
                </div>

                <div className="border-t border-divider pt-4">
                  <p className="mb-1 text-sm font-semibold text-ink">Format</p>
                  <div className="flex gap-2 mb-4">
                    {formats.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setSelectedFormat(f)}
                        className={`rounded-input border px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue ${
                          selectedFormat === f
                            ? 'border-brand-blue bg-brand-skyLight text-brand-blue'
                            : 'border-border bg-surface text-ink-sub hover:bg-divider'
                        }`}
                      >
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {selectedFormat === 'csv' && (
                    <p className="mb-3 text-[10px] text-muted italic border border-warning-bg bg-warning-bg rounded-input px-2 py-1.5">
                      XLSX is not available (SheetJS absent from package.json). CSV will be generated instead.
                    </p>
                  )}
                  {selectedFormat === 'jsonld' && (
                    <p className="mb-3 text-[10px] text-muted italic border border-brand-skyLight bg-brand-skyLight rounded-input px-2 py-1.5">
                      JSON-LD output uses W3C Data Privacy Vocabulary (DPV) @context — designed for GDPR Art-30 RoPA and PDPL data breach reports.
                    </p>
                  )}

                  <p className="mb-3 text-sm font-semibold text-ink">Parameters</p>
                  <ParamForm
                    schemaJson={template.parameters_schema_json}
                    disabled={generateMut.isPending}
                    onSubmit={(paramValues) => {
                      const asOfDate = (paramValues['as_of_date'] as string | undefined)
                        ?? new Date().toISOString().slice(0, 10);
                      const rest: Record<string, unknown> = { ...paramValues };
                      delete rest['as_of_date'];
                      generateMut.mutate({ as_of_date: asOfDate, params: rest, format: selectedFormat });
                    }}
                  />
                </div>
              </div>
            </Panel>

            {/* Right: last generated receipt */}
            <div className="space-y-4">
              {lastReceipt ? (
                <Panel>
                  <p className="mb-3 text-sm font-semibold text-ink flex items-center gap-1.5">
                    <FileText size={14} />
                    Last generated receipt
                  </p>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted">Receipt ID</dt>
                      <dd className="font-mono text-ink">#{lastReceipt.receipt_id}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Format</dt>
                      <dd className="uppercase font-medium text-ink">{lastReceipt.format}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Rows</dt>
                      <dd className="font-medium text-ink">{lastReceipt.rows}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Generated</dt>
                      <dd className="text-ink">{new Date(lastReceipt.generated_at).toLocaleString()}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 border-t border-divider pt-3">
                    <SignedReceiptBadge sha256={lastReceipt.sha256} signatureJson={JSON.stringify(lastReceipt.signature)} />
                  </div>
                </Panel>
              ) : (
                <Panel className="flex flex-col items-center justify-center py-10 text-center">
                  <FileText size={28} className="text-muted mb-2" />
                  <p className="text-sm text-muted">No report generated yet in this session.</p>
                  <p className="text-xs text-muted mt-1">Fill in the parameters and click Generate.</p>
                </Panel>
              )}
            </div>
          </div>
        </TabPanel>

        {/* Submission log tab */}
        <TabPanel value="submissions">
          <SubmissionsTab templateId={templateId} />
        </TabPanel>
      </Tabs>

      {/* Edit modal */}
      {isAdmin && (
        <TemplateEditor
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          initial={template}
          onSave={async (body) => { await updateMut.mutateAsync(body); }}
        />
      )}
    </div>
  );
}
