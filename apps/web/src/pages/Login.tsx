import { useState, type FormEvent, type CSSProperties } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { Carousel, type Slide } from "../components/Carousel.js";

const SLIDES: Slide[] = [
  { icon: "📄", title: "Capture, classify, index.", body: "Multi-channel capture from branch scanners, mobile, email, and portal — OCR and AI classification in one pipeline." },
  { icon: "🧭", title: "Maker–checker workflows.", body: "Configurable approval chains with full audit, escalation, and step-up authentication for high-risk documents." },
  { icon: "🔍", title: "Enterprise search across branches.", body: "Full-text across OCR, metadata, and customer records — results scoped by branch, role, and risk band." },
];

// Light-theme styles — the right panel is white, so we can't reuse the dark
// dashboard .field/.label classes (white text on translucent bg).
const labelStyle: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, color: "#475569", marginBottom: 7, letterSpacing: ".2px" };
const inputStyle: CSSProperties = { display: "block", width: "100%", padding: "11px 13px", border: "1px solid #e2e8f0", borderRadius: 9, background: "#fff", color: "#0f172a", fontSize: 14, outline: "none", boxSizing: "border-box" };

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [mfa, setMfa] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await login(username, password, mfa ? totp : undefined);
    } catch (err: any) {
      if (err?.body?.mfaRequired) { setMfa(true); setError("Enter your authenticator code."); }
      else setError("Invalid credentials.");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100vh" }}>
      {/* LEFT — navy panel with vertically-centred auto-rotating carousel */}
      <div style={{ position: "relative", overflow: "hidden", background: "linear-gradient(160deg,var(--navy),var(--navy-deep))", backgroundImage: "radial-gradient(rgba(255,255,255,.08) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
        <div style={{ position: "absolute", top: 40, left: 56, color: "#fff", display: "flex", gap: 12, alignItems: "center", zIndex: 1 }}>
          <div style={{ width: 34, height: 34, background: "var(--gold)", borderRadius: 8, display: "grid", placeItems: "center", color: "var(--navy-deep)", fontWeight: 700 }}>Z</div>
          <div className="brand"><div style={{ fontWeight: 700 }}>ZorDMS</div><div style={{ fontSize: 12, opacity: .7 }}>Enterprise Document Management</div></div>
        </div>
        <Carousel slides={SLIDES} />
      </div>

      {/* RIGHT — white sign-in panel */}
      <div style={{ position: "relative", display: "grid", placeItems: "center", padding: 24, background: "#ffffff" }}>
        <form onSubmit={onSubmit} style={{ width: 360 }}>
          <div style={{ width: 46, height: 46, background: "var(--navy)", borderRadius: 12, display: "grid", placeItems: "center", color: "#fff", fontSize: 20, marginBottom: 26 }}>🛡️</div>
          <h2 style={{ margin: "0 0 8px", fontSize: 26, color: "#0f172a" }}>Sign in</h2>
          <p style={{ color: "#64748b", margin: "0 0 32px", fontSize: 14 }}>Document operations for authorised staff only</p>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle} htmlFor="username">Username</label>
            <input id="username" style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your.username" />
          </div>

          <div>
            <label style={labelStyle} htmlFor="password">Password</label>
            <input id="password" style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>

          {mfa && (
            <div style={{ marginTop: 20 }}>
              <label style={labelStyle} htmlFor="totp">Authenticator code</label>
              <input id="totp" style={inputStyle} value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="123456" />
            </div>
          )}

          {error && <p style={{ color: "#b91c1c", fontSize: 13, margin: "16px 0 0" }}>{error}</p>}

          <button
            type="submit"
            disabled={busy}
            style={{ marginTop: 30, width: "100%", padding: "12px 16px", background: busy ? "#94a3b8" : "var(--navy)", color: "#fff", border: "none", borderRadius: 9, fontSize: 15, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}
          >
            {busy ? "…" : "Sign in"}
          </button>
        </form>

        {/* App version — derived from the real package.json version at build time */}
        <div className="brand" style={{ position: "absolute", bottom: 22, left: 0, right: 0, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
          ZorDMS · v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}
