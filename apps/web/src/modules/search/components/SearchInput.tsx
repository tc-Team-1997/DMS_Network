/**
 * SearchInput — big search box with operator-token chip autocomplete.
 *
 * Operator tokens are detected as the user types patterns like
 * `type:passport`, `branch:thimphu`, `expiry:<30d`, `customer:<cid>`.
 * When detected, the token is extracted into a chip and the text field
 * is cleared of that segment.
 *
 * Chips render inline (left of the text cursor) so the box feels like
 * a modern tag-input.
 */

import {
  useRef,
  useState,
  useEffect,
  type ChangeEvent,
  type KeyboardEvent,
  type FormEvent,
} from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { OperatorTokenChip, type TokenChip } from './OperatorTokenChip';
import type { SearchFilters } from '../schemas';

// Map of operator key → filter field.
const OPERATOR_MAP: Record<string, keyof SearchFilters> = {
  type:     'doc_type',
  branch:   'branch',
  customer: 'customer_cid',
};

// Regex to detect a completed operator token at the end of the input.
// Matches `key:value` where value is a non-whitespace sequence.
const TOKEN_RE = /\b(type|branch|customer):(\S+)$/i;

export interface SearchInputProps {
  filters: SearchFilters;
  onFiltersChange: (next: Partial<SearchFilters>) => void;
  onSubmit: (q: string) => void;
  placeholder?: string;
}

export function SearchInput({
  filters,
  onFiltersChange,
  onSubmit,
  placeholder = 'Search documents…  try type:passport or branch:thimphu',
}: SearchInputProps) {
  const [inputValue, setInputValue] = useState(filters.q);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync if external q changes (e.g. URL navigation).
  useEffect(() => { setInputValue(filters.q); }, [filters.q]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setInputValue(val);

    // Check if the last word is a completed operator token.
    const match = TOKEN_RE.exec(val);
    if (match) {
      const opKey  = match[1]!.toLowerCase();
      const opVal  = match[2]!;
      const field  = OPERATOR_MAP[opKey];
      if (field) {
        // Remove the token text from the input.
        const stripped = val.slice(0, match.index).trimEnd();
        setInputValue(stripped);

        // Merge into the corresponding array filter.
        const existing = (filters[field] as string[] | undefined) ?? [];
        if (!existing.includes(opVal)) {
          onFiltersChange({ [field]: [...existing, opVal] });
        }
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Backspace on empty input removes the last chip.
    if (e.key === 'Backspace' && inputValue === '') {
      // Remove the last applied filter from the first non-empty array.
      for (const field of ['doc_type', 'branch', 'risk_band', 'status'] as const) {
        const arr = filters[field];
        if (arr.length > 0) {
          onFiltersChange({ [field]: arr.slice(0, -1) });
          break;
        }
      }
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(inputValue.trim());
  }

  // Build chip list from current array filters.
  const chips: TokenChip[] = [
    ...filters.doc_type.map((v) => ({ key: 'type', value: v, display: `type:${v}` })),
    ...filters.branch.map((v)    => ({ key: 'branch', value: v, display: `branch:${v}` })),
    ...filters.risk_band.map((v) => ({ key: 'risk_band', value: v, display: `risk:${v}` })),
    ...filters.status.map((v)    => ({ key: 'status', value: v, display: `status:${v}` })),
  ];

  function removeChip(chip: TokenChip) {
    const field = chip.key === 'type'      ? 'doc_type'
                : chip.key === 'branch'    ? 'branch'
                : chip.key === 'risk_band' ? 'risk_band'
                : chip.key === 'status'    ? 'status'
                : null;
    if (!field) return;
    const arr = filters[field];
    onFiltersChange({ [field]: arr.filter((v) => v !== chip.value) });
  }

  return (
    <form onSubmit={handleSubmit} role="search" aria-label="Document search">
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 rounded-input border border-border bg-surface',
          'px-3 py-2 shadow-card transition-shadow',
          'focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/20',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <SearchIcon size={16} className="text-muted flex-shrink-0" />

        {chips.map((chip) => (
          <OperatorTokenChip key={chip.display} chip={chip} onRemove={removeChip} />
        ))}

        <input
          ref={inputRef}
          type="search"
          aria-label="Search query"
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={chips.length === 0 ? placeholder : 'Add more terms…'}
          className={cn(
            'flex-1 min-w-[140px] bg-transparent text-base text-ink',
            'placeholder:text-muted outline-none border-none ring-0 shadow-none',
            'focus:outline-none focus:ring-0',
          )}
        />

        <button
          type="submit"
          className={cn(
            'flex-shrink-0 rounded-input bg-brand-blue px-4 py-1.5 text-sm font-medium text-white',
            'hover:bg-brand-blueHover transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1',
          )}
        >
          Search
        </button>
      </div>
    </form>
  );
}
