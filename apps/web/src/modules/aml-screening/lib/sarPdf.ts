/**
 * sarPdf — generate a SAR (Suspicious Activity Report) draft PDF via pdf-lib.
 *
 * pdf-lib is already a project dependency (^1.17.1).
 * No new deps required.
 *
 * The PDF is generated entirely in the browser (Uint8Array) and returned to
 * the caller for download.  No data is sent to the server by this function.
 * The SAR submission to the regulator is handled separately via submitSar().
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { ScoreBreakdown } from '../schemas';

export interface SarDraftData {
  // Subject (customer)
  subjectCid:     string;
  subjectName:    string;
  subjectDob:     string | null | undefined;
  subjectCountry: string | null | undefined;

  // Hit / watchlist match
  hitId:              number;
  watchlistName:      string | null | undefined;
  watchlistEntryName: string;
  matchScore:         number;
  scoreBreakdown:     ScoreBreakdown | undefined;

  // Decision context
  narrative:   string;   // ≥ 50 chars, reviewer-edited in SarDraftModal
  reviewedBy:  string;
  reviewedAt:  string;

  // Bank context
  tenantName: string;
  branch:     string | null | undefined;
}

const MARGIN = 50;
const PAGE_W = 595;
const LINE_H = 18;
const SECTION_GAP = 10;
const COL_LABEL = MARGIN;
const COL_VALUE = 200;

/** Truncate a string for PDF display. */
function trunc(s: string | null | undefined, max = 60): string {
  if (!s) return '—';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/** Format a float as a percentage string: 0.78 → '78 %' */
function pct(n: number): string {
  return `${Math.round(n * 100)} %`;
}

export async function generateSarPdf(data: SarDraftData): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, 841]); // A4
  const font      = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold  = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = 800;

  // ── Title ────────────────────────────────────────────────────────────────────
  page.drawText('SUSPICIOUS ACTIVITY REPORT — DRAFT', {
    x: MARGIN, y,
    size: 14, font: fontBold,
    color: rgb(0.05, 0.17, 0.42),
  });
  y -= LINE_H * 2;

  page.drawText(`Generated: ${new Date().toUTCString()}`, {
    x: MARGIN, y,
    size: 9, font,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= LINE_H * 1.5;

  // Horizontal rule
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= SECTION_GAP;

  function drawSection(title: string): void {
    y -= LINE_H * 0.5;
    page.drawText(title, {
      x: MARGIN, y,
      size: 10, font: fontBold,
      color: rgb(0.05, 0.17, 0.42),
    });
    y -= LINE_H;
  }

  function drawRow(label: string, value: string): void {
    page.drawText(label + ':', {
      x: COL_LABEL, y,
      size: 8, font: fontBold,
      color: rgb(0.3, 0.3, 0.3),
    });
    page.drawText(trunc(value), {
      x: COL_VALUE, y,
      size: 8, font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= LINE_H;
  }

  // ── Bank / institution ────────────────────────────────────────────────────────
  drawSection('INSTITUTION');
  drawRow('Institution',        data.tenantName);
  drawRow('Branch',             data.branch ?? '—');
  drawRow('Report Date',        new Date().toISOString().slice(0, 10));

  // ── Subject ───────────────────────────────────────────────────────────────────
  y -= SECTION_GAP;
  drawSection('SUBJECT (CUSTOMER)');
  drawRow('CID',          data.subjectCid);
  drawRow('Name',         data.subjectName);
  drawRow('Date of Birth',data.subjectDob ?? '—');
  drawRow('Country',      data.subjectCountry ?? '—');

  // ── Hit / match details ───────────────────────────────────────────────────────
  y -= SECTION_GAP;
  drawSection('WATCHLIST MATCH');
  drawRow('Hit ID',             String(data.hitId));
  drawRow('Watchlist',          data.watchlistName ?? '—');
  drawRow('Matched Entry',      data.watchlistEntryName);
  drawRow('Composite Score',    pct(data.matchScore));
  if (data.scoreBreakdown) {
    drawRow('  Name score',     pct(data.scoreBreakdown.name));
    drawRow('  DOB score',      pct(data.scoreBreakdown.dob));
    drawRow('  Country score',  pct(data.scoreBreakdown.country));
  }

  // ── Decision ──────────────────────────────────────────────────────────────────
  y -= SECTION_GAP;
  drawSection('DECISION');
  drawRow('Decision',       'True Match');
  drawRow('Reviewed By',    data.reviewedBy);
  drawRow('Reviewed At',    data.reviewedAt);

  // ── Narrative ─────────────────────────────────────────────────────────────────
  y -= SECTION_GAP;
  drawSection('NARRATIVE');
  // Wrap narrative at ~80 chars
  const words = data.narrative.split(/\s+/);
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > 80) {
      page.drawText(line.trim(), { x: MARGIN, y, size: 8, font, color: rgb(0.1, 0.1, 0.1) });
      y -= LINE_H;
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) {
    page.drawText(line.trim(), { x: MARGIN, y, size: 8, font, color: rgb(0.1, 0.1, 0.1) });
    y -= LINE_H;
  }

  // ── Footer ────────────────────────────────────────────────────────────────────
  y -= SECTION_GAP;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= LINE_H;
  page.drawText('DRAFT — NOT FOR SUBMISSION WITHOUT COMPLIANCE OFFICER REVIEW', {
    x: MARGIN, y,
    size: 7, font: fontBold,
    color: rgb(0.7, 0.2, 0.2),
  });

  return doc.save();
}

/** Trigger a browser download of the SAR PDF. */
export function downloadSarPdf(bytes: Uint8Array, filename: string): void {
  // Copy into a fresh Uint8Array backed by a plain ArrayBuffer so Blob
  // construction satisfies strictLib (no SharedArrayBuffer branch).
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
