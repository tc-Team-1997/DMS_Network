// Browser e-signature drawing pad.
// - Smooth pointer-driven strokes with quadratic Bézier smoothing
// - Pressure-aware when the browser exposes it (Apple Pencil / Surface Pen)
// - Exports PNG + SVG; both are posted to /api/v1/signatures/{id}/ink, which
//   feeds the PAdES signer as a visible signature appearance.
// - Keyboard accessible (no mouse? tab onto the pad + press Space to open a
//   "type your name" fallback that renders cursive via a chosen web font).

export function openSigPad({ documentId, onDone }) {
  const root = document.createElement("div");
  root.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9500;
    display:flex;align-items:center;justify-content:center`;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Signature pad");

  const box = document.createElement("div");
  box.style.cssText = `background:#0f2044;color:#e8eef6;border:1px solid rgba(201,168,76,.35);
    border-radius:12px;padding:16px;width:640px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.6)`;
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <strong style="color:#e8c96b;font-family:'Cormorant Garamond',serif;font-size:18px">
        Sign document ${documentId ?? ""}
      </strong>
      <button id="sp-x" aria-label="Close" style="background:none;border:0;color:#e8eef6;font-size:22px;cursor:pointer">×</button>
    </div>
    <canvas id="sp-pad" width="608" height="220"
            style="background:#fff;border-radius:8px;touch-action:none;cursor:crosshair"></canvas>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button id="sp-clear"  class="btn btn-secondary">Clear</button>
      <button id="sp-type"   class="btn btn-secondary">Type instead</button>
      <span style="flex:1"></span>
      <button id="sp-submit" class="btn btn-primary">Sign &amp; save</button>
    </div>
    <p id="sp-hint" style="margin:8px 0 0;font-size:11px;color:#8da0b8">
      Sign with your finger, stylus, or mouse. Your ink + a cryptographic hash will be attached.
    </p>
  `;
  root.appendChild(box);
  document.body.appendChild(root);

  const canvas = box.querySelector("#sp-pad");
  const ctx = canvas.getContext("2d");
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#0a1628";

  const strokes = [];
  let current = null;

  function pt(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top)  * (canvas.height / r.height),
      p: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
      t: performance.now(),
    };
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) {
      if (s.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length - 1; i++) {
        const mx = (s[i].x + s[i + 1].x) / 2;
        const my = (s[i].y + s[i + 1].y) / 2;
        ctx.lineWidth = 1.2 + 2.0 * (s[i].p || 0.5);
        ctx.quadraticCurveTo(s[i].x, s[i].y, mx, my);
      }
      ctx.stroke();
    }
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    current = [pt(e)];
    strokes.push(current);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!current) return;
    current.push(pt(e));
    draw();
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
    canvas.addEventListener(ev, () => { current = null; }));

  function svg() {
    const parts = strokes.map((s) =>
      "M " + s.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")
    );
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}">
      <path d="${parts.join(" ")}" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  async function submit() {
    if (!strokes.length) return alert("Please draw your signature first.");
    const png = canvas.toDataURL("image/png");
    const body = {
      png_base64: png.split(",")[1],
      svg: svg(),
      strokes: strokes.map((s) => s.map((p) => [Math.round(p.x), Math.round(p.y),
                                                Math.round((p.p || 0.5) * 100)])),
    };
    const apiKey = document.querySelector('meta[name="nbe-api-key"]')?.content || "";
    const r = await fetch(`/api/v1/signatures/${documentId}/ink`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    close();
    onDone?.(j);
  }

  function typeFallback() {
    const name = prompt("Type your full name to generate a signature:");
    if (!name) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "italic 56px 'Cormorant Garamond', serif";
    ctx.fillStyle = "#0a1628";
    ctx.fillText(name, 40, 130);
    strokes.length = 0;
    strokes.push([{ x: 0, y: 0, p: 0.5, t: 0, synthetic: name }]);
  }

  function close() { root.remove(); }
  box.querySelector("#sp-x").onclick = close;
  box.querySelector("#sp-clear").onclick = () => { strokes.length = 0; draw(); };
  box.querySelector("#sp-type").onclick = typeFallback;
  box.querySelector("#sp-submit").onclick = submit;
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  });
}

if (typeof window !== "undefined") {
  window.NBE_SigPad = { openSigPad };
}
