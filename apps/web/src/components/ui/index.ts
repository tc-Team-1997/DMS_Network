// ── Existing primitives ───────────────────────────────────────────────────────
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { Input } from './Input';
export { Badge, statusTone } from './Badge';
export type { BadgeTone } from './Badge';
export { Panel } from './Panel';
export { MetricCard } from './MetricCard';
export { DataTable } from './DataTable';
export type {
  Column,
  DataTableProps,
  SortState,
  SelectionState,
  PaginationState,
  ColumnVisibilityState,
} from './DataTable';

// ── CC4 primitives ────────────────────────────────────────────────────────────
export { Modal } from './Modal';
export type { ModalProps, ModalSize } from './Modal';

export { ToastProvider, useToast } from './Toast';
export type { ToastItem, ToastVariant } from './Toast';

export { Tabs, TabList, Tab, TabPanel } from './Tabs';
export type { TabsProps, TabListProps, TabProps, TabPanelProps } from './Tabs';

export { Combobox } from './Combobox';
export type { ComboboxProps, ComboboxOption } from './Combobox';

export { Drawer } from './Drawer';
export type { DrawerProps, DrawerSide } from './Drawer';

export { Tooltip } from './Tooltip';
export type { TooltipProps, TooltipPlacement } from './Tooltip';

export { Popover } from './Popover';
export type { PopoverProps, PopoverPlacement } from './Popover';

export { Stepper } from './Stepper';
export type { StepperProps, Step, StepStatus } from './Stepper';

export { Skeleton } from './Skeleton';
export type { SkeletonProps } from './Skeleton';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { AiConfidenceBadge } from './AiConfidenceBadge';
export type { AiConfidenceBadgeProps, SourceSpan } from './AiConfidenceBadge';
