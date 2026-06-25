/**
 * Tooltip — lightweight hover tooltip wrapper for ZorDMS
 *
 * Renders children as-is; on hover shows a small floating label above them.
 * Uses CSS-only positioning (no portal, no third-party lib).
 */
import type { ReactNode, CSSProperties } from "react";

export interface TooltipProps {
  /** Label shown on hover */
  label: string;
  /** The element(s) to wrap — typically an icon button */
  children: ReactNode;
  /** Optional placement override (default: "top") */
  placement?: "top" | "bottom";
}

const wrapStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const tipStyle: CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 6px)",
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(10, 20, 40, 0.92)",
  color: "#e8eaf0",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.02em",
  whiteSpace: "nowrap",
  padding: "3px 8px",
  borderRadius: 4,
  pointerEvents: "none",
  opacity: 0,
  transition: "opacity 0.15s ease",
  zIndex: 9999,
};

const tipStyleBottom: CSSProperties = {
  ...tipStyle,
  bottom: "auto",
  top: "calc(100% + 6px)",
};

/**
 * Hover tooltip wrapper.
 *
 * @example
 * <Tooltip label="Sign out">
 *   <button onClick={logout}><LogOut size={17} /></button>
 * </Tooltip>
 */
export function Tooltip({ label, children, placement = "top" }: TooltipProps) {
  const activeTipStyle = placement === "bottom" ? tipStyleBottom : tipStyle;

  return (
    <span
      style={wrapStyle}
      className="zor-tooltip-wrap"
      data-tip={label}
      aria-label={label}
    >
      {children}
      {/* The bubble — shown via CSS :hover on the wrapper */}
      <span
        className="zor-tooltip-bubble"
        role="tooltip"
        style={activeTipStyle}
        aria-hidden="true"
      >
        {label}
      </span>

      {/* Inject scoped style once — idempotent if multiple Tooltips render */}
      <style>{`
        .zor-tooltip-wrap:hover .zor-tooltip-bubble {
          opacity: 1 !important;
        }
      `}</style>
    </span>
  );
}
