/**
 * ZorDMS AI Service Client
 *
 * Calls the Python AI service (services/ai) over HTTP.
 * Base URL is read from AI_URL env (default: http://localhost:8000).
 * The caller's Bearer JWT is forwarded so /idp/* auth passes.
 *
 * Design: multipart/form-data exactly as the AI IDP endpoints expect.
 * Falls back gracefully if the AI service is unavailable.
 */

export interface AiClassifyResult {
  doc_type: string;
  confidence: number;
  signals?: Record<string, unknown>;
}

export interface AiExtractResult {
  doc_type: string;
  valid: boolean;
  review_flag: boolean;
  data: Record<string, unknown> | null;
  partial: boolean;
  errors: string[];
}

export interface AiProcessResult {
  handoff: Record<string, unknown>;
  decision: {
    band: string;
    action: string;
    proceed_to_extract: boolean;
    review_required: boolean;
    sla_hours: number;
    catalog_assignment: string | null;
  };
  review_item_id: string | null;
}

function aiBaseUrl(): string {
  return (process.env["AI_URL"] ?? "http://localhost:8000").replace(/\/$/, "");
}

/** Build a minimal multipart body without importing form-data (already available via Node 18+) */
function buildFormData(fields: Record<string, string>, fileBuffer: Buffer, fileName: string, contentType: string): { body: Buffer; boundary: string } {
  const boundary = `----ZorDMSBoundary${Date.now()}`;
  const parts: Buffer[] = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
    ));
  }

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  ));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return { body: Buffer.concat(parts), boundary };
}

async function postMultipart(
  url: string,
  bearer: string,
  fields: Record<string, string>,
  fileBuffer: Buffer,
  fileName: string,
  fileContentType: string,
  timeoutMs = 30_000,
): Promise<Response> {
  const { body, boundary } = buildFormData(fields, fileBuffer, fileName, fileContentType);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Convert Buffer → ArrayBuffer to satisfy the BodyInit type constraint
    const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: ab,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function aiClassify(
  bearer: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  ocrText = "",
): Promise<AiClassifyResult> {
  const url = `${aiBaseUrl()}/idp/classify`;
  const res = await postMultipart(url, bearer, { ocr_text: ocrText }, fileBuffer, fileName, mimeType);
  if (!res.ok) throw new Error(`AI classify HTTP ${res.status}`);
  return (await res.json()) as AiClassifyResult;
}

export async function aiExtract(
  bearer: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  docType: string,
): Promise<AiExtractResult> {
  const url = `${aiBaseUrl()}/idp/extract`;
  const res = await postMultipart(url, bearer, { doc_type: docType }, fileBuffer, fileName, mimeType);
  if (!res.ok) throw new Error(`AI extract HTTP ${res.status}`);
  return (await res.json()) as AiExtractResult;
}

export async function aiProcess(
  bearer: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  docId: string,
  ocrText = "",
): Promise<AiProcessResult> {
  const url = `${aiBaseUrl()}/idp/process`;
  const res = await postMultipart(url, bearer, { doc_id: docId, ocr_text: ocrText }, fileBuffer, fileName, mimeType);
  if (!res.ok) throw new Error(`AI process HTTP ${res.status}`);
  return (await res.json()) as AiProcessResult;
}
