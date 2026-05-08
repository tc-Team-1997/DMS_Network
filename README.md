# NBE Document Management System

Localhost web app scaffold for the NBE DMS mockup.

## Stack
- Node.js + Express
- SQLite (better-sqlite3)
- EJS templates
- Multer (file uploads)
- bcryptjs + express-session (auth)

## Setup

```bash
cd C:\Users\Amit\nbe-dms
npm install
node db/seed.js      # creates DB + seed data
npm start            # http://localhost:3000
```

## Login
- admin / admin123  (Doc Admin)
- sara / sara123    (Maker)
- mohamed / mohamed123  (Checker)

## DocBrain (AI) configuration

DocBrain is the local-first AI layer — OCR, classification, entity
extraction, embeddings, and grounded RAG chat. It runs against [Ollama](https://ollama.com).

### Pull the models

```bash
ollama pull llama3.2:3b          # small/fast default (3B params)
ollama pull nomic-embed-text     # 768-dim embeddings
```

### Upgrade to a larger chat model (strongly recommended)

The 3B model often drops the `[^N]` citation format the RAG guardrail
expects. For reliable citation behaviour pick one of:

```bash
ollama pull llama3.1:8b          # balanced — recommended
ollama pull qwen2.5:7b           # strong reasoning, good at structured output
ollama pull llama3.1:70b         # tier-1 on-prem; 40 GB+ memory required
```

Then set the env var before starting:

```bash
export DOCBRAIN_MODEL=llama3.1:8b
./start.sh
```

### Vision OCR fallback (strongly recommended for image-based docs)

Tesseract struggles on low-contrast scans, phone photos, and complex
layouts. Enable the vision fallback so poor scans are re-processed by a
multimodal model:

```bash
ollama pull qwen2.5vl:7b                    # or llava:13b / minicpm-v
export DOCBRAIN_VISION_OCR=qwen2.5vl:7b
export DOCBRAIN_VISION_OCR_THRESHOLD=70     # re-run when Tesseract mean_conf < 70
./start.sh
```

Flow: Tesseract runs first (fast); if its mean confidence is below the
threshold OR the text is short, the same image is passed to the VL model
which transcribes directly from pixels. The pipeline picks whichever
output is fuller and tags it with the backend that produced it. The
Capture summary and AI preview both surface the backend name so you can
see which path ran.

For PDFs, pages are rasterised (pdf2image / poppler) and each page is sent
to the VL model one at a time.

### LangChain RAG pipeline (opt-in)

The streaming chat (`POST /api/v1/docbrain/chat/stream`) has two backends:

- **Default** — the bespoke `rag_answer_stream` in `app/services/docbrain/rag.py`.
- **LangChain** — `app/services/docbrain/lc_rag.py`, a `Runnable` pipeline
  built on `langchain-core` + `langchain-ollama`. Same SSE output shape;
  adds a proper `BaseRetriever` interface and a lifecycle that can grow
  into multi-query retrieval + agent tool-use.

Enable with:

```bash
export DOCBRAIN_USE_LANGCHAIN=1
./start.sh
```

### Re-indexing

If documents show `0 chunks indexed` in the Viewer (seeded docs, or after
changing the embed model), go to **System Admin → Re-index all documents**
or `POST /spa/api/admin/docbrain/reindex-all`.

## Functional Screens (Phase 1)
- Login / Auth / RBAC (basic)
- Dashboard with live KPIs + charts
- Capture — real file upload with metadata
- Indexing — edit metadata on uploaded docs
- Repository — folders + doc list + download/delete
- Search — full-text across metadata + OCR text field
- Document Viewer — inline PDF/image preview
- Workflows — approve / reject / escalate
- Alerts — list + mark read
- Reports — type/status breakdowns + chart
- Security — user management, lock/unlock
- Admin — audit log, retention policies
- Integration — status dashboard (static)

## Mocked (Phase 2 candidates)
- OCR engine (random confidence score assigned on upload)
- AI classification
- Email/SMS/WhatsApp notifications
- CBS/LOS/SSO/S3 integrations
- MFA enforcement

## Folder Layout
```
nbe-dms/
  server.js           Express entry
  db/
    schema.sql        Tables
    seed.js           Seed data
    index.js          DB singleton
  routes/             Per-module routers
  views/              EJS templates
    partials/         header/footer
  public/css/app.css  Extracted theme
  uploads/            Uploaded files (gitignored)
```
