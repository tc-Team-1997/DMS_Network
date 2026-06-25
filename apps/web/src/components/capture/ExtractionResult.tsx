/**
 * ExtractionResult — renders the AI extraction outcome after Proceed.
 * Shows: detected doc_type + confidence, extracted metadata fields,
 * catalog/folder assignment, and a "Create new type" suggestion card.
 */
import { Card, Tag } from "../ui/index.js";
import type { ExtractionResult as ExtractionResultData } from "../../api/captureApi.js";

export interface ExtractionResultProps {
  result: ExtractionResultData;
  onCreateNewType?: (proposedName: string) => void;
}

const ROUTE_VARIANT: Record<string, "green" | "amber" | "red"> = {
  AUTO: "green",
  TENTATIVE: "amber",
  HUMAN_REVIEW: "red",
};

export function ExtractionResult({ result, onCreateNewType }: ExtractionResultProps) {
  const { classification, mappedFields, catalog, folder, suggestedNewType, source } = result;
  const confidence = Math.round(classification.confidence * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Classification summary */}
      <Card title="AI Classification Result">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--gold3)" }}>
              {classification.doc_type}
            </div>
            <div style={{ fontSize: 11, color: "var(--sil)", marginTop: 2 }}>
              Document type detected by AI · Source: {source === "ai" ? "AI Engine" : "OCR Fallback"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: confidence >= 85 ? "var(--G)" : confidence >= 60 ? "var(--gold3)" : "var(--R)",
              }}
            >
              {confidence}%
            </div>
            <Tag variant={classification.review_flag ? "amber" : "green"}>
              {classification.review_flag ? "Needs Review" : "High Confidence"}
            </Tag>
          </div>
        </div>
      </Card>

      {/* Catalog + Folder */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card title="Catalog Assignment">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
            <Row label="Category" value={catalog.category} />
            <Row label="Route" value={
              <Tag variant={ROUTE_VARIANT[catalog.route] ?? "amber"}>{catalog.route}</Tag>
            } />
            <Row label="Retention" value={`${catalog.retentionYears} years`} />
            {catalog.alertRule && <Row label="Alert Rule" value={catalog.alertRule} />}
            {catalog.missing.length > 0 && (
              <Row
                label="Missing Fields"
                value={<Tag variant="red">{catalog.missing.join(", ")}</Tag>}
              />
            )}
          </div>
        </Card>

        <Card title="Folder Assignment">
          {folder ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
              <Row label="Folder ID" value={String(folder.folderId)} />
              <div style={{ background: "var(--ink2)", borderRadius: 6, padding: "6px 8px", fontSize: 11, color: "var(--mist)", wordBreak: "break-all" }}>
                {folder.path}
              </div>
              {folder.acls.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                  {folder.acls.map((acl, i) => (
                    <Tag key={i} variant="blue">{acl.role}: {acl.access}</Tag>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: "var(--sil)", fontSize: 12, padding: "8px 0" }}>
              No folder assigned — manual routing required.
            </div>
          )}
        </Card>
      </div>

      {/* Extracted metadata fields */}
      <Card
        title={
          <span>
            Extracted Metadata Fields{" "}
            {mappedFields.partial && <Tag variant="amber">Partial</Tag>}
          </span>
        }
      >
        {Object.keys(mappedFields.data).length === 0 ? (
          <div style={{ color: "var(--sil)", fontSize: 12, padding: "8px 0" }}>No fields extracted.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
            {Object.entries(mappedFields.data).map(([key, val]) => (
              <div
                key={key}
                style={{
                  background: "var(--ink3)",
                  borderRadius: 7,
                  padding: "7px 10px",
                  border: mappedFields.mappedKeys.includes(key)
                    ? "1px solid rgba(184,145,42,.3)"
                    : "1px solid var(--bd)",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 2, textTransform: "uppercase", letterSpacing: ".04em" }}>
                  {key.replace(/_/g, " ")}
                  {mappedFields.mappedKeys.includes(key) && (
                    <Tag variant="gold" style={{ marginLeft: 4, fontSize: 8 }}>mapped</Tag>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--mist)", fontWeight: 600 }}>
                  {val != null ? String(val) : <span style={{ color: "var(--sil)" }}>—</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {mappedFields.errors.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {mappedFields.errors.map((err, i) => (
              <div key={i} style={{ fontSize: 11, color: "var(--R)", background: "rgba(255,80,80,.06)", borderRadius: 5, padding: "5px 8px" }}>
                {err}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Suggested new type */}
      {suggestedNewType && (
        <Card title="Suggested New Document Type">
          <div style={{ background: "rgba(184,145,42,.06)", border: "1px solid rgba(184,145,42,.2)", borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--gold3)", marginBottom: 4 }}>
              Create new document type: <em>{suggestedNewType.proposedName}</em>?
            </div>
            <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 8 }}>
              {suggestedNewType.reason}
            </div>
            {suggestedNewType.sampleFields.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                {suggestedNewType.sampleFields.map((f) => (
                  <Tag key={f} variant="blue">{f}</Tag>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                aria-label="Create new document type"
                onClick={() => onCreateNewType?.(suggestedNewType.proposedName)}
                style={{
                  padding: "7px 14px",
                  background: "linear-gradient(135deg,#b8912a,#f0c84a)",
                  border: "none",
                  borderRadius: 7,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  color: "#050d1a",
                }}
              >
                Create New Type
              </button>
              <button
                type="button"
                aria-label="Dismiss suggestion"
                onClick={() => {}}
                style={{ padding: "7px 12px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 7, fontSize: 11, color: "var(--mist)", cursor: "pointer" }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{ color: "var(--sil)" }}>{label}</span>
      <span style={{ color: "var(--mist)", fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}
