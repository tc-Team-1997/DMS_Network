# ADR 0004 — PDF Redaction Irreversibility

**Date:** 2026-05-09  
**Status:** Accepted  
**Date accepted:** 2026-05-09  
**Deciders:** Python Engineer, SPA Engineer, Security Team  
**Related:** `docs/contracts/document-redaction.md` (BHU-46)

---

## Context

Bhutan bidding regulation §46 requires PII redaction that *physically destroys* text, not visual masking. Many document platforms render black rectangles over text while leaving the underlying PDF content stream intact—an attacker or determined user can extract the text by copying from the PDF or analyzing the binary stream.

Current state: no redaction tooling exists. Officers manually re-type sensitive fields or use external tools, introducing OCR errors and data loss.

---

## Decision

We implement irreversible PDF redaction via `pikepdf` (a Pythonic wrapper around C++ Poppler):

1. **Content-stream text destruction** — Load the PDF, locate text objects in the regions marked for redaction, **delete them from the content stream**, and rewrite the PDF.
2. **Post-redaction verification** — Run `pdftotext` (from poppler-utils) on the redacted PDF. If any redacted token appears in the output, raise `RedactionFailedError` and discard the half-written file.
3. **Version chaining** — Store the original document intact. The redacted version has `parent_id` set to the original and `redacted=true` flag. DSAR requests return only the redacted version to users without `view_unredacted` permission.
4. **Audit trail** — Every redaction writes to `redaction_log` with: `redacted_by`, `regions` (as JSON with page, x, y, w, h, reason), and `created_at`. Original and redacted document SHAs are compared to prove content change.

**Alternatives considered:**

- **Client-side overlay (pdf.js)** — Rejected. Visual-only; text still recoverable from content stream.
- **ImageMagick rasterize-then-redact** — Rejected. Destroys searchability, accessibility, and metadata.
- **pdfminer parse + reconstruct** — Rejected. Too fragile across PDF variants (embedded fonts, encoded streams, XObjects).

---

## Consequences

### Positive
- **Irreversible** — Text is physically removed. No extraction possible via standard PDF readers or tools.
- **Searchability preserved** — Redacted PDF remains a valid PDF, can be full-text indexed (without redacted regions).
- **Audit transparency** — Auditors see exactly which regions were redacted, by whom, at what time.
- **Compliance-grade** — Meets GDPR recital 17 ("fair and transparent processing") and PII destruction mandates.

### Operating Costs
- **poppler-utils is a hard dependency** — Must be installed in production (via apt, yum, or Homebrew). CI/CD must include Tesseract and Poppler for testing.
- **Verification latency** — Post-redaction `pdftotext` adds 1–2 seconds per redaction. Acceptable for typical branch workflow (few redactions/day).
- **PDFs with embedded fonts may fail** — Some PDFs encode text as outlines or glyphs instead of text streams. Verification will flag these as "text still visible" and reject the redaction (safe default: fail closed rather than ship unsafe redactions).
- **No partial redaction recovery** — Redaction is one-way. If a region is too large or too small, user must re-redact (create a new version).

### Limitations (v1)
- **Text-only redaction** — Images embedded in the PDF are NOT redacted (scope for v1.1). User manually redacts image regions or accepts residual visual information.
- **Single document at a time** — No bulk redaction. User redacts one document per form submission.
- **Manual region selection** — No auto-detect PII. User draws rectangles; if they miss a field, it remains visible.

---

## Status

**Accepted** (2026-05-09). Implementation shipped: pikepdf content-stream editing, pdftotext post-redaction verification, version chaining, audit trail.

---

## Related Decisions

- **ADR 0003 (WORM locks)** — Redacted documents inherit WORM locks from parent if under retention.
- **ADR 0002 (Temenos CBS adapter)** — Redaction is orthogonal to CBS integration; can redact before/after document approval.
- **Engineering Principles § PII Handling** — Redaction is complementary to encryption; together they form defense in depth for PII.
