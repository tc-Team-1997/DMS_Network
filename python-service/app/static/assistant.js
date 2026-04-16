// Conversational assistant pane — floating chat that hits the existing copilot API.
// Zero-dependency, keyboard-accessible, remembers recent turns in localStorage so
// users can refresh the page mid-conversation without losing context.

const BTN_ID = "nbe-assistant-btn";
const PANE_ID = "nbe-assistant-pane";
const HISTORY_KEY = "nbe.dms.assistant_history";

const STYLE = `
#${BTN_ID} {
  position: fixed; bottom: 20px; right: 20px; z-index: 8800;
  width: 56px; height: 56px; border-radius: 50%; border: none;
  background: linear-gradient(135deg,#c9a84c,#e8c96b);
  color: #0a1628; font-size: 22px; font-weight: 800; cursor: pointer;
  box-shadow: 0 10px 30px rgba(0,0,0,.45);
}
#${PANE_ID} {
  position: fixed; bottom: 90px; right: 20px; width: 380px; height: 520px;
  background: var(--navy2, #0f2044); color: #e8eef6; border: 1px solid rgba(201,168,76,.3);
  border-radius: 12px; display: none; flex-direction: column; z-index: 8801;
  box-shadow: 0 10px 40px rgba(0,0,0,.55); overflow: hidden;
}
#${PANE_ID} header {
  padding: 12px 14px; background: rgba(201,168,76,.1);
  border-bottom: 1px solid rgba(201,168,76,.25);
  display: flex; justify-content: space-between; align-items: center;
}
#${PANE_ID} header h4 { margin:0; color: #e8c96b; font-size: 14px; font-weight: 700; }
#${PANE_ID} .msgs { flex:1; overflow-y:auto; padding: 12px; display:flex; flex-direction:column; gap:10px; }
#${PANE_ID} .msg { padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 1.45; max-width: 88%; }
#${PANE_ID} .msg.user  { background: rgba(201,168,76,.15); color:#fff; align-self: flex-end; }
#${PANE_ID} .msg.bot   { background: rgba(255,255,255,.06); align-self: flex-start; }
#${PANE_ID} .msg.sys   { background: transparent; font-size: 11px; color:#8da0b8; align-self: center; }
#${PANE_ID} footer {
  padding: 10px; border-top: 1px solid rgba(255,255,255,.06);
  display: flex; gap: 8px;
}
#${PANE_ID} footer input {
  flex:1; background: rgba(0,0,0,.25); color:#fff; border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px; padding: 8px 12px; font-size: 13px;
}
#${PANE_ID} footer button {
  background:#c9a84c; color:#0a1628; border:none; padding:8px 14px;
  font-weight:700; border-radius:8px; cursor:pointer;
}
#${PANE_ID} .src {
  font-size: 11px; color:#8da0b8; margin-top: 4px;
}
#${PANE_ID} .src a { color:#e8c96b; text-decoration: none; }
html[dir="rtl"] #${BTN_ID} { right: auto; left: 20px; }
html[dir="rtl"] #${PANE_ID} { right: auto; left: 20px; }
`;

function load() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}
function save(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-40)));
}

function render(pane, history) {
  const msgs = pane.querySelector(".msgs");
  msgs.innerHTML = "";
  for (const m of history) {
    const row = document.createElement("div");
    row.className = "msg " + m.role;
    row.textContent = m.text;
    if (m.sources?.length) {
      const s = document.createElement("div");
      s.className = "src";
      s.textContent = "Sources: " + m.sources.map(x => `#${x.document_id}`).join(" · ");
      row.appendChild(s);
    }
    msgs.appendChild(row);
  }
  msgs.scrollTop = msgs.scrollHeight;
}

async function ask(text) {
  const apiKey = window.NBE_API_KEY
    || document.querySelector('meta[name="nbe-api-key"]')?.content
    || (typeof API_KEY !== "undefined" ? API_KEY : "");
  try {
    const r = await fetch("/api/v1/copilot/ask", {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ question: text }),
    });
    if (!r.ok) return { answer: `(error ${r.status})` };
    return await r.json();
  } catch (e) { return { answer: `(network: ${e.message})` }; }
}

function boot() {
  const style = document.createElement("style"); style.textContent = STYLE;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.setAttribute("aria-label", "Open DMS assistant");
  btn.textContent = "?";
  document.body.appendChild(btn);

  const pane = document.createElement("section");
  pane.id = PANE_ID;
  pane.setAttribute("role", "dialog");
  pane.setAttribute("aria-label", "DMS assistant");
  pane.innerHTML = `
    <header>
      <h4>DMS Assistant</h4>
      <button aria-label="Close" style="background:none;border:none;color:#e8eef6;font-size:18px;cursor:pointer">×</button>
    </header>
    <div class="msgs" aria-live="polite"></div>
    <footer>
      <label class="sr-only" for="asst-input">Ask the assistant</label>
      <input id="asst-input" type="text" placeholder="Ask about any document, CID, or policy…" />
      <button>Send</button>
    </footer>`;
  document.body.appendChild(pane);

  let history = load();
  if (history.length === 0) {
    history = [{ role: "sys", text: "Ask things like: 'expired passports in Cairo West' or 'how many KYC docs for EGY-2024-00847291?'" }];
  }
  render(pane, history);

  btn.addEventListener("click", () => {
    pane.style.display = pane.style.display === "flex" ? "none" : "flex";
    if (pane.style.display === "flex") pane.querySelector("#asst-input").focus();
  });
  pane.querySelector("header button").addEventListener("click", () => pane.style.display = "none");

  async function send() {
    const input = pane.querySelector("#asst-input");
    const text = input.value.trim(); if (!text) return;
    history.push({ role: "user", text });
    render(pane, history); save(history);
    input.value = ""; input.disabled = true;
    const r = await ask(text);
    history.push({ role: "bot", text: r.answer || "(no answer)",
                   sources: r.sources || [] });
    render(pane, history); save(history);
    input.disabled = false; input.focus();
  }
  pane.querySelector("footer button").addEventListener("click", send);
  pane.querySelector("#asst-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); send(); }
  });
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else boot();
}
