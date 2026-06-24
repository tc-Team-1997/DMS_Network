/**
 * WorkflowBuilder — visual step-chain representation.
 * Renders an ordered chain of workflow steps with their
 * required permissions, confidence gate, and status.
 */
import type { WorkflowStepRow } from "../../api/workflowEngine.js";

function parsePermissions(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function stepColor(status: string): string {
  switch (status) {
    case "Approved": return "var(--G)";
    case "Rejected": return "var(--R)";
    case "Pending":  return "var(--gold2)";
    default:         return "var(--sil)";
  }
}

function stepBorderColor(status: string): string {
  switch (status) {
    case "Approved": return "rgba(46,204,138,.5)";
    case "Rejected": return "rgba(224,82,82,.5)";
    case "Pending":  return "rgba(184,145,42,.5)";
    default:         return "var(--bd)";
  }
}

function StepIcon({ status }: { status: string }) {
  if (status === "Approved") {
    return (
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        background: "rgba(46,204,138,.12)",
        border: "2px solid rgba(46,204,138,.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, color: "var(--G)",
      }}>✓</div>
    );
  }
  if (status === "Rejected") {
    return (
      <div style={{
        width: 32, height: 32, borderRadius: "50%",
        background: "rgba(224,82,82,.12)",
        border: "2px solid rgba(224,82,82,.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, color: "var(--R)",
      }}>✗</div>
    );
  }
  return (
    <div style={{
      width: 32, height: 32, borderRadius: "50%",
      background: "rgba(184,145,42,.1)",
      border: "2px solid rgba(184,145,42,.3)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, color: "var(--gold2)", fontWeight: 700,
    }}>●</div>
  );
}

export interface WorkflowBuilderProps {
  steps: WorkflowStepRow[];
  /** Optional compact mode for embedding inside case cards */
  compact?: boolean;
}

export function WorkflowBuilder({ steps, compact = false }: WorkflowBuilderProps) {
  if (!steps || steps.length === 0) {
    return (
      <div style={{ color: "var(--sil)", fontSize: 12, padding: "8px 0" }}>
        No steps defined for this workflow.
      </div>
    );
  }

  if (compact) {
    // Compact "flow" view matching the HTML prototype's .fn / .fc / .fcd / .fcp pattern
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap", padding: "6px 0" }}>
        {steps.map((s, i) => (
          <div key={s.seq} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: s.status === "Approved"
                  ? "rgba(46,204,138,.15)"
                  : s.status === "Rejected"
                  ? "rgba(224,82,82,.15)"
                  : s.status === "Pending"
                  ? "rgba(184,145,42,.1)"
                  : "rgba(255,255,255,.05)",
                border: `2px solid ${stepBorderColor(s.status)}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: stepColor(s.status),
              }}>
                {s.status === "Approved" ? "✓" : s.status === "Rejected" ? "✗" : s.seq}
              </div>
              <div style={{ fontSize: 9, color: "var(--sil)", textAlign: "center", maxWidth: 52, lineHeight: 1.2 }}>
                {s.name}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                width: 24, height: 2,
                background: s.status === "Approved" ? "rgba(46,204,138,.4)" : "rgba(255,255,255,.08)",
                margin: "0 2px", marginBottom: 18,
              }} />
            )}
          </div>
        ))}
      </div>
    );
  }

  // Full visual builder view for the WorkflowEngine screen
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 600, padding: "8px 0" }}>
        {steps.map((s, i) => (
          <div key={s.seq} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{
              border: `1px solid ${stepBorderColor(s.status)}`,
              borderLeft: `3px solid ${stepColor(s.status)}`,
              borderRadius: 8,
              padding: "12px 14px",
              minWidth: 160,
              background: "rgba(255,255,255,.02)",
              display: "flex", flexDirection: "column", gap: 6,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StepIcon status={s.status} />
                <div>
                  <div style={{ fontSize: 9, color: "var(--sil)", textTransform: "uppercase", letterSpacing: "1.2px" }}>
                    Step {s.seq}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--mist)", marginTop: 2 }}>
                    {s.name}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: "var(--sil)", borderTop: "1px solid var(--bd)", paddingTop: 6 }}>
                <div style={{ marginBottom: 3 }}>
                  <span style={{ color: "var(--sil)", marginRight: 4 }}>Perms:</span>
                  {parsePermissions(s.required_permissions).map((p) => (
                    <span key={p} style={{
                      background: "rgba(184,145,42,.1)", color: "var(--gold2)",
                      border: "1px solid rgba(184,145,42,.2)", borderRadius: 3,
                      fontSize: 9, padding: "1px 4px", marginRight: 3,
                      fontFamily: "monospace",
                    }}>{p}</span>
                  ))}
                </div>
                <div style={{ color: "var(--sil)" }}>
                  Confidence ≥ <span style={{ color: "var(--gold2)", fontWeight: 600 }}>{s.min_confidence}</span>
                </div>
                {s.sla_minutes && (
                  <div style={{ color: "var(--sil)", marginTop: 3 }}>
                    SLA: <span style={{ color: "var(--B)" }}>{s.sla_minutes} min</span>
                  </div>
                )}
                <div style={{
                  marginTop: 4,
                  display: "inline-block",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 9,
                  background: s.status === "Approved"
                    ? "rgba(46,204,138,.12)"
                    : s.status === "Rejected"
                    ? "rgba(224,82,82,.12)"
                    : s.status === "Pending"
                    ? "rgba(184,145,42,.12)"
                    : "rgba(255,255,255,.06)",
                  color: stepColor(s.status),
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}>{s.status}</div>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                display: "flex", alignItems: "center", paddingTop: 16,
              }}>
                <div style={{
                  width: 24, height: 2,
                  background: s.status === "Approved" ? "rgba(46,204,138,.4)" : "rgba(255,255,255,.1)",
                }} />
                <span style={{ color: "var(--sil)", fontSize: 14 }}>›</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
