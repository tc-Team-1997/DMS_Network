/**
 * FilePreview — real-time preview for captured image/PDF files.
 * Provides zoom, rotate, and resize controls.
 */
import { useState, useEffect } from "react";

export interface FilePreviewProps {
  file: File;
  "data-testid"?: string;
}

export function FilePreview({ file, "data-testid": testId }: FilePreviewProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";

  return (
    <div
      data-testid={testId}
      style={{
        background: "var(--ink3)",
        borderRadius: 10,
        border: "1px solid var(--bd)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--bd)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--sil)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file.name}
        </span>
        <span style={{ fontSize: 10, color: "var(--sil)" }}>
          {(file.size / 1024).toFixed(0)} KB
        </span>
        {/* Zoom controls */}
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
          style={toolBtnStyle}
          title="Zoom out"
        >
          −
        </button>
        <span style={{ fontSize: 10, color: "var(--mist)", minWidth: 34, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
          style={toolBtnStyle}
          title="Zoom in"
        >
          +
        </button>
        {/* Rotate */}
        <button
          type="button"
          aria-label="Rotate clockwise"
          onClick={() => setRotate((r) => (r + 90) % 360)}
          style={toolBtnStyle}
          title="Rotate 90°"
        >
          ↻
        </button>
        {/* Reset */}
        <button
          type="button"
          aria-label="Reset view"
          onClick={() => { setZoom(1); setRotate(0); }}
          style={{ ...toolBtnStyle, fontSize: 9 }}
          title="Reset"
        >
          Reset
        </button>
      </div>

      {/* Preview area */}
      <div
        style={{
          flex: 1,
          minHeight: 200,
          maxHeight: 360,
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 12,
          background: "#0a1020",
        }}
      >
        {objectUrl && isImage && (
          <img
            src={objectUrl}
            alt={file.name}
            style={{
              transform: `scale(${zoom}) rotate(${rotate}deg)`,
              transformOrigin: "center",
              maxWidth: `${100 / zoom}%`,
              maxHeight: "100%",
              transition: "transform .2s",
              borderRadius: 4,
            }}
          />
        )}
        {objectUrl && isPdf && (
          <iframe
            src={`${objectUrl}#toolbar=0`}
            title={file.name}
            style={{
              width: "100%",
              height: 320,
              border: "none",
              transform: `scale(${zoom}) rotate(${rotate}deg)`,
              transformOrigin: "top left",
            }}
          />
        )}
        {!isImage && !isPdf && (
          <div style={{ textAlign: "center", color: "var(--sil)", fontSize: 12 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--sil)" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <div style={{ marginTop: 8 }}>{file.name}</div>
            <div style={{ fontSize: 10, marginTop: 4 }}>{file.type || "Unknown type"}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const toolBtnStyle: React.CSSProperties = {
  padding: "3px 8px",
  background: "var(--ink2)",
  border: "1px solid var(--bd)",
  borderRadius: 5,
  fontSize: 13,
  color: "var(--mist)",
  cursor: "pointer",
  lineHeight: 1,
};
