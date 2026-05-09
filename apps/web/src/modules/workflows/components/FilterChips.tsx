import { Combobox, type ComboboxOption } from '@/components/ui';
import { Search } from 'lucide-react';
import type { WorkflowFilters } from '../api';

interface FilterChipsProps {
  filters: WorkflowFilters;
  onChange: (patch: Partial<WorkflowFilters>) => void;
  branchOptions:  ComboboxOption[];
  docTypeOptions: ComboboxOption[];
  riskBandOptions: ComboboxOption[];
}

export function FilterChips({
  filters,
  onChange,
  branchOptions,
  docTypeOptions,
  riskBandOptions,
}: FilterChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative min-w-[200px]">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          type="text"
          placeholder="Search ref, title, customer…"
          value={filters.search ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            const patch: Partial<WorkflowFilters> = { page: 1 };
            if (v) patch.search = v;
            onChange(patch);
          }}
          className="input pl-8 h-8 text-sm w-full"
          aria-label="Search workflows"
        />
      </div>

      {/* Branch */}
      <div className="w-[160px]">
        <Combobox
          placeholder="Branch"
          options={[{ value: '', label: 'All branches' }, ...branchOptions]}
          value={filters.branch ?? ''}
          onChange={(v) => {
            const patch: Partial<WorkflowFilters> = { page: 1 };
            if (v) patch.branch = v;
            onChange(patch);
          }}
        />
      </div>

      {/* Doc type */}
      <div className="w-[160px]">
        <Combobox
          placeholder="Doc type"
          options={[{ value: '', label: 'All types' }, ...docTypeOptions]}
          value={filters.doc_type ?? ''}
          onChange={(v) => {
            const patch: Partial<WorkflowFilters> = { page: 1 };
            if (v) patch.doc_type = v;
            onChange(patch);
          }}
        />
      </div>

      {/* Risk band */}
      <div className="w-[140px]">
        <Combobox
          placeholder="Risk band"
          options={[
            { value: '',        label: 'All risks' },
            ...riskBandOptions,
          ]}
          value={filters.risk_band ?? ''}
          onChange={(v) => {
            const patch: Partial<WorkflowFilters> = { page: 1 };
            if (v) patch.risk_band = v;
            onChange(patch);
          }}
        />
      </div>

      {/* Clear button */}
      {(filters.search || filters.branch || filters.doc_type || filters.risk_band) && (
        <button
          type="button"
          onClick={() => onChange({ page: 1 })}
          className="text-xs text-muted hover:text-ink underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
