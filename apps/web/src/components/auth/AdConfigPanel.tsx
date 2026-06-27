/**
 * AdConfigPanel — admin configuration of BOBL Active Directory (LDAP) login.
 *
 * When enabled, non-superuser staff authenticate against the directory; the
 * platform superuser ("admin") always stays local. Config is persisted in the
 * gateway and applied live (env vars, if set, take precedence and lock the UI).
 */
import { useCallback, useEffect, useState } from "react";
import { Card, FormField } from "../ui/index.js";
import { adConfigApi, type AdConfig } from "../../api/adConfigApi.js";

type Msg = { kind: "success" | "error"; text: string } | null;

export function AdConfigPanel({ canWrite }: { canWrite: boolean }) {
  const [cfg, setCfg] = useState<AdConfig | null>(null);
  const [envManaged, setEnvManaged] = useState(false);
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adConfigApi.get();
      setCfg(res.ldap);
      setEnvManaged(res.envManaged);
    } catch {
      setMsg({ kind: "error", text: "Failed to load AD configuration." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    setMsg(null);
    try {
      await adConfigApi.put({
        enabled: cfg.enabled,
        displayName: cfg.displayName,
        url: cfg.url,
        bindDN: cfg.bindDN,
        searchBase: cfg.searchBase,
        searchFilter: cfg.searchFilter,
        groupAttr: cfg.groupAttr,
        ...(secret.trim() ? { bindCredentials: secret.trim() } : {}),
      });
      setSecret("");
      setMsg({ kind: "success", text: "Active Directory configuration saved." });
      await load();
    } catch (e: unknown) {
      const err = e as { body?: { error?: string } };
      setMsg({ kind: "error", text: err?.body?.error ?? "Save failed." });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !cfg) {
    return <div style={{ padding: 20, color: "var(--sil)", fontSize: 12 }}>Loading AD configuration…</div>;
  }

  const disabled = !canWrite || envManaged;

  return (
    <div style={{ marginTop: 14, maxWidth: 640 }}>
      <div style={{ fontSize: 12, color: "var(--sil)", marginBottom: 12 }}>
        Enable BOBL Active Directory so staff sign in with their directory credentials. The platform
        superuser (<b>admin</b>) always signs in locally and can never be locked out by AD.
      </div>

      {envManaged && (
        <div style={{ padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12, background: "var(--WT, rgba(240,160,48,.1))", border: "1px solid rgba(240,160,48,.35)", color: "var(--Wtx)" }}>
          AD is pinned by environment variables on this deployment — these fields are read-only here.
        </div>
      )}

      {msg && (
        <div style={{
          padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12,
          background: msg.kind === "success" ? "var(--GT)" : "var(--RT)",
          border: `1px solid ${msg.kind === "success" ? "rgba(46,204,138,.3)" : "rgba(224,82,82,.3)"}`,
          color: msg.kind === "success" ? "var(--Gtx)" : "var(--Rtx)",
        }}>{msg.text}</div>
      )}

      <Card title="Active Directory (LDAP)">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <FormField as="select" label="Status" value={cfg.enabled ? "on" : "off"} disabled={disabled}
            onChange={(e) => setCfg({ ...cfg, enabled: (e.target as HTMLSelectElement).value === "on" })}>
            <option value="on">Enabled</option>
            <option value="off">Disabled</option>
          </FormField>
          <FormField label="Display name" value={cfg.displayName} disabled={disabled}
            hint="Shown on the sign-in button, e.g. 'BOBL Active Directory'."
            onChange={(e) => setCfg({ ...cfg, displayName: (e.target as HTMLInputElement).value })} />
          <FormField label="Server URL" placeholder="ldaps://ad.bobl.bt:636" value={cfg.url} disabled={disabled}
            onChange={(e) => setCfg({ ...cfg, url: (e.target as HTMLInputElement).value })} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormField label="Bind DN" placeholder="CN=svc,OU=Service,DC=bobl,DC=bt" value={cfg.bindDN} disabled={disabled}
              onChange={(e) => setCfg({ ...cfg, bindDN: (e.target as HTMLInputElement).value })} />
            <FormField label="Bind password (write-only)" type="password" placeholder={cfg.hasBindCredentials ? "•••••• (set)" : "set bind password"} value={secret} disabled={disabled}
              hint="Blank keeps the current password."
              onChange={(e) => setSecret((e.target as HTMLInputElement).value)} />
          </div>
          <FormField label="Search base" placeholder="DC=bobl,DC=bt" value={cfg.searchBase} disabled={disabled}
            onChange={(e) => setCfg({ ...cfg, searchBase: (e.target as HTMLInputElement).value })} />
          <FormField label="Search filter" placeholder="(sAMAccountName={{username}})" value={cfg.searchFilter} disabled={disabled}
            hint="Use {{username}} where the login name should be substituted."
            onChange={(e) => setCfg({ ...cfg, searchFilter: (e.target as HTMLInputElement).value })} />
          <FormField label="Group attribute" placeholder="memberOf" value={cfg.groupAttr} disabled={disabled}
            onChange={(e) => setCfg({ ...cfg, groupAttr: (e.target as HTMLInputElement).value })} />

          {!disabled && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button className="btn bs" onClick={load} disabled={saving}>Reset</button>
              <button className="btn bg" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save AD configuration"}</button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
