/**
 * Regulator Reports library page — lists all templates filtered by regulator
 * and active status. Click a template to open TemplateDetail.
 * Admins can create new templates from the "New template" button.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Plus, Filter, ChevronRight, Clock } from 'lucide-react';
import {
  Panel, Badge, Button, Input, EmptyState, Skeleton, useToast,
} from '@/components/ui';
import { useAuth } from '@/store/auth';
import { fetchTemplates, createTemplate } from './api';
import { TemplateEditor } from './components/TemplateEditor';
import type { Template, TemplateIn } from './schemas';

const REGULATORS = ['All', 'RMA', 'CBE', 'SAMA', 'RBI', 'SOC2', 'GDPR', 'PDPL'];

function RegulatorIcon({ code }: { code: string }) {
  const abbr = code.slice(0, 3).toUpperCase();
  return (
    <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-skyLight text-[10px] font-bold text-brand-blue">
      {abbr}
    </span>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const hasSchedule = template.schedule_cron !== null && template.schedule_cron !== '';
  return (
    <Link
      to={`/regulator-reports/${template.id}`}
      className="group flex items-center gap-4 rounded-card border border-divider bg-surface px-4 py-3 transition-all hover:border-brand-blue/40 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
      data-testid={`template-card-${template.id}`}
    >
      <RegulatorIcon code={template.regulator} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-semibold text-ink truncate">{template.name}</p>
          {!template.is_active && (
            <Badge tone="neutral" >Inactive</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="blue">{template.regulator}</Badge>
          <Badge tone="neutral">{template.format.toUpperCase()}</Badge>
          {hasSchedule && (
            <span className="flex items-center gap-1 text-[10px] text-muted">
              <Clock size={10} />
              {template.schedule_cron}
            </span>
          )}
        </div>
      </div>
      <ChevronRight
        size={16}
        className="flex-shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand-blue"
      />
    </Link>
  );
}

export function RegulatorReportsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === 'Doc Admin';

  const [regulator, setRegulator] = useState('All');
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['regulator-reports', 'templates', regulator, activeOnly],
    queryFn: () => {
      const opts: { regulator?: string; active_only?: boolean } = { active_only: activeOnly };
      if (regulator !== 'All') opts.regulator = regulator;
      return fetchTemplates(opts);
    },
  });

  const createMut = useMutation({
    mutationFn: (body: TemplateIn) => createTemplate(body),
    onSuccess: (resp) => {
      toast({ variant: 'success', title: 'Template created', message: `ID #${resp.id}` });
      void qc.invalidateQueries({ queryKey: ['regulator-reports', 'templates'] });
      setEditorOpen(false);
    },
    onError: (err) => {
      toast({ variant: 'error', title: 'Create failed', message: String(err) });
    },
  });

  const templates = (data?.templates ?? []).filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.regulator.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink flex items-center gap-2">
            <FileSpreadsheet size={20} className="text-brand-blue" />
            Regulator Reports
          </h1>
          <p className="mt-1 text-sm text-muted">
            Generate, sign, and submit compliance reports to regulatory bodies.
            Formats: PDF, CSV, JSON-LD (W3C DPV).
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setEditorOpen(true)}>
            <Plus size={15} className="mr-1.5" />
            New template
          </Button>
        )}
      </div>

      {/* Filters */}
      <Panel className="flex flex-wrap items-center gap-3">
        <Filter size={14} className="text-muted flex-shrink-0" />
        {/* Regulator pills */}
        <div className="flex flex-wrap gap-1.5">
          {REGULATORS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegulator(r)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue ${
                regulator === r
                  ? 'border-brand-blue bg-brand-skyLight text-brand-blue'
                  : 'border-border bg-surface text-ink-sub hover:bg-divider'
              }`}
              data-testid={`filter-regulator-${r}`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <Input
            placeholder="Search by name or regulator…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-ink-sub whitespace-nowrap">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="h-4 w-4 rounded border-border text-brand-blue focus:ring-brand-blue"
          />
          Active only
        </label>
      </Panel>

      {/* Template list */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={64} />)}
        </div>
      ) : isError ? (
        <EmptyState
          icon={<FileSpreadsheet size={24} className="text-muted" />}
          title="Could not load templates"
          body="Check the API connection or contact your administrator."
        />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={<FileSpreadsheet size={24} className="text-muted" />}
          title="No templates found"
          body={
            search || regulator !== 'All'
              ? 'Try clearing the filters.'
              : 'Create a template to get started.'
          }
          {...(isAdmin ? { action: { label: 'New template', onClick: () => setEditorOpen(true) } } : {})}
        />
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
          <p className="text-xs text-muted text-right pr-1">
            {templates.length} template{templates.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* Create modal */}
      {isAdmin && (
        <TemplateEditor
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          onSave={async (body) => { await createMut.mutateAsync(body); }}
        />
      )}
    </div>
  );
}
