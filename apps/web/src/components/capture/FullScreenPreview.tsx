/**
 * FullScreenPreview — full-screen overlay modal for viewing a captured file.
 * Renders image (img), PDF (iframe), or fallback for other types.
 * Uses URL.createObjectURL + revokes on unmount.
 */
import { useState, useEffect } from "react";

export interface FullScreenPreviewProps {
  file: File | null;
  open: boolean;
  onClose: () => void;
}

export function FullScreenPreview({ file, open, onClose }: FullScreenPreviewProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);

  useEffect(() => {
    if (!file || !open) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    setZoom(1);
    setRotate(0);
    return () => { URL.revokeObjectURL(url); setObjectUrl(null); };
  }, [file, open]);

  if (!open || !file) return null;

  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full screen file preview"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        background: "rgba(0,0,0,0.88)",
        display: "flex",
        flexDirection: "column",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Header / toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          background: "rgba(5,13,26,.9)",
          borderBottom: "1px solid rgba(255,255,255,.1)",
          flexShrink: 0,
        }}
      >
        <span style={{ flex: 1, fontSize: 13, color: "rgba(255,255,255,.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file.name}
        </span>
        {/* Zoom controls — only for image/pdf */}
        {(isImage || isPdf) && (
          <>
            <button
              type="button"
              aria-label="Zoom out full screen"
              onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
              style={toolStyle}
            >−</button>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,.7)", minWidth: 36, textAlign: "center" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in full screen"
              onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
              style={toolStyle}
            >+</button>
            <button
              type="button"
              aria-label="Rotate full screen"
              onClick={() => setRotate((r) => (r + 90) % 360)}
              style={toolStyle}
            >↻</button>
            <button
              type="button"
              aria-label="Reset full screen view"
              onClick={() => { setZoom(1); setRotate(0); }}
              style={{ ...toolStyle, fontSize: 10 }}
            >Reset</button>
          </>
        )}
        <button
          type="button"
          aria-label="Close full screen preview"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,.8)",
            fontSize: 26,
            lineHeight: 1,
            cursor: "pointer",
            padding: "0 4px",
            marginLeft: 4,
          }}
        >×</button>
      </div>

      {/* Preview body */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
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
              width: "min(900px, 90vw)",
              height: "calc(100vh - 120px)",
              border: "none",
              transform: `scale(${zoom}) rotate(${rotate}deg)`,
              transformOrigin: "top center",
            }}
          />
        )}
        {!isImage && !isPdf && (
          <div
            style={{
              textAlign: "center",
              color: "rgba(255,255,255,.5)",
              fontSize: 14,
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <div style={{ marginTop: 12 }}>Preview not available for this file type</div>
            <div style={{ fontSize: 12, marginTop: 6, opacity: .7 }}>{file.name}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const toolStyle: React.CSSProperties = {
  padding: "4px 9px",
  background: "rgba(255,255,255,.1)",
  border: "1px solid rgba(255,255,255,.2)",
  borderRadius: 5,
  fontSize: 14,
  color: "rgba(255,255,255,.85)",
  cursor: "pointer",
  lineHeight: 1,
};
