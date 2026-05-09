import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Info,
  MessageSquarePlus,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { Badge, Button, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  createConversation,
  deleteConversation,
  fetchConversation,
  fetchConversations,
  streamChat,
  type ChatMode,
  type Citation,
  type ChatMessage,
  type ConversationListItem,
} from './chat-api';
import { fetchDocbrainHealth } from './api';
import { ToolResultView } from './ToolResultView';

/** Local representation of a message mid-stream (id is negative until saved). */
interface ToolEvent {
  name: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
}
interface LocalMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  has_evidence: boolean | null;
  streaming?: boolean;
  error?: string;
  tool_events?: ToolEvent[];
  needs_verification?: boolean;
}

const SUGGESTED_PROMPTS = [
  'What documents are expiring this month?',
  'Show KYC compliance status',
  'Summarize the latest loan agreement',
  'Which customer records are missing a CID?',
] as const;

export function ChatPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState('');
  // Agent is the only public chat mode — it uses the tool registry
  // (aggregate_rows, find_documents, list_expiring, lookup_glossary, …) and
  // falls through to grounded RAG via find_documents when the question is
  // passage-level. Keeping `mode` as a constant preserves the existing
  // `send()` plumbing without a refactor.
  const mode: ChatMode = 'agent';
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const conversations = useQuery({
    queryKey: ['ai', 'conversations'],
    queryFn: fetchConversations,
  });

  const active = useQuery({
    queryKey: ['ai', 'conversation', activeId],
    queryFn: () => (activeId !== null ? fetchConversation(activeId) : Promise.reject(new Error('no-id'))),
    enabled: activeId !== null,
  });

  const docbrain = useQuery({
    queryKey: ['docbrain', 'health'],
    queryFn: fetchDocbrainHealth,
    retry: 0,
    staleTime: 60_000,
  });

  // When the server-persisted messages arrive, adopt them as the source of truth.
  useEffect(() => {
    if (active.data) {
      setLocalMessages(active.data.messages.map(serverToLocal));
    }
  }, [active.data]);

  // Scroll to the bottom on every render while messages change.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [localMessages, pending]);

  // Auto-resize the textarea as the user types.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input]);

  const create = useMutation({
    mutationFn: createConversation,
    onSuccess: (convo) => {
      setActiveId(convo.id);
      setLocalMessages([]);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] });
    },
  });

  const remove = useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] });
    },
  });

  const startNew = useCallback(() => {
    create.mutate({ title: 'New chat', scope_type: 'all' });
  }, [create]);

  // If there are conversations but none selected, open the most recent.
  useEffect(() => {
    if (activeId === null && conversations.data && conversations.data.length > 0) {
      setActiveId(conversations.data[0]?.id ?? null);
    }
  }, [conversations.data, activeId]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || pending) return;
      let convoId = activeId;
      if (convoId === null) {
        try {
          const convo = await createConversation({ title: text.slice(0, 80), scope_type: 'all' });
          convoId = convo.id;
          setActiveId(convo.id);
          void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] });
        } catch (err) {
          setError((err as Error).message);
          return;
        }
      }

      const userMsg: LocalMessage = {
        id: -Date.now(),
        role: 'user',
        content: text.trim(),
        citations: [],
        has_evidence: null,
      };
      const assistantMsg: LocalMessage = {
        id: -Date.now() - 1,
        role: 'assistant',
        content: '',
        citations: [],
        has_evidence: null,
        streaming: true,
      };
      setLocalMessages((m) => [...m, userMsg, assistantMsg]);
      setInput('');
      setPending(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamChat(
          convoId,
          text.trim(),
          (evt) => {
            if (evt.type === 'token') {
              setLocalMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: last.content + evt.text };
                }
                return next;
              });
            } else if (evt.type === 'citations') {
              setLocalMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = { ...last, citations: evt.items };
                }
                return next;
              });
            } else if (evt.type === 'no_evidence') {
              setLocalMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: evt.message, has_evidence: false, streaming: false };
                }
                return next;
              });
            } else if (evt.type === 'done') {
              setLocalMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = {
                    ...last,
                    has_evidence: evt.has_evidence ?? true,
                    ...(evt.needs_verification !== undefined ? { needs_verification: evt.needs_verification } : {}),
                    streaming: false,
                  };
                }
                return next;
              });
            } else if (evt.type === 'tool_call') {
              setLocalMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  const events = [...(last.tool_events ?? []), { name: evt.name, arguments: evt.arguments }];
                  next[next.length - 1] = { ...last, tool_events: events };
                }
                return next;
              });
            } else if (evt.type === 'tool_result') {
              setLocalMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant' && last.tool_events && last.tool_events.length > 0) {
                  const events = [...last.tool_events];
                  // Attach the result to the most recent matching call.
                  for (let i = events.length - 1; i >= 0; i -= 1) {
                    const candidate = events[i];
                    if (candidate && candidate.name === evt.name && candidate.result === undefined) {
                      events[i] = { ...candidate, result: evt.result };
                      break;
                    }
                  }
                  next[next.length - 1] = { ...last, tool_events: events };
                }
                return next;
              });
            } else if (evt.type === 'error') {
              setLocalMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = {
                    ...last,
                    streaming: false,
                    error: evt.message ?? `HTTP ${evt.status ?? '?'}`,
                  };
                }
                return next;
              });
            }
          },
          controller.signal,
          mode,
        );
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message);
        }
      } finally {
        setPending(false);
        abortRef.current = null;
        void qc.invalidateQueries({ queryKey: ['ai', 'conversation', convoId] });
        void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] });
      }
    },
    [activeId, pending, qc, mode],
  );

  const stop = () => {
    abortRef.current?.abort();
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

  const copy = async (msg: LocalMessage) => {
    await navigator.clipboard.writeText(msg.content);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId((c) => (c === msg.id ? null : c)), 1200);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const isSubmit = (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ||
                     (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing);
    if (isSubmit) {
      e.preventDefault();
      void send(input);
    }
  };

  const ollamaDown =
    docbrain.isFetched && docbrain.data?.ollama?.ok === false;

  const sidebarItems = useMemo(() => conversations.data ?? [], [conversations.data]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-6 h-[calc(100vh-180px)] min-h-[540px]">
      <Panel
        title="Chats"
        className="flex flex-col overflow-hidden"
        action={
          <Button size="sm" onClick={startNew} data-testid="chat-new">
            <Plus size={13} /> New
          </Button>
        }
      >
        <div className="flex-1 overflow-y-auto -mx-2 space-y-1 pr-1">
          {sidebarItems.length === 0 && !conversations.isLoading && (
            <p className="text-xs text-muted text-center py-6 px-3">
              No conversations yet. Start one with the button above.
            </p>
          )}
          {sidebarItems.map((c) => (
            <ConversationRow
              key={c.id}
              item={c}
              active={c.id === activeId}
              onSelect={() => setActiveId(c.id)}
              onDelete={() => {
                if (confirm(`Delete conversation "${c.title}"?`)) {
                  remove.mutate(c.id, {
                    onSuccess: () => {
                      if (activeId === c.id) {
                        setActiveId(null);
                        setLocalMessages([]);
                      }
                    },
                  });
                }
              }}
            />
          ))}
        </div>
      </Panel>

      <Panel
        className="flex flex-col overflow-hidden"
        title={
          active.data?.conversation.title ??
          (activeId === null ? 'AI Search' : 'Loading…')
        }
        action={
          <div className="flex items-center gap-3 text-xs text-muted">
            <Sparkles size={13} className="text-brand-blue" />
            <span>Agent · {docbrain.data?.ollama?.chat_model ?? 'llama3.2:3b'}</span>
            {ollamaDown && <Badge tone="danger">Ollama down</Badge>}
          </div>
        }
      >
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto space-y-4 pr-1"
          data-testid="chat-thread"
        >
          {localMessages.length === 0 ? (
            <EmptyState onPick={(p) => void send(p)} ollamaDown={ollamaDown} />
          ) : (
            localMessages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                copied={copiedId === m.id}
                onCopy={() => copy(m)}
              />
            ))
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger" data-testid="chat-error">
            {error}
          </div>
        )}

        <form
          className="mt-3 pt-3 border-t border-divider flex gap-2 items-end"
          onSubmit={(e) => { e.preventDefault(); void send(input); }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              ollamaDown
                ? 'Ollama is unreachable — start the daemon to chat.'
                : 'Ask anything about your documents…'
            }
            disabled={pending || ollamaDown}
            data-testid="chat-input"
            className="flex-1 resize-none rounded-input border border-border px-3 py-2 text-md text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:opacity-60"
          />
          {pending ? (
            <Button type="button" size="sm" variant="secondary" onClick={stop} data-testid="chat-stop">
              <Square size={13} /> Stop
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={!input.trim() || ollamaDown}
              data-testid="chat-send"
              aria-label="Send"
            >
              <Send size={13} />
            </Button>
          )}
        </form>

        <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <Info size={11} /> Grounded answers only — every claim carries a citation.
          </span>
          <span>Enter to send · Shift+Enter for newline</span>
        </div>
      </Panel>
    </div>
  );
}

function ConversationRow({
  item,
  active,
  onSelect,
  onDelete,
}: {
  item: ConversationListItem;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer group',
        active ? 'bg-brand-skyLight text-brand-blue' : 'hover:bg-divider',
      )}
      onClick={onSelect}
      data-testid={`chat-convo-${item.id}`}
    >
      <MessageSquarePlus size={13} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <p className={cn('text-xs font-medium truncate', active ? 'text-brand-blue' : 'text-ink')}>
          {item.title}
        </p>
        <p className="text-[10px] text-muted truncate">
          {item.message_count > 0 ? `${item.message_count} messages` : 'Empty'}
        </p>
      </div>
      <button
        type="button"
        aria-label="Delete"
        data-testid={`chat-convo-${item.id}-delete`}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded flex items-center justify-center hover:bg-danger-bg hover:text-danger"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function EmptyState({
  onPick,
  ollamaDown,
}: {
  onPick: (text: string) => void;
  ollamaDown: boolean;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center py-8">
      <div className="w-14 h-14 rounded-2xl bg-brand-skyLight flex items-center justify-center mb-4">
        <Sparkles size={26} className="text-brand-blue" />
      </div>
      <h3 className="text-lg font-semibold text-ink mb-1">Ask your document corpus</h3>
      <p className="text-md text-muted max-w-md">
        DocBrain retrieves grounded passages, then answers with inline citations.
        Every response links to the source document.
      </p>
      {!ollamaDown && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-2 w-full max-w-xl">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPick(p)}
              data-testid="chat-suggested"
              className="text-left text-md rounded-card border border-divider p-3 hover:bg-divider/40 text-ink"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageRow({
  message,
  copied,
  onCopy,
}: {
  message: LocalMessage;
  copied: boolean;
  onCopy: () => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div
      className={cn('flex gap-3', isUser && 'flex-row-reverse')}
      data-testid={`chat-msg-${message.role}`}
    >
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
          isUser ? 'bg-brand-blue text-white' : 'bg-brand-skyLight text-brand-blue',
        )}
      >
        {isUser ? <UserIcon size={14} /> : <Bot size={14} />}
      </div>
      <div className={cn('max-w-[82%]', isUser && 'text-right')}>
        {!isUser && message.tool_events && message.tool_events.length > 0 && (
          <div className="mb-2 space-y-2" data-testid={`chat-tools-${message.id}`}>
            <ul className="flex flex-wrap gap-1">
              {message.tool_events.map((ev, i) => (
                <li
                  key={i}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]',
                    ev.result !== undefined
                      ? 'border-success/30 bg-success-bg/60 text-success'
                      : 'border-brand-blue/30 bg-brand-skyLight/60 text-brand-blue animate-pulse',
                  )}
                  title={JSON.stringify(ev.arguments ?? {}, null, 2)}
                >
                  <Sparkles size={9} />
                  {ev.name}
                  {ev.result !== undefined && <Check size={9} />}
                </li>
              ))}
            </ul>
            {/* Inline data visualisation per tool_result — the prose answer
                stays concise and the user gets the table / chart directly. */}
            <div className="space-y-2">
              {message.tool_events
                .filter((ev) => ev.result !== undefined)
                .map((ev, i) => (
                  <ToolResultView key={`res-${i}`} result={ev.result} />
                ))}
            </div>
          </div>
        )}
        <div
          className={cn(
            'rounded-input px-3 py-2 text-md inline-block text-left',
            isUser ? 'bg-brand-blue text-white' : 'bg-divider/60 text-ink',
          )}
        >
          <MessageBody text={message.content} citations={message.citations} streaming={!!message.streaming} />
          {message.has_evidence === false && !message.streaming && (
            <p className="mt-2 pt-2 border-t border-border/40 text-[11px] text-warning flex items-center gap-1">
              <ShieldAlert size={11} /> No grounded evidence
            </p>
          )}
          {message.needs_verification && !message.streaming && (
            <p className="mt-2 pt-2 border-t border-border/40 text-[11px] text-warning flex items-center gap-1">
              <ShieldAlert size={11} /> Model did not cite passages — verify against the retrieved context below.
            </p>
          )}
          {message.error && (
            <p className="mt-2 pt-2 border-t border-border/40 text-[11px] text-danger">
              {message.error}
            </p>
          )}
        </div>
        {!isUser && message.content && !message.streaming && (
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onCopy}
              className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1"
              data-testid={`chat-copy-${message.id}`}
            >
              {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {message.citations.length > 0 && (
              <span className="text-[11px] text-muted">
                {message.citations.length} citation{message.citations.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}
        {!isUser && message.citations.length > 0 && !message.streaming && (
          <ul className="mt-2 space-y-1.5" data-testid="chat-citations">
            {message.citations.map((c, i) => (
              <CitationCard key={`${c.document_id}-${c.chunk_index}-${i}`} idx={i + 1} citation={c} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MessageBody({
  text,
  citations,
  streaming,
}: {
  text: string;
  citations: Citation[];
  streaming: boolean;
}) {
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
        const valid = idx >= 1 && idx <= citations.length;
        return (
          <span
            key={i}
            title={valid ? citations[idx - 1]?.snippet : 'missing citation'}
            className="inline-block align-super text-[10px] font-semibold rounded px-1 ml-0.5 cursor-help bg-white/80 text-brand-blue"
          >
            {idx}
          </span>
        );
      })}
      {streaming && <span className="inline-block w-1.5 h-3 bg-current ml-0.5 align-text-bottom animate-pulse" />}
    </p>
  );
}

function CitationCard({ idx, citation }: { idx: number; citation: Citation }) {
  return (
    <li className="flex items-start gap-2 rounded-card border border-divider p-2 bg-white">
      <span className="w-5 h-5 rounded-full bg-brand-skyLight text-brand-blue text-[10px] font-mono flex items-center justify-center shrink-0 mt-0.5">
        {idx}
      </span>
      <div className="flex-1 min-w-0">
        <Link
          to={`/viewer/${citation.document_id}`}
          className="text-xs text-brand-blue hover:underline inline-flex items-center gap-1"
          data-testid={`chat-citation-link-${citation.document_id}`}
        >
          Document #{citation.document_id} · chunk {citation.chunk_index} <ExternalLink size={10} />
        </Link>
        <p className="text-[11px] text-muted mt-1 line-clamp-3">{citation.snippet}</p>
      </div>
    </li>
  );
}

function serverToLocal(m: ChatMessage): LocalMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    citations: m.citations,
    has_evidence: m.has_evidence,
  };
}
