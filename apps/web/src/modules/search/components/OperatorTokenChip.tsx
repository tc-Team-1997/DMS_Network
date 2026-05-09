import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface TokenChip {
  key: string;
  value: string;
  display: string;
}

export interface OperatorTokenChipProps {
  chip: TokenChip;
  onRemove: (chip: TokenChip) => void;
}

export function OperatorTokenChip({ chip, onRemove }: OperatorTokenChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-badge px-2 py-0.5',
        'bg-brand-skyLight text-brand-blue text-xs font-medium',
        'border border-brand-sky/30',
      )}
    >
      <span className="text-brand-navy/60 text-[10px] font-semibold uppercase">
        {chip.key}:
      </span>
      <span>{chip.value}</span>
      <button
        type="button"
        aria-label={`Remove ${chip.key}:${chip.value} filter`}
        onClick={() => onRemove(chip)}
        className="ml-0.5 rounded-full p-0.5 hover:bg-brand-sky/20 focus:outline-none focus:ring-1 focus:ring-brand-blue"
      >
        <X size={10} />
      </button>
    </span>
  );
}
