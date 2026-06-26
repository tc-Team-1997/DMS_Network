/**
 * SessionExpiredScreen — branded full-screen overlay shown when the session
 * times out (a 401 from any authenticated API call, or the JWT `exp` passing).
 *
 * Rendered globally by AuthProvider so it appears over whatever screen the user
 * was on, preventing broken layouts / raw error banners from a stale token.
 */
import { Lock } from "lucide-react";

export interface SessionExpiredScreenProps {
  /** Re-authenticate: clears any residual state and sends the user to /login. */
  onReauthenticate: () => void;
}

export function SessionExpiredScreen({ onReauthenticate }: SessionExpiredScreenProps) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        background: "rgba(5,13,26,.78)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: "90vw",
          background: "#0b1830",
          color: "#fff",
          border: "1px solid rgba(255,255,255,.1)",
          borderRadius: 14,
          padding: "34px 32px",
          textAlign: "center",
          boxShadow: "0 24px 60px rgba(0,0,0,.45)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 56, height: 56, margin: "0 auto 18px", borderRadius: 14,
            display: "grid", placeItems: "center",
            background: "rgba(184,145,42,.16)", color: "var(--gold2, #d4a73c)",
          }}
        >
          <Lock size={26} />
        </div>
        <h2 id="session-expired-title" style={{ margin: "0 0 8px", fontSize: 21 }}>Session expired</h2>
        <p style={{ margin: "0 0 24px", fontSize: 14, lineHeight: 1.55, color: "rgba(255,255,255,.72)" }}>
          For your security, your session has timed out. Please sign in again to continue.
        </p>
        <button
          type="button"
          onClick={onReauthenticate}
          autoFocus
          style={{
            width: "100%", padding: "12px 16px",
            background: "var(--gold2, #d4a73c)", color: "#241a06",
            border: "none", borderRadius: 9, fontSize: 15, fontWeight: 700, cursor: "pointer",
          }}
        >
          Sign in again
        </button>
      </div>
    </div>
  );
}
