import { useState, type FormEvent, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Send, Bot, User as UserIcon, ShieldAlert, AlertTriangle, Sparkles, ExternalLink } from 'lucide-react';
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

const DEMO_QUESTIONS = [
  'What documents are expiring this month?',
  'Show KYC compliance status',
  'Summarize the latest loan agreement',
] as const;

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
  /** True when streaming has started but no tokens have arrived yet */
  const [waitingForFirst, setWaitingForFirst] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const ask = useCallback((question: string) => {
    setStreaming(true);
    setWaitingForFirst(true);
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
          setWaitingForFirst(false);
          setMessages((m) => m.map((msg, i) =>
            i === m.length - 1 ? { ...msg, text: msg.text + text } : msg,
          ));
        },
        onNoEvidence: (message) => {
          setWaitingForFirst(false);
          setMessages((m) => m.map((msg, i) =>
            i === m.length - 1
              ? { ...msg, text: message, hasEvidence: false, streaming: false }
              : msg,
          ));
          setStreaming(false);
        },
        onDone: ({ hasEvidence, needsVerification }) => {
          setWaitingForFirst(false);
          setMessages((m) => m.map((msg, i) =>
            i === m.length - 1
              ? { ...msg, hasEvidence, needsVerification, streaming: false }
              : msg,
          ));
          setStreaming(false);
        },
        onError: (message) => {
          setWaitingForFirst(false);
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

  const sendDemoQuestion = (q: string) => {
    if (streaming) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
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
              {m.role === 'assistant' && m.streaming && m.text === '' ? (
                <TypingIndicator />
              ) : (
                <MessageBody text={m.text} citations={m.citations ?? []} />
              )}
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
                      <CitationCard key={j} idx={j + 1} citation={c} />
                    ))}
                  </ul>
                </div>
              )}
              {/* Show citation cards after non-verification responses too */}
              {m.role === 'assistant' && !m.needsVerification && m.citations && m.citations.length > 0 && !m.streaming && (
                <div className="mt-2 pt-2 border-t border-border/40 space-y-1.5" data-testid="docbrain-citations">
                  <p className="text-[11px] text-muted font-medium">{m.citations.length} source{m.citations.length === 1 ? '' : 's'}:</p>
                  <ul className="space-y-1">
                    {m.citations.map((c, j) => (
                      <CitationCard key={j} idx={j + 1} citation={c} />
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

        {/* Typing indicator when streaming has started but no tokens yet */}
        {waitingForFirst && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-brand-skyLight flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot size={13} className="text-brand-blue" />
            </div>
            <div className="rounded-input px-3 py-2 text-sm bg-divider text-muted">
              <TypingIndicator />
            </div>
          </div>
        )}
      </div>

      {/* Demo question chips */}
      {messages.length === 0 && !notReady && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="docbrain-demo-chips">
          {DEMO_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={streaming}
              onClick={() => sendDemoQuestion(q)}
              className="rounded-input border border-brand-blue/30 bg-brand-skyLight/50 px-3 py-1.5 text-xs text-brand-blue hover:bg-brand-skyLight transition disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

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

function TypingIndicator() {
  return (
    <span className="inline-flex gap-1 items-center" aria-label="Typing">
      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

function CitationCard({ idx, citation }: { idx: number; citation: Citation }) {
  return (
    <li className="flex items-start gap-2 rounded-input bg-page/70 border border-divider px-2 py-1.5">
      <span className="w-4 h-4 rounded-full bg-brand-skyLight text-brand-blue text-[10px] font-mono flex items-center justify-center shrink-0 mt-0.5">
        {idx}
      </span>
      <div className="flex-1 min-w-0">
        <Link
          to={`/viewer/${citation.document_id}`}
          className="text-[11px] text-brand-blue hover:underline inline-flex items-center gap-1"
          data-testid={`docbrain-citation-link-${citation.document_id}`}
        >
          Document #{citation.document_id} · chunk {citation.chunk_index}
          <ExternalLink size={9} />
        </Link>
        <p className="text-[11px] text-muted mt-0.5 line-clamp-2">{citation.snippet}</p>
      </div>
    </li>
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
