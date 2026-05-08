"""DMS system knowledge — narrative overview the AI Engine agent can
retrieve when the user asks a question that doesn't map cleanly to a SQL
aggregation. Examples: "how does retention work?", "what roles exist?",
"walk me through the document lifecycle", "which modules live in the DMS?".

Content is maintained as structured sections (heading + body) so the
embedder produces one chunk per section — this keeps retrieval precision
high without requiring a second chunker.

Stored in the docbrain vector store under a reserved `document_id` so it
sits beside the glossary embeddings and real document chunks but is
trivially separable. The `search_knowledge` entry point is wired into the
agent as a tool.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List

import numpy as np

from .embed import embed_text
from .vectors import _DB_PATH as VECTOR_DB_PATH

log = logging.getLogger(__name__)

# Reserved negative rowid range shared across all non-document chunks.
# glossary.py uses -1, knowledge.py uses -2, keeps separation simple.
KNOWLEDGE_DOC_ID = -2


@dataclass(frozen=True)
class Section:
    slug: str       # stable id, used as the chunk index offset
    title: str
    body: str

    def as_text(self) -> str:
        return f"{self.title}\n\n{self.body}"


# ---------------------------------------------------------------------------
# Canonical DMS overview. Keep sections short; the embedder treats each as
# a single chunk so longer blocks lose precision. Tune by editing here — the
# `ingest()` entry point replays this list every start-up so edits take
# effect on the next python-service restart.
# ---------------------------------------------------------------------------
SECTIONS: List[Section] = [
    Section(
        slug="overview",
        title="National Bank of Egypt Document Management System — overview",
        body=(
            "This is the National Bank of Egypt Document Management System "
            "(DMS). It lets bank staff capture, classify, review, approve, "
            "store, search, and retain customer and operational documents. "
            "Primary document types include Passport, National ID, Utility "
            "Bill, Loan Application, Contract, and various compliance "
            "artefacts. The system is used daily for KYC onboarding, "
            "workflow approvals, audit, and retention governance across all "
            "NBE branches."
        ),
    ),
    Section(
        slug="modules",
        title="Modules and user-facing pages",
        body=(
            "Top-level modules in the SPA: Dashboard (KPIs and recent "
            "activity), Capture (upload + AI-assisted auto-fill of metadata), "
            "Indexing (bulk review of OCR output), Repository (folder-tree "
            "browse), Viewer (per-document preview + Ask-the-document chat), "
            "Search (full-text and field search), AI Engine (ecosystem "
            "chat), Workflows (Maker → Checker → Approve), Alerts, Reports "
            "& BI, Compliance, Integration (CBS/CRM adapters), Security & "
            "RBAC, Users, and System Admin."
        ),
    ),
    Section(
        slug="roles",
        title="User roles and RBAC",
        body=(
            "Four built-in roles mirror the Node RBAC matrix: Doc Admin "
            "(full privileges including delete, admin, security), Maker "
            "(can capture, index, upload, view, and own workflow tasks), "
            "Checker (approve / reject workflow steps, view), and Viewer "
            "(read-only). A fifth role, Auditor, exists in the Python "
            "service for read-only compliance inspection. Permissions are "
            "checked by services/rbac.js in Node and by "
            "python-service/app/services/auth.py in Python."
        ),
    ),
    Section(
        slug="document-lifecycle",
        title="Document lifecycle: capture to archive",
        body=(
            "A document moves through: (1) Capture — Maker uploads via the "
            "SPA; AI previews classification + field extraction. (2) AI "
            "index — OCR runs via Tesseract (+ optional Qwen2.5-VL fallback "
            "for low-confidence scans), classification picks a doc_type, "
            "fields are extracted with confidence scores. (3) Maker review "
            "— confirms metadata and attaches to a workflow if needed. "
            "(4) Checker approves or rejects. (5) Doc Admin signs off on "
            "sensitive actions. (6) Archive — retention policies decide "
            "auto-purge after N years. Every state change writes to the "
            "audit_log table."
        ),
    ),
    Section(
        slug="retention",
        title="Retention policies and auto-purge",
        body=(
            "Retention is configured per doc_type in the retention_policies "
            "table. Each policy has a retention_years count and an "
            "auto_purge flag. When auto_purge is 1, documents past the "
            "retention window are moved to Archived then deleted; when 0, "
            "they surface in the compliance queue for manual review. "
            "Default seed policies: Passport and National ID 10 years "
            "(manual), Loan Application and Contract 7 years (manual), "
            "Utility Bill 5 years (auto-purge), Temp 1 year (auto-purge)."
        ),
    ),
    Section(
        slug="workflows",
        title="Workflow engine",
        body=(
            "Workflows are stored in the workflows table with a ref_code, "
            "title, doc_id, current stage, and priority. Templates in the "
            "workflow_templates table capture the canonical step list for "
            "a given doc_type (e.g. 'KYC Standard' for Passport: Capture → "
            "AI Index → Maker Review → Checker → Approve → Archive). "
            "Stages include Maker Review, Manager Sign-off, Legal Review, "
            "Approved, and Rejected - Rework. Each transition raises an "
            "Alert and writes to audit_log."
        ),
    ),
    Section(
        slug="alerts-and-notifications",
        title="Alerts and notifications",
        body=(
            "The alerts table carries system-wide banners — critical (e.g. "
            "expired-document compliance breach), warning (documents "
            "expiring soon), info (batch processing completed), success "
            "(workflow approved). Per-user notifications in the "
            "notifications table drive the bell icon in the SPA header. "
            "Alerts are aggregated into the Alerts page; notifications "
            "are user-scoped. The expiry-job cron service writes warning "
            "alerts daily."
        ),
    ),
    Section(
        slug="ai-engine",
        title="AI Engine: DocBrain, glossary, and agent",
        body=(
            "DocBrain is the AI layer: OCR, classification, field "
            "extraction, embeddings, vector search, and grounded RAG chat "
            "— all local-first via Ollama (llama3.2:3b chat, "
            "nomic-embed-text embeddings). The AI Engine page hosts a "
            "tool-using agent that can call aggregate_rows, find_documents, "
            "list_expiring, list_workflows, list_alerts, count_by_status, "
            "activity_feed, processing_rate, lookup_glossary, and "
            "search_knowledge. The glossary table ai_glossary_terms is "
            "editable by Doc Admin and drives how the agent maps natural "
            "language to tables and SQL fragments."
        ),
    ),
    Section(
        slug="schema-tables",
        title="Database schema — tables",
        body=(
            "The Node SQLite database backs the SPA and holds: documents "
            "(the main document index), document_versions (version history), "
            "folders (virtual filing tree), workflows and workflow_templates, "
            "alerts and notifications, audit_log (immutable trail of "
            "user/system actions), users (authN and RBAC), annotations "
            "(per-document comments / markups), signatures (e-signature "
            "state), retention_policies, document_type_schemas (dynamic "
            "metadata schemas per doc_type), and ai_glossary_terms / "
            "ai_conversations / ai_messages for the AI layer."
        ),
    ),
    Section(
        slug="integration",
        title="Integrations with core banking and CRM",
        body=(
            "Adapter packages live under python-service/app/services/"
            "integrations/. Shipped shells: Temenos T24, FLEXCUBE, Finastra "
            "Fusion, Mambu, Thought Machine, Oracle Banking, FIS, Salesforce "
            "Financial Services, DocuSign, Microsoft Fabric. Each adapter "
            "implements the Adapter Protocol (configure / health / pull / "
            "push) so the DMS can pull customer records and push signed "
            "documents back to the system of record."
        ),
    ),
    Section(
        slug="compliance",
        title="Compliance, audit, and security",
        body=(
            "Compliance module surfaces retention gaps, expired documents, "
            "missing signatures, and branch-level KPIs. audit_log captures "
            "every meaningful action (login, upload, approve, reject, "
            "delete) with user_id, entity_type, entity_id, and timestamp. "
            "Security posture: session cookies for the SPA, API-key for "
            "service-to-service, JWT for the mobile app, OPA/Rego ABAC "
            "for tenant + branch + risk-band checks on top of RBAC."
        ),
    ),
]


# ---------- vector storage ----------------------------------------------

def _vec_conn() -> sqlite3.Connection:
    VECTOR_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(VECTOR_DB_PATH), isolation_level=None)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS docbrain_chunks (
            rowid        INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id    TEXT NOT NULL,
            document_id  INTEGER NOT NULL,
            chunk_index  INTEGER NOT NULL,
            text         TEXT NOT NULL,
            embedding    BLOB NOT NULL,
            UNIQUE(tenant_id, document_id, chunk_index)
        )
    """)
    return conn


def _encode(vec: List[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def ingest(tenant_id: str = "nbe") -> int:
    """Replace all knowledge chunks in the vector store with the current
    SECTIONS. Idempotent: safe to call on every start-up."""
    conn = _vec_conn()
    try:
        conn.execute(
            "DELETE FROM docbrain_chunks "
            "WHERE tenant_id = ? AND document_id = ?",
            (tenant_id, KNOWLEDGE_DOC_ID),
        )
        for idx, sec in enumerate(SECTIONS):
            vec = embed_text(sec.as_text())
            if not vec:
                log.warning("knowledge ingest: empty embedding for %s", sec.slug)
                continue
            conn.execute(
                "INSERT INTO docbrain_chunks "
                "(tenant_id, document_id, chunk_index, text, embedding) "
                "VALUES (?, ?, ?, ?, ?)",
                (tenant_id, KNOWLEDGE_DOC_ID, idx, sec.as_text(), _encode(vec)),
            )
    finally:
        conn.close()
    return len(SECTIONS)


def search(query: str, *, tenant_id: str = "nbe", k: int = 4) -> List[Dict[str, Any]]:
    """Cosine-similarity search over the knowledge sections. Returns the
    top-k hits as dicts ready to hand to the agent as tool output."""
    qvec = embed_text(query)
    if not qvec:
        return []
    conn = _vec_conn()
    try:
        rows = conn.execute(
            "SELECT chunk_index, text, embedding FROM docbrain_chunks "
            "WHERE tenant_id = ? AND document_id = ?",
            (tenant_id, KNOWLEDGE_DOC_ID),
        ).fetchall()
    finally:
        conn.close()
    if not rows:
        # Knowledge wasn't ingested yet; do it now and retry once.
        if ingest(tenant_id):
            return search(query, tenant_id=tenant_id, k=k)
        return []
    q = np.array(qvec, dtype="<f4")
    q /= (np.linalg.norm(q) + 1e-12)
    embs = np.vstack([np.frombuffer(r[2], dtype="<f4") for r in rows])
    norms = np.linalg.norm(embs, axis=1) + 1e-12
    sims = (embs / norms[:, None]) @ q
    order = sims.argsort()[::-1][:k]
    out: List[Dict[str, Any]] = []
    for i in order:
        idx = int(rows[i][0])
        section = SECTIONS[idx] if 0 <= idx < len(SECTIONS) else None
        out.append({
            "slug":    section.slug if section else f"chunk_{idx}",
            "title":   section.title if section else "",
            "body":    section.body if section else str(rows[i][1]),
            "score":   float(sims[i]),
        })
    return out


__all__: Iterable[str] = ("SECTIONS", "ingest", "search", "KNOWLEDGE_DOC_ID")
