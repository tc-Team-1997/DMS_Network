# Contract: DocBrain Chat v2

**Owner:** docbrain-ai-engineer  
**Version:** 1.0 (Wave C)  
**Status:** Stable  
**SPA contact:** spa-engineer (zod schema in `apps/web/src/modules/ai/chat-api.ts`)  
**Node proxy:** `routes/spa-api/docbrain.js` — `/spa/api/docbrain/v2/*`  
**Python router:** `python-service/app/routers/docbrain_v2.py` — `/api/v1/docbrain/*`  
**Migration:** `python-service/migrations/versions/0041_docbrain_conversations.py`

---

## 1. Data models

### Conversation

```json
{
  "id": 1,
  "title": "Passport inquiry",
  "pinned": false,
  "folder": null,
  "created_at": "2026-05-10T00:00:00Z",
  "updated_at": "2026-05-10T00:00:00Z",
  "message_count": 3
}
```

### Message

```json
{
  "id": 11,
  "conversation_id": 1,
  "role": "assistant",
  "content": "The passport expires on 2032-01-09[^1].",
  "has_evidence": true,
  "needs_verification": false,
  "citations": [
    {
      "document_id": 1,
      "chunk_index": 0,
      "snippet": "Date of expiry: 2032-01-09",
      "page": 1,
      "x": null,
      "y": null,
      "w": null,
      "h": null
    }
  ],
  "edited_at": null,
  "deleted_at": null,
  "created_at": "2026-05-10T00:00:00Z"
}
```

**Audit note:** `deleted_at` is NULL by default. Soft-deleted rows (from edit-and-resend tail truncation) are retained for audit. The SPA default query filters `WHERE deleted_at IS NULL`; audit queries omit the filter.

### RagAnswer (internal Python type, surfaced via SSE)

```json
{
  "answer": "The passport expires on 2032-01-09.",
  "citations": [...],
  "has_evidence": true
}
```

`has_evidence = false` MUST be respected by the SPA. The amber halt banner renders when `has_evidence === false` or a `no_evidence` SSE event is received. This flag MUST NOT be stripped or overridden to force a confident answer.

---

## 2. REST endpoints

All routes require `Authorization: Bearer <jwt>` or `X-API-Key` (injected by Node proxy from session).

### GET /spa/api/docbrain/v2/conversations

Query: `?q=<fts>&limit=50&offset=0`

Response: `Conversation[]`

### POST /spa/api/docbrain/v2/conversations

Body:
```json
{ "title": "optional", "persona": "general", "document_id": null }
```

Response: `Conversation`

### GET /spa/api/docbrain/v2/conversations/:id

Response:
```json
{
  "conversation": Conversation,
  "messages": Message[]
}
```

Messages are ordered by `created_at ASC`. Soft-deleted rows (`deleted_at IS NOT NULL`) are excluded.

### POST /spa/api/docbrain/v2/conversations/:id/messages — SSE stream

Body:
```json
{ "question": "...", "document_id": null, "persona": "general" }
```

Response: `Content-Type: text/event-stream`

SSE event sequence (one per line, separated by blank lines):

| Event type        | Payload fields                                                  | Notes |
|-------------------|-----------------------------------------------------------------|-------|
| `citations`       | `{ items: Citation[] }`                                         | Emitted before first token |
| `token`           | `{ text: string }`                                              | May fire many times |
| `done`            | `{ has_evidence: bool, needs_verification: bool }`              | Terminal |
| `no_evidence`     | `{ message: string }`                                           | Terminal; triggers amber halt banner |
| `error`           | `{ message: string, status?: number }`                          | Terminal |

The persisted assistant message is written in the Python router's `finally` block after the stream completes.

### PATCH /spa/api/docbrain/v2/messages/:id?conversation_id=

Body:
```json
{ "content": "edited content" }
```

Response: `{ id, content, edited_at }`

Side-effect: all messages with `id > :id` in the same conversation are soft-deleted (tail truncation for edit-and-resend). The SPA then re-calls `send()` with the edited content.

### POST /spa/api/docbrain/v2/messages/:id/regenerate?conversation_id= — SSE stream

Body: `{}` (empty)

Response: same SSE event sequence as `/messages`. The Python router deletes the previous assistant bubble and writes a fresh one after streaming.

### POST /spa/api/docbrain/v2/conversations/:id/pin

Body: `{ "pinned": true | false }`  
Response: `{ "pinned": bool }`

### POST /spa/api/docbrain/v2/conversations/:id/folder

Body: `{ "folder": "string | null" }`  
Response: `{ "folder": string | null }`

---

## 3. Citation shape

`[^N]` markers in the assistant answer text refer to the N-th item (1-indexed) in the `citations` array. The SPA's `_strip_unsupported_citations` guardrail removes any `[^N]` markers that reference indices beyond the array length.

Citation click dispatches `viewer:scroll-to-span` on the Wave A event bus:

```ts
eventBus.emit({
  type: 'viewer:scroll-to-span',
  payload: {
    documentId: citation.document_id,
    span: {
      page: citation.page ?? 1,
      // x, y, w, h added conditionally only when non-undefined
    },
  },
});
```

---

## 4. has_evidence semantics

| Condition                              | `has_evidence` | SPA renders |
|----------------------------------------|---------------|-------------|
| Retrieval similarity above floor + LLM cited chunks | `true` | Normal answer with citations |
| Retrieval similarity below floor       | `false`       | Amber halt banner: "No grounded evidence" |
| `needs_verification: true`             | `true`        | Answer + amber warning: "Model did not cite passages — verify manually" |

The amber halt banner carries `data-testid="amber-halt-banner"`.

---

## 5. Token budget

`_check_token_budget` is a stub in Wave C: it logs the call but does not enforce. Wave D will enforce per-tenant monthly budget via the `tenant_config.docbrain.max_tokens_per_response` key.

Structured log emitted on every LLM call:

```json
{
  "op": "docbrain_send",
  "conversation_id": 1,
  "latency_ms": 430,
  "model": "llama3.2:3b",
  "has_evidence": true
}
```

---

## 6. Admin configuration namespace

Namespace: `docbrain` in `tenant_config`.

Schema keys (Python publishes the authoritative JSON Schema on startup):

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `personas` | array | built-in defaults | `{id, label, system_prompt, starter_prompts, model}` |
| `citation_requirement` | enum | `"mandatory"` | `"mandatory" \| "optional" \| "off"` |
| `evidence_threshold_for_amber_halt` | number | `0.35` | 0.0–1.0 |
| `conversation_retention_days` | integer | `90` | Days to keep conversations |
| `max_tokens_per_response` | integer | `4096` | 256–32000 |
| `default_persona_id` | string | `"general"` | Persona ID selected on new conversation |
| `pin_max_per_user` | integer | `20` | 0–100 |

---

## 7. SPA zod schemas (reference — spa-engineer owns the authoritative versions)

```ts
const V2CitationSchema = z.object({
  document_id: z.number(),
  chunk_index: z.number(),
  snippet: z.string(),
  page: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
});

const V2ConversationSchema = z.object({
  id: z.number(),
  title: z.string(),
  pinned: z.boolean(),
  folder: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  message_count: z.number(),
});

const V2MessageSchema = z.object({
  id: z.number(),
  conversation_id: z.number(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  has_evidence: z.boolean().nullable(),
  needs_verification: z.boolean(),
  citations: z.array(V2CitationSchema),
  edited_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
});
```

---

## 8. Change log

| Date | Change | Who |
|------|--------|-----|
| 2026-05-10 | Initial contract for Wave C DocBrain Chat v2 | docbrain-ai-engineer |
