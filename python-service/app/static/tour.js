// Lightweight guided tour engine — zero dependencies, WCAG-aware.
// Usage:  NBE_Tour.start("dashboard")

const TOURS = {
  dashboard: [
    { el: "#kpiRow",        title: "Key Indicators",     body: "Real-time totals across the whole bank." },
    { el: "#sidebar",       title: "Navigation",         body: "All lifecycle, discovery, and operations screens live here." },
    { el: ".lang-switch",   title: "Language",           body: "Switch between English and Arabic (RTL) anytime." },
    { el: ".upload-btn",    title: "Quick Upload",       body: "Drop a document into the pipeline from any screen." },
  ],
  capture: [
    { el: "#capFile",       title: "Select file",        body: "PDF or scanned image — we auto-OCR and classify." },
    { el: "#capType",       title: "Document type",      body: "Picks the right indexing template and retention policy." },
    { el: "#capCid",        title: "Customer CID",       body: "Links the doc to a customer record. Required for KYC." },
  ],
  workflow: [
    { el: "#wfDocId",       title: "Document ID",        body: "Which document's maker-checker flow you're operating on." },
    { el: "#wfAction",      title: "Action",             body: "Approve forwards, reject sends back, escalate bumps to manager." },
  ],
  search: [
    { el: "#searchQ",       title: "Search OCR + metadata", body: "Free-text across names, CIDs, and every OCR'd word." },
  ],
};

const SEEN_KEY = "nbe.dms.tours_seen";
const seen = () => JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
const markSeen = (name) => {
  const s = seen(); s[name] = Date.now();
  localStorage.setItem(SEEN_KEY, JSON.stringify(s));
};

function buildOverlay() {
  let el = document.getElementById("tour-overlay");
  if (el) return el;
  el = document.createElement("div");
  el.id = "tour-overlay";
  el.innerHTML = `
    <div class="tour-dim" id="tour-dim"></div>
    <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div class="tour-step" id="tour-step"></div>
      <h3 id="tour-title"></h3>
      <p id="tour-body"></p>
      <div class="tour-actions">
        <button type="button" id="tour-skip">Skip</button>
        <button type="button" id="tour-prev">Back</button>
        <button type="button" id="tour-next" class="primary">Next</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function highlight(target) {
  document.querySelectorAll(".tour-highlight").forEach((n) => n.classList.remove("tour-highlight"));
  if (target) {
    target.classList.add("tour-highlight");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function positionPopover(pop, target) {
  const r = target.getBoundingClientRect();
  const top = Math.min(window.innerHeight - 220, r.bottom + 12);
  const left = Math.max(12, Math.min(window.innerWidth - 340, r.left));
  pop.style.top = top + "px";
  pop.style.left = left + "px";
}

function run(name, steps) {
  const overlay = buildOverlay();
  overlay.style.display = "block";
  const pop = overlay.querySelector(".tour-pop");
  let i = 0;
  const render = () => {
    const s = steps[i];
    const target = document.querySelector(s.el);
    if (!target) { next(); return; }
    highlight(target);
    positionPopover(pop, target);
    overlay.querySelector("#tour-step").textContent = `${i + 1} / ${steps.length}`;
    overlay.querySelector("#tour-title").textContent = s.title;
    overlay.querySelector("#tour-body").textContent = s.body;
    overlay.querySelector("#tour-prev").disabled = i === 0;
    overlay.querySelector("#tour-next").textContent = i === steps.length - 1 ? "Done" : "Next";
    overlay.querySelector("#tour-next").focus();
  };
  const close = () => {
    overlay.style.display = "none";
    document.querySelectorAll(".tour-highlight").forEach((n) => n.classList.remove("tour-highlight"));
    markSeen(name);
  };
  const next = () => { if (i >= steps.length - 1) return close(); i++; render(); };
  const prev = () => { if (i <= 0) return; i--; render(); };
  overlay.querySelector("#tour-next").onclick = next;
  overlay.querySelector("#tour-prev").onclick = prev;
  overlay.querySelector("#tour-skip").onclick = close;
  overlay.querySelector("#tour-dim").onclick = close;
  document.addEventListener("keydown", function onKey(e) {
    if (!overlay.style.display || overlay.style.display === "none") {
      document.removeEventListener("keydown", onKey); return;
    }
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight" || e.key === "Enter") next();
    else if (e.key === "ArrowLeft") prev();
  });
  render();
}

export function start(name) {
  const steps = TOURS[name]; if (!steps) return;
  run(name, steps);
}

export function maybeAutoStart(name) {
  if (!seen()[name]) start(name);
}

if (typeof window !== "undefined") {
  window.NBE_Tour = { start, maybeAutoStart };
}
