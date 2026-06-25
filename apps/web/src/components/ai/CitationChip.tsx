/**
 * CitationChip — a clickable chip that navigates to /viewer?doc=<id>.
 * Renders the document title and navigates on click.
 */
import type { CopilotCitation } from "../../api/aiCopilot.js";

interface CitationChipProps {
  citation: CopilotCitation;
}

export function CitationChip({ citation }: CitationChipProps) {
  const href = `/viewer?doc=${encodeURIComponent(citation.doc_id)}`;

  return (
    <a
      href={href}
      data-testid="citation-chip"
      title={citation.snippet}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        background: "rgba(37, 99, 235, 0.10)",
        border: "1px solid rgba(37, 99, 235, 0.25)",
        borderRadius: 12,
        fontSize: 11,
        color: "#2563eb",
        textDecoration: "none",
        cursor: "pointer",
        transition: "background 0.15s",
        fontWeight: 500,
        whiteSpace: "nowrap",
        maxWidth: 200,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
      onClick={(e) => {
        // In SPA context, prevent full navigation and use location if available
        if (typeof window !== "undefined" && window.history) {
          e.preventDefault();
          window.location.href = href;
        }
      }}
    >
      <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0 }}>
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      {citation.title}
    </a>
  );
}
