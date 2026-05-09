import {
  cloneElement,
  useRef,
  useState,
  useEffect,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  /** Tooltip text or node. */
  content: ReactNode;
  /** The element that triggers the tooltip. Must accept ref + aria props. */
  children: ReactElement<React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> }>;
  /** Preferred placement. Defaults to 'top'. */
  placement?: TooltipPlacement;
  /** Delay before the tooltip appears (ms). Defaults to 300. */
  delay?: number;
}

function getPosition(
  trigger: DOMRect,
  tooltip: DOMRect,
  placement: TooltipPlacement,
  scrollX: number,
  scrollY: number,
): { top: number; left: number } {
  const gap = 8;
  switch (placement) {
    case 'top':
      return {
        top: trigger.top + scrollY - tooltip.height - gap,
        left: trigger.left + scrollX + trigger.width / 2 - tooltip.width / 2,
      };
    case 'bottom':
      return {
        top: trigger.bottom + scrollY + gap,
        left: trigger.left + scrollX + trigger.width / 2 - tooltip.width / 2,
      };
    case 'left':
      return {
        top: trigger.top + scrollY + trigger.height / 2 - tooltip.height / 2,
        left: trigger.left + scrollX - tooltip.width - gap,
      };
    case 'right':
      return {
        top: trigger.top + scrollY + trigger.height / 2 - tooltip.height / 2,
        left: trigger.right + scrollX + gap,
      };
  }
}

export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 300,
}: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  function show() {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }

  function hide() {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setVisible(false);
  }

  // Position after paint
  useEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;
    const trigRect = triggerRef.current.getBoundingClientRect();
    const tipRect = tooltipRef.current.getBoundingClientRect();
    setCoords(getPosition(trigRect, tipRect, placement, window.scrollX, window.scrollY));
  }, [visible, placement]);

  // Escape closes
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible]);

  // Clean up timer on unmount
  useEffect(() => () => { if (timerRef.current !== null) clearTimeout(timerRef.current); }, []);

  const trigger = cloneElement(children, {
    ref: triggerRef,
    'aria-describedby': visible ? id : undefined,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  } as React.HTMLAttributes<HTMLElement> & { ref: React.Ref<HTMLElement> });

  return (
    <>
      {trigger}
      {visible &&
        createPortal(
          <div
            id={id}
            ref={tooltipRef}
            role="tooltip"
            className={cn(
              'pointer-events-none fixed z-50 max-w-xs rounded-input bg-ink px-2.5 py-1.5 text-xs text-white shadow-card',
              'transition-opacity duration-150',
            )}
            style={{ top: coords.top, left: coords.left }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
