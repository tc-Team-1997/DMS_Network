import { useState, type FormEvent, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Send, Bot, User as UserIcon, ShieldAlert } from 'lucide-react';
import { Button, Input, Panel } from '@/components/ui';
import { askDocBrain } from './api';
import type { ChatResponse, Citation } from './api';
import { cn } from '@/lib/cn';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  hasEvidence?: boolean;
}

export function RagChat({ documentId }: { documentId: number }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: (question: string) =>
      askDocBrain({ question, documentId }),
    onSuccess: (r: ChatResponse) => {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: r.answer, citations: r.citations, hasEvidence: r.has_evidence },
      ]);
    },
    onError: (err: Error) => {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `Error: ${err.message}`, hasEvidence: false },
      ]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, ask.isPending]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || ask.isPending) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    ask.mutate(q);
  };

  return (
    <Panel title="Ask the document" action={<span className="text-[10px] text-muted">Local Llama · citations required</span>}>
      <div
        ref={scrollRef}
        className="max-h-[360px] min-h-[200px] overflow-y-auto space-y-3 pr-1"
        data-testid="docbrain-chat-log"
      >
        {messages.length === 0 && (
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
              'rounded-input px-3 py-2 text-sm max-w-[80%]',
              m.role === 'user' ? 'bg-brand-blue text-white' : 'bg-divider text-ink',
            )}>
              <MessageBody text={m.text} citations={m.citations ?? []} />
              {m.role === 'assistant' && m.hasEvidence === false && (
                <p className="mt-2 pt-2 border-t border-border/40 text-[11px] text-warning flex items-center gap-1">
                  <ShieldAlert size={11} /> No grounded evidence
                </p>
              )}
            </div>
            {m.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-brand-blue flex items-center justify-center flex-shrink-0 mt-0.5">
                <UserIcon size={13} className="text-white" />
              </div>
            )}
          </div>
        ))}

        {ask.isPending && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-brand-skyLight flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot size={13} className="text-brand-blue" />
            </div>
            <div className="rounded-input px-3 py-2 text-sm bg-divider text-muted animate-pulse">
              Thinking…
            </div>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex gap-2 pt-3 border-t border-divider">
        <Input
          name="question"
          placeholder="Ask a question about this document…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1"
          data-testid="docbrain-chat-input"
        />
        <Button
          type="submit"
          loading={ask.isPending}
          disabled={!input.trim()}
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
