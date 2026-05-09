import {
  cloneElement,
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

export type PopoverPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface PopoverProps {
  /** The element that toggles the popover. Must forward refs. */
  trigger: ReactElement<React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> }>;
  /** Popover body content. */
  children: ReactNode;
  /** Preferred placement relative to the trigger. Defaults to 'bottom'. */
  placement?: PopoverPlacement;
  className?: string;
  /** Controlled open state. If omitted, Popover manages open state internally. */
  open?: boolean;
  /** Called when the popover requests to close. Required when `open` is provided. */
  onClose?: () => void;
}

function getCoords(
  trigger: DOMRect,
  popover: DOMRect,
  placement: PopoverPlacement,
  scrollX: number,
  scrollY: number,
): { top: number; left: number } {
  const gap = 8;
  switch (placement) {
    case 'top':
      return {
        top: trigger.top + scrollY - popover.height - gap,
        left: trigger.left + scrollX + trigger.width / 2 - popover.width / 2,
      };
    case 'bottom':
      return {
        top: trigger.bottom + scrollY + gap,
        left: trigger.left + scrollX + trigger.width / 2 - popover.width / 2,
      };
    case 'left':
      return {
        top: trigger.top + scrollY + trigger.height / 2 - popover.height / 2,
        left: trigger.left + scrollX - popover.width - gap,
      };
    case 'right':
      return {
        top: trigger.top + scrollY + trigger.height / 2 - popover.height / 2,
        left: trigger.right + scrollX + gap,
      };
  }
}

export function Popover({
  trigger,
  children,
  placement = 'bottom',
  className,
  open: controlledOpen,
  onClose,
}: PopoverProps) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;

  const triggerRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const close = useCallback(() => {
    if (isControlled) {
      onClose?.();
    } else {
      setInternalOpen(false);
    }
    // Return focus to trigger
    triggerRef.current?.focus();
  }, [isControlled, onClose]);

  function toggle() {
    if (isControlled) {
      if (open) onClose?.();
    } else {
      setInternalOpen((v) => !v);
    }
  }

  // Position after paint
  useEffect(() => {
    if (!open || !triggerRef.current || !popoverRef.current) return;
    const trigRect = triggerRef.current.getBoundingClientRect();
    const popRect = popoverRef.current.getBoundingClientRect();
    setCoords(getCoords(trigRect, popRect, placement, window.scrollX, window.scrollY));
  }, [open, placement]);

  // Escape + click-outside
  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    function onPointerDown(e: PointerEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  // Move focus into popover when it opens
  useEffect(() => {
    if (!open || !popoverRef.current) return;
    const firstFocusable = popoverRef.current.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();
  }, [open]);

  const triggerEl = cloneElement(trigger, {
    ref: triggerRef,
    onClick: toggle,
    'aria-expanded': open,
    'aria-haspopup': 'dialog',
  } as React.HTMLAttributes<HTMLElement> & { ref: React.Ref<HTMLElement> });

  return (
    <>
      {triggerEl}
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-modal="false"
            className={cn(
              'fixed z-40 min-w-[220px] rounded-card border border-divider bg-surface shadow-card',
              'animate-in fade-in-0 zoom-in-95 duration-150',
              className,
            )}
            style={{ top: coords.top, left: coords.left }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
