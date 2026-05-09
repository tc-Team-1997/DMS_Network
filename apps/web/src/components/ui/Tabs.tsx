import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

// ─── Context ──────────────────────────────────────────────────────────────────

interface TabsCtx {
  activeValue: string;
  setActive: (value: string) => void;
  baseId: string;
}

const Context = createContext<TabsCtx | null>(null);

function useTabsCtx(): TabsCtx {
  const ctx = useContext(Context);
  if (ctx === null) throw new Error('<Tab> and <TabPanel> must be used inside <Tabs>');
  return ctx;
}

// ─── Tabs root ────────────────────────────────────────────────────────────────

export interface TabsProps {
  /** Controlled: which tab is active. */
  value?: string;
  /** Uncontrolled default. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, defaultValue = '', onChange, children, className }: TabsProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string>(defaultValue);
  const activeValue = isControlled ? value : internal;
  const baseId = useId();

  const setActive = useCallback(
    (next: string) => {
      if (!isControlled) setInternal(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );

  return (
    <Context.Provider value={{ activeValue, setActive, baseId }}>
      <div className={className}>{children}</div>
    </Context.Provider>
  );
}

// ─── TabList ─────────────────────────────────────────────────────────────────

export interface TabListProps {
  children: ReactNode;
  className?: string;
}

export function TabList({ children, className }: TabListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? [],
    );
    const current = document.activeElement;
    const idx = tabs.findIndex((t) => t === current);
    if (idx === -1) return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      tabs[(idx + 1) % tabs.length]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      tabs[(idx - 1 + tabs.length) % tabs.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      tabs[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      tabs[tabs.length - 1]?.focus();
    }
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn('flex border-b border-divider', className)}
    >
      {children}
    </div>
  );
}

// ─── Tab ─────────────────────────────────────────────────────────────────────

export interface TabProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Tab({ value, children, disabled = false, className }: TabProps) {
  const { activeValue, setActive, baseId } = useTabsCtx();
  const isActive = activeValue === value;
  const panelId = `${baseId}-panel-${value}`;
  const tabId = `${baseId}-tab-${value}`;

  return (
    <button
      type="button"
      id={tabId}
      role="tab"
      aria-selected={isActive}
      aria-controls={panelId}
      // Roving tabindex: only the active tab is in the natural tab order.
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      onClick={() => setActive(value)}
      className={cn(
        'inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-1',
        isActive
          ? 'border-brand-blue text-brand-blue'
          : 'border-transparent text-ink-sub hover:text-ink hover:border-borderMed',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ─── TabPanel ────────────────────────────────────────────────────────────────

export interface TabPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ value, children, className }: TabPanelProps) {
  const { activeValue, baseId } = useTabsCtx();
  const panelId = `${baseId}-panel-${value}`;
  const tabId = `${baseId}-tab-${value}`;

  if (activeValue !== value) return null;

  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={tabId}
      tabIndex={0}
      className={cn('focus:outline-none', className)}
    >
      {children}
    </div>
  );
}
