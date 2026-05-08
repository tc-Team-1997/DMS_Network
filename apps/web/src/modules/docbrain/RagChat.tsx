import { useState, type FormEvent, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Bot, User as UserIcon, ShieldAlert, AlertTriangle, Sparkles } from 'lucide-react';
import { Button, Input, Panel } from '@/components/ui';
import { fetchAnalysis, streamDocBrain } from './api';
import type { Citation } from './api';
import { HttpError } from '@/lib/http';
import { cn } from '@/lib/cn';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  hasEvidence?: boolean;
  needsVerification?: boolean;
  streaming?: boolean;
}

export function RagChat({ documentId }: { documentId: number }) {
  const analysis = useQuery({
    queryKey: ['docbrain', 'analysis', documentId],
    queryFn: async () => {
      try {
        return await fetchAnalysis(documentId);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return null;
        throw err;
      }
    },
    retry: false,
  });
  const chunksIndexed = analysis.data?.chunks_indexed ?? 0;
  const notReady = !analysis.data || chunksIndexed === 0;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const ask = useCallback((question: string) => {
    setStreaming(true);
    // Append the assistant bubble immediately so tokens stream into it.
    setMessages((m) => [...m, { role: 'assistant', text: '', streaming: true }]);

    abortRef.current = streamDocBrain(
      { question, documentId },
      {
        onCitations: (items) => {
          setMessages((m) => m.map((msg, i) =>
            i === m.length - 1 ? { ...msg, citations: items } : msg,
          ));
        },
        onToken: (text) => {
          setMessages((m) => m.map((msg, i) =>
            i === m.length - 1 ? { ...msg, text: msg.text + text } : msg,
          ));
        },
        onNoEvidence: (message) => {
          setMessages((m) => m.map((msg, i) =>
            i === m.length - 1
              ? { ...msg, text: message, hasEvidence: false, streaming: false }
              : msg,
          ));
          setStreaming(false);
        },
        onDone: ({ hasEvidence, needsVerification }) => {
          setMessages((m) => m.map((msg, i) =>
            i === m.length - 1
              ? { ...msg, hasEvidence, needsVerification, streaming: false }
              : msg,
          ));
          setStreaming(false);
        },
        onError: (message) => {
          setMessages((m) => m.map((msg, i) =>
            i === m.length - 1
              ? { ...msg, text: `Error: ${message}`, hasEvidence: false, streaming: false }
              : msg,
          ));
          setStreaming(false);
        },
      },
    );
  }, [documentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => () => abortRef.current?.(), []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || streaming) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    ask(q);
  };

  return (
    <Panel
      title="Ask the document"
      action={
        <span className="text-[10px] text-muted inline-flex items-center gap-1.5">
          <Sparkles size={10} className="text-brand-blue" />
          {chunksIndexed > 0
            ? `${chunksIndexed} chunks indexed`
            : 'Not indexed yet'}
        </span>
      }
    >
      {notReady && (
        <div
          className="mb-3 rounded-card border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-ink flex items-start gap-2"
          data-testid="docbrain-chat-not-indexed"
        >
          <AlertTriangle size={13} className="text-warning mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">This document isn't indexed yet.</p>
            <p className="text-muted mt-0.5">
              Click <span className="font-semibold">Analyse</span> in the DocBrain panel above to run
              OCR + embedding. The chat needs retrievable passages to answer without hallucinating.
            </p>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="max-h-[360px] min-h-[200px] overflow-y-auto space-y-3 pr-1"
        data-testid="docbrain-chat-log"
      >
        {messages.length === 0 && !notReady && (
          <div className="text-center py-6 text-muted">
            <Bot size={22} className="mx-auto mb-2" />
            <p className="text-sm">Ask anything about this document.</p>
            <p className="text-xs mt-1">Try: "When does it expire?" · "Who issued it?"</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-brand-skyLight flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot size={13} className="text-brand-blue" />
              </div>
            )}
            <div className={cn(
              'rounded-input px-3 py-2 text-sm max-w-[85%]',
              m.role === 'user' ? 'bg-brand-blue text-white' : 'bg-divider text-ink',
            )}>
              <MessageBody text={m.text} citations={m.citations ?? []} />
              {m.role === 'assistant' && m.hasEvidence === false && (
                <p className="mt-2 pt-2 border-t border-border/40 text-[11px] text-warning flex items-center gap-1">
                  <ShieldAlert size={11} /> No grounded evidence
                </p>
              )}
              {m.role === 'assistant' && m.needsVerification && m.citations && m.citations.length > 0 && (
                <div
                  className="mt-2 pt-2 border-t border-border/40 space-y-1.5"
                  data-testid="docbrain-chat-verify"
                >
                  <p className="text-[11px] text-warning flex items-center gap-1">
                    <AlertTriangle size={11} /> Model did not cite passages — verify against the retrieved context below.
                  </p>
                  <ul className="space-y-1">
                    {m.citations.map((c, j) => (
                      <li
                        key={j}
                        className="rounded-input bg-page/70 border border-divider px-2 py-1 text-[11px] text-ink-sub"
                      >
                        <span className="font-mono text-muted">doc #{c.document_id} · chunk {c.chunk_index}</span>
                        <div className="mt-0.5 line-clamp-3">{c.snippet}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {m.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-brand-blue flex items-center justify-center flex-shrink-0 mt-0.5">
                <UserIcon size={13} className="text-white" />
              </div>
            )}
          </div>
        ))}

        {streaming && messages[messages.length - 1]?.text === '' && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-brand-skyLight flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot size={13} className="text-brand-blue" />
            </div>
            <div className="rounded-input px-3 py-2 text-sm bg-divider text-muted animate-pulse">
              Searching passages…
            </div>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex gap-2 pt-3 border-t border-divider">
        <Input
          name="question"
          placeholder={notReady ? 'Analyse the document first…' : 'Ask a question about this document…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1"
          disabled={notReady}
          data-testid="docbrain-chat-input"
        />
        <Button
          type="submit"
          loading={streaming}
          disabled={!input.trim() || notReady}
          aria-label="Send question"
          data-testid="docbrain-chat-send"
        >
          <Send size={14} />
        </Button>
      </form>
    </Panel>
  );
}

function MessageBody({ text, citations }: { text: string; citations: Citation[] }) {
  // Turn [^N] markers into subscript-style pills that link-hover to the snippet
  const parts = text.split(/(\[\^\d+\])/g);
  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {parts.map((part, i) => {
        const m = /\[\^(\d+)\]/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        const idx = parseInt(m[1] ?? '0', 10) - 1;
        const cite = citations[idx];
        return (
          <span
            key={i}
            title={cite ? cite.snippet : 'missing citation'}
            className="inline-block align-super text-[9px] font-semibold bg-white/80 text-brand-blue rounded px-1 ml-0.5 cursor-help"
          >
            {idx + 1}
          </span>
        );
      })}
    </p>
  );
}
