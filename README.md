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
