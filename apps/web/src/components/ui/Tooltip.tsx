/**
 * Tooltip — collision-aware hover/focus tooltip for ZorDMS.
 *
 * Enterprise-grade behaviour:
 *  - Rendered in a portal on <body> so it is NEVER clipped by an ancestor's
 *    overflow:hidden / stacking context (e.g. the topbar or sidebar).
 *  - Measured on open, then AUTO-POSITIONED: it tries the preferred side and
 *    flips to the first side (top/bottom/right/left) that fits the viewport,
 *    then clamps within the viewport so it can never run off-screen.
 *  - Opens on hover AND keyboard focus; closes on leave/blur, on Escape, and
 *    repositions on scroll/resize.
 *  - The bubble is role="tooltip"; the wrapped control keeps its own
 *    accessible name (aria-label).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Side = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** Label shown on hover/focus. */
  label: string;
  /** The element(s) to wrap — typically an icon button. */
  children: ReactNode;
  /** Preferred side; the tooltip auto-flips if it doesn't fit. Default "top". */
  placement?: Side;
  /** Hover-intent delay before showing (ms). Default 120. */
  delay?: number;
}

const GAP = 8; // distance between trigger and bubble
const MARGIN = 8; // min distance from the viewport edge

/** Order in which sides are tried for each preferred side. */
const FLIP_ORDER: Record<Side, Side[]> = {
  top: ["top", "bottom", "right", "left"],
  bottom: ["bottom", "top", "right", "left"],
  left: ["left", "right", "top", "bottom"],
  right: ["right", "left", "top", "bottom"],
};

function computePosition(
  trigger: DOMRect,
  tip: { width: number; height: number },
  prefer: Side,
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const fits = (s: Side): boolean => {
    if (s === "top") return trigger.top - GAP - tip.height >= MARGIN;
    if (s === "bottom") return trigger.bottom + GAP + tip.height <= vh - MARGIN;
    if (s === "left") return trigger.left - GAP - tip.width >= MARGIN;
    return trigger.right + GAP + tip.width <= vw - MARGIN; // right
  };

  const side = FLIP_ORDER[prefer].find(fits) ?? prefer;

  let top = 0;
  let left = 0;
  if (side === "top") {
    top = trigger.top - GAP - tip.height;
    left = trigger.left + trigger.width / 2 - tip.width / 2;
  } else if (side === "bottom") {
    top = trigger.bottom + GAP;
    left = trigger.left + trigger.width / 2 - tip.width / 2;
  } else if (side === "left") {
    left = trigger.left - GAP - tip.width;
    top = trigger.top + trigger.height / 2 - tip.height / 2;
  } else {
    left = trigger.right + GAP;
    top = trigger.top + trigger.height / 2 - tip.height / 2;
  }

  // Clamp inside the viewport so it can never run off-screen.
  left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - MARGIN - tip.width));
  top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - MARGIN - tip.height));
  return { top, left };
}

const wrapStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const bubbleStyle: CSSProperties = {
  position: "fixed",
  zIndex: 99999,
  background: "rgba(10, 20, 40, 0.94)",
  color: "#e8eaf0",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.02em",
  whiteSpace: "nowrap",
  padding: "4px 9px",
  borderRadius: 5,
  boxShadow: "0 6px 18px rgba(0,0,0,.28)",
  pointerEvents: "none",
  transition: "opacity .12s ease",
};

export function Tooltip({ label, children, placement = "top", delay = 120 }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
    setCoords(null);
  }, []);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [delay]);

  // Clean up any pending timer on unmount.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Position once open (measure the rendered bubble), keep it in place on
  // scroll/resize, and dismiss on Escape.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      const b = tipRef.current?.getBoundingClientRect();
      if (!t || !b) return;
      setCoords(computePosition(t, { width: b.width, height: b.height }, placement));
    };
    place();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, placement, hide]);

  return (
    <>
      <span
        ref={triggerRef}
        style={wrapStyle}
        className="zor-tooltip-wrap"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="zor-tooltip-bubble"
            style={{
              ...bubbleStyle,
              // Render off-screen for the first measuring pass, then snap in.
              top: coords ? coords.top : -9999,
              left: coords ? coords.left : -9999,
              opacity: coords ? 1 : 0,
            }}
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
