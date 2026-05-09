/**
 * ExportMenu — JSON / CSV / PDF export trigger for the Audit Log page.
 *
 * Export is a Doc Admin-only action (requireNamespacePermJson 'write' on backend).
 * The button opens a small popover to choose format, then triggers a browser
 * download via window.open (GET request, browser handles Content-Disposition).
 * Export events are self-logged server-side as action='audit_export'.
 */

import { useState } from 'react';
import { Download, FileJson, FileText, FileImage } from 'lucide-react';
import { buildExportUrl, type ExportFormat } from '../api';
import type { AuditFilters } from '../schemas';
import { cn } from '@/lib/cn';

interface Props {
  filters: Omit<AuditFilters, 'page' | 'per_page'>;
}

const FORMATS: { value: ExportFormat; label: string; Icon: typeof FileJson }[] = [
  { value: 'json', label: 'Export JSON', Icon: FileJson },
  { value: 'csv',  label: 'Export CSV',  Icon: FileText },
  { value: 'pdf',  label: 'Export PDF',  Icon: FileImage },
];

export function ExportMenu({ filters }: Props) {
  const [open, setOpen] = useState(false);

  const handleExport = (format: ExportFormat) => {
    const url = buildExportUrl(format, filters);
    window.open(url, '_blank', 'noopener');
    setOpen(false);
  };

  return (
    <div className="relative" data-testid="export-menu">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-input border border-border bg-surface',
          'px-3 py-1.5 text-xs font-medium text-ink hover:bg-divider transition',
        )}
      >
        <Download size={13} />
        Export
      </button>

      {open && (
        <>
          {/* Dismiss scrim */}
          <div
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />

          {/* Popover */}
          <div className="absolute right-0 top-full mt-1 z-20 min-w-[160px] rounded-card border border-border bg-surface shadow-card">
            {FORMATS.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleExport(value)}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ink hover:bg-divider transition first:rounded-t-card last:rounded-b-card"
              >
                <Icon size={13} className="text-muted" />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
