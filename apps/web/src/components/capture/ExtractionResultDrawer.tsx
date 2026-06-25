/**
 * ExtractionResultDrawer — editable post-processing result panel shown inside
 * CaptureQueueDrawer after extraction completes.
 *
 * The uploader can correct:
 *  - Classification: doc_type (select from GET /doc-types) + human category
 *  - Metadata fields: rendered from the type's mandatoryFields/optionalFields,
 *    pre-filled from extraction's mappedFields.data
 *
 * Read-only sections:
 *  - AI analysis summary + OCR metadata (confidence / source)
 *  - Folder / path mapping (confirm)
 *
 * Quality / Completeness panel:
 *  - quality.score, mandatory-field checklist, completeness %
 *
 * Duplicates: list with matchType + "Open in Viewer" link (/viewer?doc=<id>)
 *
 * "Save corrections" -> PATCH /documents/:id -> shows recomputed quality.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Tag, FormField } from "../ui/index.js";
import type {
  ExtractionResult,
  DocType,
  ExtractionQuality,
  PatchDocumentPayload,
} from "../../api/captureApi.js";
import { getDocTypes, patchDocument } from "../../api/captureApi.js";
import { FullScreenPreview } from "./FullScreenPreview.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractionResultDrawerProps {
  docId: string;
  result: ExtractionResult;
  /** Called when drawer X is clicked */
  onClose: () => void;
  /** Optional front file for full-screen preview affordance */
  previewFile?: File | null;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const ROUTE_VARIANT: Record<string, "green" | "amber" | "red"> = {
  AUTO: "green",
  TENTATIVE: "amber",
  HUMAN_REVIEW: "red",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--sil)" }}>{label}</span>
      <span style={{ color: "var(--mist)", fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

// ─── Quality panel ────────────────────────────────────────────────────────────

function QualityPanel({
  quality,
  allMandatory,
}: {
  quality: ExtractionQuality;
  allMandatory: string[];
}) {
  const score = quality.score;
  const scoreColor =
    score >= 80 ? "var(--G)" : score >= 50 ? "var(--gold3)" : "var(--R)";

  return (
    <Card title="Quality &amp; Completeness">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Score */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: scoreColor,
              lineHeight: 1,
            }}
          >
            {score}
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--sil)" }}>Quality Score</div>
            <div style={{ fontSize: 11, color: "var(--sil)" }}>
              Completeness:{" "}
              <strong style={{ color: "var(--mist)" }}>
                {Math.round(quality.completeness * 100)}%
              </strong>
            </div>
            <div style={{ fontSize: 11, color: "var(--sil)" }}>
              AI Confidence:{" "}
              <strong style={{ color: "var(--mist)" }}>
                {Math.round(quality.confidence * 100)}%
              </strong>
            </div>
          </div>
        </div>

        {/* Mandatory field checklist */}
        {allMandatory.length > 0 && (
          <div>
            <div
              style={{
                fontSize: 10,
                color: "var(--sil)",
                textTransform: "uppercase",
                letterSpacing: ".04em",
                marginBottom: 6,
              }}
            >
              Mandatory Fields
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
              aria-label="mandatory fields checklist"
            >
              {allMandatory.map((field) => {
                const missing = quality.mandatoryMissing.includes(field);
                return (
                  <div
                    key={field}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 8px",
                      borderRadius: 6,
                      background: missing
                        ? "rgba(255,80,80,.07)"
                        : "rgba(60,210,130,.06)",
                      border: missing
                        ? "1px solid rgba(255,80,80,.2)"
                        : "1px solid rgba(60,210,130,.2)",
                    }}
                  >
                    <span
                      aria-label={missing ? "missing" : "present"}
                      style={{
                        fontSize: 12,
                        color: missing ? "var(--R)" : "var(--G)",
                        fontWeight: 700,
                        lineHeight: 1,
                      }}
                    >
                      {missing ? "✗" : "✓"}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: missing ? "var(--R)" : "var(--mist)",
                        flex: 1,
                      }}
                    >
                      {field.replace(/_/g, " ")}
                    </span>
                    {missing && (
                      <Tag variant="red" style={{ fontSize: 9 }}>
                        Missing
                      </Tag>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Duplicates panel ─────────────────────────────────────────────────────────

function DuplicatesPanel({
  duplicates,
  autoVersioned,
}: {
  duplicates: NonNullable<ExtractionResult["duplicates"]>;
  autoVersioned: boolean;
}) {
  const navigate = useNavigate();

  if (duplicates.length === 0 && !autoVersioned) return null;

  return (
    <Card title="Duplicate Detection">
      {autoVersioned && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(184,145,42,.08)",
            border: "1px solid rgba(184,145,42,.25)",
            borderRadius: 7,
            fontSize: 12,
            color: "var(--gold3)",
            marginBottom: duplicates.length > 0 ? 10 : 0,
          }}
        >
          Auto-versioned — an existing document has been superseded by this upload.
        </div>
      )}
      {duplicates.length > 0 && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
          aria-label="duplicates list"
        >
          {duplicates.map((dup) => (
            <div
              key={dup.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                background: "var(--ink3)",
                borderRadius: 7,
                border: "1px solid var(--bd)",
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--mist)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {dup.title}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--sil)",
                    marginTop: 2,
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  <span>{dup.doc_type}</span>
                  <span>·</span>
                  <span>{dup.branch}</span>
                  <span>·</span>
                  <span>{new Date(dup.ingest_timestamp).toLocaleDateString()}</span>
                </div>
              </div>
              <Tag variant="amber" style={{ fontSize: 9 }}>
                {dup.matchType}
              </Tag>
              <button
                type="button"
                aria-label={`Open duplicate ${dup.id} in Viewer`}
                onClick={() => navigate(`/viewer?doc=${dup.id}`)}
                style={{
                  padding: "5px 10px",
                  background: "var(--ink2)",
                  border: "1px solid var(--bd)",
                  borderRadius: 5,
                  fontSize: 10,
                  color: "var(--gold3)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Open in Viewer
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Raw metadata panel ───────────────────────────────────────────────────────

function RawMetadataPanel({ rawMetadata }: { rawMetadata: Record<string, unknown> | null | undefined }) {
  const [open, setOpen] = useState(false);
  const hasData = rawMetadata != null && Object.keys(rawMetadata).length > 0;

  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--ink3)",
      }}
    >
      <button
        type="button"
        aria-label="Toggle raw extracted metadata"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "var(--sil)",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: ".04em",
        }}
      >
        <span>Raw extracted metadata (JSON)</span>
        <span aria-hidden="true" style={{ fontSize: 14, color: "var(--sil)" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--bd)", padding: "10px 14px" }}>
          {hasData ? (
            <pre
              aria-label="raw metadata json"
              style={{
                margin: 0,
                fontSize: 10,
                color: "var(--mist)",
                fontFamily: "monospace",
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                maxHeight: 280,
                overflowY: "auto",
              }}
            >
              {JSON.stringify(rawMetadata, null, 2)}
            </pre>
          ) : (
            <div style={{ fontSize: 12, color: "var(--sil)", fontStyle: "italic" }}>
              No raw metadata captured.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExtractionResultDrawer({
  docId,
  result,
  onClose,
  previewFile,
}: ExtractionResultDrawerProps) {
  const { classification, mappedFields, catalog, folder, suggestedNewType, source } = result;
  const initialQuality = result.quality ?? {
    score: 0,
    completeness: 0,
    mandatoryMissing: [],
    confidence: classification.confidence,
  };

  // ── Full-screen preview state ──
  const [showFullScreen, setShowFullScreen] = useState(false);

  // ── Doc-types for classification select ──
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  useEffect(() => {
    getDocTypes()
      .then((r) => setDocTypes(r.docTypes))
      .catch(() => {/* silently ignore — keep empty list */});
  }, []);

  // ── Editable classification fields ──
  const [editedDocType, setEditedDocType] = useState(classification.doc_type);
  const [editedCategory, setEditedCategory] = useState(catalog.category);

  // ── Current doc-type schema (for field form) ──
  const currentDocTypeDef = docTypes.find((dt) => dt.code === editedDocType) ?? null;
  const mandatoryFields: string[] = currentDocTypeDef?.mandatoryFields ?? [];
  const optionalFields: string[] = currentDocTypeDef?.optionalFields ?? [];
  const allFormFields = [
    ...mandatoryFields.map((f) => ({ field: f, required: true })),
    ...optionalFields.map((f) => ({ field: f, required: false })),
  ];

  // ── Editable metadata fields — pre-filled from extraction data ──
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [k, v] of Object.entries(mappedFields.data)) {
      init[k] = v != null ? String(v) : "";
    }
    return init;
  });

  function setField(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  // ── Save corrections ──
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quality, setQuality] = useState<ExtractionQuality>(initialQuality);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload: PatchDocumentPayload = {
        doc_type: editedDocType,
        catalog_category: editedCategory,
        metadata: Object.fromEntries(
          Object.entries(fieldValues).map(([k, v]) => [k, v === "" ? null : v])
        ),
      };
      const resp = await patchDocument(docId, payload);
      setQuality(resp.quality);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [docId, editedDocType, editedCategory, fieldValues]);

  const confidence = Math.round(classification.confidence * 100);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        background: "var(--ink2)",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Drawer header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid var(--bd)",
          flexShrink: 0,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              color: "var(--gold3)",
            }}
          >
            AI Classification Result
          </h3>
          <div style={{ fontSize: 11, color: "var(--sil)", marginTop: 2 }}>
            Review &amp; correct extraction — then save.
          </div>
        </div>
        <button
          type="button"
          aria-label="Close result drawer"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--sil)",
            cursor: "pointer",
            fontSize: 22,
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* ── Read-only: AI summary ── */}
        <Card title="AI Analysis Summary">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--gold3)",
                }}
              >
                {classification.doc_type}
              </div>
              <div style={{ fontSize: 11, color: "var(--sil)", marginTop: 2 }}>
                Source:{" "}
                {source === "ai" ? "AI Engine" : "OCR Fallback"} · OCR
                Confidence: {confidence}%
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 4,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color:
                    confidence >= 85
                      ? "var(--G)"
                      : confidence >= 60
                      ? "var(--gold3)"
                      : "var(--R)",
                }}
              >
                {confidence}%
              </div>
              <Tag
                variant={classification.review_flag ? "amber" : "green"}
              >
                {classification.review_flag ? "Needs Review" : "High Confidence"}
              </Tag>
            </div>
          </div>
          {previewFile && (
            <button
              type="button"
              aria-label="Open full screen file preview"
              onClick={() => setShowFullScreen(true)}
              style={{
                padding: "6px 12px",
                background: "var(--ink3)",
                border: "1px solid var(--bd)",
                borderRadius: 6,
                fontSize: 11,
                color: "var(--gold3)",
                cursor: "pointer",
                marginTop: 8,
              }}
            >
              ⤢ Open full preview
            </button>
          )}
        </Card>

        {/* ── Editable: Classification ── */}
        <Card title="Classification (editable)">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <FormField
              as="select"
              label="Document Type"
              value={editedDocType}
              onChange={(e) =>
                setEditedDocType((e.target as HTMLSelectElement).value)
              }
              aria-label="Document type select"
            >
              {/* Keep current value even if not loaded yet */}
              {docTypes.length === 0 && (
                <option value={editedDocType}>{editedDocType}</option>
              )}
              {docTypes.map((dt) => (
                <option key={dt.code} value={dt.code}>
                  {dt.code} — {dt.description}
                </option>
              ))}
            </FormField>

            <FormField
              label="Human Category"
              value={editedCategory}
              onChange={(e) =>
                setEditedCategory((e.target as HTMLInputElement).value)
              }
              placeholder="e.g. National ID, Passport"
              aria-label="Human category input"
            />
          </div>
        </Card>

        {/* ── Editable: Metadata fields ── */}
        {(allFormFields.length > 0 ||
          Object.keys(mappedFields.data).length > 0) && (
          <Card
            title={
              <span>
                Extracted Fields{" "}
                {mappedFields.partial && (
                  <Tag variant="amber">Partial</Tag>
                )}
              </span>
            }
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 8,
              }}
            >
              {/* Render schema-driven fields if doc-type known */}
              {allFormFields.length > 0
                ? allFormFields.map(({ field, required }) => (
                    <FormField
                      key={field}
                      label={`${field.replace(/_/g, " ")}${required ? " *" : ""}`}
                      value={fieldValues[field] ?? ""}
                      onChange={(e) =>
                        setField(
                          field,
                          (e.target as HTMLInputElement).value
                        )
                      }
                      placeholder={required ? "Required" : "Optional"}
                      aria-label={`Field ${field}`}
                    />
                  ))
                : /* Fallback: all extracted keys */
                  Object.keys(mappedFields.data).map((key) => (
                    <FormField
                      key={key}
                      label={key.replace(/_/g, " ")}
                      value={fieldValues[key] ?? ""}
                      onChange={(e) =>
                        setField(
                          key,
                          (e.target as HTMLInputElement).value
                        )
                      }
                      aria-label={`Field ${key}`}
                    />
                  ))}
            </div>

            {/* Extraction errors */}
            {mappedFields.errors.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {mappedFields.errors.map((err, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 11,
                      color: "var(--R)",
                      background: "rgba(255,80,80,.06)",
                      borderRadius: 5,
                      padding: "5px 8px",
                    }}
                  >
                    {err}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* ── Read-only: Folder / path ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <Card title="Catalog Assignment">
            <div
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              <Row label="Category" value={catalog.category} />
              <Row
                label="Route"
                value={
                  <Tag
                    variant={ROUTE_VARIANT[catalog.route] ?? "amber"}
                  >
                    {catalog.route}
                  </Tag>
                }
              />
              <Row
                label="Retention"
                value={`${catalog.retentionYears} years`}
              />
              {catalog.alertRule && (
                <Row label="Alert Rule" value={catalog.alertRule} />
              )}
            </div>
          </Card>

          <Card title="Folder Path (confirmed)">
            {folder ? (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
              >
                <Row label="Folder ID" value={String(folder.folderId)} />
                <div
                  style={{
                    background: "var(--ink3)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 11,
                    color: "var(--mist)",
                    wordBreak: "break-all",
                  }}
                >
                  {folder.path}
                </div>
              </div>
            ) : (
              <div
                style={{
                  color: "var(--sil)",
                  fontSize: 12,
                  padding: "8px 0",
                }}
              >
                No folder assigned — manual routing required.
              </div>
            )}
          </Card>
        </div>

        {/* ── Quality / Completeness panel ── */}
        <QualityPanel quality={quality} allMandatory={mandatoryFields} />

        {/* ── Duplicates ── */}
        <DuplicatesPanel
          duplicates={result.duplicates ?? []}
          autoVersioned={result.autoVersioned ?? false}
        />

        {/* ── Suggested new type ── */}
        {suggestedNewType && (
          <Card title="Suggested New Document Type">
            <div
              style={{
                background: "rgba(184,145,42,.06)",
                border: "1px solid rgba(184,145,42,.2)",
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--gold3)",
                  marginBottom: 4,
                }}
              >
                Suggested: <em>{suggestedNewType.proposedName}</em>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--sil)",
                  marginBottom: 8,
                }}
              >
                {suggestedNewType.reason}
              </div>
              {suggestedNewType.sampleFields.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    flexWrap: "wrap",
                  }}
                >
                  {suggestedNewType.sampleFields.map((f) => (
                    <Tag key={f} variant="blue">
                      {f}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ── Raw extracted metadata ── */}
        <RawMetadataPanel rawMetadata={result.rawMetadata} />

        {/* ── Save corrections button ── */}
        {saveError && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              background: "rgba(255,80,80,.07)",
              border: "1px solid rgba(255,80,80,.3)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--R)",
            }}
          >
            Save failed: {saveError}
          </div>
        )}

        <button
          type="button"
          aria-label="Save corrections"
          disabled={saving}
          onClick={handleSave}
          style={{
            width: "100%",
            padding: "12px 0",
            background: saving
              ? "rgba(184,145,42,.3)"
              : "linear-gradient(135deg,#b8912a,#f0c84a)",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor: saving ? "not-allowed" : "pointer",
            color: "#050d1a",
            boxShadow: saving ? "none" : "0 4px 14px rgba(184,145,42,.3)",
          }}
        >
          {saving ? "Saving…" : "Save corrections"}
        </button>
      </div>

      {/* Full-screen preview modal */}
      {previewFile && (
        <FullScreenPreview
          file={previewFile}
          open={showFullScreen}
          onClose={() => setShowFullScreen(false)}
        />
      )}
    </div>
  );
}
