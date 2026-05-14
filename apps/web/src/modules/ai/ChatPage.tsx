/**
 * DocBrain Chat v2 — 3-pane layout:
 *   Left:   ConversationsSidebar (pinned + today + folders + FTS search)
 *   Center: MessageThread (streaming, edit-and-resend, regenerate, amber halt banner)
 *   Right:  EvidenceRail (citation cards with viewer:scroll-to-span deep-links)
 *
 * Wave C — replaces ChatPage (v1) + AgentChat (deleted).
 * Citation clicks dispatch viewer:scroll-to-span so the Wave A Viewer navigates.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  Edit2,
  ExternalLink,
  Folder,
  Info,
  MessageSquarePlus,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  User as UserIcon,
  Wrench,
  X,
} from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { eventBus } from '@/lib/events';
import {
  createV2Conversation,
  fetchV2Conversation,
  fetchV2Conversations,
  patchV2Message,
  pinV2Conversation,
  streamV2Chat,
  streamV2Regenerate,
  type V2Citation,
  type V2Conversation,
  type V2Message,
  type StreamEvent,
} from './chat-api';
import { fetchDocbrainHealth } from './api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LocalMessage {
  id: number;
  serverId?: number;
  role: 'user' | 'assistant';
  content: string;
  citations: V2Citation[];
  has_evidence: boolean | null;
  needs_verification: boolean;
  streaming?: boolean;
  error?: string;
  edited_at?: string | null;
  tool_events?: Array<{ name: string; arguments?: Record<string, unknown>; result?: unknown }>;
}

interface Persona {
  id: string;
  label: string;
  starter_prompts: string[];
}

// ---------------------------------------------------------------------------
// TokenWindowChip
// ---------------------------------------------------------------------------

function TokenWindowChip({ messages, maxTokens }: { messages: LocalMessage[]; maxTokens: number }) {
  const estimated = Math.round(messages.reduce((acc, m) => acc + m.content.length, 0) * 0.25);
  const pct = Math.min(100, (estimated / maxTokens) * 100);
  const tone = pct > 85 ? 'text-danger' : pct > 65 ? 'text-warning' : 'text-muted';
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-mono', tone)}>
      <Info size={9} />
      {estimated.toLocaleString()} / {maxTokens.toLocaleString()} tokens
    </span>
  );
}

// ---------------------------------------------------------------------------
// AmberHaltBanner
// ---------------------------------------------------------------------------

function AmberHaltBanner({
  children,
  onSearchAdjacent,
  onOverride,
}: {
  children?: React.ReactNode;
  onSearchAdjacent?: () => void;
  onOverride?: () => void;
}) {
  return (
    <div
      className="rounded-card border border-warning/40 bg-warning-bg px-3 py-2"
      data-testid="docbrain-halt-banner"
      role="alert"
      aria-live="polite"
    >
      {/* Backwards-compat alias for the Wave-C docbrain.spec.ts assertions. */}
      <span data-testid="amber-halt-banner" hidden />
      <p className="text-[11px] font-semibold text-warning flex items-center gap-1.5 mb-1.5">
        <ShieldAlert size={12} /> No grounded evidence — general knowledge only
      </p>
      <p className="text-[10px] text-ink/70 leading-relaxed mb-2">
        I don't have grounded evidence to answer this from the corpus. Try rephrasing
        the question or attach more sources to the conversation. The reply below is the
        model's general knowledge and should not be used for compliance decisions.
      </p>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <button
          type="button"
          data-testid="docbrain-halt-search-adjacent"
          onClick={onSearchAdjacent}
          className="px-2 py-1 rounded-input border border-warning/40 bg-surface text-[10px] font-medium text-warning hover:bg-warning-bg/60 focus:outline-none focus:ring-2 focus:ring-warning/40 min-h-[24px]"
        >
          Search adjacent corpora
        </button>
        <button
          type="button"
          data-testid="docbrain-halt-override"
          onClick={onOverride}
          className="px-2 py-1 rounded-input border border-warning/40 bg-surface text-[10px] font-medium text-warning hover:bg-warning-bg/60 focus:outline-none focus:ring-2 focus:ring-warning/40 min-h-[24px]"
        >
          Override (audit-logged)
        </button>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CitationButton — [^N] → viewer:scroll-to-span
// ---------------------------------------------------------------------------

function citationSpan(c: V2Citation): { page: number; x?: number; y?: number; w?: number; h?: number } {
  const span: { page: number; x?: number; y?: number; w?: number; h?: number } = { page: c.page ?? 1 };
  if (c.x !== undefined) span.x = c.x;
  if (c.y !== undefined) span.y = c.y;
  if (c.w !== undefined) span.w = c.w;
  if (c.h !== undefined) span.h = c.h;
  return span;
}

function CitationButton({ idx, citation }: { idx: number; citation: V2Citation | undefined }) {
  const handleClick = () => {
    if (!citation) return;
    eventBus.emit({
      type: 'viewer:scroll-to-span',
      payload: { documentId: String(citation.document_id), span: citationSpan(citation) },
    });
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title={citation ? citation.snippet : 'missing citation'}
      data-testid={`citation-btn-${idx}`}
      className={cn(
        'inline-block align-super text-[10px] font-semibold rounded px-1 ml-0.5',
        'bg-brand-skyLight text-brand-blue hover:bg-brand-blue hover:text-white transition-colors',
        !citation && 'opacity-40 cursor-not-allowed pointer-events-none',
      )}
    >
      {idx}
    </button>
  );
}

// ---------------------------------------------------------------------------
// MessageBody
// ---------------------------------------------------------------------------

function MessageBody({ text, citations, streaming }: { text: string; citations: V2Citation[]; streaming: boolean }) {
  if (!text && streaming) {
    return (
      <span className="inline-flex gap-1 items-center text-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" style={{ animationDelay: '120ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" style={{ animationDelay: '240ms' }} />
      </span>
    );
  }
  const parts = text.split(/(\[\^\d+\])/g);
  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {parts.map((part, i) => {
        const m = /\[\^(\d+)\]/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        const idx = parseInt(m[1] ?? '0', 10);
        return <CitationButton key={i} idx={idx} citation={citations[idx - 1]} />;
      })}
      {streaming && <span className="inline-block w-1.5 h-3 bg-current ml-0.5 align-text-bottom animate-pulse" />}
    </p>
  );
}

// ---------------------------------------------------------------------------
// MessageToolbar
// ---------------------------------------------------------------------------

function MessageToolbar({
  message, copied, onCopy, onEdit, onRetry, onRegenerate,
}: {
  message: LocalMessage;
  copied: boolean;
  onCopy: () => void;
  onEdit?: () => void;
  onRetry?: () => void;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div
      className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
      data-testid={`msg-toolbar-${message.id}`}
    >
      <button type="button" onClick={onCopy} className="text-[10px] text-muted hover:text-ink inline-flex items-center gap-0.5" title="Copy">
        {copied ? <Check size={10} className="text-success" /> : <Copy size={10} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      {isUser && onEdit && (
        <button type="button" onClick={onEdit} className="text-[10px] text-muted hover:text-ink inline-flex items-center gap-0.5" title="Edit" data-testid={`msg-edit-${message.id}`}>
          <Edit2 size={10} /> Edit
        </button>
      )}
      {isUser && onRetry && (
        <button type="button" onClick={onRetry} className="text-[10px] text-muted hover:text-ink inline-flex items-center gap-0.5" title="Retry" data-testid={`msg-retry-${message.id}`}>
          <RotateCcw size={10} /> Retry
        </button>
      )}
      {!isUser && onRegenerate && (
        <button type="button" onClick={onRegenerate} className="text-[10px] text-muted hover:text-ink inline-flex items-center gap-0.5" title="Regenerate" data-testid={`msg-regenerate-${message.id}`}>
          <RefreshCw size={10} /> Regenerate
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvidenceRail
// ---------------------------------------------------------------------------

function EvidenceRail({ citations }: { citations: V2Citation[] }) {
  if (citations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-3 py-8 text-muted">
        <Sparkles size={20} className="mb-2 text-brand-blue/30" />
        <p className="text-xs">Citation evidence appears here as the model responds.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-3 overflow-y-auto" data-testid="evidence-rail">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted pb-1">
        Evidence ({citations.length})
      </p>
      {citations.map((c, i) => (
        <div key={`${c.document_id}-${c.chunk_index}-${i}`} className="rounded-card border border-divider bg-page/80 p-2 space-y-1" data-testid={`evidence-card-${i + 1}`}>
          <div className="flex items-start gap-1.5">
            <span className="w-4 h-4 rounded-full bg-brand-skyLight text-brand-blue text-[9px] font-mono flex items-center justify-center shrink-0 mt-0.5">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <button
                type="button"
                className="text-[11px] text-brand-blue hover:underline inline-flex items-center gap-1"
                onClick={() =>
                  eventBus.emit({
                    type: 'viewer:scroll-to-span',
                    payload: { documentId: String(c.document_id), span: citationSpan(c) },
                  })
                }
                data-testid={`evidence-doc-link-${c.document_id}`}
              >
                Doc #{c.document_id} · chunk {c.chunk_index} <ExternalLink size={9} />
              </button>
              <p className="text-[11px] text-muted mt-0.5 line-clamp-3 leading-relaxed">{c.snippet}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PersonaPicker
// ---------------------------------------------------------------------------

const _FALLBACK_PERSONA: Persona = { id: 'compliance', label: 'Compliance officer', starter_prompts: ['Show KYC compliance status'] };

function PersonaPicker({ personas, onPick }: { personas: Persona[]; onPick: (persona: Persona, prompt: string) => void }) {
  const [selected, setSelected] = useState<Persona>(personas[0] ?? _FALLBACK_PERSONA);
  if (!selected) return null;
  return (
    <div className="h-full flex flex-col items-center justify-center py-8 px-4" data-testid="persona-picker">
      <div className="w-14 h-14 rounded-2xl bg-brand-skyLight flex items-center justify-center mb-4">
        <Sparkles size={26} className="text-brand-blue" />
      </div>
      <h3 className="text-lg font-semibold text-ink mb-1">Ask your document corpus</h3>
      <p className="text-sm text-muted max-w-md text-center mb-4">
        DocBrain retrieves grounded passages and answers with inline citations.
      </p>
      <div className="flex gap-2 mb-4 flex-wrap justify-center">
        {personas.map((p) => (
          <button key={p.id} type="button" onClick={() => setSelected(p)} data-testid={`persona-${p.id}`}
            className={cn('rounded-full px-3 py-1 text-xs font-medium border transition-colors',
              selected.id === p.id ? 'bg-brand-blue text-white border-brand-blue' : 'border-divider text-muted hover:border-brand-blue hover:text-brand-blue')}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 w-full max-w-lg">
        {selected.starter_prompts.map((prompt) => (
          <button key={prompt} type="button" onClick={() => onPick(selected, prompt)} data-testid="starter-prompt"
            className="text-left text-sm rounded-card border border-divider p-3 hover:bg-divider/40 text-ink">
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConversationRow + ConversationsSidebar
// ---------------------------------------------------------------------------

function ConversationRow({ item, active, onSelect, onDelete, onPin }: {
  item: V2Conversation; active: boolean;
  onSelect: () => void; onDelete: () => void; onPin: () => void;
}) {
  return (
    <div
      className={cn('flex items-start gap-1.5 px-2 py-2 rounded-md cursor-pointer group transition-colors',
        active ? 'bg-brand-skyLight' : 'hover:bg-divider/60')}
      onClick={onSelect}
      data-testid={`chat-convo-${item.id}`}
    >
      <MessageSquarePlus size={12} className="shrink-0 mt-0.5 text-muted" />
      <div className="flex-1 min-w-0">
        <p className={cn('text-xs font-medium truncate', active ? 'text-brand-blue' : 'text-ink')}>{item.title}</p>
        {item.last_message && <p className="text-[10px] text-muted truncate mt-0.5">{item.last_message}</p>}
        <div className="flex items-center gap-1 mt-0.5">
          {item.persona && <span className="text-[9px] rounded-full bg-divider px-1.5 py-0.5 text-muted">{item.persona}</span>}
          {item.folder && <span className="text-[9px] text-muted inline-flex items-center gap-0.5"><Folder size={8} />{item.folder}</span>}
          <span className="text-[9px] text-muted">{item.message_count}msg</span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button type="button" onClick={(e) => { e.stopPropagation(); onPin(); }}
          title={item.pinned ? 'Unpin' : 'Pin'}
          className="w-5 h-5 rounded flex items-center justify-center hover:bg-brand-skyLight text-muted hover:text-brand-blue"
          data-testid={`chat-pin-${item.id}`}>
          {item.pinned ? <PinOff size={10} /> : <Pin size={10} />}
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete"
          className="w-5 h-5 rounded flex items-center justify-center hover:bg-danger-bg hover:text-danger text-muted"
          data-testid={`chat-convo-${item.id}-delete`}>
          <Trash2 size={10} />
        </button>
      </div>
    </div>
  );
}

function ConversationsSidebar({ conversations, activeId, onSelect, onNew, onDelete, onPin }: {
  conversations: V2Conversation[]; activeId: number | null;
  onSelect: (id: number) => void; onNew: () => void;
  onDelete: (id: number) => void; onPin: (id: number, pinned: boolean) => void;
}) {
  const [q, setQ] = useState('');

  const searchResults = useQuery({
    queryKey: ['docbrain-v2', 'conversations', q],
    queryFn: () => fetchV2Conversations(q || undefined),
    staleTime: 5_000,
    enabled: q.length > 0,
  });

  const items = q ? (searchResults.data ?? conversations) : conversations;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const pinned = items.filter((c) => c.pinned);
  const today  = items.filter((c) => !c.pinned && (c.last_message_at ?? c.created_at) >= todayStart);
  const older  = items.filter((c) => !c.pinned && (c.last_message_at ?? c.created_at) < todayStart);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-divider">
        <p className="text-xs font-semibold text-ink flex-1">Conversations</p>
        <button type="button" onClick={onNew} title="New conversation"
          className="w-6 h-6 rounded flex items-center justify-center hover:bg-divider text-muted hover:text-ink"
          data-testid="chat-new">
          <Plus size={13} />
        </button>
      </div>
      <div className="px-3 py-2 border-b border-divider">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input type="text" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)}
            className="w-full pl-6 pr-2 py-1 text-xs rounded-input border border-border focus:outline-none focus:ring-1 focus:ring-brand-blue/30"
            data-testid="chat-search" />
          {q && (
            <button type="button" onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
              <X size={10} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1 py-2 space-y-0.5">
        <section data-testid="docbrain-conv-section-pinned" aria-label="Pinned conversations">
          {pinned.length > 0 && (
            <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted">Pinned</p>
          )}
          {pinned.map((c) => <ConversationRow key={c.id} item={c} active={c.id === activeId} onSelect={() => onSelect(c.id)} onDelete={() => onDelete(c.id)} onPin={() => onPin(c.id, !c.pinned)} />)}
        </section>
        <section data-testid="docbrain-conv-section-today" aria-label="Today's conversations">
          {today.length > 0 && (
            <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted">Today</p>
          )}
          {today.map((c) => <ConversationRow key={c.id} item={c} active={c.id === activeId} onSelect={() => onSelect(c.id)} onDelete={() => onDelete(c.id)} onPin={() => onPin(c.id, !c.pinned)} />)}
        </section>
        <section data-testid="docbrain-conv-section-earlier" aria-label="Earlier conversations">
          {older.length > 0 && (
            <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted">Earlier</p>
          )}
          {older.map((c) => <ConversationRow key={c.id} item={c} active={c.id === activeId} onSelect={() => onSelect(c.id)} onDelete={() => onDelete(c.id)} onPin={() => onPin(c.id, !c.pinned)} />)}
        </section>
        {items.length === 0 && (
          <p className="text-xs text-muted text-center py-8 px-2">
            {q ? 'No conversations match.' : 'No conversations yet.'}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageRow
// ---------------------------------------------------------------------------

function MessageRow({ message, copied, editing, onCopy, onEdit, onEditSubmit, onEditCancel, onRetry, onRegenerate }: {
  message: LocalMessage; copied: boolean; editing: boolean;
  onCopy: () => void; onEdit: () => void;
  onEditSubmit: (content: string) => void; onEditCancel: () => void;
  onRetry: () => void; onRegenerate: () => void;
}) {
  const isUser = message.role === 'user';
  const [editDraft, setEditDraft] = useState(message.content);
  useEffect(() => { setEditDraft(message.content); }, [message.content]);

  const bubble = (
    <MessageBody text={message.content} citations={message.citations} streaming={!!message.streaming} />
  );

  return (
    <div className={cn('group flex gap-3', isUser && 'flex-row-reverse')} data-testid={`chat-msg-${message.role}`}>
      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5',
        isUser ? 'bg-brand-blue text-white' : 'bg-brand-skyLight text-brand-blue')}>
        {isUser ? <UserIcon size={14} /> : <Bot size={14} />}
      </div>
      <div className={cn('max-w-[78%]', isUser && 'text-right')}>
        {/* Tool events */}
        {!isUser && message.tool_events && message.tool_events.length > 0 && (
          <ul className="flex flex-wrap gap-1 mb-2">
            {message.tool_events.map((ev, i) => (
              <li key={i} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
                ev.result !== undefined ? 'border-success/30 bg-success-bg/60 text-success' : 'border-brand-blue/30 bg-brand-skyLight/60 text-brand-blue animate-pulse')}>
                <Wrench size={9} />{ev.name}{ev.result !== undefined && <Check size={9} />}
              </li>
            ))}
          </ul>
        )}

        {/* Edit mode */}
        {editing && isUser ? (
          <div className="space-y-2">
            <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={3} autoFocus
              data-testid="msg-edit-textarea"
              className="w-full rounded-input border border-brand-blue/40 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue/30 resize-none" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={onEditCancel}>Cancel</Button>
              <Button size="sm" onClick={() => onEditSubmit(editDraft.trim())} disabled={!editDraft.trim()} data-testid="msg-edit-submit">Send</Button>
            </div>
          </div>
        ) : (
          <>
            {/* Amber halt banner wraps assistant bubble when no evidence */}
            {!isUser && message.has_evidence === false && !message.streaming ? (
              <AmberHaltBanner>
                <div className="rounded-input px-3 py-2 text-sm text-ink bg-divider/60">{bubble}</div>
              </AmberHaltBanner>
            ) : (
              <div className={cn('rounded-input px-3 py-2 text-sm inline-block text-left',
                isUser ? 'bg-brand-blue text-white' : 'bg-divider/60 text-ink')}>
                {bubble}
                {!isUser && message.needs_verification && !message.streaming && (
                  <p className="mt-2 pt-2 border-t border-border/40 text-[10px] text-warning flex items-center gap-1">
                    <AlertTriangle size={10} /> Model did not cite passages — verify against the evidence rail.
                  </p>
                )}
                {message.error && <p className="mt-1 text-[10px] text-danger border-t border-border/40 pt-1">{message.error}</p>}
              </div>
            )}
            {message.edited_at && <span className="text-[9px] text-muted ml-1 italic">edited</span>}
            {!message.streaming && (
              <MessageToolbar
                message={message} copied={copied} onCopy={onCopy}
                {...(isUser ? { onEdit, onRetry } : {})}
                {...(!isUser ? { onRegenerate } : {})}
              />
            )}
            {/* Citation list */}
            {!isUser && message.citations.length > 0 && !message.streaming && (
              <ul className="mt-2 space-y-1" data-testid="chat-citations">
                {message.citations.map((c, i) => (
                  <li key={`${c.document_id}-${c.chunk_index}-${i}`} className="flex items-start gap-2 rounded-card border border-divider p-2 bg-white text-left">
                    <span className="w-4 h-4 rounded-full bg-brand-skyLight text-brand-blue text-[9px] font-mono flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <Link to={`/viewer/${c.document_id}`} className="text-[11px] text-brand-blue hover:underline inline-flex items-center gap-1" data-testid={`chat-citation-link-${c.document_id}`}>
                        Doc #{c.document_id} · chunk {c.chunk_index} <ExternalLink size={9} />
                      </Link>
                      <p className="text-[10px] text-muted mt-0.5 line-clamp-2">{c.snippet}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatPage — main export
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 32_000;
const DEFAULT_PERSONAS = [
  { id: 'compliance',     label: 'Compliance officer', starter_prompts: ['Show KYC compliance status', 'Which fields are below confidence threshold?', 'Is this document within its validity period?'] },
  { id: 'branch_manager', label: 'Branch manager',     starter_prompts: ['What documents are expiring this month?', 'Show pending documents by branch', 'How many documents were processed today?'] },
  { id: 'auditor',        label: 'Auditor',             starter_prompts: ['Summarize the latest loan agreement', 'Show all document versions', 'Which customer records are missing a CID?'] },
] satisfies Persona[];

export function ChatPage() {
  const qc = useQueryClient();

  const [activeId, setActiveId]       = useState<number | null>(null);
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [activeCitations, setActiveCitations] = useState<V2Citation[]>([]);
  const [pending, setPending]         = useState(false);
  const [input, setInput]             = useState('');
  const [error, setError]             = useState<string | null>(null);
  const [copiedId, setCopiedId]       = useState<number | null>(null);
  const [editingId, setEditingId]     = useState<number | null>(null);

  const scrollRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef    = useRef<(() => void) | null>(null);

  const conversations = useQuery({
    queryKey: ['docbrain-v2', 'conversations', ''],
    queryFn: () => fetchV2Conversations(),
    staleTime: 15_000,
  });

  const activeDetail = useQuery({
    queryKey: ['docbrain-v2', 'conversation', activeId],
    queryFn: () => (activeId !== null ? fetchV2Conversation(activeId) : Promise.reject(new Error('no-id'))),
    enabled: activeId !== null,
  });

  const health = useQuery({
    queryKey: ['docbrain', 'health'],
    queryFn: fetchDocbrainHealth,
    retry: 0,
    staleTime: 60_000,
  });

  const ollamaDown = health.isFetched && health.data?.ollama?.ok === false;
  const chatModel  = health.data?.ollama?.chat_model ?? 'llama3.2:3b';

  useEffect(() => {
    if (activeDetail.data) setLocalMessages(activeDetail.data.messages.map(serverToLocal));
  }, [activeDetail.data]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [localMessages, pending]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input]);

  useEffect(() => {
    if (activeId === null && conversations.data && conversations.data.length > 0) {
      setActiveId(conversations.data[0]?.id ?? null);
    }
  }, [conversations.data, activeId]);

  // Update evidence rail from the latest assistant message.
  useEffect(() => {
    const last = [...localMessages].reverse().find((m) => m.role === 'assistant');
    setActiveCitations(last?.citations ?? []);
  }, [localMessages]);

  useEffect(() => () => { abortRef.current?.(); }, []);

  // ── send ──────────────────────────────────────────────────────────────────

  const send = useCallback(async (text: string, opts?: { persona?: string }) => {
    if (!text.trim() || pending) return;
    setEditingId(null);

    let convoId = activeId;
    if (convoId === null) {
      try {
        const convo = await createV2Conversation({ title: text.slice(0, 80), ...(opts?.persona ? { persona: opts.persona } : {}) });
        convoId = convo.id;
        setActiveId(convo.id);
        void qc.invalidateQueries({ queryKey: ['docbrain-v2', 'conversations'] });
      } catch (err) { setError((err as Error).message); return; }
    }

    const tempUser: LocalMessage      = { id: -Date.now(),     role: 'user',      content: text.trim(), citations: [], has_evidence: null, needs_verification: false };
    const tempAssist: LocalMessage    = { id: -Date.now() - 1, role: 'assistant', content: '',           citations: [], has_evidence: null, needs_verification: false, streaming: true };
    setLocalMessages((m) => [...m, tempUser, tempAssist]);
    setInput('');
    setPending(true);
    setError(null);

    const abort = streamV2Chat(convoId, text.trim(), undefined, (evt: StreamEvent) => {
      setLocalMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        if (!last || last.role !== 'assistant') return m;
        switch (evt.type) {
          case 'token':       return [...next.slice(0, -1), { ...last, content: last.content + evt.text }];
          case 'citations':   return [...next.slice(0, -1), { ...last, citations: evt.items as V2Citation[] }];
          case 'no_evidence': return [...next.slice(0, -1), { ...last, content: evt.message ?? '', has_evidence: false, streaming: false }];
          case 'done':        return [...next.slice(0, -1), { ...last, has_evidence: evt.has_evidence ?? true, needs_verification: evt.needs_verification ?? false, streaming: false }];
          case 'error': {
            const errMsg: string = evt.message ?? `HTTP ${evt.status ?? '?'}`;
            return [...next.slice(0, -1), { ...last, streaming: false, error: errMsg }];
          }
          default:            return m;
        }
      });
      if (evt.type === 'done' || evt.type === 'no_evidence' || evt.type === 'error') {
        setPending(false);
        abortRef.current = null;
        void qc.invalidateQueries({ queryKey: ['docbrain-v2', 'conversation', convoId] });
        void qc.invalidateQueries({ queryKey: ['docbrain-v2', 'conversations'] });
      }
    });
    abortRef.current = abort;
  }, [activeId, pending, qc]);

  const stop = () => {
    abortRef.current?.();
    abortRef.current = null;
    setPending(false);
    setLocalMessages((m) => {
      const next = [...m];
      const last = next[next.length - 1];
      if (last && last.role === 'assistant' && last.streaming) {
        next[next.length - 1] = { ...last, streaming: false, content: last.content || '(stopped)' };
      }
      return next;
    });
  };

  // ── edit-and-resend ───────────────────────────────────────────────────────

  const handleEditSubmit = useCallback(async (messageId: number, content: string) => {
    if (!activeId || !content.trim()) return;
    setEditingId(null);
    try {
      await patchV2Message(messageId, activeId, content.trim());
      setLocalMessages((msgs) => {
        const idx = msgs.findIndex((m) => m.id === messageId);
        if (idx < 0) return msgs;
        return [...msgs.slice(0, idx), { ...msgs[idx]!, content: content.trim(), edited_at: new Date().toISOString() }];
      });
      void send(content.trim());
    } catch { setError('Edit failed — please retry'); }
  }, [activeId, send]);

  // ── regenerate ───────────────────────────────────────────────────────────

  const handleRegenerate = useCallback((messageId: number) => {
    if (!activeId || pending) return;
    setPending(true);
    setLocalMessages((msgs) => {
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx < 0) return msgs;
      const newMsg: LocalMessage = { id: -Date.now(), role: 'assistant', content: '', citations: [], has_evidence: null, needs_verification: false, streaming: true };
      return [...msgs.slice(0, idx), newMsg];
    });
    const abort = streamV2Regenerate(messageId, activeId, (evt: StreamEvent) => {
      setLocalMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        if (!last || last.role !== 'assistant') return m;
        switch (evt.type) {
          case 'token':     return [...next.slice(0, -1), { ...last, content: last.content + evt.text }];
          case 'citations': return [...next.slice(0, -1), { ...last, citations: evt.items as V2Citation[] }];
          case 'done':
            setPending(false);
            void qc.invalidateQueries({ queryKey: ['docbrain-v2', 'conversation', activeId] });
            return [...next.slice(0, -1), { ...last, has_evidence: evt.has_evidence ?? true, needs_verification: evt.needs_verification ?? false, streaming: false }];
          case 'error': {
            setPending(false);
            const regenErrMsg: string = evt.message ?? `HTTP ${evt.status ?? '?'}`;
            return [...next.slice(0, -1), { ...last, streaming: false, error: regenErrMsg }];
          }
          default: return m;
        }
      });
    });
    abortRef.current = abort;
  }, [activeId, pending, qc]);

  // ── copy ─────────────────────────────────────────────────────────────────

  const copy = async (msg: LocalMessage) => {
    await navigator.clipboard.writeText(msg.content);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId((c) => (c === msg.id ? null : c)), 1200);
  };

  // ── mutations ─────────────────────────────────────────────────────────────

  const newConvo = useMutation({
    mutationFn: () => createV2Conversation({ title: 'New chat' }),
    onSuccess: (convo) => {
      setActiveId(convo.id);
      setLocalMessages([]);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['docbrain-v2', 'conversations'] });
    },
  });

  const pinConvo = useMutation({
    mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) => pinV2Conversation(id, pinned),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['docbrain-v2', 'conversations'] }),
  });

  const handleDelete = (id: number) => {
    if (!confirm('Delete this conversation?')) return;
    if (activeId === id) { setActiveId(null); setLocalMessages([]); }
    void qc.invalidateQueries({ queryKey: ['docbrain-v2', 'conversations'] });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const submit = (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ||
                   (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing);
    if (submit) { e.preventDefault(); void send(input); }
  };

  const convList = conversations.data ?? [];

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="grid grid-cols-[240px_1fr_260px] h-[calc(100vh-120px)] min-h-[540px] border border-divider rounded-card overflow-hidden"
      data-testid="docbrain-chat-v2"
    >
      {/* LEFT — sidebar */}
      <div
        data-testid="docbrain-conversations-sidebar"
        className="border-r border-divider bg-surface-alt overflow-hidden flex flex-col"
      >
        <ConversationsSidebar
          conversations={convList}
          activeId={activeId}
          onSelect={(id) => { setActiveId(id); setLocalMessages([]); setEditingId(null); }}
          onNew={() => newConvo.mutate()}
          onDelete={handleDelete}
          onPin={(id, pinned) => pinConvo.mutate({ id, pinned })}
        />
      </div>

      {/* CENTER — thread */}
      <div data-testid="docbrain-message-thread" className="flex flex-col overflow-hidden bg-surface">
        <div className="flex items-center justify-between px-4 py-2 border-b border-divider">
          <p className="text-sm font-semibold text-ink truncate">
            {activeDetail.data?.conversation.title ?? (activeId === null ? 'DocBrain Chat' : 'Loading…')}
          </p>
          <div className="flex items-center gap-3 text-xs text-muted">
            <TokenWindowChip messages={localMessages} maxTokens={DEFAULT_MAX_TOKENS} />
            <Sparkles size={12} className="text-brand-blue" />
            <span>{chatModel}</span>
            {ollamaDown && <Badge tone="danger">Ollama down</Badge>}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4" data-testid="chat-thread">
          {localMessages.length === 0 ? (
            <PersonaPicker personas={DEFAULT_PERSONAS} onPick={(p, prompt) => void send(prompt, { persona: p.id })} />
          ) : (
            localMessages.map((m) => (
              <MessageRow
                key={m.id} message={m} copied={copiedId === m.id} editing={editingId === m.id}
                onCopy={() => void copy(m)}
                onEdit={() => setEditingId(m.id)}
                onEditSubmit={(c) => void handleEditSubmit(m.id, c)}
                onEditCancel={() => setEditingId(null)}
                onRetry={() => void send(m.content)}
                onRegenerate={() => handleRegenerate(m.id)}
              />
            ))
          )}
        </div>

        {error && (
          <div className="mx-4 mb-2 rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger" data-testid="chat-error">
            {error}
          </div>
        )}

        <form className="px-4 py-3 border-t border-divider flex gap-2 items-end" onSubmit={(e: FormEvent) => { e.preventDefault(); void send(input); }}>
          <textarea
            ref={textareaRef} rows={1} value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={ollamaDown ? 'Ollama is unreachable — start the daemon.' : 'Ask anything about your documents… (Enter to send)'}
            disabled={pending || ollamaDown}
            data-testid="chat-input"
            className="flex-1 resize-none rounded-input border border-border px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:opacity-60"
          />
          {pending ? (
            <Button type="button" size="sm" variant="secondary" onClick={stop} data-testid="chat-stop">
              <Square size={12} /> Stop
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!input.trim() || ollamaDown} data-testid="chat-send" aria-label="Send">
              <Send size={12} />
            </Button>
          )}
        </form>
        <p className="px-4 pb-2 text-[10px] text-muted flex items-center gap-1">
          <Info size={10} /> Grounded answers only — every claim carries a citation.
          <span className="ml-auto">Shift+Enter for newline</span>
        </p>
      </div>

      {/* RIGHT — evidence rail */}
      <div data-testid="docbrain-evidence-rail" className="border-l border-divider bg-surface-alt overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-divider">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Evidence Rail</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <EvidenceRail citations={activeCitations} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serverToLocal(m: V2Message): LocalMessage {
  return {
    id:                 m.id,
    serverId:           m.id,
    role:               m.role,
    content:            m.content,
    citations:          m.citations,
    has_evidence:       m.has_evidence,
    needs_verification: m.needs_verification,
    edited_at:          m.edited_at,
  };
}
