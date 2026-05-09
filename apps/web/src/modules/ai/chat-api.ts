import { z } from 'zod';
import { get, post, del, http } from '@/lib/http';
import { OkSchema } from '@/lib/schemas';

// ---------------------------------------------------------------------------
// DocBrain Chat v2 schemas — conversations backed by Python persistence
// ---------------------------------------------------------------------------

export const V2CitationSchema = z.object({
  document_id: z.number().int(),
  chunk_index: z.number().int(),
  snippet:     z.string(),
  page:        z.number().int().optional(),
  x:           z.number().optional(),
  y:           z.number().optional(),
  w:           z.number().optional(),
  h:           z.number().optional(),
});
export type V2Citation = z.infer<typeof V2CitationSchema>;

export const V2ConversationSchema = z.object({
  id:              z.number().int(),
  tenant_id:       z.string(),
  user_id:         z.number().int(),
  title:           z.string(),
  persona:         z.string().nullable(),
  folder:          z.string().nullable(),
  pinned:          z.boolean(),
  model_used:      z.string().nullable(),
  last_message:    z.string().nullable(),
  created_at:      z.string(),
  updated_at:      z.string(),
  last_message_at: z.string().nullable(),
  message_count:   z.number().int().default(0),
});
export type V2Conversation = z.infer<typeof V2ConversationSchema>;

export const V2MessageSchema = z.object({
  id:                 z.number().int(),
  conversation_id:    z.number().int(),
  role:               z.enum(['user', 'assistant']),
  content:            z.string(),
  citations:          z.array(V2CitationSchema),
  has_evidence:       z.boolean().nullable(),
  needs_verification: z.boolean(),
  edited_at:          z.string().nullable(),
  created_at:         z.string(),
});
export type V2Message = z.infer<typeof V2MessageSchema>;

export const V2ConversationDetailSchema = z.object({
  conversation: V2ConversationSchema,
  messages:     z.array(V2MessageSchema),
});
export type V2ConversationDetail = z.infer<typeof V2ConversationDetailSchema>;

// API calls

export const fetchV2Conversations = (q?: string, limit = 50) =>
  get(
    `/spa/api/docbrain/v2/conversations${q ? `?q=${encodeURIComponent(q)}&limit=${limit}` : `?limit=${limit}`}`,
    z.array(V2ConversationSchema),
  );

export const fetchV2Conversation = (id: number) =>
  get(`/spa/api/docbrain/v2/conversations/${id}`, V2ConversationDetailSchema);

export const createV2Conversation = (input: {
  title?: string;
  persona?: string | null;
  folder?: string | null;
  model_used?: string | null;
}) =>
  post('/spa/api/docbrain/v2/conversations', input, V2ConversationSchema);

export const patchV2Message = (messageId: number, conversationId: number, content: string) =>
  http.patch(
    `/spa/api/docbrain/v2/messages/${messageId}?conversation_id=${conversationId}`,
    { content },
  ).then((r) => V2MessageSchema.parse(r.data));

export const pinV2Conversation = (id: number, pinned: boolean) =>
  post(`/spa/api/docbrain/v2/conversations/${id}/pin`, { pinned }, V2ConversationSchema);

export const setV2Folder = (id: number, folder: string | null) =>
  post(`/spa/api/docbrain/v2/conversations/${id}/folder`, { folder }, V2ConversationSchema);

/** Stream a chat turn against a v2 conversation. Returns an abort function. */
export function streamV2Chat(
  conversationId: number,
  question: string,
  documentId: number | undefined,
  onEvent: (evt: StreamEvent) => void,
  signal?: AbortSignal,
): () => void {
  const ctl = new AbortController();
  if (signal) signal.addEventListener('abort', () => ctl.abort());

  void (async () => {
    try {
      const resp = await fetch(
        `/spa/api/docbrain/v2/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          body: JSON.stringify({
            question,
            ...(documentId !== undefined ? { document_id: documentId } : {}),
          }),
          signal: ctl.signal,
        },
      );
      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => '');
        onEvent({ type: 'error', status: resp.status, message: text || resp.statusText });
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!frame.startsWith('data:')) continue;
          try { onEvent(JSON.parse(frame.slice(5).trim()) as StreamEvent); } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        onEvent({ type: 'error', message: (err as Error).message });
      }
    }
  })();

  return () => ctl.abort();
}

/** Stream a regenerate turn for a specific assistant message. */
export function streamV2Regenerate(
  messageId: number,
  conversationId: number,
  onEvent: (evt: StreamEvent) => void,
  signal?: AbortSignal,
): () => void {
  const ctl = new AbortController();
  if (signal) signal.addEventListener('abort', () => ctl.abort());

  void (async () => {
    try {
      const resp = await fetch(
        `/spa/api/docbrain/v2/messages/${messageId}/regenerate?conversation_id=${conversationId}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          body: '{}',
          signal: ctl.signal,
        },
      );
      if (!resp.ok || !resp.body) {
        onEvent({ type: 'error', status: resp.status });
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!frame.startsWith('data:')) continue;
          try { onEvent(JSON.parse(frame.slice(5).trim()) as StreamEvent); } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        onEvent({ type: 'error', message: (err as Error).message });
      }
    }
  })();

  return () => ctl.abort();
}

// ---------------------------------------------------------------------------
// Existing v1 schemas (kept for backward compat with AIEnginePage)
// ---------------------------------------------------------------------------

export const ScopeTypeSchema = z.enum(['all', 'document', 'folder']);
export type ScopeType = z.infer<typeof ScopeTypeSchema>;

export const CitationSchema = z.object({
  document_id: z.number().int(),
  chunk_index: z.number().int(),
  snippet: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const MessageSchema = z.object({
  id: z.number().int(),
  conversation_id: z.number().int(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(CitationSchema),
  has_evidence: z.boolean().nullable(),
  created_at: z.string(),
});
export type ChatMessage = z.infer<typeof MessageSchema>;

export const ConversationSchema = z.object({
  id: z.number().int(),
  user_id: z.number().int(),
  title: z.string(),
  scope_type: ScopeTypeSchema,
  scope_id: z.number().int().nullable(),
  tenant_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationListItemSchema = ConversationSchema.extend({
  first_user_message: z.string().nullable(),
  message_count: z.number().int(),
});
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;

export const ConversationDetailSchema = z.object({
  conversation: ConversationSchema,
  messages: z.array(MessageSchema),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

export const CreateConversationInputSchema = z.object({
  title: z.string().max(200).optional(),
  scope_type: ScopeTypeSchema.optional(),
  scope_id: z.number().int().nullable().optional(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;

export const fetchConversations = () =>
  get('/spa/api/ai/conversations', z.array(ConversationListItemSchema));

export const fetchConversation = (id: number) =>
  get(`/spa/api/ai/conversations/${id}`, ConversationDetailSchema);

export const createConversation = (input: CreateConversationInput = {}) =>
  post('/spa/api/ai/conversations', input, ConversationSchema);

export const patchConversation = async (
  id: number,
  body: { title?: string; scope_type?: ScopeType; scope_id?: number | null },
) => {
  const { data } = await http.patch(`/spa/api/ai/conversations/${id}`, body);
  return ConversationSchema.parse(data);
};

export const deleteConversation = (id: number) =>
  del(`/spa/api/ai/conversations/${id}`, OkSchema);

/** SSE frame shapes emitted by /spa/api/ai/chat/stream and /ai/agent/stream. */
export type StreamEvent =
  | { type: 'citations'; items: Citation[] }
  | { type: 'no_evidence'; message: string }
  | { type: 'token'; text: string }
  | { type: 'done'; has_evidence?: boolean; needs_verification?: boolean; iterations?: number; used_tools?: string[] }
  | { type: 'tool_call'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'error'; message?: string; status?: number };

export type ChatMode = 'rag' | 'agent';

/**
 * Open a streaming chat turn. Calls `onEvent` for each SSE frame and
 * resolves when the stream ends. `signal` supports cancellation.
 */
export async function streamChat(
  conversationId: number,
  question: string,
  onEvent: (evt: StreamEvent) => void,
  signal?: AbortSignal,
  mode: ChatMode = 'rag',
): Promise<void> {
  const endpoint = mode === 'agent' ? '/spa/api/ai/agent/stream' : '/spa/api/ai/chat/stream';
  const init: RequestInit = {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({ conversation_id: conversationId, question }),
  };
  if (signal) init.signal = signal;
  const resp = await fetch(endpoint, init);
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    onEvent({ type: 'error', status: resp.status, message: text || resp.statusText });
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!frame.startsWith('data:')) continue;
      const payload = frame.slice(5).trim();
      try {
        const evt = JSON.parse(payload) as StreamEvent;
        onEvent(evt);
      } catch {
        // non-JSON comment; skip
      }
    }
  }
}
