import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { Carousel, type Slide } from "../components/Carousel.js";

const SLIDES: Slide[] = [
  { icon: "📄", title: "Capture, classify, index.", body: "Multi-channel capture from branch scanners, mobile, email, and portal — OCR and AI classification in one pipeline." },
  { icon: "🧭", title: "Maker–checker workflows.", body: "Configurable approval chains with full audit, escalation, and step-up authentication for high-risk documents." },
  { icon: "🔍", title: "Enterprise search across branches.", body: "Full-text across OCR, metadata, and customer records — results scoped by branch, role, and risk band." },
];

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
      <div style={{ position: "relative", background: "linear-gradient(160deg,var(--navy),var(--navy-deep))", backgroundImage: "radial-gradient(rgba(255,255,255,.08) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
        <div style={{ position: "absolute", top: 40, left: 48, color: "#fff", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 34, height: 34, background: "var(--gold)", borderRadius: 8, display: "grid", placeItems: "center", color: "var(--navy-deep)", fontWeight: 700 }}>Z</div>
          <div><div style={{ fontWeight: 700 }}>ZorDMS</div><div style={{ fontSize: 12, opacity: .7 }}>Enterprise Document Management</div></div>
        </div>
        <Carousel slides={SLIDES} />
      </div>

      <div style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <form onSubmit={onSubmit} style={{ width: 360 }}>
          <div style={{ width: 40, height: 40, background: "var(--navy)", borderRadius: 10, display: "grid", placeItems: "center", color: "#fff", marginBottom: 24 }}>🛡️</div>
          <h2 style={{ margin: "0 0 4px" }}>Sign in</h2>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>Document operations for authorised staff only</p>

          <label className="label" htmlFor="username">Username</label>
          <input id="username" className="field" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your.username" />

          <label className="label" htmlFor="password" style={{ marginTop: 14, display: "block" }}>Password</label>
          <input id="password" className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />

          {mfa && (<>
            <label className="label" htmlFor="totp" style={{ marginTop: 14, display: "block" }}>Authenticator code</label>
            <input id="totp" className="field" value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="123456" />
          </>)}

          {error && <p style={{ color: "#b91c1c", fontSize: 13 }}>{error}</p>}
          <button className="btn-primary" aria-label="Sign in" disabled={busy} style={{ marginTop: 18 }}>{busy ? "…" : "Continue"}</button>
        </form>
      </div>
    </div>
  );
}
