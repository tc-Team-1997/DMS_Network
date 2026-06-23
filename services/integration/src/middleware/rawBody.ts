import type { Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { rawBody?: Buffer; } }
}

// Express json() `verify` hook: capture the exact bytes BEFORE parsing so that
// inbound webhook HMAC verification can hash the raw body (never a re-serialized one).
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  if (buf && buf.length) req.rawBody = Buffer.from(buf);
}
