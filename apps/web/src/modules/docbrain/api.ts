import { get, post } from '@/lib/http';
import { z } from 'zod';

// ---------- Schemas (runtime-validated, no `any` propagating into UI) ------

const ExtractedFieldSchema = z.object({
  value:      z.string().nullable(),
  confidence: z.number(),
});

const ExtractionSchema = z.object({
  customer_cid:      ExtractedFieldSchema,
  customer_name:     ExtractedFieldSchema,
  doc_number:        ExtractedFieldSchema,
  dob:               ExtractedFieldSchema,
  issue_date:        ExtractedFieldSchema,
  expiry_date:       ExtractedFieldSchema,
  issuing_authority: ExtractedFieldSchema,
  address:           ExtractedFieldSchema,
});

const ClassificationSchema = z.object({
  doc_class:   z.string(),
  confidence:  z.number(),
  reasoning:   z.string(),
  alternative: z.string().nullable().optional(),
});

const OcrSummarySchema = z.object({
  pages:           z.number(),
  mean_confidence: z.number(),
  languages:       z.array(z.string()),
});

export const AnalyzeResponseSchema = z.object({
  document_id:     z.number(),
  classification:  ClassificationSchema,
  extraction:      ExtractionSchema,
  ocr:             OcrSummarySchema,
  chunks_indexed:  z.number(),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export const StoredAnalysisSchema = z.object({
  document_id:    z.number(),
  classification: ClassificationSchema,
  extraction:     ExtractionSchema,
  ocr_language:   z.string().nullable(),
  ocr_confidence: z.number(),
  chunks_indexed: z.number(),
  updated_at:     z.string(),
});
export type StoredAnalysis = z.infer<typeof StoredAnalysisSchema>;

export const ExtractResponseSchema = z.object({
  fields:  ExtractionSchema,
  prefill: z.record(z.string(), z.string()),
});
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;

export const CitationSchema = z.object({
  document_id: z.number(),
  chunk_index: z.number(),
  snippet:     z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const ChatResponseSchema = z.object({
  answer:       z.string(),
  citations:    z.array(CitationSchema),
  has_evidence: z.boolean(),
  needs_verification: z.boolean().default(false),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const HealthResponseSchema = z.object({
  status:              z.string(),
  chat_model_ready:    z.boolean(),
  embed_model_ready:   z.boolean(),
  chat_model:          z.string(),
  embed_model:         z.string(),
  classes:             z.array(z.string()).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ---------- API calls ------------------------------------------------------

export const fetchDocBrainHealth = () =>
  get('/spa/api/docbrain/health', HealthResponseSchema);

export const analyzeDocument = (documentId: number) =>
  post('/spa/api/docbrain/analyze', { document_id: documentId }, AnalyzeResponseSchema);

export const fetchAnalysis = (documentId: number) =>
  get(`/spa/api/docbrain/document/${documentId}`, StoredAnalysisSchema);

export const extractFromText = (text: string) =>
  post('/spa/api/docbrain/extract', { text }, ExtractResponseSchema);

export interface ChatInput { question: string; documentId?: number | undefined }
export const askDocBrain = ({ question, documentId }: ChatInput) =>
  post(
    '/spa/api/docbrain/chat',
    documentId !== undefined ? { question, document_id: documentId } : { question },
    ChatResponseSchema,
  );

// ---------- streaming chat (SSE) ------------------------------------------

export interface StreamHandlers {
  onCitations?: (items: Citation[]) => void;
  onToken?:     (text: string) => void;
  onDone?:      (flags: { hasEvidence: boolean; needsVerification: boolean }) => void;
  onNoEvidence?: (message: string) => void;
  onError?:     (message: string) => void;
}

/**
 * Streaming counterpart of `askDocBrain`. Uses fetch+ReadableStream so we
 * can consume the Node SSE proxy without pulling in a third-party EventSource
 * polyfill (the browser `EventSource` only supports GET).
 *
 * Returns an `abort()` function so the caller can cancel mid-stream.
 */
export function streamDocBrain(
  opts: ChatInput & { history?: Array<{ role: 'user' | 'assistant'; content: string }> },
  handlers: StreamHandlers,
): () => void {
  const ctl = new AbortController();
  const body = JSON.stringify({
    question: opts.question,
    ...(opts.documentId !== undefined ? { document_id: opts.documentId } : {}),
    ...(opts.history ? { history: opts.history } : {}),
  });

  (async () => {
    try {
      const res = await fetch('/spa/api/docbrain/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body,
        credentials: 'include',
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        handlers.onError?.(`HTTP ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let carry = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        carry += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = carry.indexOf('\n\n')) !== -1) {
          const frame = carry.slice(0, idx).trim();
          carry = carry.slice(idx + 2);
          if (!frame.startsWith('data:')) continue;
          try {
            const evt = JSON.parse(frame.slice(5).trim());
            switch (evt.type) {
              case 'citations':   handlers.onCitations?.(evt.items ?? []); break;
              case 'token':       handlers.onToken?.(evt.text ?? ''); break;
              case 'no_evidence': handlers.onNoEvidence?.(evt.message ?? ''); break;
              case 'done':        handlers.onDone?.({
                hasEvidence: !!evt.has_evidence,
                needsVerification: !!evt.needs_verification,
              }); break;
              case 'error':       handlers.onError?.(evt.message ?? 'stream error'); break;
            }
          } catch { /* ignore unparseable frame */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        handlers.onError?.((err as Error).message ?? 'stream failed');
      }
    }
  })();

  return () => ctl.abort();
}
