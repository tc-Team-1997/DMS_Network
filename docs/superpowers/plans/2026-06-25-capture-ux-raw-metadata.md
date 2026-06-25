# Capture UX + Raw Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the Proceed button on file selection, add a full-screen preview modal, show raw extracted metadata JSON in the result drawer, and preserve the complete raw AI extraction on the backend.

**Architecture:** Four independent deliverables — two frontend (Capture.tsx button gate + FullScreenPreview.tsx modal), one UI-only backend extension (raw JSON in ExtractionResultDrawer), and one pure backend change (raw metadata preservation in extraction.ts + documents.ts PATCH). They share only the `rawMetadata` field flowing from backend → captureApi.ts → ExtractionResultDrawer.

**Tech Stack:** React 18 + Vitest + @testing-library/react (frontend); Express + Knex + Vitest + Supertest (backend); TypeScript throughout; pnpm workspaces.

## Global Constraints

- Base dir: `/Users/amitkatoch/Documents/DMS_Network`, branch `amit_local`. No git commits.
- Test suites: `pnpm --filter @zordms/web test` and `pnpm --filter @zordms/core test` must stay green.
- Build: `pnpm -r build` must pass clean.
- Reuse existing: SVC config (`apps/web/src/config.ts`), shared ui components from `../ui/index.js`, existing `captureApi.ts`, existing `FilePreview.tsx` (already has zoom/rotate + isPdf iframe branch).
- No new npm packages — use what is already in each package.json.
- No `.md` documentation files unless this plan file itself.
- All file paths absolute when running commands.

---

### Task 1: Gate the Proceed button — always rendered, disabled when no file

**Files:**
- Modify: `apps/web/src/pages/Capture.tsx` (lines 793–815 — the Proceed button section)
- Modify: `apps/web/src/pages/Capture.test.tsx` (add two assertions)

**Interfaces:**
- Consumes: existing `hasFile` boolean computed at line 513 of Capture.tsx
- Produces: a `<button disabled={!hasFile}>` that is always in the DOM (not conditionally rendered), so tests can `getByRole('button', { name: /Proceed/i })` unconditionally

**Why this matters:** Currently the button is conditionally rendered (`{hasFile && !processing && ...}`). The spec says it must be *disabled* (not hidden) so a test can assert `.toBeDisabled()` before selection. We keep the `!processing` guard but change `!hasFile` to make the button disabled rather than absent.

- [ ] **Step 1: Read the current Proceed button block (Capture.tsx lines 793–815) to confirm exact JSX**

```
Read /Users/amitkatoch/Documents/DMS_Network/apps/web/src/pages/Capture.tsx lines 793–830
```

- [ ] **Step 2: Replace the conditional render with an always-rendered disabled button**

Find:
```tsx
      {/* ── Proceed Button ── */}
      {hasFile && !processing && (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            aria-label="Proceed to upload and extract"
            onClick={openProceedModal}
            style={{
              padding: "11px 28px",
              background: "linear-gradient(135deg,#b8912a,#f0c84a)",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              color: "#050d1a",
              boxShadow: "0 4px 16px rgba(184,145,42,.3)",
            }}
          >
            ▶ Proceed
          </button>
        </div>
      )}
```

Replace with:
```tsx
      {/* ── Proceed Button — always rendered; disabled until file selected or while processing ── */}
      {!processing && (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            aria-label="Proceed to upload and extract"
            disabled={!hasFile}
            onClick={hasFile ? openProceedModal : undefined}
            style={{
              padding: "11px 28px",
              background: hasFile
                ? "linear-gradient(135deg,#b8912a,#f0c84a)"
                : "rgba(184,145,42,.25)",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: hasFile ? "pointer" : "not-allowed",
              color: hasFile ? "#050d1a" : "rgba(5,13,26,.4)",
              boxShadow: hasFile ? "0 4px 16px rgba(184,145,42,.3)" : "none",
              opacity: hasFile ? 1 : 0.5,
            }}
          >
            ▶ Proceed
          </button>
        </div>
      )}
```

- [ ] **Step 3: Write failing tests in Capture.test.tsx**

Add these two tests inside the existing `describe("Capture screen — enterprise rebuild", ...)` block, after the existing `"Proceed button does NOT appear when no file selected"` test (around line 465). Delete or update the old test that expects the button to NOT be in the DOM — it now IS in the DOM but disabled:

```tsx
  it("Proceed button is in the DOM but DISABLED before any file is selected", () => {
    renderWithRouter(<Capture />);
    const btn = screen.getByRole("button", { name: /Proceed to upload and extract/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("Proceed button is ENABLED after front file is selected on File Upload tab", async () => {
    renderWithRouter(<Capture />);
    // Initially disabled
    const btn = screen.getByRole("button", { name: /Proceed to upload and extract/i });
    expect(btn).toBeDisabled();
    // Select a file
    const frontInput = screen.getByLabelText(/Front Side.*file input/i);
    Object.defineProperty(frontInput, "files", { value: [mockFile("cid.pdf")], configurable: true });
    fireEvent.change(frontInput);
    // Now enabled
    await waitFor(() => expect(screen.getByRole("button", { name: /Proceed to upload and extract/i })).not.toBeDisabled());
  });
```

Also update the existing test `"Proceed button does NOT appear when no file selected"` to match the new behavior (button is in DOM but disabled):

```tsx
  it("Proceed button is visible but disabled when no file selected", () => {
    renderWithRouter(<Capture />);
    const btn = screen.getByRole("button", { name: /Proceed to upload and extract/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });
```

- [ ] **Step 4: Run the web tests to see the two new tests fail (and old test fail if not updated)**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/web test -- --reporter=verbose 2>&1 | tail -40
```

Expected: new tests FAIL because button isn't in DOM yet (before the code change).

- [ ] **Step 5: Apply code change to Capture.tsx (Step 2 above)**

Use the Edit tool to make the replacement described in Step 2.

- [ ] **Step 6: Also update the old test "Proceed button does NOT appear when no file selected"**

The old test at ~line 460 expects `.not.toBeInTheDocument()`. Replace it with the new text from Step 3 (the first block).

- [ ] **Step 7: Run tests and confirm they pass**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/web test 2>&1 | tail -20
```

Expected: PASS — all existing tests + 2 new ones.

---

### Task 2: FullScreenPreview.tsx — full-screen overlay modal

**Files:**
- Create: `apps/web/src/components/capture/FullScreenPreview.tsx`
- Modify: `apps/web/src/components/capture/FilePreview.tsx` (add "Full screen" button to toolbar)
- Modify: `apps/web/src/components/capture/ExtractionResultDrawer.tsx` (add "Open full preview" affordance)
- Create: `apps/web/src/components/capture/FullScreenPreview.test.tsx`

**Interfaces:**
- Produces: `export function FullScreenPreview({ file, open, onClose }: FullScreenPreviewProps): JSX.Element`
  - `file: File` — the file to preview
  - `open: boolean` — whether the modal is shown
  - `onClose: () => void` — called when X is clicked or backdrop clicked
- FilePreview adds: `onFullScreen?: () => void` prop. If provided, renders a "Full screen" button in the toolbar that calls `onFullScreen()`.
- ExtractionResultDrawer: the file comes from `CaptureQueueEntry`'s `frontFile` — but the drawer doesn't have direct access. Since ExtractionResultDrawer receives `result: ExtractionResult` only, the "Open full preview" in the drawer must be wired from CaptureQueueDrawer which has `selected.frontFile`. Add an optional `previewFile?: File | null` prop to `ExtractionResultDrawer`.

**Implementation details:**
- `FullScreenPreview` uses `URL.createObjectURL(file)` in a `useEffect`, stores it in `objectUrl` state, and calls `URL.revokeObjectURL` on unmount.
- Image branch: `file.type.startsWith("image/")` → `<img>` with zoom + rotate controls (same as FilePreview toolbar pattern).
- PDF branch: `file.type === "application/pdf"` → `<iframe src={objectUrl}#toolbar=0>` (same as FilePreview).
- Otherwise: graceful fallback `<div>Preview not available for {file.name}</div>`.
- Overlay: `position: fixed; inset: 0; z-index: 500; background: rgba(0,0,0,0.85)`.
- Close X button: `aria-label="Close full screen preview"`, top-right, white ×.

- [ ] **Step 1: Create FullScreenPreview.tsx**

```tsx
// apps/web/src/components/capture/FullScreenPreview.tsx
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
```

- [ ] **Step 2: Add "Full screen" button to FilePreview.tsx toolbar**

In `apps/web/src/components/capture/FilePreview.tsx`, add optional `onFullScreen` prop and a "⤢ Full screen" button to the toolbar after the existing Reset button.

Add to the `FilePreviewProps` interface:
```tsx
  onFullScreen?: () => void;
```

Add to the destructure:
```tsx
export function FilePreview({ file, "data-testid": testId, onFullScreen }: FilePreviewProps) {
```

Add after the Reset button in the toolbar (after the existing `{/* Reset */}` button):
```tsx
        {/* Full screen */}
        {onFullScreen && (
          <button
            type="button"
            aria-label="Open full screen preview"
            onClick={onFullScreen}
            style={{ ...toolBtnStyle, fontSize: 11 }}
            title="Full screen"
          >
            ⤢
          </button>
        )}
```

- [ ] **Step 3: Wire FullScreenPreview in CaptureQueueDrawer**

In `apps/web/src/components/capture/CaptureQueueDrawer.tsx`:

1. Import `FullScreenPreview`:
   ```tsx
   import { FullScreenPreview } from "./FullScreenPreview.js";
   ```

2. Add local state inside `CaptureQueueDrawer`:
   ```tsx
   const [fullScreenFile, setFullScreenFile] = useState<File | null>(null);
   ```
   (Add `useState` import from `react` if not already there.)

3. Pass `onFullScreen` to each `<FilePreview>` in the file preview row:
   ```tsx
   <FilePreview
     file={selected.frontFile}
     onFullScreen={() => setFullScreenFile(selected.frontFile)}
   />
   // and for backFile:
   <FilePreview
     file={selected.backFile}
     onFullScreen={() => setFullScreenFile(selected.backFile)}
   />
   ```

4. Render the modal at the end (just before the closing `</>` of the return):
   ```tsx
   <FullScreenPreview
     file={fullScreenFile}
     open={fullScreenFile !== null}
     onClose={() => setFullScreenFile(null)}
   />
   ```

- [ ] **Step 4: Add "Open full preview" affordance in ExtractionResultDrawer**

The drawer receives `result: ExtractionResult` but not the file. To wire file preview from the drawer, add an optional `previewFile?: File | null` prop:

In `ExtractionResultDrawer.tsx` interface:
```tsx
interface ExtractionResultDrawerProps {
  docId: number;
  result: ExtractionResult;
  onClose: () => void;
  previewFile?: File | null; // optional — front file for full-screen preview
}
```

Destructure it:
```tsx
export function ExtractionResultDrawer({ docId, result, onClose, previewFile }: ExtractionResultDrawerProps) {
```

Import FullScreenPreview at the top:
```tsx
import { FullScreenPreview } from "./FullScreenPreview.js";
```

Add state inside the component:
```tsx
const [showFullScreen, setShowFullScreen] = useState(false);
```

In the "AI Analysis Summary" card (after the confidence % display), add a button if previewFile is present:
```tsx
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
```

Add FullScreenPreview modal at the end of the component's return (after `</div>` closing the scrollable body but inside the outer div):
```tsx
      {previewFile && (
        <FullScreenPreview
          file={previewFile}
          open={showFullScreen}
          onClose={() => setShowFullScreen(false)}
        />
      )}
```

In `CaptureQueueDrawer.tsx`, pass `previewFile` to `ExtractionResultDrawer`:
```tsx
<ExtractionResultDrawer
  docId={selected.docId}
  result={selected.extraction}
  onClose={() => onSelect(selected.id)}
  previewFile={selected.frontFile ?? null}
/>
```

- [ ] **Step 5: Write FullScreenPreview.test.tsx**

```tsx
// apps/web/src/components/capture/FullScreenPreview.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FullScreenPreview } from "./FullScreenPreview.js";

if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  globalThis.URL.revokeObjectURL = vi.fn();
}

function mockFile(name: string, type: string) {
  return new File(["x"], name, { type });
}

describe("FullScreenPreview", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders nothing when open=false", () => {
    render(
      <FullScreenPreview
        file={mockFile("test.png", "image/png")}
        open={false}
        onClose={() => {}}
      />
    );
    expect(screen.queryByRole("dialog", { name: /Full screen file preview/i })).not.toBeInTheDocument();
  });

  it("renders the dialog when open=true", () => {
    render(
      <FullScreenPreview
        file={mockFile("test.png", "image/png")}
        open={true}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole("dialog", { name: /Full screen file preview/i })).toBeInTheDocument();
  });

  it("shows the filename in the header", () => {
    render(
      <FullScreenPreview
        file={mockFile("passport.pdf", "application/pdf")}
        open={true}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("passport.pdf")).toBeInTheDocument();
  });

  it("renders an img tag for image files", () => {
    render(
      <FullScreenPreview
        file={mockFile("scan.jpg", "image/jpeg")}
        open={true}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole("img", { name: "scan.jpg" })).toBeInTheDocument();
  });

  it("renders an iframe for PDF files", () => {
    render(
      <FullScreenPreview
        file={mockFile("doc.pdf", "application/pdf")}
        open={true}
        onClose={() => {}}
      />
    );
    expect(document.querySelector("iframe")).toBeTruthy();
  });

  it("shows fallback message for unsupported file types", () => {
    render(
      <FullScreenPreview
        file={mockFile("data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        open={true}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/Preview not available for this file type/i)).toBeInTheDocument();
    expect(screen.getByText("data.xlsx")).toBeInTheDocument();
  });

  it("calls onClose when the X button is clicked", () => {
    const onClose = vi.fn();
    render(
      <FullScreenPreview
        file={mockFile("test.png", "image/png")}
        open={true}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Close full screen preview/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has zoom in/out and rotate buttons for image files", () => {
    render(
      <FullScreenPreview
        file={mockFile("img.png", "image/png")}
        open={true}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /Zoom in full screen/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Zoom out full screen/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rotate full screen/i })).toBeInTheDocument();
  });

  it("does NOT show zoom/rotate controls for unsupported file types", () => {
    render(
      <FullScreenPreview
        file={mockFile("file.doc", "application/msword")}
        open={true}
        onClose={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /Zoom in full screen/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run web tests**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/web test 2>&1 | tail -30
```

Expected: PASS — all tests including new FullScreenPreview tests.

---

### Task 3: Raw metadata JSON section in ExtractionResultDrawer

**Files:**
- Modify: `apps/web/src/api/captureApi.ts` (add `rawMetadata` to `ExtractionResult`)
- Modify: `apps/web/src/components/capture/ExtractionResultDrawer.tsx` (add collapsible raw JSON section)
- Modify: `apps/web/src/pages/Capture.test.tsx` (add rawMetadata render test)

**Interfaces:**
- Consumes: `result.rawMetadata: Record<string, unknown> | null` (new field, added in Task 4)
- Produces: a collapsible `<details><summary>Raw extracted metadata (JSON)</summary><pre>...</pre></details>` section in the drawer

**Note:** Task 3 can be implemented before Task 4 (backend). The frontend just reads `result.rawMetadata` — it will be `undefined` until the backend ships it, which is fine (show "No raw metadata captured." in that case).

- [ ] **Step 1: Add rawMetadata to ExtractionResult type in captureApi.ts**

In `apps/web/src/api/captureApi.ts`, find the `ExtractionResult` interface and add:

```tsx
export interface ExtractionResult {
  document: UploadedDocument;
  classification: ExtractionClassification;
  mappedFields: ExtractionMappedFields;
  catalog: ExtractionCatalog;
  folder: ExtractionFolder | null;
  suggestedNewType: SuggestedNewType | null;
  source: "ai" | "ocr-fallback";
  quality?: ExtractionQuality;
  duplicates?: ExtractionDuplicate[];
  autoVersioned?: boolean;
  /** Full raw AI extraction object — ALL keys, even those not in the schema */
  rawMetadata?: Record<string, unknown> | null;
}
```

- [ ] **Step 2: Add collapsible Raw Metadata section in ExtractionResultDrawer.tsx**

Inside the scrollable body `<div>`, after the `QualityPanel` and before the `DuplicatesPanel`, add a new `RawMetadataPanel` sub-component. Add it just before the `{/* ── Save corrections button ── */}` comment:

First, add a `RawMetadataPanel` sub-component at the top of the file (after the `DuplicatesPanel` component definition):

```tsx
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
```

Then add it inside the scrollable body, before the Save button:
```tsx
        {/* ── Raw extracted metadata ── */}
        <RawMetadataPanel rawMetadata={result.rawMetadata} />
```

- [ ] **Step 3: Write failing test in Capture.test.tsx for rawMetadata**

Add this test inside the existing `describe` block in `apps/web/src/pages/Capture.test.tsx`. Also update `MOCK_EXTRACTION_RESPONSE` to include `rawMetadata`:

At the top where `MOCK_EXTRACTION_RESPONSE` is defined (~line 118), add `rawMetadata` to it:
```tsx
const MOCK_EXTRACTION_RESPONSE = {
  // ... existing fields ...
  rawMetadata: {
    cid_no: "11504000231",
    full_name: "Dorji Wangchuk",
    dob: "1985-03-12",
    unmapped_custom_key: "some_value_not_in_schema",
    ai_internal_score: 0.97,
  },
};
```

Add the test:
```tsx
  it("raw metadata section is visible in result drawer and shows JSON when toggled", async () => {
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    // The toggle button should be present
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Toggle raw extracted metadata/i })
      ).toBeInTheDocument()
    );
    // Click to expand
    fireEvent.click(
      screen.getByRole("button", { name: /Toggle raw extracted metadata/i })
    );
    // The raw JSON should be visible (including unmapped key)
    await waitFor(() =>
      expect(
        screen.getByLabelText("raw metadata json")
      ).toBeInTheDocument()
    );
    expect(screen.getByLabelText("raw metadata json").textContent).toContain(
      "unmapped_custom_key"
    );
  });

  it("raw metadata section shows fallback text when rawMetadata is null", async () => {
    mockExtractDocument.mockResolvedValueOnce({
      ...MOCK_EXTRACTION_RESPONSE,
      rawMetadata: null,
    });
    renderWithRouter(<Capture />);
    await doFullProceed();
    await waitFor(() =>
      screen.getByRole("dialog", { name: /Capture queue drawer/i })
    );
    await waitFor(() =>
      screen.getByRole("button", { name: /Toggle raw extracted metadata/i })
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Toggle raw extracted metadata/i })
    );
    await waitFor(() =>
      expect(
        screen.getByText(/No raw metadata captured/i)
      ).toBeInTheDocument()
    );
  });
```

- [ ] **Step 4: Run web tests**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/web test 2>&1 | tail -30
```

Expected: PASS — new tests pass (rawMetadata in mock response → JSON renders).

---

### Task 4: Preserve ALL extracted metadata on the backend

**Files:**
- Modify: `services/core/src/routes/extraction.ts` (persist raw extraction + return rawMetadata)
- Modify: `services/core/src/routes/documents.ts` (PATCH must preserve raw keys)
- Modify: `services/core/src/routes/extraction.test.ts` (add rawMetadata tests)
- Modify: `services/core/src/routes/documents.test.ts` (add PATCH raw keys test)

**Interfaces:**
- `rawMetadata` stored in the `metadata` column as JSON under a sentinel key: `{ __raw: {...rawExtraction}, ...mappedFields }`. This avoids a schema migration while still storing everything.

  Actually — cleaner approach: store `raw_metadata` as a separate JSON column. But since that requires a migration (and the task says "store the union: all raw keys PLUS the mapped values"), the simplest zero-migration approach is to store in `metadata` as `JSON.stringify({ ...rawData, ...mapped.metadata })` (union, raw wins on conflict for unknown keys, mapped values take precedence for known keys).

  The return shape must include `rawMetadata: Record<string, unknown>` = the full raw `extractResult.data` object (all keys from AI, before mapping).

- Extraction response adds: `rawMetadata: extractResult.data ?? {}` — the complete raw extraction object.
- PATCH: when merging corrections, read existing `metadata` from DB, then merge as `{ ...existingMeta, ...body.metadata }`. Since we stored raw keys in metadata from extraction, they survive the merge automatically (as long as we keep the merge, which already exists).

**Design decision on persistence:**
- Today: `metadata: JSON.stringify(mapped.metadata)` — only mapped keys.
- After: `metadata: JSON.stringify({ ...extractResult.data, ...mapped.metadata })` — union of all raw keys + the mapped result. Mapped values take precedence over raw for the same key.
- `rawMetadata` in the response is always `extractResult.data ?? {}` (the pre-mapping full object).
- PATCH: `mergedMeta = { ...existingMeta, ...body.metadata }` — already preserves raw keys since existingMeta contains them.

- [ ] **Step 1: Write failing tests in extraction.test.ts**

Add these tests at the end of the `describe("POST /documents/:id/extract", ...)` block:

```ts
  it("returns rawMetadata with ALL keys including unmapped ones", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.97 });
    mockExtract.mockResolvedValue({
      data: {
        cid_no: "11504000231",
        full_name: "Dorji Wangchuk",
        dob: "1985-03-12",
        expiry_date: "2030-01-01",
        // unmapped keys — these are the ones being tested
        ai_internal_score: 0.97,
        raw_ocr_text: "Some OCR text the model saw",
        unusual_field_xyz: "value that has no schema mapping",
      },
      partial: false,
      errors: [],
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // rawMetadata must be present in response
    expect(res.body).toHaveProperty("rawMetadata");
    const raw = res.body.rawMetadata as Record<string, unknown>;
    // All unmapped keys preserved
    expect(raw).toHaveProperty("ai_internal_score", 0.97);
    expect(raw).toHaveProperty("raw_ocr_text", "Some OCR text the model saw");
    expect(raw).toHaveProperty("unusual_field_xyz", "value that has no schema mapping");
    // Mapped keys also present
    expect(raw).toHaveProperty("cid_no", "11504000231");
    expect(raw).toHaveProperty("full_name", "Dorji Wangchuk");
  });

  it("persists unmapped raw keys in the metadata column", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.95 });
    mockExtract.mockResolvedValue({
      data: {
        cid_no: "00000000001",
        full_name: "Test Person",
        dob: "1990-01-01",
        expiry_date: "2030-01-01",
        completely_custom_field: "preserved_value",
      },
      partial: false,
      errors: [],
    });

    await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    const dbDoc = await h.knex("documents").where({ id: docId }).first();
    const storedMeta = JSON.parse(dbDoc.metadata);
    // The unmapped key must survive in the DB
    expect(storedMeta).toHaveProperty("completely_custom_field", "preserved_value");
  });

  it("incomplete extraction (only partial fields) still persists what it has", async () => {
    const token = await h.tokenFor("admin");
    const docId = await upload(token);

    // AI only returns 2 of the expected fields — partial=true
    mockClassify.mockResolvedValue({ doc_type: "BT_CID_4G", confidence: 0.6 });
    mockExtract.mockResolvedValue({
      data: {
        cid_no: "22222222222",
        // missing: full_name, dob, expiry_date
      },
      partial: true,
      errors: ["Could not extract full_name", "dob not found"],
    });

    const res = await request(h.app)
      .post(`/documents/${docId}/extract`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Should still return rawMetadata with what was extracted
    expect(res.body.rawMetadata).toHaveProperty("cid_no", "22222222222");
    // DB should have saved partial data
    const dbDoc = await h.knex("documents").where({ id: docId }).first();
    const storedMeta = JSON.parse(dbDoc.metadata);
    expect(storedMeta).toHaveProperty("cid_no", "22222222222");
    // extraction_status should still be DONE (not FAILED) — incomplete is not a failure
    expect(dbDoc.extraction_status).toBe("DONE");
  });
```

- [ ] **Step 2: Run tests to see them fail**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/core test -- --reporter=verbose 2>&1 | grep -E "(FAIL|PASS|rawMetadata|unmapped)" | tail -20
```

Expected: the 3 new tests FAIL because `rawMetadata` not in response yet.

- [ ] **Step 3: Modify extraction.ts to persist raw + return rawMetadata**

In `services/core/src/routes/extraction.ts`, find step 8 "Persist all updates" (around line 213):

Change:
```ts
        metadata: JSON.stringify(mapped.metadata),
```

To:
```ts
        metadata: JSON.stringify({ ...(extractResult.data ?? {}), ...mapped.metadata }),
```

This stores the union: all raw keys from `extractResult.data`, plus the mapped values (mapped wins on conflict).

In the response (step 12, around line 315), add `rawMetadata` to `res.json({...})`:

```ts
      res.json({
        document: finalDoc,
        classification: { ... },
        mappedFields: { ... },
        catalog: { ... },
        folder: folderId ? { folderId, path: mapPath, acls: mapAcls } : null,
        suggestedNewType: suggestedNewType ?? null,
        source: aiSource,
        quality: { ... },
        duplicates: duplicates.map(...),
        autoVersioned,
        rawMetadata: extractResult.data ?? {},   // ← ADD THIS LINE
      });
```

- [ ] **Step 4: Add PATCH test in documents.test.ts**

Read the end of `services/core/src/routes/documents.test.ts` first, then append:

```ts
describe("PATCH /documents/:id — raw metadata preservation", () => {
  it("PATCH keeps existing raw metadata keys that were not in the patch payload", async () => {
    const h2 = await makeTestApp();
    try {
      const token = await h2.tokenFor("admin");
      // Upload a document
      const up = await request(h2.app)
        .post("/documents")
        .set("Authorization", `Bearer ${token}`)
        .field("title", "Raw Meta Test")
        .field("branch", "Thimphu")
        .attach("file", Buffer.from("bytes"), "doc.png");
      const id = up.body.document.id;

      // Manually set metadata in DB to simulate post-extraction raw state
      await h2.knex("documents").where({ id }).update({
        metadata: JSON.stringify({
          cid_no: "99900000001",
          full_name: "Raw Person",
          ai_internal_score: 0.95,       // raw/unmapped key
          raw_ocr_text: "Original OCR",  // raw/unmapped key
        }),
        doc_type: "BT_CID_4G",
      });

      // PATCH only the full_name field
      const patch = await request(h2.app)
        .patch(`/documents/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          metadata: { full_name: "Corrected Person" },
        });

      expect(patch.status).toBe(200);

      // The patched doc's metadata must retain the raw keys
      const dbDoc = await h2.knex("documents").where({ id }).first();
      const meta = JSON.parse(dbDoc.metadata);
      expect(meta.full_name).toBe("Corrected Person"); // updated
      expect(meta.cid_no).toBe("99900000001");         // preserved
      expect(meta.ai_internal_score).toBe(0.95);        // raw key preserved
      expect(meta.raw_ocr_text).toBe("Original OCR"); // raw key preserved
    } finally {
      await h2.cleanup();
    }
  });
});
```

- [ ] **Step 5: Run core tests**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/core test 2>&1 | tail -20
```

Expected: PASS — all tests including the 4 new ones (3 extraction + 1 PATCH).

---

### Task 5: Build verification + write wf7 report

**Files:**
- Run: `pnpm -r build`
- Create: `/Users/amitkatoch/Documents/DMS_Network/.superpowers/sdd/wf7-capture-raw-report.md`

- [ ] **Step 1: Run full build**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm -r build 2>&1 | tail -30
```

Expected: clean exit (0). If TypeScript errors, fix them now.

Common issues to pre-check:
- `FullScreenPreview.tsx` must export a named `FullScreenPreview` function (no default export).
- `useState` must be imported in `CaptureQueueDrawer.tsx` (it already uses `Tag` but may not use `useState`).
- `ExtractionResultDrawer.tsx` already imports `useState` from `"react"` (line 21).
- The new `rawMetadata` field in `ExtractionResult` is `optional` (`?`) so old mocks that don't include it won't fail TypeScript.

- [ ] **Step 2: Run all tests one final time**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/web test 2>&1 | tail -10 && pnpm --filter @zordms/core test 2>&1 | tail -10
```

Expected: Both PASS.

- [ ] **Step 3: Write wf7 report**

Create `/Users/amitkatoch/Documents/DMS_Network/.superpowers/sdd/wf7-capture-raw-report.md` with the actual counts from the test runs and file list from the implementation.

---

## Self-Review

**Spec coverage check:**

1. ✓ Gate Proceed on file selection — Task 1 (disabled not hidden, `hasFile` drives `disabled` prop)
2. ✓ Full-screen preview modal — Task 2 (FullScreenPreview.tsx, wired from FilePreview + ExtractionResultDrawer)
3. ✓ Image/PDF/fallback branches in modal — Task 2 Step 1 (isImage → img, isPdf → iframe, else fallback)
4. ✓ URL.createObjectURL + revokeObjectURL on unmount — Task 2 Step 1
5. ✓ Raw metadata JSON in drawer — Task 3 (collapsible section, read-only `<pre>`)
6. ✓ `rawMetadata` in captureApi.ts ExtractionResult type — Task 3 Step 1
7. ✓ "No raw metadata captured" fallback — Task 3 Step 2 (RawMetadataPanel)
8. ✓ Backend persists ALL raw keys — Task 4 Step 3 (`{ ...extractResult.data, ...mapped.metadata }`)
9. ✓ Backend returns `rawMetadata` in response — Task 4 Step 3
10. ✓ PATCH preserves raw keys (already works via `mergedMeta = { ...existingMeta, ...body.metadata }`) — Task 4 (documented + tested)
11. ✓ Incomplete extraction still persists partial data — Task 4 test 3
12. ✓ Tests for each task — each task has explicit test steps

**Placeholder scan:** No TBD, no "handle edge cases", no "similar to task N". All code blocks are complete.

**Type consistency:**
- `FullScreenPreviewProps.file: File | null` — matches usage in CaptureQueueDrawer `selected.frontFile ?? null`
- `ExtractionResultDrawerProps.previewFile?: File | null` — optional, so CaptureQueueDrawer must pass it where `selected.frontFile` exists
- `ExtractionResult.rawMetadata?: Record<string, unknown> | null` — optional so existing mocks don't break
- `RawMetadataPanel` receives `rawMetadata: Record<string, unknown> | null | undefined` — matches

**Potential issue:** The test `"Proceed button does NOT appear when no file selected"` (line 460–465 in Capture.test.tsx) uses `.not.toBeInTheDocument()`. After Task 1, the button IS always in the DOM. Task 1 Step 3 and Step 6 explicitly address updating that test. The plan handles it correctly.
