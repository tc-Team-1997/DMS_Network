/**
 * TemplateEditor — modal form for creating or editing a report template.
 * Supports: regulator, name, format, is_active, schedule_cron,
 * parameters_schema_json (JSON textarea), query_template (SQL textarea).
 */
import { useState, type FormEvent } from 'react';
import { Modal, Button, Input, useToast } from '@/components/ui';
import type { Template, TemplateIn, ReportFormat } from '../schemas';

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (body: TemplateIn) => Promise<void>;
  initial?: Template;
}

const FORMATS: ReportFormat[] = ['pdf', 'csv', 'jsonld'];
const FORMAT_LABELS: Record<ReportFormat, string> = {
  pdf:    'PDF',
  csv:    'CSV',
  jsonld: 'JSON-LD',
};

export function TemplateEditor({ open, onClose, onSave, initial }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [regulator, setRegulator]   = useState(initial?.regulator ?? '');
  const [name, setName]             = useState(initial?.name ?? '');
  const [format, setFormat]         = useState<ReportFormat>(initial?.format ?? 'pdf');
  const [isActive, setIsActive]     = useState(initial?.is_active ?? true);
  const [cron, setCron]             = useState(initial?.schedule_cron ?? '');
  const [paramsSchema, setParamsSchema] = useState(
    initial?.parameters_schema_json ?? '{\n  "$schema": "http://json-schema.org/draft-07/schema#",\n  "type": "object",\n  "properties": {}\n}',
  );
  const [queryTemplate, setQueryTemplate] = useState(initial?.query_template ?? '');

  function validateParamsSchema(): boolean {
    try {
      JSON.parse(paramsSchema);
      return true;
    } catch {
      return false;
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!regulator.trim() || !name.trim()) {
      toast({ variant: 'error', title: 'Regulator and name are required.' });
      return;
    }
    if (!validateParamsSchema()) {
      toast({ variant: 'error', title: 'Parameters schema is not valid JSON.' });
      return;
    }
    setSaving(true);
    try {
      await onSave({
        regulator: regulator.trim(),
        name: name.trim(),
        format,
        is_active: isActive,
        schedule_cron: cron.trim() || null,
        parameters_schema_json: paramsSchema,
        query_template: queryTemplate,
      });
      onClose();
    } catch (err) {
      toast({ variant: 'error', title: 'Save failed', message: String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit template' : 'New template'} size="lg">
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-sub mb-1" htmlFor="te-regulator">
              Regulator <span className="text-danger">*</span>
            </label>
            <Input
              id="te-regulator"
              value={regulator}
              onChange={(e) => setRegulator(e.target.value)}
              placeholder="e.g. RMA, CBE, GDPR"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-sub mb-1" htmlFor="te-name">
              Template name <span className="text-danger">*</span>
            </label>
            <Input
              id="te-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. RMA Quarterly Compliance Report"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-sub mb-1">Format</label>
            <div className="flex gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={`rounded-input border px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue ${
                    format === f
                      ? 'border-brand-blue bg-brand-skyLight text-brand-blue'
                      : 'border-border bg-surface text-ink-sub hover:bg-divider'
                  }`}
                >
                  {FORMAT_LABELS[f]}
                </button>
              ))}
            </div>
            {format === 'csv' && (
              <p className="mt-1 text-[10px] text-muted italic">
                XLSX not available — SheetJS absent from package.json. Using CSV.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-sub mb-1" htmlFor="te-cron">
              Schedule (cron)
            </label>
            <Input
              id="te-cron"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 6 1 * * (leave blank for manual)"
              className="font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="te-active"
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-border text-brand-blue focus:ring-brand-blue"
          />
          <label htmlFor="te-active" className="text-sm text-ink">Active</label>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-sub mb-1">
            Parameters schema (JSON Schema draft-07)
          </label>
          <textarea
            value={paramsSchema}
            onChange={(e) => setParamsSchema(e.target.value)}
            rows={6}
            className="block w-full rounded-input border border-border bg-surface px-3 py-2 font-mono text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-sub mb-1">
            SQL query template
          </label>
          <textarea
            value={queryTemplate}
            onChange={(e) => setQueryTemplate(e.target.value)}
            rows={5}
            placeholder="SELECT ... FROM documents WHERE tenant_id = :tenant_id ..."
            className="block w-full rounded-input border border-border bg-surface px-3 py-2 font-mono text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
          />
          <p className="mt-0.5 text-[10px] text-muted">
            Available named params: :tenant_id, :as_of_date, plus any fields defined in the schema above.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-divider">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Update' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
