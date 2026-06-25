/**
 * Micro-level unit tests for FilePreview — image/pdf/fallback type branches
 * plus zoom/rotate/reset toolbar behavior. URL.createObjectURL is stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FilePreview } from "./FilePreview.js";

function makeFile(name: string, type: string, size = 2048): File {
  const f = new File([new Uint8Array(size)], name, { type });
  // jsdom File.size derives from blob parts; assert it for the KB label test.
  return f;
}

// jsdom does not implement URL.createObjectURL — install spies on the object.
const revokeSpy = vi.fn();
beforeEach(() => {
  let n = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${n++}`);
  globalThis.URL.revokeObjectURL = revokeSpy;
});

afterEach(() => {
  cleanup();
  revokeSpy.mockClear();
});

describe("FilePreview type branches", () => {
  it("renders an <img> for image files", () => {
    render(<FilePreview file={makeFile("scan.png", "image/png")} />);
    const img = screen.getByAltText("scan.png") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toMatch(/^blob:mock-/);
  });

  it("renders an <iframe> for PDF files with toolbar disabled", () => {
    render(<FilePreview file={makeFile("doc.pdf", "application/pdf")} />);
    const frame = screen.getByTitle("doc.pdf") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toMatch(/#toolbar=0$/);
  });

  it("renders the fallback for unsupported types showing name + type", () => {
    render(<FilePreview file={makeFile("data.bin", "application/octet-stream")} />);
    // Name appears in both the toolbar span and the fallback body.
    expect(screen.getAllByText("data.bin").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("application/octet-stream")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    // No image / iframe rendered for unsupported types.
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("fallback shows 'Unknown type' when file.type is empty", () => {
    render(<FilePreview file={makeFile("mystery", "")} />);
    expect(screen.getByText("Unknown type")).toBeInTheDocument();
  });
});

describe("FilePreview toolbar", () => {
  it("zoom in increases the displayed percentage by 25%", () => {
    render(<FilePreview file={makeFile("a.png", "image/png")} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByText("125%")).toBeInTheDocument();
  });

  it("zoom out clamps at the 25% lower bound", () => {
    render(<FilePreview file={makeFile("a.png", "image/png")} />);
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("zoom in clamps at the 400% upper bound", () => {
    render(<FilePreview file={makeFile("a.png", "image/png")} />);
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByText("400%")).toBeInTheDocument();
  });

  it("Reset returns zoom to 100%", () => {
    render(<FilePreview file={makeFile("a.png", "image/png")} />);
    fireEvent.click(screen.getByLabelText("Zoom in"));
    fireEvent.click(screen.getByLabelText("Reset view"));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("rotate applies a rotate transform to the image", () => {
    render(<FilePreview file={makeFile("a.png", "image/png")} />);
    fireEvent.click(screen.getByLabelText("Rotate clockwise"));
    const img = screen.getByAltText("a.png") as HTMLImageElement;
    expect(img.style.transform).toContain("rotate(90deg)");
  });

  it("only renders the full-screen button when onFullScreen is provided", () => {
    const onFs = vi.fn();
    const { rerender } = render(<FilePreview file={makeFile("a.png", "image/png")} />);
    expect(screen.queryByLabelText("Open full screen preview")).toBeNull();
    rerender(<FilePreview file={makeFile("a.png", "image/png")} onFullScreen={onFs} />);
    fireEvent.click(screen.getByLabelText("Open full screen preview"));
    expect(onFs).toHaveBeenCalledOnce();
  });

  it("revokes the object URL on unmount", () => {
    const { unmount } = render(<FilePreview file={makeFile("a.png", "image/png")} />);
    unmount();
    expect(revokeSpy).toHaveBeenCalled();
  });
});
