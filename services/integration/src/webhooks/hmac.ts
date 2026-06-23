import { createHmac, timingSafeEqual } from "node:crypto";

// HMAC-SHA256 of the RAW request bytes, prefixed with "sha256=".
export function signBody(rawBody: Buffer | string, secret: string): string {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const digest = createHmac("sha256", secret).update(buf).digest("hex");
  return `sha256=${digest}`;
}

// Constant-time comparison against the provided header. Never throws: returns false
// for missing/malformed/length-mismatched signatures.
export function verifySignature(rawBody: Buffer | string, secret: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = signBody(rawBody, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}
