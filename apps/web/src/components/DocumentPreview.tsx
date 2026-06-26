/**
 * DocumentPreview — renders a stored document's actual content.
 *
 * The raw-file endpoint is auth-gated, and <img>/<iframe> can't send an
 * Authorization header, so we fetch the bytes with the token and render a
 * same-origin blob: URL. PDFs render in an <iframe>, images in an <img>, and
 * anything else falls back to a typed placeholder with a download affordance.
 */
import { useEffect, useRef, useState } from "react";
import { FileText, Download as DownloadIcon } from "lucide-react";
import { repositoryViewerApi } from "../api/repositoryViewerApi.js";

export interface DocumentPreviewProps {
  docId: string;
  mimeType?: string | null;
  fileName?: string | null;
  /** Height of the preview surface (px). */
  height?: number;
  /** Compact mode for list/side panels (smaller fallback). */
  compact?: boolean;
}

export function DocumentPreview({ docId, mimeType, fileName, height = 460, compact }: DocumentPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [mime, setMime] = useState<string>(mimeType ?? "");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errStatus, setErrStatus] = useState<number | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrStatus(null);
    // Revoke any previous object URL before fetching a new one.
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    setUrl(null);

    // Guard for environments/mocks where the fetch helper isn't available.
    if (typeof repositoryViewerApi.fetchFileObjectUrl !== "function") {
      setStatus("error");
      return () => { cancelled = true; };
    }

    repositoryViewerApi
      .fetchFileObjectUrl(docId)
      .then(({ url: objUrl, mime: m }) => {
        if (cancelled) { URL.revokeObjectURL(objUrl); return; }
        urlRef.current = objUrl;
        setUrl(objUrl);
        setMime(m || mimeType || "");
        setStatus("ready");
      })
      .catch((e: { status?: number }) => {
        if (cancelled) return;
        setErrStatus(e?.status ?? null);
        setStatus("error");
      });

    return () => {
      cancelled = true;
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
  }, [docId, mimeType]);

  const isPdf = /pdf/i.test(mime);
  const isImage = /^image\//i.test(mime);

  const surface = (children: React.ReactNode) => (
    <div
      style={{
        height,
        borderRadius: 8,
        border: "1px solid var(--bd)",
        background: "var(--ink3)",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );

  if (status === "loading") {
    return surface(<div style={{ color: "var(--sil)", fontSize: 12 }}>Loading preview…</div>);
  }

  if (status === "error") {
    const msg =
      errStatus === 403 ? "You don't have permission to preview this document."
      : errStatus === 404 ? "The document file is unavailable."
      : "Preview could not be loaded.";
    return surface(
      <div style={{ textAlign: "center", color: "var(--sil)", fontSize: 12, padding: 16 }}>
        <FileText size={compact ? 24 : 32} style={{ opacity: 0.5, marginBottom: 8 }} />
        <div>{msg}</div>
      </div>,
    );
  }

  if (url && isImage) {
    return surface(
      <img
        src={url}
        alt={fileName ?? "document"}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />,
    );
  }

  if (url && isPdf) {
    return (
      <iframe
        title={fileName ?? "document"}
        src={`${url}#toolbar=1&navpanes=0`}
        style={{ width: "100%", height, border: "1px solid var(--bd)", borderRadius: 8, background: "#fff" }}
      />
    );
  }

  // Unknown / non-previewable type → typed placeholder with a download link.
  return surface(
    <div style={{ textAlign: "center", color: "var(--sil)", fontSize: 12, padding: 16 }}>
      <FileText size={compact ? 24 : 36} style={{ opacity: 0.6, marginBottom: 10 }} />
      <div style={{ marginBottom: 4, color: "var(--mist)", fontWeight: 600 }}>{fileName ?? "Document"}</div>
      <div style={{ marginBottom: 12 }}>{mime || "Unknown type"} — preview not available</div>
      {url && (
        <a
          href={url}
          download={fileName ?? "document"}
          className="btn bs"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11 }}
        >
          <DownloadIcon size={13} /> Download
        </a>
      )}
    </div>,
  );
}
