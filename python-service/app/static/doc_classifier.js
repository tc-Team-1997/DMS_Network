// Client-side document type classifier using ONNX Runtime Web.
// Loads the model from /static/models/doc_type.onnx (shipped via the training script).
// Runs a lightweight 224x224 grayscale CNN to predict: passport | national_id |
// utility_bill | loan_application | other.
//
// If the model file isn't present, the classifier silently degrades to a
// filename-heuristic so the UI stays functional.

const LABELS = ["passport", "national_id", "utility_bill", "loan_application", "other"];
const MODEL_URL = "/static/models/doc_type.onnx";

let _session = null;
let _loading = null;

async function ortLoaded() {
  if (window.ort) return window.ort;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return window.ort;
}

async function getSession() {
  if (_session) return _session;
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const ort = await ortLoaded();
      const r = await fetch(MODEL_URL, { method: "HEAD" });
      if (!r.ok) throw new Error("model_not_found");
      _session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["webgl", "wasm"],
      });
      return _session;
    } catch (e) {
      console.warn("[doc_classifier] ONNX unavailable:", e.message);
      return null;
    }
  })();
  return _loading;
}

function fileToTensor(img, ort) {
  const canvas = document.createElement("canvas");
  canvas.width = 224; canvas.height = 224;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, 224, 224);
  const { data } = ctx.getImageData(0, 0, 224, 224);
  const out = new Float32Array(224 * 224);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255.0;
  }
  return new ort.Tensor("float32", out, [1, 1, 224, 224]);
}

export async function classifyFile(file) {
  // Heuristic fallback — runs instantly, no model needed.
  const n = (file.name || "").toLowerCase();
  const heuristic =
    n.includes("passport") ? "passport" :
    n.includes("natid") || n.includes("national") ? "national_id" :
    n.includes("utility") || n.includes("bill") ? "utility_bill" :
    n.includes("loan") ? "loan_application" : null;

  const ort = await ortLoaded();
  const session = await getSession();
  if (!session || !/image/.test(file.type)) {
    return heuristic
      ? { label: heuristic, confidence: 0.6, via: "heuristic" }
      : { label: "other", confidence: 0.4, via: "heuristic" };
  }

  const bitmap = await createImageBitmap(file);
  const input = fileToTensor(bitmap, ort);
  const out = await session.run({ [session.inputNames[0]]: input });
  const probs = Array.from(out[session.outputNames[0]].data);
  // softmax
  const m = Math.max(...probs);
  const exp = probs.map((v) => Math.exp(v - m));
  const s = exp.reduce((a, b) => a + b, 0);
  const sm = exp.map((v) => v / s);
  const idx = sm.indexOf(Math.max(...sm));
  return { label: LABELS[idx] || "other",
           confidence: Number(sm[idx].toFixed(3)),
           via: "onnx",
           all: LABELS.map((l, i) => ({ label: l, p: sm[i] })) };
}

if (typeof window !== "undefined") {
  window.NBE_DocClassifier = { classifyFile };
}
