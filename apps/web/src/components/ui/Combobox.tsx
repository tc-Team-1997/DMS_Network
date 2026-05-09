import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/lib/cn';
import { ChevronDown, Check } from 'lucide-react';

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  /** Controlled selected value. */
  value?: string;
  /** Uncontrolled default selected value. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Static list of options. Used when `loadOptions` is not provided. */
  options?: ComboboxOption[];
  /**
   * Async option loader. Called with the current query after a 200ms debounce.
   * If a newer query arrives before the promise resolves, its result is discarded.
   */
  loadOptions?: (query: string) => Promise<ComboboxOption[]>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export function Combobox({
  value: controlledValue,
  defaultValue = '',
  onChange,
  options: staticOptions = [],
  loadOptions,
  placeholder = 'Search…',
  disabled = false,
  className,
  label,
}: ComboboxProps) {
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState<string>(defaultValue);
  const selectedValue = isControlled ? controlledValue : internalValue;

  const [query, setQuery] = useState<string>('');
  const [open, setOpen] = useState<boolean>(false);
  const [options, setOptions] = useState<ComboboxOption[]>(staticOptions);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const inputId = useId();
  const listId = useId();
  const labelId = useId();

  // Keep static options in sync when prop changes.
  useEffect(() => {
    if (loadOptions === undefined) {
      setOptions(staticOptions);
    }
  }, [staticOptions, loadOptions]);

  // Debounced async loading with generation counter to cancel stale results.
  useEffect(() => {
    if (loadOptions === undefined) return;
    let generation = 0; // local counter

    // Capture current generation before async work.
    const current = ++generation;

    setLoading(true);

    const timer = setTimeout(() => {
      loadOptions(query)
        .then((result) => {
          // Discard if a newer generation has started.
          if (current !== generation) return;
          setOptions(result);
          setLoading(false);
        })
        .catch(() => {
          if (current !== generation) return;
          setOptions([]);
          setLoading(false);
        });
    }, 200);

    return () => {
      // Cancel the timer AND invalidate in-flight promise by incrementing generation.
      clearTimeout(timer);
      generation++;
    };
  }, [query, loadOptions]);

  function selectOption(opt: ComboboxOption) {
    if (opt.disabled === true) return;
    if (!isControlled) setInternalValue(opt.value);
    onChange?.(opt.value);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setOpen(true);
    setActiveIdx(-1);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (!open) return;

    const enabledOpts = options.filter((o) => o.disabled !== true);
    const count = enabledOpts.length;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, count - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIdx(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIdx(count - 1);
        break;
      case 'Enter': {
        e.preventDefault();
        const active = enabledOpts[activeIdx];
        if (active !== undefined) selectOption(active);
        break;
      }
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setQuery('');
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  // Scroll active option into view.
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const item = listRef.current.children[activeIdx];
    if (item instanceof HTMLElement) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  // Click outside closes.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const selectedLabel = options.find((o) => o.value === selectedValue)?.label ?? '';
  const displayValue = open ? query : selectedLabel;

  const enabledOptions = options.filter((o) => o.disabled !== true);

  const activeDescendant =
    activeIdx >= 0 && activeIdx < enabledOptions.length
      ? `${listId}-opt-${activeIdx}`
      : undefined;

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      {label !== undefined && (
        <label id={labelId} htmlFor={inputId} className="label">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activeDescendant}
          aria-labelledby={label !== undefined ? labelId : undefined}
          value={displayValue}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className={cn(
            'input pr-9',
            disabled && 'cursor-not-allowed opacity-50',
          )}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
        />
        <ChevronDown
          size={14}
          className={cn(
            'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </div>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className={cn(
            'absolute z-30 mt-1 w-full overflow-auto rounded-card border border-divider bg-surface py-1 shadow-card',
            'max-h-60',
          )}
        >
          {loading && (
            <li className="px-3 py-2 text-xs text-muted" role="presentation">
              Loading…
            </li>
          )}
          {!loading && options.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted" role="presentation">
              No options
            </li>
          )}
          {!loading &&
            options.map((opt, i) => {
              const isSelected = opt.value === selectedValue;
              const enabledIdx = enabledOptions.indexOf(opt);
              const isActive = enabledIdx === activeIdx;
              return (
                <li
                  key={opt.value}
                  id={`${listId}-opt-${enabledIdx}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled === true}
                  onPointerDown={(e) => {
                    e.preventDefault(); // prevent input blur
                    selectOption(opt);
                  }}
                  className={cn(
                    'flex cursor-pointer items-center justify-between px-3 py-2 text-sm',
                    isActive && 'bg-brand-skyLight text-brand-blue',
                    !isActive && 'text-ink hover:bg-divider',
                    opt.disabled === true && 'cursor-not-allowed opacity-40',
                    // Keep alignment consistent for options beyond enabled list
                    i === 0 && 'rounded-t-input',
                  )}
                >
                  <span>{opt.label}</span>
                  {isSelected && <Check size={13} className="text-brand-blue" />}
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
