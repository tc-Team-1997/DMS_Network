import { useEffect, useState, type FormEvent, type CSSProperties } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { Carousel, type Slide } from "../components/Carousel.js";
import { fetchAuthConfig, ldapLogin, type SsoProvider } from "../api/authConfig.js";
import { readHandoffToken, clearHandoffHash } from "../auth/ssoHandoff.js";

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
  const { user, login, loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [mfa, setMfa] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Enabled SSO providers discovered from the gateway's public /auth/config.
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  // When an LDAP provider is chosen, the local form POSTs to its endpoint
  // instead of /auth/login (same JWT result). `null` = local mode.
  const [ldapProvider, setLdapProvider] = useState<SsoProvider | null>(null);

  // TOKEN HANDOFF: an OIDC/SAML redirect lands back here as `/login#token=…`.
  // Adopt the JWT exactly like a local login, clear the fragment, and proceed.
  useEffect(() => {
    const token = readHandoffToken(window.location.hash);
    if (token) {
      loginWithToken(token);
      clearHandoffHash();
      navigate("/dashboard", { replace: true });
    }
  }, [loginWithToken, navigate]);

  // Discover which enterprise providers are enabled. Failure degrades to
  // local-only (fetchAuthConfig never throws), so the screen always renders.
  useEffect(() => {
    let live = true;
    fetchAuthConfig().then((cfg) => {
      if (live) setProviders(cfg.providers);
    });
    return () => { live = false; };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      if (ldapProvider) {
        // LDAP returns the same internal { token, user } as a local login.
        const res = await ldapLogin(ldapProvider.loginUrl, username, password);
        loginWithToken(res.token, res.user);
      } else {
        await login(username, password, mfa ? totp : undefined);
      }
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      if (err?.body?.mfaRequired) { setMfa(true); setError("Enter your authenticator code."); }
      else if (ldapProvider) setError(`${ldapProvider.displayName} sign-in failed.`);
      else setError("Invalid credentials.");
    } finally { setBusy(false); }
  }

  // OIDC/SAML are browser-redirect flows: navigate the whole window to the
  // gateway login URL, which 302s to the IdP and later redirects back with a
  // #token= handoff (handled by the effect above).
  function onProviderClick(p: SsoProvider) {
    if (p.id === "ldap") {
      // LDAP keeps the username/password form, just routed to the AD endpoint.
      setLdapProvider(p);
      setError(""); setMfa(false);
      return;
    }
    window.location.assign(p.loginUrl);
  }

  // Already signed in (e.g. visiting /login with a live session) → go to the app.
  if (user) return <Navigate to="/dashboard" replace />;

  const ldapProviders = providers.filter((p) => p.id === "ldap");
  const redirectProviders = providers.filter((p) => p.id !== "ldap");
  const hasSso = providers.length > 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100vh" }}>
      {/* LEFT — navy panel with vertically-centred auto-rotating carousel */}
      <div style={{ position: "relative", overflow: "hidden", backgroundColor: "#0b1830", backgroundImage: "radial-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(160deg, #0b1830, #050d1a)", backgroundSize: "16px 16px, 100% 100%" }}>
        <div style={{ position: "absolute", top: 40, left: 56, color: "#fff", display: "flex", gap: 12, alignItems: "center", zIndex: 1 }}>
          <div style={{ width: 34, height: 34, background: "var(--gold)", borderRadius: 8, display: "grid", placeItems: "center", color: "var(--navy-deep)", fontWeight: 700 }}>Z</div>
          <div className="brand"><div style={{ fontWeight: 700 }}>ZorDMS</div><div style={{ fontSize: 12, opacity: .7 }}>Enterprise Document Management</div></div>
        </div>
        <Carousel slides={SLIDES} />
      </div>

      {/* RIGHT — white sign-in panel */}
      <div style={{ position: "relative", display: "grid", placeItems: "center", padding: 24, background: "#ffffff" }}>
        <div style={{ width: 360 }}>
          <form onSubmit={onSubmit} autoComplete="off">
            <div style={{ width: 46, height: 46, background: "var(--navy)", borderRadius: 12, display: "grid", placeItems: "center", color: "#fff", fontSize: 20, marginBottom: 26 }}>🛡️</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 26, color: "#0f172a" }}>Sign in</h2>
            <p style={{ color: "#64748b", margin: "0 0 32px", fontSize: 14 }}>
              {ldapProvider
                ? `Sign in with ${ldapProvider.displayName}`
                : "Document operations for authorised staff only"}
            </p>

            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle} htmlFor="username">Username</label>
              <input id="username" name="zordms-username" style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your.username" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} />
            </div>

            <div>
              <label style={labelStyle} htmlFor="password">Password</label>
              <input id="password" name="zordms-password" style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </div>

            {mfa && !ldapProvider && (
              <div style={{ marginTop: 20 }}>
                <label style={labelStyle} htmlFor="totp">Authenticator code</label>
                <input id="totp" name="zordms-totp" style={inputStyle} value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="123456" autoComplete="one-time-code" inputMode="numeric" />
              </div>
            )}

            {error && <p style={{ color: "#b91c1c", fontSize: 13, margin: "16px 0 0" }}>{error}</p>}

            <button
              type="submit"
              disabled={busy}
              style={{ marginTop: 30, width: "100%", padding: "12px 16px", background: busy ? "#94a3b8" : "var(--navy)", color: "#fff", border: "none", borderRadius: 9, fontSize: 15, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}
            >
              {busy ? "…" : ldapProvider ? `Sign in with ${ldapProvider.displayName}` : "Sign in"}
            </button>

            {ldapProvider && (
              <button
                type="button"
                onClick={() => { setLdapProvider(null); setError(""); }}
                style={{ marginTop: 12, width: "100%", padding: "10px 16px", background: "transparent", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                Back to standard sign-in
              </button>
            )}
          </form>

          {/* SSO — only when at least one provider is enabled and we're not
              already inside an LDAP credential prompt. Otherwise the screen is
              byte-for-byte the local-only login. */}
          {hasSso && !ldapProvider && (
            <div style={{ marginTop: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 18px" }}>
                <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
                <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, letterSpacing: ".3px", whiteSpace: "nowrap" }}>or continue with</span>
                <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[...redirectProviders, ...ldapProviders].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onProviderClick(p)}
                    style={{ width: "100%", padding: "11px 16px", background: "#fff", color: "#0f172a", border: "1px solid #cbd5e1", borderRadius: 9, fontSize: 14.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                  >
                    <span aria-hidden="true">🔐</span>
                    Sign in with {p.displayName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* App version — derived from the real package.json version at build time */}
        <div className="brand" style={{ position: "absolute", bottom: 22, left: 0, right: 0, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
          ZorDMS · v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}
