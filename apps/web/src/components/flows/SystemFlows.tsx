import { useEffect, useState, Fragment } from "react";
import { Card } from "../ui/index.js";
import { flowsApi, type FlowLane, type FlowNode } from "../../api/flowsApi.js";

/**
 * SC-07 — four interactive system-flow lanes (document · AI · workflow ·
 * integration) from the core /flows config. Click a node to see its detail.
 */
export function SystemFlows() {
  const [lanes, setLanes] = useState<FlowLane[]>([]);
  const [selected, setSelected] = useState<{ lane: string; node: FlowNode } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    flowsApi.listFlows().then(setLanes).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  return (
    <Card title="System Flows — document · AI · workflow · integration" style={{ marginTop: 14 }}>
      {error && <div role="alert" style={{ color: "var(--R, #c0392b)" }}>{error}</div>}
      {lanes.map((l) => (
        <div key={l.lane} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--mist)" }}>{l.label}</div>
          <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 6 }}>{l.description}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {l.nodes.map((n, i) => (
              <Fragment key={n.id}>
                <button
                  className="btn bs xs"
                  aria-label={`${l.lane} ${n.id}`}
                  onClick={() => setSelected({ lane: l.lane, node: n })}
                  style={selected?.lane === l.lane && selected?.node.id === n.id ? { outline: "2px solid var(--accent, #6080ff)" } : undefined}
                >
                  {n.label}
                </button>
                {i < l.nodes.length - 1 && <span aria-hidden style={{ color: "var(--sil)" }}>→</span>}
              </Fragment>
            ))}
          </div>
        </div>
      ))}
      {selected && (
        <div data-testid="flow-detail" style={{ marginTop: 8, padding: "10px 14px", borderRadius: 8, background: "rgba(96,128,255,.06)", border: "1px solid rgba(96,128,255,.18)" }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{selected.node.label}</div>
          <div style={{ fontSize: 12, color: "var(--mist)", marginTop: 2 }}>{selected.node.detail}</div>
        </div>
      )}
      {lanes.length === 0 && !error && <div style={{ color: "var(--sil)", fontSize: 12 }}>Loading flows…</div>}
    </Card>
  );
}

export default SystemFlows;
