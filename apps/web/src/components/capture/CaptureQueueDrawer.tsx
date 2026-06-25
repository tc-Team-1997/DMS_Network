/**
 * CaptureQueueDrawer — right-side drawer showing capture queue items.
 * Opened via the FAB (floating action button) using uiStore.captureDrawerOpen.
 * Each item is clickable to view its preview and extraction details.
 */
import { Tag } from "../ui/index.js";
import { FilePreview } from "./FilePreview.js";
import { ExtractionResult } from "./ExtractionResult.js";
import type { CaptureQueueEntry } from "../../pages/Capture.js";

export interface CaptureQueueDrawerProps {
  open: boolean;
  onClose: () => void;
  queue: CaptureQueueEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_TAG: Record<
  CaptureQueueEntry["status"],
  { label: string; variant: "green" | "amber" | "blue" | "red" | "gold" }
> = {
  ready: { label: "Ready", variant: "gold" },
  uploading: { label: "Uploading…", variant: "amber" },
  extracting: { label: "Extracting…", variant: "blue" },
  done: { label: "Captured", variant: "green" },
  error: { label: "Error", variant: "red" },
};

export function CaptureQueueDrawer({
  open,
  onClose,
  queue,
  selectedId,
  onSelect,
}: CaptureQueueDrawerProps) {
  const selected = queue.find((q) => q.id === selectedId) ?? null;

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(5,13,26,.45)",
            zIndex: 200,
          }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <div
        aria-label="Capture queue drawer"
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          background: "var(--ink1)",
          borderLeft: "1px solid var(--bd)",
          zIndex: 201,
          display: "flex",
          flexDirection: "column",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform .28s cubic-bezier(.4,0,.2,1)",
          boxShadow: open ? "-8px 0 32px rgba(0,0,0,.4)" : "none",
        }}
      >
        {/* Drawer header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--bd)",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--gold3)" }}>
              Capture Queue
            </h3>
            <div style={{ fontSize: 11, color: "var(--sil)", marginTop: 2 }}>
              {queue.length} item{queue.length !== 1 ? "s" : ""}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close drawer"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--sil)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Content area */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Queue list (left column) */}
          <div
            style={{
              width: selected ? 200 : "100%",
              borderRight: selected ? "1px solid var(--bd)" : "none",
              overflowY: "auto",
              transition: "width .2s",
            }}
          >
            {queue.length === 0 ? (
              <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--sil)", fontSize: 12 }}>
                No captures yet.
              </div>
            ) : (
              queue.map((item) => {
                const s = STATUS_TAG[item.status];
                const isSelected = item.id === selectedId;
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Queue item: ${item.title}`}
                    onClick={() => onSelect(item.id)}
                    onKeyDown={(e) => e.key === "Enter" && onSelect(item.id)}
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--bd)",
                      cursor: "pointer",
                      background: isSelected ? "rgba(184,145,42,.08)" : "transparent",
                      borderLeft: isSelected ? "3px solid var(--gold3)" : "3px solid transparent",
                      transition: "background .15s",
                    }}
                  >
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
                      {item.title}
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
                      <span>{item.channel}</span>
                      <Tag variant={s.variant} style={{ fontSize: 9 }}>
                        {s.label}
                      </Tag>
                    </div>
                    {item.confidence != null && (
                      <div style={{ fontSize: 10, color: "var(--gold)", marginTop: 2 }}>
                        AI: {Math.round(item.confidence * 100)}%
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Item detail (right column — only when selected) */}
          {selected && (
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {/* File preview */}
              {selected.frontFile && (
                <div>
                  <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 4, textTransform: "uppercase" }}>
                    Front Side
                  </div>
                  <FilePreview file={selected.frontFile} />
                </div>
              )}
              {selected.backFile && (
                <div>
                  <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 4, textTransform: "uppercase" }}>
                    Back Side
                  </div>
                  <FilePreview file={selected.backFile} />
                </div>
              )}

              {/* Extraction result */}
              {selected.extraction && (
                <ExtractionResult result={selected.extraction} />
              )}

              {/* Error */}
              {selected.status === "error" && selected.errorMsg && (
                <div
                  style={{
                    background: "rgba(255,80,80,.07)",
                    border: "1px solid rgba(255,80,80,.3)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontSize: 12,
                    color: "var(--R)",
                  }}
                >
                  {selected.errorMsg}
                </div>
              )}

              {/* Processing state */}
              {(selected.status === "uploading" || selected.status === "extracting") && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "var(--ink3)",
                    borderRadius: 8,
                    padding: "12px 14px",
                    fontSize: 12,
                    color: "var(--sil)",
                  }}
                >
                  <span style={{ fontSize: 16, animation: "spin 1s linear infinite" }}>⟳</span>
                  {selected.status === "uploading" ? "Uploading…" : "AI extraction in progress…"}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
