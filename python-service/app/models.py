from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Float, Boolean
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
