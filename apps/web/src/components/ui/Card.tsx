import type { ReactNode, CSSProperties } from "react";

export interface CardProps {
  title?:     ReactNode;
  action?:    ReactNode;
  children:   ReactNode;
  className?: string;
  style?:     CSSProperties;
}

export function Card({ title, action, children, className = "", style }: CardProps) {
  return (
    <div className={`card ${className}`} style={style}>
      {(title || action) && (
        <div className="card-hd">
          <span>{title}</span>
          {action && <span>{action}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
