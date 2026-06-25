/**
 * FullScreenPreview.test.tsx — tests for the full-screen file preview modal.
 * Covers: open/close, image branch, PDF branch, fallback, zoom/rotate controls.
 */
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
    // filename appears in header and in fallback body — use getAllByText
    const filenameMatches = screen.getAllByText("data.xlsx");
    expect(filenameMatches.length).toBeGreaterThan(0);
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

  it("renders nothing when file is null even if open=true", () => {
    render(
      <FullScreenPreview
        file={null}
        open={true}
        onClose={() => {}}
      />
    );
    expect(screen.queryByRole("dialog", { name: /Full screen file preview/i })).not.toBeInTheDocument();
  });
});
