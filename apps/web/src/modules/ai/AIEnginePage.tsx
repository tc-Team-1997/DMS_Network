import { useQuery } from '@tanstack/react-query';
import { Sparkles, CheckCircle2, BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MetricCard, Panel } from '@/components/ui';
import { fetchDocbrainHealth } from './api';
import { fetchGlossary } from './glossary-api';
import { AgentChat } from './AgentChat';

export function AIEnginePage() {
  const health = useQuery({
    queryKey: ['docbrain', 'health'],
    queryFn: fetchDocbrainHealth,
    retry: 1,
  });
  const glossary = useQuery({
    queryKey: ['glossary', 'coverage'],
    queryFn: () => fetchGlossary(),
    // Cheap to re-fetch; page is admin-facing.
    staleTime: 10_000,
  });

  const h = health.data;
  const ollamaOk = h?.ollama?.ok ?? false;
  const chatModel = h?.ollama?.chat_model ?? 'llama3.2:3b';
  const embedModel = h?.ollama?.embed_model ?? 'nomic-embed-text';
  const vectorCount = h?.vectors?.count ?? 0;
  const coverage = glossary.data?.coverage;

  return (
    <div className="space-y-6">
      <Panel title="DocBrain AI Engine">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-skyLight flex items-center justify-center">
            <Sparkles size={22} className="text-brand-blue" />
          </div>
          <div className="flex-1">
            <p className="text-md text-ink">
              Local-first AI pipeline powering document classification, field extraction, and grounded RAG chat.
              {' '}Runs against Ollama with <code className="font-mono text-xs">{chatModel}</code> for chat and{' '}
              <code className="font-mono text-xs">{embedModel}</code> for embeddings.
            </p>
            <p className="text-xs text-muted mt-2">
              For per-document analysis and chat, open a document in the{' '}
              <Link to="/repository" className="text-brand-blue hover:underline">repository</Link>.
            </p>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Ollama"
          value={health.isLoading ? '…' : ollamaOk ? 'Connected' : 'Offline'}
          tone={ollamaOk ? 'success' : 'danger'}
          sub={ollamaOk ? 'Ready' : 'Local daemon unreachable'}
        />
        <MetricCard label="Chat model" value={chatModel} tone="blue" sub="Classification + RAG" />
        <MetricCard label="Embed model" value={embedModel} tone="purple" sub="768-dim cosine" />
        <MetricCard label="Vectors stored" value={vectorCount} tone="neutral" sub="Across all documents" />
      </div>

      <Panel
        title="Glossary coverage"
        action={
          <Link
            to="/admin/ai-glossary"
            className="text-xs text-brand-blue hover:underline inline-flex items-center gap-1"
          >
            <BookOpen size={12} /> Manage glossary
          </Link>
        }
      >
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          <MetricCard
            label="Approved terms"
            value={coverage?.approved ?? '…'}
            tone="success"
            sub="Visible to the agent preamble"
          />
          <MetricCard
            label="Draft terms"
            value={coverage ? coverage.total - coverage.approved : '…'}
            tone="warning"
            sub="Awaiting admin review"
          />
          <MetricCard
            label="Admin-edited"
            value={coverage?.admin_edited ?? '…'}
            tone="purple"
            sub="Locked from regenerate"
          />
        </div>
      </Panel>

      <AgentChat />

      <Panel title="Capabilities">
        <ul className="space-y-3">
          <Capability
            title="Document classification"
            body="JSON-mode LLM with confidence scores. Writes back to the document row when ≥0.7."
          />
          <Capability
            title="Field extraction"
            body="CID, customer name, doc number, DOB, issue / expiry dates, issuing authority. High-confidence fields auto-fill metadata."
          />
          <Capability
            title="Grounded RAG chat"
            body="Answers with citations to the retrieved chunks. Surfaces a 'no grounded evidence' banner when similarity drops below the floor."
          />
          <Capability
            title="Local-first, private"
            body="All embeddings and inference happen against your Ollama daemon. No cloud LLM calls without an explicit per-tenant opt-in."
          />
        </ul>
      </Panel>

      {!ollamaOk && !health.isLoading && (
        <Panel title="Troubleshooting">
          <ol className="list-decimal list-inside text-md text-muted space-y-1">
            <li>Start the Ollama daemon: <code className="font-mono text-xs">ollama serve</code></li>
            <li>Pull the models: <code className="font-mono text-xs">ollama pull llama3.2:3b && ollama pull nomic-embed-text</code></li>
            <li>Verify the Python service points at it: <code className="font-mono text-xs">OLLAMA_HOST=http://localhost:11434</code></li>
          </ol>
        </Panel>
      )}
    </div>
  );
}

function Capability({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-success-bg text-success flex items-center justify-center shrink-0">
        <CheckCircle2 size={14} />
      </div>
      <div>
        <p className="text-md font-medium text-ink">{title}</p>
        <p className="text-xs text-muted">{body}</p>
      </div>
    </li>
  );
}
