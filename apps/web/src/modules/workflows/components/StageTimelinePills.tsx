import { cn } from '@/lib/cn';
import { Check } from 'lucide-react';

const STAGES = [
  { key: 'Maker Review',     label: 'Maker' },
  { key: 'Checker',          label: 'Checker' },
  { key: 'Manager Sign-off', label: 'Compliance' },
  { key: 'Approved',         label: 'Approved' },
];

type PillStatus = 'done' | 'active' | 'future' | 'rejected';

function stageStatus(currentStage: string, pillKey: string): PillStatus {
  if (currentStage.startsWith('Rejected')) return 'rejected';
  const currentIdx = STAGES.findIndex((s) => s.key === currentStage);
  const pillIdx    = STAGES.findIndex((s) => s.key === pillKey);
  if (pillIdx < currentIdx)  return 'done';
  if (pillIdx === currentIdx) return 'active';
  return 'future';
}

const pillCls: Record<PillStatus, string> = {
  done:     'bg-success-bg text-success border-success/30',
  active:   'bg-brand-skyLight text-brand-blue border-brand-blue/40 font-semibold',
  future:   'bg-divider text-muted border-border',
  rejected: 'bg-danger-bg text-danger border-danger/30',
};

interface StageTimelinePillsProps {
  stage: string;
  className?: string;
}

export function StageTimelinePills({ stage, className }: StageTimelinePillsProps) {
  const isRejected = stage.startsWith('Rejected');

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {STAGES.map((s, i) => {
        const status = isRejected ? 'future' : stageStatus(stage, s.key);
        const isLast = i === STAGES.length - 1;
        return (
          <div key={s.key} className="flex items-center gap-1">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-badge border px-1.5 py-0.5 text-2xs whitespace-nowrap',
                pillCls[status],
              )}
            >
              {status === 'done' && <Check size={9} />}
              {s.label}
            </span>
            {!isLast && (
              <span className="text-muted text-2xs">&rsaquo;</span>
            )}
          </div>
        );
      })}
      {isRejected && (
        <span className="inline-flex items-center rounded-badge border px-1.5 py-0.5 text-2xs bg-danger-bg text-danger border-danger/30 ml-1">
          {stage}
        </span>
      )}
    </div>
  );
}
