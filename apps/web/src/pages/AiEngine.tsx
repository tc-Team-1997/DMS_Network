/**
 * AiEngine — ZorDMS Copilot Chat screen.
 *
 * A genuine RAG-powered AI assistant over the document corpus.
 * - Left rail: conversation list + "New Chat" button (component state only).
 * - Main:      chat thread with user/assistant bubbles, citation chips, intent tags.
 * - Suggested prompts shown when the thread is empty.
 * - Bottom:    textarea (Enter = send, Shift+Enter = newline), send button, loading state.
 * - RBAC gate: ai:read permission required.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { askCopilot, type ChatTurn, type CopilotAskResponse } from "../api/aiCopilot.js";
import { CitationChip } from "../components/ai/CitationChip.js";

/* ─── Types ─── */

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: CopilotAskResponse;
  error?: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

/* ─── Constants ─── */

const SUGGESTED_PROMPTS = [
  "Which documents are expiring in the next 30 days?",
  "Summarise the latest KYC submissions",
  "What customer records are missing a CID?",
  "Compare retention policies across document types",
];

const INTENT_LABEL: Record<string, string> = {
  search:    "Search",
  summarize: "Summarize",
  navigate:  "Navigate",
  qa:        "Q&A",
};

const INTENT_COLOR: Record<string, string> = {
  search:    "#2563eb",
  summarize: "#7c3aed",
  navigate:  "#059669",
  qa:        "#d97706",
};

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function newConversation(): Conversation {
  return {
    id: makeId(),
    title: "New chat",
    messages: [],
    createdAt: Date.now(),
  };
}

/* ─── Sub-components ─── */

function IntentTag({ intent }: { intent: string }) {
  const label = INTENT_LABEL[intent] ?? intent;
  const color = INTENT_COLOR[intent] ?? "#6b7280";
  return (
    <span
      data-testid="intent-tag"
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 10,
        fontSize: 10,
        fontWeight: 600,
        color,
        background: color + "18",
        border: `1px solid ${color}30`,
        letterSpacing: 0.3,
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

function UserBubble({ msg }: { msg: Message }) {
  return (
    <div
      data-testid="user-bubble"
      style={{
        display: "flex",
        justifyContent: "flex-end",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          maxWidth: "72%",
          background: "#2563eb",
          color: "#fff",
          borderRadius: "16px 16px 4px 16px",
          padding: "10px 14px",
          fontSize: 13.5,
          lineHeight: 1.6,
          boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
        }}
      >
        {msg.content}
      </div>
    </div>
  );
}

function AssistantBubble({ msg }: { msg: Message }) {
  const resp = msg.response;

  return (
    <div
      data-testid="assistant-bubble"
      style={{
        display: "flex",
        justifyContent: "flex-start",
        marginBottom: 20,
        gap: 10,
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
          <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
        </svg>
      </div>

      <div style={{ flex: 1, maxWidth: "78%" }}>
        {/* Answer text */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "4px 16px 16px 16px",
            padding: "12px 16px",
            fontSize: 13.5,
            lineHeight: 1.7,
            color: "#111827",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            whiteSpace: "pre-wrap",
          }}
        >
          {msg.error ? (
            <span style={{ color: "#dc2626" }}>{msg.error}</span>
          ) : (
            msg.content
          )}
        </div>

        {/* Intent tag + citations row */}
        {resp && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginTop: 8,
              alignItems: "center",
            }}
          >
            <IntentTag intent={resp.intent} />
            {resp.citations.map((c) => (
              <CitationChip key={c.doc_id} citation={c} />
            ))}
            <span
              style={{
                fontSize: 10,
                color: "#9ca3af",
                marginLeft: "auto",
                whiteSpace: "nowrap",
              }}
            >
              {resp.model}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main component ─── */

export default function AiEngine() {
  const { user } = useAuth();
  const canRead = user?.permissions.includes("ai:read") ?? false;

  const [conversations, setConversations] = useState<Conversation[]>([newConversation()]);
  const [activeId, setActiveId] = useState<string>(() => conversations[0].id);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeConv = conversations.find((c) => c.id === activeId) ?? conversations[0];

  /* Scroll to bottom when messages change */
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [activeConv?.messages.length, sending]);

  /* Create a new conversation */
  const handleNewChat = useCallback(() => {
    const c = newConversation();
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setInput("");
  }, []);

  /* Send a question */
  const handleSend = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || sending) return;

      const userMsgId = makeId();
      const assistantMsgId = makeId();

      // Append user message immediately
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeId) return c;
          const title = c.messages.length === 0 ? q.slice(0, 50) : c.title;
          return {
            ...c,
            title,
            messages: [
              ...c.messages,
              { id: userMsgId, role: "user" as const, content: q },
            ],
          };
        }),
      );
      setInput("");
      setSending(true);

      // Build history from current conversation turns
      const historyTurns: ChatTurn[] = activeConv.messages.flatMap((m): ChatTurn[] => {
        if (m.role === "user") return [{ role: "user", content: m.content }];
        if (m.role === "assistant") return [{ role: "assistant", content: m.content }];
        return [];
      });

      try {
        const resp = await askCopilot(q, historyTurns);
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== activeId) return c;
            return {
              ...c,
              messages: [
                ...c.messages,
                {
                  id: assistantMsgId,
                  role: "assistant" as const,
                  content: resp.answer,
                  response: resp,
                },
              ],
            };
          }),
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Request failed";
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== activeId) return c;
            return {
              ...c,
              messages: [
                ...c.messages,
                {
                  id: assistantMsgId,
                  role: "assistant" as const,
                  content: "",
                  error: `Error: ${errorMsg}`,
                },
              ],
            };
          }),
        );
      } finally {
        setSending(false);
        textareaRef.current?.focus();
      }
    },
    [activeId, activeConv.messages, sending],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend(input);
      }
    },
    [handleSend, input],
  );

  if (!canRead) {
    return (
      <div className="fade-up" style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>
        <p>You need <code>ai:read</code> permission to access the AI Copilot.</p>
      </div>
    );
  }

  return (
    <div
      className="fade-up"
      style={{
        display: "flex",
        height: "calc(100vh - 64px)",
        background: "#f9fafb",
        overflow: "hidden",
      }}
    >
      {/* ── Left rail ── */}
      <aside
        data-testid="chat-rail"
        style={{
          width: 240,
          background: "#fff",
          borderRight: "1px solid #e5e7eb",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 14px 12px",
            borderBottom: "1px solid #f3f4f6",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
              </svg>
            </div>
            <span style={{ fontWeight: 700, fontSize: 13, color: "#111827" }}>ZorDMS Copilot</span>
          </div>
          <button
            data-testid="new-chat-btn"
            onClick={handleNewChat}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 10px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Conversation list */}
        <div
          data-testid="conversation-list"
          style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}
        >
          {conversations.map((c) => (
            <button
              key={c.id}
              data-testid="conversation-item"
              onClick={() => setActiveId(c.id)}
              style={{
                width: "100%",
                display: "block",
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 8,
                border: "none",
                background: c.id === activeId ? "#eff6ff" : "transparent",
                color: c.id === activeId ? "#1d4ed8" : "#374151",
                fontSize: 12,
                cursor: "pointer",
                marginBottom: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: c.id === activeId ? 600 : 400,
              }}
            >
              {c.title}
            </button>
          ))}
        </div>
      </aside>

      {/* ── Main chat area ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header bar */}
        <div
          style={{
            padding: "12px 24px",
            background: "#fff",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <h2
              style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#111827" }}
              data-testid="copilot-heading"
            >
              AI Copilot
            </h2>
            <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>
              Grounded answers over the ZorDMS document corpus · every claim carries a citation
            </p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <span
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 10,
                background: "#dcfce7",
                color: "#16a34a",
                fontWeight: 600,
                border: "1px solid #bbf7d0",
              }}
            >
              RAG · Live
            </span>
          </div>
        </div>

        {/* Thread */}
        <div
          ref={threadRef}
          data-testid="chat-thread"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 32px",
          }}
        >
          {activeConv.messages.length === 0 ? (
            /* Suggested prompts shown when the thread is empty */
            <div data-testid="suggested-prompts" style={{ maxWidth: 560, margin: "0 auto" }}>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 14px",
                  }}
                >
                  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8}>
                    <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
                  </svg>
                </div>
                <h3 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 700, color: "#111827" }}>
                  How can I help you?
                </h3>
                <p style={{ margin: 0, fontSize: 12.5, color: "#6b7280" }}>
                  Ask anything about your documents — I'll ground every answer with citations.
                </p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    data-testid="suggested-prompt-card"
                    onClick={() => handleSend(prompt)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 14px",
                      background: "#fff",
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      fontSize: 12.5,
                      color: "#374151",
                      cursor: "pointer",
                      transition: "border-color 0.15s, box-shadow 0.15s",
                      lineHeight: 1.5,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "#2563eb";
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 0 2px #eff6ff";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "#e5e7eb";
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = "";
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
              {activeConv.messages.map((msg) =>
                msg.role === "user" ? (
                  <UserBubble key={msg.id} msg={msg} />
                ) : (
                  <AssistantBubble key={msg.id} msg={msg} />
                ),
              )}
              {sending && (
                <div
                  data-testid="loading-indicator"
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
                      <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
                    </svg>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#9ca3af",
                          animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input area */}
        <div
          style={{
            padding: "16px 32px 20px",
            background: "#fff",
            borderTop: "1px solid #e5e7eb",
          }}
        >
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-end",
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "8px 12px 8px 16px",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            >
              <textarea
                ref={textareaRef}
                data-testid="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question about your documents… (Enter to send, Shift+Enter for newline)"
                rows={1}
                disabled={sending}
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  resize: "none",
                  outline: "none",
                  fontSize: 13.5,
                  color: "#111827",
                  lineHeight: 1.6,
                  fontFamily: "inherit",
                  minHeight: 24,
                  maxHeight: 120,
                  overflowY: "auto",
                }}
              />
              <button
                data-testid="send-btn"
                onClick={() => handleSend(input)}
                disabled={!input.trim() || sending}
                aria-label="send message"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  border: "none",
                  background: input.trim() && !sending ? "#2563eb" : "#e5e7eb",
                  color: input.trim() && !sending ? "#fff" : "#9ca3af",
                  cursor: input.trim() && !sending ? "pointer" : "not-allowed",
                  flexShrink: 0,
                  transition: "background 0.15s",
                }}
              >
                {sending ? (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx={12} cy={12} r={10} />
                    <line x1={12} y1={8} x2={12} y2={12} />
                    <line x1={12} y1={16} x2={12} y2={16} />
                  </svg>
                ) : (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1={22} y1={2} x2={11} y2={13} />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </div>

            {/* Footer note */}
            <div
              style={{
                marginTop: 8,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                data-testid="grounded-note"
                style={{ fontSize: 10.5, color: "#9ca3af" }}
              >
                Grounded answers only — every claim carries a citation
              </span>
              <span style={{ fontSize: 10.5, color: "#9ca3af" }}>
                ZorDMS Copilot · RAG Agent
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
