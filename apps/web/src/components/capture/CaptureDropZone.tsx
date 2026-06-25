/**
 * CaptureDropZone — single drag-and-drop / file-pick slot.
 * Used for Front Side and Back Side in Scanner/File Upload tabs.
 */
import { useRef, useState, type DragEvent } from "react";

export interface CaptureDropZoneProps {
  label: string;
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  "data-testid"?: string;
}

export function CaptureDropZone({
  label,
  accept = ".pdf,.tiff,.tif,.jpeg,.jpg,.png,.docx",
  multiple = false,
  onFiles,
  "data-testid": testId,
}: CaptureDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(multiple ? files : [files[0]]);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      onFiles(Array.from(e.target.files));
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label} — click or drag to select`}
      data-testid={testId}
      style={{
        border: `2px dashed ${dragging ? "var(--gold2)" : "rgba(184,145,42,.3)"}`,
        borderRadius: 10,
        padding: "28px 16px",
        textAlign: "center",
        cursor: "pointer",
        background: dragging ? "rgba(184,145,42,.06)" : "rgba(184,145,42,.02)",
        transition: "border-color .2s, background .2s",
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--gold)"
        strokeWidth="1.5"
        style={{ opacity: 0.7 }}
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mist)" }}>{label}</div>
      <div style={{ fontSize: 10, color: "var(--sil)" }}>
        {dragging ? "Release to capture" : "Drop or click · PDF, TIFF, JPEG, PNG, DOCX · Max 50 MB"}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: "none" }}
        onChange={handleChange}
        aria-label={`${label} file input`}
      />
    </div>
  );
}
