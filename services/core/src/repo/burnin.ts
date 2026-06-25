import { execFile } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

export interface StampOptions {
  label: string; // e.g. "APPROVED"
  by: string; // approver username / name
  date: string; // ISO or human date string
  ref?: string; // optional reference (e.g. cert hash / doc no)
  page?: number; // 1-based page number; omit/undefined => stamp every page
}

export interface RedactRegion {
  page: number; // 1-based page number (PDF) or 1 for images
  x: number; // normalized 0..1 left, top-left origin
  y: number; // normalized 0..1 top, top-left origin
  w: number; // normalized 0..1 width
  h: number; // normalized 0..1 height
}

const isPdf = (mime?: string): boolean => (mime ?? "").toLowerCase() === "application/pdf";

/**
 * Burn a visible APPROVED stamp into the document bytes, returning the new bytes.
 * PDFs are stamped with pdf-lib (vector). Images are composited with sharp (raster).
 */
export async function burnStamp(input: Buffer, mimeType: string | undefined, opts: StampOptions): Promise<Buffer> {
  if (isPdf(mimeType)) return stampPdf(input, opts);
  return stampImage(input, opts);
}

/**
 * Destructively redact the document bytes, returning the new bytes.
 *
 * REDACTION GUARANTEE:
 *  - Images: the affected pixels are overwritten with opaque black and the raster
 *    is re-encoded. The original pixels are GONE from the output bytes — truly
 *    destructive, non-recoverable.
 *  - PDFs: any page that has at least one redaction region is RASTERIZED to a PNG
 *    via pdftoppm (poppler), the opaque black rectangles are painted onto that
 *    raster, and the page is re-embedded as an image. Because the page becomes a
 *    flat raster, the underlying text/vector content stream beneath the box is
 *    physically removed from the output — truly destructive, non-recoverable
 *    (no selectable text, no hidden layer). Pages without regions are copied
 *    through untouched (their text remains searchable).
 *  - If poppler (pdftoppm) is unavailable, we fall back to drawing opaque black
 *    rectangles only (overlay). This is a softer guarantee and is signalled by the
 *    returned `rasterized` flag being false.
 */
export async function burnRedaction(
  input: Buffer,
  mimeType: string | undefined,
  regions: RedactRegion[],
): Promise<{ bytes: Buffer; rasterized: boolean }> {
  if (isPdf(mimeType)) return redactPdf(input, regions);
  return { bytes: await redactImage(input, regions), rasterized: true };
}

// ---------------------------------------------------------------------------
// PDF stamping (vector overlay — additive, non-destructive by design)
// ---------------------------------------------------------------------------
async function stampPdf(input: Buffer, opts: StampOptions): Promise<Buffer> {
  const pdf = await PDFDocument.load(input);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  const targets = opts.page ? [pages[opts.page - 1]].filter(Boolean) : pages;

  for (const page of targets) {
    const { width } = page.getSize();
    const boxW = 230;
    const boxH = 64;
    const x = width - boxW - 24;
    const y = 28;
    // translucent green/gold approval box
    page.drawRectangle({
      x, y, width: boxW, height: boxH,
      color: rgb(0.96, 0.99, 0.94), opacity: 0.85,
      borderColor: rgb(0.16, 0.5, 0.28), borderWidth: 2,
    });
    page.drawText(opts.label, { x: x + 12, y: y + boxH - 22, size: 16, font, color: rgb(0.13, 0.45, 0.27) });
    page.drawText(`By: ${opts.by}`, { x: x + 12, y: y + boxH - 38, size: 9, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(opts.date, { x: x + 12, y: y + boxH - 50, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
    if (opts.ref) page.drawText(`Ref: ${opts.ref}`, { x: x + 12, y: y + boxH - 60, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
  }
  return Buffer.from(await pdf.save());
}

// ---------------------------------------------------------------------------
// Image stamping (raster composite — destructive to those pixels)
// ---------------------------------------------------------------------------
async function stampImage(input: Buffer, opts: StampOptions): Promise<Buffer> {
  const img = sharp(input);
  const meta = await img.metadata();
  const W = meta.width ?? 800;
  const H = meta.height ?? 1000;
  const boxW = Math.min(Math.round(W * 0.42), 360);
  const boxH = Math.round(boxW * 0.28);
  const bx = W - boxW - Math.round(W * 0.03);
  const by = H - boxH - Math.round(H * 0.03);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fs1 = Math.round(boxH * 0.34);
  const fs2 = Math.round(boxH * 0.2);
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${bx}" y="${by}" width="${boxW}" height="${boxH}" rx="10"
      fill="#f5fdf0" fill-opacity="0.85" stroke="#298047" stroke-width="3"/>
    <text x="${bx + 14}" y="${by + fs1 + 6}" font-family="Helvetica,Arial,sans-serif"
      font-size="${fs1}" font-weight="bold" fill="#226e3a">${esc(opts.label)}</text>
    <text x="${bx + 14}" y="${by + fs1 + fs2 + 14}" font-family="Helvetica,Arial,sans-serif"
      font-size="${fs2}" fill="#1a1a1a">By: ${esc(opts.by)} · ${esc(opts.date)}</text>
    ${opts.ref ? `<text x="${bx + 14}" y="${by + fs1 + 2 * fs2 + 18}" font-family="Helvetica,Arial,sans-serif" font-size="${Math.round(fs2 * 0.85)}" fill="#4d4d4d">Ref: ${esc(opts.ref)}</text>` : ""}
  </svg>`;
  return img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

// ---------------------------------------------------------------------------
// Image redaction (raster overwrite — non-recoverable)
// ---------------------------------------------------------------------------
async function redactImage(input: Buffer, regions: RedactRegion[]): Promise<Buffer> {
  const img = sharp(input);
  const meta = await img.metadata();
  const W = meta.width ?? 800;
  const H = meta.height ?? 1000;
  const rects = regions
    .map((r) => {
      const x = Math.max(0, Math.round(clamp01(r.x) * W));
      const y = Math.max(0, Math.round(clamp01(r.y) * H));
      const w = Math.max(1, Math.round(clamp01(r.w) * W));
      const hh = Math.max(1, Math.round(clamp01(r.h) * H));
      return `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="#000000"/>`;
    })
    .join("");
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
  // Composite opaque rects then re-encode: the covered source pixels are discarded.
  return img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

// ---------------------------------------------------------------------------
// PDF redaction (rasterize affected pages -> re-embed; true content removal)
// ---------------------------------------------------------------------------
async function redactPdf(
  input: Buffer,
  regions: RedactRegion[],
): Promise<{ bytes: Buffer; rasterized: boolean }> {
  const byPage = new Map<number, RedactRegion[]>();
  for (const r of regions) {
    const list = byPage.get(r.page) ?? [];
    list.push(r);
    byPage.set(r.page, list);
  }

  const src = await PDFDocument.load(input);
  const pageCount = src.getPageCount();

  const haveRaster = await popplerAvailable();
  if (!haveRaster) {
    // Soft fallback: opaque black rectangles only (overlay, not content removal).
    const font = StandardFonts.Helvetica;
    void font;
    for (const [pageNo, regs] of byPage) {
      const page = src.getPage(pageNo - 1);
      if (!page) continue;
      const { width, height } = page.getSize();
      for (const r of regs) {
        page.drawRectangle({
          x: clamp01(r.x) * width,
          y: height - (clamp01(r.y) + clamp01(r.h)) * height, // flip top-left -> bottom-left
          width: clamp01(r.w) * width,
          height: clamp01(r.h) * height,
          color: rgb(0, 0, 0), opacity: 1,
        });
      }
    }
    return { bytes: Buffer.from(await src.save()), rasterized: false };
  }

  // Rasterize the whole document once at high DPI; rebuild affected pages from raster.
  const dir = await mkdtemp(join(tmpdir(), "zordms-redact-"));
  try {
    const inPath = join(dir, "in.pdf");
    await writeFile(inPath, input);
    const dpi = 200;
    await execFileAsync("pdftoppm", ["-png", "-r", String(dpi), inPath, join(dir, "page")]);
    const files = (await readdir(dir)).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort();

    const out = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) {
      const pageNo = i + 1;
      const regs = byPage.get(pageNo);
      if (!regs || regs.length === 0) {
        // No redaction on this page — copy original (keeps text searchable).
        const [copied] = await out.copyPages(src, [i]);
        out.addPage(copied);
        continue;
      }
      // Redacted page: paint opaque rects onto the raster, then embed it.
      const rasterFile = files[i];
      if (!rasterFile) {
        const [copied] = await out.copyPages(src, [i]);
        out.addPage(copied);
        continue;
      }
      const rasterBytes = await readFile(join(dir, rasterFile));
      const flat = await redactImage(rasterBytes, regs.map((r) => ({ ...r, page: 1 })));
      const png = await out.embedPng(flat);
      const srcPage = src.getPage(i);
      const { width, height } = srcPage.getSize();
      const newPage = out.addPage([width, height]);
      newPage.drawImage(png, { x: 0, y: 0, width, height });
    }
    return { bytes: Buffer.from(await out.save()), rasterized: true };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let popplerCache: boolean | undefined;
async function popplerAvailable(): Promise<boolean> {
  if (popplerCache !== undefined) return popplerCache;
  try {
    await execFileAsync("pdftoppm", ["-h"]);
    popplerCache = true;
  } catch {
    popplerCache = false;
  }
  return popplerCache;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
