from datetime import datetime, timedelta
from typing import Any
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Float, Boolean, LargeBinary, UniqueConstraint, JSON
from sqlalchemy.orm import relationship
from .db import Base


class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True)
    filename = Column(String(512), nullable=False)
    original_name = Column(String(512), nullable=False)
    mime_type = Column(String(128))
    size_bytes = Column(Integer)
    sha256 = Column(String(64), index=True)
    phash = Column(String(32), index=True)
    doc_type = Column(String(64))
    customer_cid = Column(String(64), index=True)
    branch = Column(String(128), index=True)
    tenant = Column(String(64), default="default", index=True)
    sync_clock = Column(Text)
    status = Column(String(32), default="captured")
    issue_date = Column(String(32))
    expiry_date = Column(String(32))
    uploaded_by = Column(String(128))
    created_at = Column(DateTime, default=datetime.utcnow)

    # WORM retention-lock columns (migration 0023)
    worm_locked_at = Column(DateTime, nullable=True)
    worm_unlock_after = Column(DateTime, nullable=True)
    worm_release_reason = Column(String(128), nullable=True)
    sha256_at_lock = Column(String(64), nullable=True)

    # Redaction columns (migration 0024_redaction)
    parent_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    redacted = Column(Integer, default=0)  # 0=original, 1=redacted copy
    version = Column(Integer, default=1)

    ocr = relationship("OcrResult", back_populates="document", uselist=False, cascade="all, delete-orphan")
    workflow_steps = relationship("WorkflowStep", back_populates="document", cascade="all, delete-orphan")


class OcrResult(Base):
    __tablename__ = "ocr_results"
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id"), unique=True)
    text = Column(Text)
    confidence = Column(Float)
    fields_json = Column(Text)
    engine = Column(String(64), default="tesseract")
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("Document", back_populates="ocr")


class WorkflowStep(Base):
    __tablename__ = "workflow_steps"
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    stage = Column(String(64))
    actor = Column(String(128))
    action = Column(String(32))
    comment = Column(Text)
    # SOX-2 audit unification — filled in by the Wave C two-phase commit flow.
    # node_wf_action_id is advisory (Node writes this back to wf_actions as python_step_id).
    reason_code = Column(String(128))
    assertion_id = Column(String(256))
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("Document", back_populates="workflow_steps")


class IntegrationLog(Base):
    __tablename__ = "integration_logs"
    id = Column(Integer, primary_key=True)
    system = Column(String(32))
    endpoint = Column(String(256))
    method = Column(String(8))
    status_code = Column(Integer)
    latency_ms = Column(Integer)
    request_json = Column(Text)
    response_json = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class StampFingerprint(Base):
    __tablename__ = "stamp_fingerprints"
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    phash = Column(String(32), index=True)
    avg_color = Column(String(16))
    bbox = Column(String(64))
    created_at = Column(DateTime, default=datetime.utcnow)


class ComplianceScore(Base):
    __tablename__ = "compliance_scores"
    id = Column(Integer, primary_key=True)
    tenant = Column(String(64), index=True)
    framework = Column(String(32), index=True)
    control_id = Column(String(64))
    status = Column(String(16))
    evidence = Column(Text)
    score = Column(Float)
    measured_at = Column(DateTime, default=datetime.utcnow, index=True)


class WorkflowDesign(Base):
    __tablename__ = "workflow_designs"
    id = Column(Integer, primary_key=True)
    tenant = Column(String(64), index=True)
    name = Column(String(128))
    description = Column(Text)
    spec_json = Column(Text)
    created_by = Column(String(128))
    created_at = Column(DateTime, default=datetime.utcnow)


class WatchlistEntry(Base):
    __tablename__ = "watchlist_entries"
    id = Column(Integer, primary_key=True)
    source = Column(String(16), index=True)
    ext_id = Column(String(128), index=True)
    name = Column(String(512), index=True)
    name_norm = Column(String(512), index=True)
    aliases_json = Column(Text)
    dob = Column(String(32))
    country = Column(String(8))
    category = Column(String(64))
    listed_at = Column(DateTime)
    raw_json = Column(Text)
    loaded_at = Column(DateTime, default=datetime.utcnow, index=True)


class WatchlistMatch(Base):
    __tablename__ = "watchlist_matches"
    id = Column(Integer, primary_key=True)
    customer_cid = Column(String(64), index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), index=True)
    entry_id = Column(Integer, ForeignKey("watchlist_entries.id"))
    score = Column(Float)
    matched_name = Column(String(512))
    reason = Column(String(256))
    status = Column(String(16), default="open")
    created_at = Column(DateTime, default=datetime.utcnow)
    reviewed_by = Column(String(128))
    reviewed_at = Column(DateTime)


class LoanCovenant(Base):
    __tablename__ = "loan_covenants"
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    kind = Column(String(32))
    clause = Column(Text)
    metric = Column(String(64))
    operator = Column(String(8))
    threshold = Column(Float)
    currency = Column(String(3))
    confidence = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)


class PasskeyCredential(Base):
    __tablename__ = "passkey_credentials"
    id = Column(Integer, primary_key=True)
    customer_cid = Column(String(64), index=True)
    user_handle = Column(String(128), index=True)
    credential_id = Column(Text)
    public_key = Column(Text)
    sign_count = Column(Integer, default=0)
    aaguid = Column(String(64))
    friendly_name = Column(String(128))
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime)


class UsageEvent(Base):
    __tablename__ = "usage_events"
    id = Column(Integer, primary_key=True)
    feature = Column(String(64), index=True)
    user_sub = Column(String(128), index=True)
    tenant = Column(String(64), index=True)
    branch = Column(String(128))
    path = Column(String(256))
    status_code = Column(Integer)
    latency_ms = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class CustomerDek(Base):
    __tablename__ = "customer_deks"
    id = Column(Integer, primary_key=True)
    customer_cid = Column(String(64), unique=True, index=True)
    wrapped_dek = Column(Text)
    kms_key_id = Column(String(128))
    algorithm = Column(String(32), default="AES-256-GCM")
    created_at = Column(DateTime, default=datetime.utcnow)
    rotated_at = Column(DateTime)


class VoiceEnrollment(Base):
    __tablename__ = "voice_enrollments"
    id = Column(Integer, primary_key=True)
    user_sub = Column(String(128), index=True)
    customer_cid = Column(String(64), index=True)
    embedding = Column(Text)
    samples = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime)


class ZkProof(Base):
    __tablename__ = "zk_proofs"
    id = Column(Integer, primary_key=True)
    customer_cid = Column(String(64), index=True)
    claim = Column(String(64))
    issued_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime)
    commitment = Column(String(128))
    signature = Column(Text)
    revoked = Column(Integer, default=0)


class OidcClient(Base):
    __tablename__ = "oidc_clients"
    id = Column(Integer, primary_key=True)
    client_id = Column(String(64), unique=True, index=True)
    client_secret = Column(String(128))
    name = Column(String(128))
    redirect_uris = Column(Text)
    scopes = Column(String(256), default="openid profile email")
    created_at = Column(DateTime, default=datetime.utcnow)


class OidcAuthCode(Base):
    __tablename__ = "oidc_auth_codes"
    id = Column(Integer, primary_key=True)
    code = Column(String(128), unique=True, index=True)
    client_id = Column(String(64), index=True)
    user_sub = Column(String(128))
    tenant = Column(String(64))
    scope = Column(String(256))
    redirect_uri = Column(String(512))
    nonce = Column(String(128))
    expires_at = Column(DateTime)
    used = Column(Integer, default=0)


class ProvenanceEvent(Base):
    __tablename__ = "provenance_events"
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    kind = Column(String(32), index=True)
    system = Column(String(64))
    actor = Column(String(128))
    region = Column(String(32))
    parent_event_id = Column(Integer, ForeignKey("provenance_events.id"))
    payload_json = Column(Text)
    hash_prev = Column(String(64))
    hash_self = Column(String(64))
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class AisConsent(Base):
    __tablename__ = "ais_consents"
    id = Column(Integer, primary_key=True)
    customer_cid = Column(String(64), index=True)
    provider = Column(String(64))
    consent_id = Column(String(128))
    scopes = Column(String(256))
    status = Column(String(16), default="pending")
    token = Column(Text)
    refresh_token = Column(Text)
    expires_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)


class AisStatement(Base):
    __tablename__ = "ais_statements"
    id = Column(Integer, primary_key=True)
    consent_id = Column(Integer, ForeignKey("ais_consents.id", ondelete="CASCADE"))
    account_id = Column(String(64))
    as_of = Column(DateTime)
    currency = Column(String(3))
    balance = Column(Float)
    transactions_json = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class FxRate(Base):
    __tablename__ = "fx_rates"
    id = Column(Integer, primary_key=True)
    base = Column(String(3), index=True)
    quote = Column(String(3), index=True)
    rate = Column(Float)
    as_of = Column(DateTime, default=datetime.utcnow, index=True)
    source = Column(String(64), default="manual")


class WebAuthnCredential(Base):
    __tablename__ = "webauthn_credentials"
    id = Column(Integer, primary_key=True)
    user_sub = Column(String(128), index=True)
    credential_id = Column(Text)
    public_key = Column(Text)
    sign_count = Column(Integer, default=0)
    transports = Column(String(64))
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime)


class StepUpChallenge(Base):
    __tablename__ = "stepup_challenges"
    id = Column(Integer, primary_key=True)
    user_sub = Column(String(128), index=True)
    action = Column(String(64))
    resource_id = Column(Integer)
    challenge = Column(String(256))
    kind = Column(String(16), default="register")
    used = Column(Integer, default=0)
    expires_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)


class StepupUsedAssertion(Base):
    """Replay-prevention table for verified WebAuthn assertion_ids.

    Each assertion_id may be used at most once within its 5-minute TTL.
    Once consumed the row is inserted here; subsequent verify calls for
    the same assertion_id are rejected with verified=False, reason='replayed'.

    Migration: 0043_stepup_validation
    """
    __tablename__ = "stepup_used_assertions"
    assertion_id = Column(String(256), primary_key=True)
    user_sub = Column(String(128), nullable=False, index=True)
    tenant_id = Column(String(64), nullable=False, default="nbe", index=True)
    used_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class RetentionPolicy(Base):
    __tablename__ = "retention_policies"
    id = Column(Integer, primary_key=True)
    doc_type = Column(String(64), unique=True, index=True)
    retention_days = Column(Integer)
    action = Column(String(16), default="purge")  # purge | archive_cold
    tenant = Column(String(64), default="default")
    created_at = Column(DateTime, default=datetime.utcnow)


class LegalHold(Base):
    __tablename__ = "legal_holds"
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    reason = Column(String(512))
    case_ref = Column(String(128))
    placed_by = Column(String(128))
    placed_at = Column(DateTime, default=datetime.utcnow)
    released_by = Column(String(128))
    released_at = Column(DateTime)


class PortalSession(Base):
    __tablename__ = "portal_sessions"
    id = Column(Integer, primary_key=True)
    customer_cid = Column(String(64), index=True)
    email = Column(String(256), index=True)
    otp_code = Column(String(8))
    otp_expires_at = Column(DateTime)
    token = Column(String(64), index=True)
    verified_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)


class EForm(Base):
    __tablename__ = "eforms"
    id = Column(Integer, primary_key=True)
    key = Column(String(64), unique=True, index=True)
    title = Column(String(256))
    version = Column(Integer, default=1)
    tenant = Column(String(64), default="default", index=True)
    schema_json = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    submissions = relationship("EFormSubmission", back_populates="form", cascade="all, delete-orphan")


class EFormSubmission(Base):
    __tablename__ = "eform_submissions"
    id = Column(Integer, primary_key=True)
    form_id = Column(Integer, ForeignKey("eforms.id", ondelete="CASCADE"))
    customer_cid = Column(String(64), index=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    submitted_by = Column(String(128))
    data_json = Column(Text)
    status = Column(String(32), default="submitted")
    created_at = Column(DateTime, default=datetime.utcnow)

    form = relationship("EForm", back_populates="submissions")


class DuplicateMatch(Base):
    __tablename__ = "duplicate_matches"
    id = Column(Integer, primary_key=True)
    doc_a = Column(Integer, ForeignKey("documents.id"))
    doc_b = Column(Integer, ForeignKey("documents.id"))
    similarity = Column(Float)
    match_type = Column(String(32))
    created_at = Column(DateTime, default=datetime.utcnow)


class AlertRecord(Base):
    """Persisted alert record created via POST /api/v1/alerts."""
    __tablename__ = "alert_records"
    id = Column(Integer, primary_key=True)
    user_sub = Column(String(128), index=True, nullable=False)
    level = Column(String(16), default="info", index=True)   # info | warning | critical
    title = Column(String(256), nullable=False)
    message = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class UserNotificationPreference(Base):
    """Stores per-user notification channel preferences.

    ``notification_channels`` is a JSON array stored as TEXT,
    e.g. '["email","sms"]'.  NULL means default (["email"]).
    ``email`` and ``phone`` hold the destination addresses.
    """
    __tablename__ = "user_notification_preferences"
    id = Column(Integer, primary_key=True)
    user_sub = Column(String(128), unique=True, index=True, nullable=False)
    notification_channels = Column(Text, nullable=True)   # JSON array, e.g. '["email","sms"]'
    email = Column(String(256), nullable=True)
    phone = Column(String(32), nullable=True)             # E.164, used for SMS + WhatsApp
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DocumentTypeSchema(Base):
    """Admin-configurable field schema for one document type.

    Mirrors the SQLite ``document_type_schemas`` table in the Node schema plus
    the four DocBrain inference columns added in migration 0018 and the
    DocTypes-v2 columns added in migration 0031.
    """
    __tablename__ = "document_type_schemas"
    id = Column(Integer, primary_key=True)
    name = Column(String(128), unique=True, nullable=False, index=True)
    description = Column(Text)
    fields_json = Column(Text, nullable=False, default="[]")
    active = Column(Integer, default=1)
    tenant_id = Column(String(64), default="nbe", index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # DocBrain inference state (migration 0018)
    schema_version = Column(Integer, nullable=False, default=1)
    inference_status = Column(String(32), nullable=False, default="pending")
    source_samples_count = Column(Integer, nullable=False, default=0)
    vector_index_version = Column(Integer, nullable=False, default=0)
    # DocTypes v2 (migration 0031)
    notify_days = Column(String(64), nullable=False, default="30,60,90")
    translate_extracted_to_dz = Column(Integer, nullable=False, default=0)

    samples = relationship(
        "DocumentTypeSample",
        back_populates="schema",
        cascade="all, delete-orphan",
    )
    versions = relationship(
        "DoctypeVersion",
        back_populates="doctype",
        cascade="all, delete-orphan",
        order_by="DoctypeVersion.version",
    )


class DocumentTypeSample(Base):
    """Reference image/PDF used by DocBrain to train inference for a schema."""
    __tablename__ = "document_type_samples"
    id                  = Column(Integer, primary_key=True)
    schema_id           = Column(
        Integer,
        ForeignKey("document_type_schemas.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    filename            = Column(String(512), nullable=False)
    sha256              = Column(String(64), nullable=False, index=True)
    storage_key         = Column(String(512), nullable=False)
    size                = Column(Integer, nullable=False)
    mime_type           = Column(String(128), nullable=False)
    ocr_text            = Column(Text)
    ocr_backend         = Column(String(64))
    ocr_mean_confidence = Column(Float)
    schema_version      = Column(Integer, nullable=False, default=1)
    uploaded_by         = Column(String(128))
    uploaded_at         = Column(DateTime, default=datetime.utcnow)
    tenant_id           = Column(String(64), nullable=False, default="nbe", index=True)

    __table_args__ = (
        UniqueConstraint("schema_id", "sha256", name="uq_dts_schema_sha256"),
    )

    schema = relationship("DocumentTypeSchema", back_populates="samples")
    chunks = relationship(
        "DoctypeSampleChunk",
        back_populates="sample",
        cascade="all, delete-orphan",
    )


class DoctypeVersion(Base):
    """Schema version snapshot for a DocumentTypeSchema (migration 0031).

    Each edit to a doctype creates a new draft version row. Publishing
    promotes it to ``live`` and archives the previous live row.  Workflow
    instances pin to the live version at creation time via
    ``workflow_steps.doctype_version_id``.
    """
    __tablename__ = "doctype_versions"
    id          = Column(Integer, primary_key=True)
    doctype_id  = Column(
        Integer,
        ForeignKey("document_type_schemas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version     = Column(Integer, nullable=False, default=1)
    schema_json = Column(Text, nullable=False, default="[]")
    created_by  = Column(String(128), nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
    status      = Column(String(16), nullable=False, default="draft")

    __table_args__ = (
        UniqueConstraint("doctype_id", "version", name="uq_dv_doctype_version"),
    )

    doctype = relationship("DocumentTypeSchema", back_populates="versions")
    bboxes  = relationship(
        "DoctypeFieldBbox",
        back_populates="version",
        cascade="all, delete-orphan",
    )


class DoctypeFieldBbox(Base):
    """Per-field bounding box annotation on a sample page (migration 0031).

    ``x``, ``y``, ``w``, ``h`` are normalised to [0, 1] relative to the
    rendered page dimensions.  ``source`` distinguishes human-confirmed boxes
    (solid green in the labeler) from AI-proposed ones (dashed amber).
    """
    __tablename__ = "doctype_field_bbox"
    id                 = Column(Integer, primary_key=True)
    doctype_version_id = Column(
        Integer,
        ForeignKey("doctype_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    field_name = Column(String(64), nullable=False)
    page       = Column(Integer, nullable=False, default=1)
    x          = Column(Float, nullable=False)
    y          = Column(Float, nullable=False)
    w          = Column(Float, nullable=False)
    h          = Column(Float, nullable=False)
    source     = Column(String(16), nullable=False, default="confirmed")

    version = relationship("DoctypeVersion", back_populates="bboxes")


class DoctypeSampleChunk(Base):
    """Vector embedding chunk derived from a DocumentTypeSample.

    ``embedding`` is stored as raw bytes (LargeBinary) so the column works with
    both SQLite (BLOB) and Postgres (BYTEA) without a pgvector extension
    dependency at the model layer.  The AI service serialises/deserialises the
    float32 array via ``numpy.frombuffer`` / ``ndarray.tobytes()``.
    """
    __tablename__ = "doctype_sample_chunks"
    id = Column(Integer, primary_key=True)
    sample_id = Column(
        Integer,
        ForeignKey("document_type_samples.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_index = Column(Integer, nullable=False, default=0)
    page = Column(Integer)
    text_snippet = Column(Text)
    embedding = Column(LargeBinary)    # float32 array, numpy tobytes()
    model_name = Column(String(128))
    created_at = Column(DateTime, default=datetime.utcnow)

    sample = relationship("DocumentTypeSample", back_populates="chunks")


# ---------------------------------------------------------------------------
# CBS integration models (migration 0019_customers)
# ---------------------------------------------------------------------------


class Customer(Base):
    """
    CBS-sourced customer record, upserted by the KYC/CIF link layer.

    cif         — customer identifier as used in the CBS (e.g. Temenos CIF)
    tenant_id   — tenant isolation key (one row per cif+tenant_id)
    cbs_source  — adapter name that last wrote this row (e.g. "temenos_t24")
    last_synced_at — UTC timestamp of the last successful CBS pull
    raw_json    — full CBS response body as JSON text (for debug/audit)
    """
    __tablename__ = "customers"
    id             = Column(Integer, primary_key=True)
    cif            = Column(String(64), nullable=False, index=True)
    name           = Column(String(512))
    tenant_id      = Column(String(64), nullable=False, index=True)
    cbs_source     = Column(String(64), default="temenos_t24")
    last_synced_at = Column(DateTime, index=True)
    raw_json       = Column(Text)
    created_at     = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("cif", "tenant_id", name="uq_customer_cif_tenant"),
    )


class AuditLog(Base):
    """
    Append-only audit log for all CBS integration operations.

    Written by kyc_cif.py and any future service that needs a durable,
    human-readable trail of who did what to which resource.
    """
    __tablename__ = "audit_log"
    id            = Column(Integer, primary_key=True)
    tenant        = Column(String(64), nullable=False, index=True)
    actor         = Column(String(128), nullable=False, index=True)
    action        = Column(String(64), nullable=False, index=True)
    resource_type = Column(String(64), index=True)
    resource_id   = Column(String(128), index=True)
    detail        = Column(Text)
    created_at    = Column(DateTime, default=datetime.utcnow, index=True)


# ---------------------------------------------------------------------------
# AML Screening models (BHU-67, Phase 2, migration 0021)
# ---------------------------------------------------------------------------


class AmlWatchlist(Base):
    """Metadata record for one AML watchlist source (OFAC SDN, EU Consolidated, etc.)."""

    __tablename__ = "aml_watchlists"

    id              = Column(Integer, primary_key=True)
    tenant_id       = Column(String(64), nullable=False, index=True)
    list_name       = Column(String(256), nullable=False)
    source_url      = Column(String(512), nullable=True)
    match_threshold = Column(Float, nullable=False, default=0.85)
    last_updated    = Column(DateTime, nullable=True)
    entry_count     = Column(Integer, nullable=False, default=0)
    active          = Column(Integer, nullable=False, default=1)
    created_at      = Column(DateTime, default=datetime.utcnow)

    entries = relationship(
        "AmlWatchlistEntry",
        back_populates="watchlist",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "list_name", name="uq_aml_watchlist_tenant_name"),
    )


class AmlWatchlistEntry(Base):
    """One flat record from an AML watchlist (individual or entity)."""

    __tablename__ = "aml_watchlist_entries"

    id              = Column(Integer, primary_key=True)
    watchlist_id    = Column(Integer, ForeignKey("aml_watchlists.id", ondelete="CASCADE"), nullable=False, index=True)
    normalized_name = Column(String(512), nullable=False, index=True)
    dob             = Column(String(10), nullable=True)
    country         = Column(String(3), nullable=True)
    original_record = Column(JSON, nullable=False, default=dict)
    created_at      = Column(DateTime, default=datetime.utcnow)

    watchlist = relationship("AmlWatchlist", back_populates="entries")
    hits      = relationship(
        "AmlHit",
        back_populates="watchlist_entry",
        cascade="all, delete-orphan",
    )


class AmlScreening(Base):
    """One screening run for a single customer."""

    __tablename__ = "aml_screenings"

    id             = Column(Integer, primary_key=True)
    tenant_id      = Column(String(64), nullable=False, index=True)
    customer_cid   = Column(String(64), nullable=False, index=True)
    screened_at    = Column(DateTime, default=datetime.utcnow, index=True)
    status         = Column(String(32), nullable=False, default="pending")
    hit_count      = Column(Integer, nullable=False, default=0)
    trigger_reason = Column(String(64), nullable=True)
    started_at     = Column(DateTime, nullable=True)
    completed_at   = Column(DateTime, nullable=True)

    hits = relationship(
        "AmlHit",
        back_populates="screening",
        cascade="all, delete-orphan",
    )


class AmlHit(Base):
    """One matched watchlist entry within a screening run."""

    __tablename__ = "aml_hits"

    id                 = Column(Integer, primary_key=True)
    screening_id       = Column(Integer, ForeignKey("aml_screenings.id", ondelete="CASCADE"), nullable=False, index=True)
    watchlist_entry_id = Column(Integer, ForeignKey("aml_watchlist_entries.id", ondelete="CASCADE"), nullable=False)
    score              = Column(Float, nullable=False)
    decision           = Column(String(32), nullable=False, default="open")
    reviewed_by        = Column(Integer, nullable=True)
    reviewed_at        = Column(DateTime, nullable=True)
    review_notes       = Column(Text, nullable=True)
    created_at         = Column(DateTime, default=datetime.utcnow)

    screening       = relationship("AmlScreening", back_populates="hits")
    watchlist_entry = relationship("AmlWatchlistEntry", back_populates="hits")


class AmlHitSuppression(Base):
    """False-positive memory for AML hit-decide v2 (migration 0035).

    When a reviewer suppresses a subject_cid×watchlist_entry_id pair, future
    screenings of the same pair within the suppressed_until window are
    auto-cleared with the stored suppression_reason, skipping manual review.
    """

    __tablename__ = "aml_hit_suppressions"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id          = Column(String(64), nullable=False, index=True)
    subject_cid        = Column(String(64), nullable=False, index=True)
    watchlist_entry_id = Column(Integer, nullable=False, index=True)
    suppression_reason = Column(Text, nullable=False)
    suppressed_until   = Column(DateTime, nullable=True)   # None = permanent
    suppressed_by      = Column(String(256), nullable=False)
    created_at         = Column(DateTime, default=datetime.utcnow)


class CustomerPiiReveal(Base):
    """Audit trail for every PII field reveal in the Customer-360 drawer (migration 0035).

    Each row records one reveal event: which user revealed which fields on which
    customer CID, with a mandatory reason of ≥ 20 chars. Retained indefinitely
    for regulatory audit; never deleted even on DSAR erasure of customer records.
    """

    __tablename__ = "customer_pii_reveals"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id    = Column(String(64), nullable=False, index=True)
    user_id      = Column(Integer, nullable=False, index=True)
    customer_cid = Column(String(64), nullable=False, index=True)
    fields_json  = Column(Text, nullable=False)   # JSON array e.g. '["phone","email"]'
    reason       = Column(Text, nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# CBS Temenos T24 linkage + circuit-breaker models (migration 0022)
# ---------------------------------------------------------------------------


class CbsDocumentLink(Base):
    """Durable audit record of every successful T24 document linkage.

    idempotency_key is derived as hash(tenant_id || document_id || transaction_ref)
    and enforced UNIQUE on (tenant_id, idempotency_key) so a duplicate call at
    the application layer cannot produce a second row for the same linkage event.

    cif is the T24 customer identifier — not a FK to documents.customer_cid because
    T24 CIFs are opaque strings managed by the CBS, not the DMS.
    """
    __tablename__ = "cbs_document_links"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id        = Column(String(64), nullable=False, index=True)
    cif              = Column(String(64), nullable=False)
    document_id      = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    transaction_ref  = Column(String(256), nullable=False)
    transaction_type = Column(String(64), nullable=True)   # kyc-update | loan-application | account-opening | compliance-review
    idempotency_key  = Column(String(128), nullable=False)  # hash(tenant_id || document_id || transaction_ref)
    linked_by        = Column(Integer, nullable=False)   # users.id from Node schema — no FK in Python model
    linked_at        = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_cbs_link_tenant_idem"),
    )


class CbsCircuitEvent(Base):
    """Append-only log for ops visibility into circuit-breaker state transitions.

    Every transition (closed → open, open → half_open, half_open → closed, etc.)
    appends one row.  No rows are ever updated or deleted — this is a pure
    event log used by ops dashboards and the Grafana "CBS Integration" panel.
    """
    __tablename__ = "cbs_circuit_events"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id         = Column(String(64), nullable=False, index=True)
    adapter           = Column(String(64), nullable=False, default="temenos")
    state_from        = Column(String(16), nullable=False)   # closed | open | half_open
    state_to          = Column(String(16), nullable=False)   # closed | open | half_open
    reason            = Column(String(64), nullable=True)    # consecutive_errors | half_open_success | half_open_failure | manual_reset
    consecutive_errors = Column(Integer, nullable=False, default=0)
    event_at          = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)


# ---------------------------------------------------------------------------
# Face Match KYC models (BHU-9, migration 0025_face_match)
# DPIA: high risk — biometric PII. Raw images are NEVER stored.
# Only 128-dim float64 encodings (non-reversible) are persisted.
# ---------------------------------------------------------------------------


class BiometricEncoding(Base):
    """Cache of face encodings for ID photos (never live photos — privacy-first).

    face_encoding is a raw bytes serialisation of a 128-dim float64 numpy array
    (~1024 bytes). Stored as BLOB/BYTEA. Deserialise with numpy.frombuffer.
    Encrypted at rest by the storage layer (AES-256).

    Expires after tenant_settings.face_encoding_retention_days (default 90).
    A daily cron deletes rows where expires_at < now().
    """
    __tablename__ = "biometric_encodings"

    id              = Column(Integer, primary_key=True)
    tenant_id       = Column(String(64), nullable=False, index=True)
    photo_sha256    = Column(String(64), nullable=False, unique=True, index=True)
    photo_type      = Column(String(16), nullable=False)          # 'id_photo'
    face_encoding   = Column(LargeBinary, nullable=False)         # 128-dim float64 bytes
    face_geometry   = Column(JSON, nullable=True)                 # {eye_distance_px, head_pose_deg, face_count}
    encoding_model  = Column(String(128), nullable=False, default="face_recognition/dlib")
    created_at      = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at      = Column(DateTime, nullable=False,
                             default=lambda: datetime.utcnow() + timedelta(days=90))


class BiometricConsent(Base):
    """GDPR consent audit trail — records WHEN a customer consented to biometric processing.

    Retention: 7 years regulatory minimum (consent records are legal evidence).
    On DSAR erasure: set revoked_at, do NOT hard-delete (legal hold).
    """
    __tablename__ = "biometric_consent"

    id                    = Column(Integer, primary_key=True)
    tenant_id             = Column(String(64), nullable=False, index=True)
    customer_cid          = Column(String(64), nullable=False, index=True)
    consent_version       = Column(String(16), nullable=False)
    language              = Column(String(2), nullable=False, default="en")
    given_at              = Column(DateTime, nullable=False, default=datetime.utcnow)
    signature_or_approval = Column(String(256), nullable=True)    # hash/token, not plaintext
    expires_at            = Column(DateTime, nullable=True)
    revoked_at            = Column(DateTime, nullable=True)


class BiometricMatch(Base):
    """Append-only audit record for every face match decision.

    No raw images. No encodings. Only SHA-256 hashes (non-reversible) +
    distance/match metadata. Required for DPIA compliance and regulatory audit.

    Retention: 10 years regulatory minimum (do not purge on DSAR — mark as
    requires_audit_review instead per contract §8).
    """
    __tablename__ = "biometric_match"

    id               = Column(Integer, primary_key=True)
    tenant_id        = Column(String(64), nullable=False, index=True)
    customer_cid     = Column(String(64), nullable=False, index=True)
    doc_id           = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    id_photo_sha256  = Column(String(64), nullable=False)
    live_photo_sha256 = Column(String(64), nullable=False)
    distance         = Column(Float, nullable=False)
    confidence       = Column(Float, nullable=False)
    match_result     = Column(Boolean, nullable=False)
    face_geometry_ok = Column(Boolean, nullable=False, default=True)
    threshold_used   = Column(Float, nullable=False)
    decided_at       = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    decided_by       = Column(String(128), nullable=True)
    decided_from     = Column(String(16), nullable=True)          # 'mobile' | 'web' | 'api'
    consent_token_id = Column(Integer, ForeignKey("biometric_consent.id", ondelete="SET NULL"), nullable=True)


# ---------------------------------------------------------------------------
# Redaction models (BHU-46, migration 0024_redaction)
# ---------------------------------------------------------------------------


class RedactionLog(Base):
    """Append-only audit record for every document redaction operation.

    One row per redaction call. Regions is a JSON array of
    {page, x, y, w, h, reason} dicts. Never updated after insert.
    Tenant boundary enforced: every query must filter by tenant_id.
    """
    __tablename__ = "redaction_log"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    document_id        = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    redacted_version_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    redacted_by        = Column(String(256), nullable=False)
    regions            = Column(JSON, nullable=False)
    reason             = Column(String(128), nullable=False)
    created_at         = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    tenant_id          = Column(String(64), nullable=False, default="default", index=True)


# ---------------------------------------------------------------------------
# CC1 — Tenant registry + configuration store (migration 0027_tenant_config)
# ---------------------------------------------------------------------------


class Tenant(Base):
    """Registry of tenant organisations.

    tenant_id is the stable internal key ('nbe', 'xyz-bank', …).
    slug is the URL-friendly alias shown in the UI (e.g. 'bob' for Bank of Bhutan).
    display_name is the human-readable bank name surfaced everywhere in the UI.
    allowed_locales is a JSON-encoded list of locale codes, e.g. '["en","dz"]'.
    """
    __tablename__ = "tenants"

    tenant_id        = Column(String(64), primary_key=True)
    slug             = Column(String(128), unique=True, nullable=False)
    display_name     = Column(String(256), nullable=False)
    regulator_name   = Column(String(256), nullable=False)
    regulator_short  = Column(String(32), nullable=False)
    default_locale   = Column(String(16), nullable=False, default="en")
    allowed_locales  = Column(Text, nullable=False, default='["en"]')
    primary_color    = Column(String(16), nullable=False, default="#0D2B6A")
    monogram         = Column(String(8), nullable=False, default="DM")
    logo_path        = Column(Text, nullable=True)
    favicon_path     = Column(Text, nullable=True)
    login_banner     = Column(Text, nullable=True)
    footer_text      = Column(Text, nullable=True)
    environment_label = Column(String(64), nullable=True)
    is_active        = Column(Integer, nullable=False, default=1)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    configs = relationship("TenantConfig", back_populates="tenant", cascade="all, delete-orphan")


class TenantConfig(Base):
    """Live configuration values for a tenant, keyed by (tenant_id, namespace, key).

    value is always JSON-encoded text — use json.loads/dumps.
    updated_by is the Node user id (integer) from the session that wrote the
    change; no FK enforced here since user rows live in the Node SQLite.
    """
    __tablename__ = "tenant_config"

    tenant_id      = Column(String(64), ForeignKey("tenants.tenant_id"), nullable=False, primary_key=True)
    namespace      = Column(String(64), nullable=False, primary_key=True)
    key            = Column(String(128), nullable=False, primary_key=True)
    value          = Column(Text, nullable=False)
    schema_version = Column(Integer, nullable=False, default=1)
    updated_by     = Column(Integer, nullable=True)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant", back_populates="configs")


class TenantConfigHistory(Base):
    """Append-only SHA-256 hash-chain audit log for tenant_config changes.

    Hash chain rule (see services/tenant_config.py for canonical implementation):
      canonical_json = json.dumps(row_dict, sort_keys=True, separators=(',', ':'))
      hash = sha256((prev_hash or '') + canonical_json).hexdigest()

    IMPORTANT: changed_at carries no server default. The service layer sets it
    explicitly (datetime.utcnow().isoformat() + 'Z') BEFORE computing the hash.
    This ensures the hash stored in the row equals the hash a verifier computes
    from the row after SELECT. Never let the DB supply this timestamp.
    """
    __tablename__ = "tenant_config_history"

    history_id     = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id      = Column(String(64), nullable=False, index=True)
    namespace      = Column(String(64), nullable=False)
    key            = Column(String(128), nullable=False)
    value          = Column(Text, nullable=False)
    schema_version = Column(Integer, nullable=False)
    changed_by     = Column(Integer, nullable=True)
    reason         = Column(Text, nullable=False)
    changed_at     = Column(String(32), nullable=False)   # ISO-8601 UTC; set client-side, no server default
    prev_hash      = Column(String(64), nullable=True)
    hash           = Column(String(64), nullable=False)


# ---------------------------------------------------------------------------
# DSAR Console models (migration 0040_dsar_requests — Wave C)
# ---------------------------------------------------------------------------

class DsarRequest(Base):
    """One Data Subject Access Request, created by an admin on behalf of a data subject.

    action  — article15_export | article17_cryptoshred | litigation_hold | fulfillment_letter
    status  — NEW | IN_PROGRESS | COMPLETED | OVERDUE
    regulator — GDPR | PDPL | RMA  (drives the SLA calendar from tenant_config)
    signed_receipt — JSON blob stored after fulfillment confirming what was done.
    """
    __tablename__ = "dsar_requests"

    id                       = Column(String(36), primary_key=True)   # UUID
    tenant_id                = Column(String(64), nullable=False, index=True)
    customer_cid             = Column(String(64), nullable=False, index=True)
    action                   = Column(String(64), nullable=False)
    status                   = Column(String(32), nullable=False, default="NEW", index=True)
    requested_by             = Column(String(128), nullable=False)
    requested_at             = Column(DateTime, nullable=False, default=datetime.utcnow)
    sla_due_at               = Column(DateTime, nullable=False)
    completed_at             = Column(DateTime, nullable=True)
    regulator                = Column(String(32), nullable=True)
    params_json              = Column(Text, nullable=True)
    fulfillment_artifact_path = Column(String(512), nullable=True)
    signed_receipt           = Column(Text, nullable=True)

    artifacts = relationship(
        "DsarArtifact",
        back_populates="request",
        cascade="all, delete-orphan",
    )


class DsarArtifact(Base):
    """One artifact record snapshotted into a DSAR request.

    kind — document | ai_trace | audit_event | workflow | cbs_record
    ref_type / ref_id — pointer to the source row (e.g. 'document', '42')
    snapshot_json — denormalised copy of the row at fulfillment time.
    """
    __tablename__ = "dsar_artifacts"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    request_id    = Column(String(36), ForeignKey("dsar_requests.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    kind          = Column(String(32), nullable=False, index=True)
    ref_type      = Column(String(64), nullable=True)
    ref_id        = Column(String(128), nullable=True)
    snapshot_json = Column(Text, nullable=True)

    request = relationship("DsarRequest", back_populates="artifacts")
