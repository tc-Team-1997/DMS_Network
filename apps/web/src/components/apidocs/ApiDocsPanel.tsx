/**
 * ApiDocsPanel — in-app OpenAPI viewer for admins.
 *
 * Fetches each service's live /openapi.json (no extra dependency) and renders a
 * grouped, expandable endpoint reference: method badge, path, summary, params,
 * request body, responses, and auth. A link to the raw spec is provided for
 * tooling (Postman / codegen).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Tag } from "../ui/index.js";
import { apiDocsApi, API_SERVICES, type OpenApiDoc, type OpenApiOperation } from "../../api/apiDocsApi.js";

const METHOD_COLORS: Record<string, { bg: string; fg: string }> = {
  get:    { bg: "var(--BT)", fg: "var(--Btx)" },
  post:   { bg: "var(--GT)", fg: "var(--Gtx)" },
  put:    { bg: "var(--WT)", fg: "var(--Wtx)" },
  patch:  { bg: "var(--WT)", fg: "var(--Wtx)" },
  delete: { bg: "var(--RT)", fg: "var(--Rtx)" },
};

interface FlatOp {
  method: string;
  path: string;
  op: OpenApiOperation;
}

function flattenOps(doc: OpenApiDoc): FlatOp[] {
  const out: FlatOp[] = [];
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      out.push({ method, path, op });
    }
  }
  return out;
}

function MethodBadge({ method }: { method: string }) {
  const c = METHOD_COLORS[method.toLowerCase()] ?? { bg: "var(--ink3)", fg: "var(--sil)" };
  return (
    <span
      style={{
        display: "inline-block", minWidth: 52, textAlign: "center",
        background: c.bg, color: c.fg, borderRadius: 5, padding: "2px 8px",
        fontSize: 10, fontWeight: 700, letterSpacing: .4, textTransform: "uppercase",
      }}
    >
      {method}
    </span>
  );
}

function OperationRow({ flat }: { flat: FlatOp }) {
  const [open, setOpen] = useState(false);
  const { op, method, path } = flat;
  const secured = (op.security?.length ?? 0) > 0;
  return (
    <div style={{ borderBottom: "1px solid var(--bd)" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 4px",
          background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <MethodBadge method={method} />
        <span className="mono" style={{ fontSize: 12, color: "var(--mist)", flex: 1 }}>{path}</span>
        {op.summary && <span style={{ fontSize: 11, color: "var(--sil)", flexShrink: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>{op.summary}</span>}
        {secured && <Tag variant="gold">auth</Tag>}
      </button>
      {open && (
        <div style={{ padding: "4px 4px 14px 62px", fontSize: 12, color: "var(--mist)" }}>
          {op.description && <p style={{ margin: "0 0 10px", color: "var(--sil)" }}>{op.description}</p>}

          {op.parameters && op.parameters.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "var(--sil)", marginBottom: 4 }}>Parameters</div>
              {op.parameters.map((p, i) => (
                <div key={i} style={{ fontSize: 11, marginBottom: 2 }}>
                  <span className="mono" style={{ color: "var(--Btx)" }}>{p.name}</span>
                  <span style={{ color: "var(--sil)" }}> in {p.in}{p.required ? " · required" : ""}</span>
                  {p.description && <span style={{ color: "var(--sil)" }}> — {p.description}</span>}
                </div>
              ))}
            </div>
          )}

          {op.requestBody && (
            <div style={{ marginBottom: 10, fontSize: 11, color: "var(--sil)" }}>
              Request body{op.requestBody.required ? " (required)" : ""} — JSON
            </div>
          )}

          {op.responses && (
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "var(--sil)", marginBottom: 4 }}>Responses</div>
              {Object.entries(op.responses).map(([code, r]) => (
                <div key={code} style={{ fontSize: 11, marginBottom: 2 }}>
                  <span className="mono" style={{ color: code.startsWith("2") ? "var(--Gtx)" : code.startsWith("4") ? "var(--Wtx)" : "var(--Rtx)" }}>{code}</span>
                  <span style={{ color: "var(--sil)" }}> — {r.description ?? ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ApiDocsPanel() {
  const [active, setActive] = useState(API_SERVICES[0].key);
  const [doc, setDoc] = useState<OpenApiDoc | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [filter, setFilter] = useState("");

  const svc = API_SERVICES.find((s) => s.key === active)!;

  const load = useCallback(async () => {
    setStatus("loading");
    setDoc(null);
    try {
      const d = await apiDocsApi.fetchSpec(svc.base);
      setDoc(d);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [svc.base]);

  useEffect(() => { load(); }, [load]);

  const ops = useMemo(() => (doc ? flattenOps(doc) : []), [doc]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return ops;
    return ops.filter((o) => o.path.toLowerCase().includes(q) || o.op.summary?.toLowerCase().includes(q) || o.method.toLowerCase() === q);
  }, [ops, filter]);

  // Group by first tag.
  const groups = useMemo(() => {
    const map = new Map<string, FlatOp[]>();
    for (const o of filtered) {
      const g = o.op.tags?.[0] ?? "general";
      const arr = map.get(g) ?? [];
      arr.push(o);
      map.set(g, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {API_SERVICES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setActive(s.key)}
            className={active === s.key ? "btn bg" : "btn bs"}
            style={{ fontSize: 11, padding: "5px 11px" }}
          >
            {s.key}
          </button>
        ))}
      </div>

      <Card
        title={
          <span>
            {svc.label}
            {doc?.info?.version && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--sil)" }}>v{doc.info.version}</span>}
          </span>
        }
        action={
          <a
            href={`${svc.base}/openapi.json`}
            target="_blank"
            rel="noreferrer"
            className="btn bs"
            style={{ fontSize: 11 }}
          >
            Raw spec ↗
          </a>
        }
      >
        {status === "loading" && <div style={{ padding: 20, color: "var(--sil)", fontSize: 12 }}>Loading API spec…</div>}
        {status === "error" && (
          <div style={{ padding: 20, color: "var(--sil)", fontSize: 12 }}>
            Could not load this service's spec. The service may be offline.
          </div>
        )}
        {status === "ready" && doc && (
          <>
            {doc.info?.description && (
              <p style={{ fontSize: 12, color: "var(--sil)", margin: "0 0 12px" }}>{doc.info.description}</p>
            )}
            <input
              className="field"
              placeholder="Filter endpoints (path, summary, or method)…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 12 }}
            />
            <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 8 }}>
              {filtered.length} endpoint{filtered.length === 1 ? "" : "s"}
            </div>
            {groups.map(([tag, items]) => (
              <div key={tag} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--gold3)", fontWeight: 700, marginBottom: 4 }}>
                  {tag}
                </div>
                {items.map((flat, i) => (
                  <OperationRow key={`${flat.method}-${flat.path}-${i}`} flat={flat} />
                ))}
              </div>
            ))}
            {filtered.length === 0 && <div style={{ padding: 16, color: "var(--sil)", fontSize: 12 }}>No matching endpoints.</div>}
          </>
        )}
      </Card>
    </div>
  );
}
