/**
 * DocBrain ecosystem chat — the tool-using agent answers questions about the
 * whole DMS ("how many documents pending", "what's expiring this week",
 * "find the KYC for CID 123…"). Backed by /spa/api/ai/agent/stream which
 * runs Ollama native tool-calling against the Node SQLite + vector store.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, Bot, User as UserIcon, Wrench, Sparkles } from 'lucide-react';
import { Button, Input, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { ToolResultView } from './ToolResultView';

interface ToolTrail {
  name: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  tools?: ToolTrail[];
  streaming?: boolean;
}

const EXAMPLES = [
  'How many documents were processed in the last 3 days?',
  'How many are still pending?',
  'Break down documents by branch for this month.',
  'Show me the processing rate per day for the last 2 weeks.',
  'What expires in the next 30 days?',
  'Any unread critical alerts?',
  'Recent activity feed for the last 7 days.',
];

export function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [convoId, setConvoId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ensureConversation = useCallback(async (): Promise<number> => {
    if (convoId != null) return convoId;
    const res = await fetch('/spa/api/ai/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title: 'AI Engine', scope_type: 'all' }),
    });
    if (!res.ok) throw new Error(`conversation failed: HTTP ${res.status}`);
    const conv = await res.json();
    setConvoId(conv.id);
    return conv.id as number;
  }, [convoId]);

  const ask = useCallback(async (question: string) => {
    setStreaming(true);
    setMessages((m) => [...m, { role: 'assistant', text: '', tools: [], streaming: true }]);

    const ctl = new AbortController();
    abortRef.current = ctl;

    try {
      const conversation_id = await ensureConversation();
      const res = await fetch('/spa/api/ai/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        credentials: 'include',
        signal: ctl.signal,
        body: JSON.stringify({ conversation_id, question }),
      });
      if (!res.ok || !res.body) {
        setMessages((m) => m.map((msg, i) =>
          i === m.length - 1
            ? { ...msg, text: `Error: HTTP ${res.status}`, streaming: false }
            : msg,
        ));
        setStreaming(false);
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
            setMessages((m) => m.map((msg, i) => {
              if (i !== m.length - 1) return msg;
              switch (evt.type) {
                case 'tool_call':
                  return {
                    ...msg,
                    tools: [...(msg.tools ?? []), { name: evt.name, arguments: evt.arguments }],
                  };
                case 'tool_result': {
                  const tools = [...(msg.tools ?? [])];
                  const idxT = tools.findIndex((t) => t.name === evt.name && t.result === undefined);
                  if (idxT >= 0) tools[idxT] = { ...tools[idxT], name: tools[idxT]?.name ?? evt.name, result: evt.result };
                  else tools.push({ name: evt.name, result: evt.result });
                  return { ...msg, tools };
                }
                case 'token':
                  return { ...msg, text: msg.text + (evt.text ?? '') };
                case 'done':
                  return { ...msg, streaming: false };
                case 'error':
                  return { ...msg, text: `Error: ${evt.message ?? 'stream error'}`, streaming: false };
                default:
                  return msg;
              }
            }));
          } catch { /* ignore unparseable frame */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((m) => m.map((msg, i) =>
          i === m.length - 1
            ? { ...msg, text: `Error: ${(err as Error).message}`, streaming: false }
            : msg,
        ));
      }
    } finally {
      setStreaming(false);
    }
  }, [ensureConversation]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || streaming) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    void ask(q);
  };

  const askExample = (q: string) => {
    setMessages((m) => [...m, { role: 'user', text: q }]);
    void ask(q);
  };

  return (
    <Panel
      title="Ask the ecosystem"
      action={
        <span className="text-[10px] text-muted inline-flex items-center gap-1.5">
          <Sparkles size={10} className="text-brand-blue" />
          LangChain · Ollama tools
        </span>
      }
    >
      <div
        ref={scrollRef}
        className="max-h-[420px] min-h-[240px] overflow-y-auto space-y-3 pr-1"
        data-testid="ai-agent-log"
      >
        {messages.length === 0 && (
          <div className="text-center py-6 text-muted">
            <Bot size={22} className="mx-auto mb-2" />
            <p className="text-sm">Ask about your documents, workflows, or alerts.</p>
            <div className="flex flex-wrap justify-center gap-1.5 mt-3">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => askExample(ex)}
                  className="text-[11px] px-2 py-1 rounded-full border border-divider bg-white hover:bg-divider text-ink"
                >
                  {ex}
                </button>
              ))}
            </div>
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
              {m.tools && m.tools.length > 0 && (
                <div className="mb-1.5 space-y-1.5">
                  {m.tools.map((t, j) => (
                    <div key={j} className="space-y-1">
                      <div className="text-[11px] text-ink-sub bg-white/70 rounded px-2 py-1 inline-flex items-center gap-1.5">
                        <Wrench size={11} className="text-brand-blue" />
                        <code className="font-mono">{t.name}</code>
                        {t.arguments && Object.keys(t.arguments).length > 0 && (
                          <span className="text-muted">
                            ({Object.entries(t.arguments)
                              .filter(([, v]) => v != null && v !== '')
                              .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
                              .join(', ')})
                          </span>
                        )}
                      </div>
                      {t.result !== undefined && <ToolResultView result={t.result} />}
                    </div>
                  ))}
                </div>
              )}
              <p className="whitespace-pre-wrap leading-relaxed">{m.text || (m.streaming ? '…' : '')}</p>
            </div>
            {m.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-brand-blue flex items-center justify-center flex-shrink-0 mt-0.5">
                <UserIcon size={13} className="text-white" />
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex gap-2 pt-3 border-t border-divider">
        <Input
          name="question"
          placeholder="e.g. How many documents are pending review?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1"
          data-testid="ai-agent-input"
        />
        <Button
          type="submit"
          loading={streaming}
          disabled={!input.trim()}
          aria-label="Send question"
          data-testid="ai-agent-send"
        >
          <Send size={14} />
        </Button>
      </form>
    </Panel>
  );
}
