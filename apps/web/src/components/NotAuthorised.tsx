/**
 * NotAuthorised / NotFound — enterprise empty states for access + missing
 * resources. Used at the route level (ProtectedRoute) and the resource level
 * (e.g. opening a document link the user can't access, or a stale link).
 *
 * Renders a calm, branded panel inside the app shell rather than a raw error
 * banner — so a 403/404 never looks like a crash.
 */
import { useNavigate } from "react-router-dom";
import { ShieldAlert, FileQuestion } from "lucide-react";

export type AccessStateVariant = "forbidden" | "notfound";

export interface NotAuthorisedProps {
  variant?: AccessStateVariant;
  /** Optional heading override. */
  title?: string;
  /** Optional body/explanation override. */
  message?: string;
  /** What the user was trying to reach (e.g. a document ref) — shown subtly. */
  resourceLabel?: string;
  /** Hide the "Back to dashboard" action (e.g. when embedded). */
  hideHomeButton?: boolean;
}

export function NotAuthorised({
  variant = "forbidden",
  title,
  message,
  resourceLabel,
  hideHomeButton,
}: NotAuthorisedProps) {
  const navigate = useNavigate();
  const isForbidden = variant === "forbidden";

  const heading = title ?? (isForbidden ? "You don't have access" : "Not found");
  const body =
    message ??
    (isForbidden
      ? "You don't have permission to view this. If you believe this is a mistake, contact your administrator to request access."
      : "The item you're looking for doesn't exist or may have been moved or removed.");

  return (
    <div
      role="region"
      aria-label={heading}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        minHeight: 420,
        padding: "48px 24px",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 64, height: 64, borderRadius: 16, marginBottom: 20,
          display: "grid", placeItems: "center",
          background: isForbidden ? "rgba(224,82,82,.12)" : "var(--ink3)",
          color: isForbidden ? "var(--Rtx, #c0392b)" : "var(--sil)",
        }}
      >
        {isForbidden ? <ShieldAlert size={30} /> : <FileQuestion size={30} />}
      </div>

      <h2 style={{ margin: "0 0 8px", fontSize: 20, color: "var(--wh, #0f172a)" }}>{heading}</h2>
      <p style={{ margin: 0, maxWidth: 440, fontSize: 13.5, lineHeight: 1.6, color: "var(--sil)" }}>{body}</p>

      {resourceLabel && (
        <div className="mono" style={{ marginTop: 12, fontSize: 11, color: "var(--sil)", opacity: 0.8 }}>
          {resourceLabel}
        </div>
      )}

      {!hideHomeButton && (
        <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
          <button className="btn bs" onClick={() => navigate(-1)}>Go back</button>
          <button className="btn bg" onClick={() => navigate("/dashboard")}>Back to dashboard</button>
        </div>
      )}
    </div>
  );
}
