import { z } from 'zod';
import { get, post, del, http } from '@/lib/http';
import { OkSchema } from '@/lib/schemas';

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
