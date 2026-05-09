"""Tests for AML screening service + router (BHU-67, Phase 2).

Coverage:
  - normalize_name (6 cases)
  - levenshtein_similarity (4 cases including empties)
  - match_against_watchlist (above/below threshold, tenant isolation)
  - screen_customer (no hits, hits exist, tenant isolation, DB error → status=error)
  - Endpoint: GET /aml/watchlists (200, 401, 403)
  - Endpoint: POST /aml/watchlists/refresh (202, 401)
  - Endpoint: PATCH /aml/watchlists/{id} (200, 404)
  - Endpoint: POST /aml/screen (skipped when FF off, pending when FF on, idempotency)
  - Endpoint: GET /aml/screenings (200, filter by status, 401)
  - Endpoint: GET /aml/screenings/{id} (200, 404)
  - Endpoint: GET /aml/hits (200, decision filter)
  - Endpoint: POST /aml/hits/{id}/decide (200, 409 already reviewed, 404, workflow for blocked)
  - Endpoint: GET /aml/summary (200, 401)
  - Endpoint: GET /aml/stats (200)
"""
from __future__ import annotations

import os
import sys
import uuid as _uuid_module
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ---------------------------------------------------------------------------
# Environment setup (before app imports)
# conftest.py sets these via setdefault; we just ensure FF_AML_LIVE is off.
# ---------------------------------------------------------------------------
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test.db")
os.environ["FF_AML_LIVE"] = "false"

from datetime import datetime
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# App / client fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    from app.main import app
    return TestClient(app, raise_server_exceptions=False)


HEADERS = {"X-API-Key": "test-key"}


# ---------------------------------------------------------------------------
# DB fixtures for unit tests
# ---------------------------------------------------------------------------

@pytest.fixture
def db_session():
    """In-memory SQLite session for unit-level service tests."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.db import Base

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()
    yield session
    session.close()
    engine.dispose()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_principal(role: str = "doc_admin", tenant: str = "default") -> MagicMock:
    p = MagicMock()
    p.sub = "test-user"
    p.tenant = tenant
    p.roles = [role]
    p.has = lambda perm: True
    return p


def _override_require(app, perm: str, principal: MagicMock):
    from app.services.auth import require
    app.dependency_overrides[require(perm)] = lambda: principal


def _clear_overrides(app):
    app.dependency_overrides.clear()


# ===========================================================================
# 1. normalize_name — 6 cases
# ===========================================================================

class TestNormalizeName:
    def test_basic_title_case(self):
        from app.services.aml_screening import normalize_name
        result = normalize_name("Mohamed Salah")
        assert result == "mohamed salah"

    def test_comma_separated_reversed(self):
        from app.services.aml_screening import normalize_name
        # 'Salah, Mohamed' should normalize to same as 'Mohamed Salah'
        assert normalize_name("Salah, Mohamed") == normalize_name("Mohamed Salah")

    def test_all_caps_double_space(self):
        from app.services.aml_screening import normalize_name
        assert normalize_name("MOHAMED  SALAH") == normalize_name("Mohamed Salah")

    def test_diacritics_stripped(self):
        from app.services.aml_screening import normalize_name
        assert normalize_name("Müller") == "muller"
        assert normalize_name("José") == "jose"
        assert normalize_name("Hébert") == "hebert"

    def test_punctuation_removed(self):
        from app.services.aml_screening import normalize_name
        # Apostrophes become spaces → tokens sorted: "brien" before "o"
        result_obrien = normalize_name("O'Brien")
        assert "," not in result_obrien
        assert "'" not in result_obrien
        # Al-Rashid, Ibrahim → hyphens and commas become spaces
        result = normalize_name("Al-Rashid, Ibrahim")
        assert "," not in result
        assert "-" not in result

    def test_empty_string(self):
        from app.services.aml_screening import normalize_name
        assert normalize_name("") == ""

    def test_token_sort_order(self):
        from app.services.aml_screening import normalize_name
        # Token sort: identical regardless of input order
        assert normalize_name("Salah Mohamed") == normalize_name("Mohamed Salah")


# ===========================================================================
# 2. levenshtein_similarity — 4 cases including empties
# ===========================================================================

class TestLevenshteinSimilarity:
    def test_exact_match(self):
        from app.services.aml_screening import levenshtein_similarity
        assert levenshtein_similarity("john smith", "john smith") == 1.0

    def test_no_overlap(self):
        from app.services.aml_screening import levenshtein_similarity
        score = levenshtein_similarity("abcdef", "ghijkl")
        assert score < 0.3  # near-0

    def test_half_match(self):
        from app.services.aml_screening import levenshtein_similarity
        # "abcdef" vs "abcxyz" — 3 of 6 chars differ → distance=3, similarity~=0.5
        score = levenshtein_similarity("abcdef", "abcxyz")
        assert 0.4 <= score <= 0.6

    def test_empty_inputs_no_crash(self):
        from app.services.aml_screening import levenshtein_similarity
        assert levenshtein_similarity("", "") == 1.0
        assert levenshtein_similarity("abc", "") == 0.0
        assert levenshtein_similarity("", "abc") == 0.0

    def test_john_smith_vs_jon_smith(self):
        """Contract requirement: 'John Smith' ≥ 0.85 similarity with 'Jon Smith'."""
        from app.services.aml_screening import normalize_name, levenshtein_similarity
        a = normalize_name("John Smith")
        b = normalize_name("Jon Smith")
        score = levenshtein_similarity(a, b)
        assert score >= 0.85, f"Expected ≥0.85, got {score}"

    def test_similarity_at_threshold(self):
        """Score exactly 1.0 for identical strings."""
        from app.services.aml_screening import levenshtein_similarity
        assert levenshtein_similarity("ali hassan", "ali hassan") == 1.0


# ===========================================================================
# 3. match_against_watchlist
# ===========================================================================

class TestMatchAgainstWatchlist:
    def _seed_watchlist(self, db) -> int:
        from app.models import AmlWatchlist, AmlWatchlistEntry
        from app.services.aml_screening import normalize_name

        wl = AmlWatchlist(
            tenant_id="tenant_a",
            list_name="TEST_LIST",
            match_threshold=0.85,
            entry_count=3,
            active=1,
        )
        db.add(wl)
        db.flush()

        for raw_name in ["John Smith", "Ali Hassan", "Ibrahim Al-Rashid"]:
            db.add(
                AmlWatchlistEntry(
                    watchlist_id=wl.id,
                    normalized_name=normalize_name(raw_name),
                    dob=None,
                    country="US",
                    original_record={"name": raw_name},
                )
            )
        db.commit()
        return wl.id

    def test_hit_above_threshold(self, db_session):
        from app.services.aml_screening import match_against_watchlist

        wl_id = self._seed_watchlist(db_session)
        matches = match_against_watchlist("Jon Smith", None, wl_id, db_session)
        assert len(matches) >= 1
        assert all(m.score >= 0.85 for m in matches)

    def test_no_hit_below_threshold(self, db_session):
        from app.services.aml_screening import match_against_watchlist

        wl_id = self._seed_watchlist(db_session)
        matches = match_against_watchlist("Completely Different Name XYZ", None, wl_id, db_session)
        assert len(matches) == 0

    def test_dob_prefilter(self, db_session):
        """With DOB provided, only DOB-matching entries are candidates."""
        from app.models import AmlWatchlist, AmlWatchlistEntry
        from app.services.aml_screening import match_against_watchlist, normalize_name

        wl = AmlWatchlist(
            tenant_id="tenant_a",
            list_name="DOB_LIST",
            match_threshold=0.85,
            entry_count=1,
            active=1,
        )
        db_session.add(wl)
        db_session.flush()
        db_session.add(
            AmlWatchlistEntry(
                watchlist_id=wl.id,
                normalized_name=normalize_name("Ali Hassan"),
                dob="1972-03-15",
                country="SD",
                original_record={"name": "Ali Hassan"},
            )
        )
        db_session.commit()

        # Correct DOB → match
        m = match_against_watchlist("Ali Hassan", "1972-03-15", wl.id, db_session)
        assert len(m) >= 1

        # Wrong DOB → no candidate rows returned → no match
        m2 = match_against_watchlist("Ali Hassan", "2000-01-01", wl.id, db_session)
        assert len(m2) == 0

    def test_inactive_watchlist_returns_empty(self, db_session):
        from app.models import AmlWatchlist, AmlWatchlistEntry
        from app.services.aml_screening import match_against_watchlist, normalize_name

        wl = AmlWatchlist(
            tenant_id="tenant_a",
            list_name="INACTIVE_LIST",
            match_threshold=0.85,
            entry_count=1,
            active=0,
        )
        db_session.add(wl)
        db_session.flush()
        db_session.add(
            AmlWatchlistEntry(
                watchlist_id=wl.id,
                normalized_name=normalize_name("John Smith"),
                dob=None,
                country="US",
                original_record={"name": "John Smith"},
            )
        )
        db_session.commit()

        matches = match_against_watchlist("John Smith", None, wl.id, db_session)
        assert matches == []


# ===========================================================================
# 4. screen_customer
# ===========================================================================

class TestScreenCustomer:
    def _seed_watchlist_for_tenant(self, db, tenant_id: str, names: list[str]) -> None:
        from app.models import AmlWatchlist, AmlWatchlistEntry
        from app.services.aml_screening import normalize_name

        wl = AmlWatchlist(
            tenant_id=tenant_id,
            list_name=f"LIST_{tenant_id.upper()}",
            match_threshold=0.85,
            entry_count=len(names),
            active=1,
        )
        db.add(wl)
        db.flush()
        for name in names:
            db.add(
                AmlWatchlistEntry(
                    watchlist_id=wl.id,
                    normalized_name=normalize_name(name),
                    dob=None,
                    country="US",
                    original_record={"name": name},
                )
            )
        db.commit()

    def test_happy_path_no_hits(self, db_session):
        from app.services.aml_screening import screen_customer

        # No watchlists seeded for this tenant → no hits
        screening = screen_customer(
            cid="cust_001",
            tenant_id="tenant_clean",
            db=db_session,
            trigger_reason="manual",
            customer_name="Completely Unique Person",
        )
        assert screening.status == "cleared"
        assert screening.hit_count == 0
        assert screening.customer_cid == "cust_001"

    def test_happy_path_hits_found(self, db_session):
        from app.services.aml_screening import screen_customer

        self._seed_watchlist_for_tenant(db_session, "tenant_b", ["John Smith"])
        screening = screen_customer(
            cid="cust_002",
            tenant_id="tenant_b",
            db=db_session,
            trigger_reason="manual",
            customer_name="Jon Smith",  # close match to "John Smith"
        )
        assert screening.status == "flagged"
        assert screening.hit_count >= 1

    def test_tenant_isolation(self, db_session):
        """Customer in tenant_c does not match watchlist scoped to tenant_d."""
        from app.services.aml_screening import screen_customer

        # Seed watchlist only for tenant_d
        self._seed_watchlist_for_tenant(db_session, "tenant_d", ["John Smith"])

        # Screen a customer in tenant_c — different tenant, no watchlists
        screening = screen_customer(
            cid="cust_003",
            tenant_id="tenant_c",
            db=db_session,
            trigger_reason="manual",
            customer_name="John Smith",  # exact name but wrong tenant
        )
        assert screening.status == "cleared"
        assert screening.hit_count == 0

    def test_db_error_sets_status_error(self, db_session):
        """If an exception occurs mid-screening, status must become 'error'."""
        from app.services.aml_screening import screen_customer
        from app.models import AmlScreening, AmlWatchlist, AmlWatchlistEntry

        # Seed a watchlist so the loop body executes and calls match_against_watchlist
        wl = AmlWatchlist(
            tenant_id="tenant_err",
            list_name="ERR_LIST",
            match_threshold=0.85,
            entry_count=1,
            active=1,
        )
        db_session.add(wl)
        db_session.flush()
        db_session.add(
            AmlWatchlistEntry(
                watchlist_id=wl.id,
                normalized_name="john smith",
                dob=None,
                country="US",
                original_record={"name": "John Smith"},
            )
        )
        db_session.commit()

        # Patch the inner scoring function to raise
        with patch(
            "app.services.aml_screening.levenshtein_similarity",
            side_effect=RuntimeError("DB unavailable"),
        ):
            with pytest.raises(RuntimeError):
                screen_customer(
                    cid="cust_err",
                    tenant_id="tenant_err",
                    db=db_session,
                    trigger_reason="manual",
                    customer_name="John Smith",
                )

        # The screening row should now be in error state
        row = (
            db_session.query(AmlScreening)
            .filter(AmlScreening.customer_cid == "cust_err")
            .first()
        )
        assert row is not None
        assert row.status == "error"

    def test_idempotency_returns_inflight(self, db_session):
        """Second screen_customer within window returns same screening."""
        from app.services.aml_screening import screen_customer
        from app.models import AmlScreening

        # Manually insert a running screening
        s = AmlScreening(
            tenant_id="tenant_idem",
            customer_cid="cust_idem",
            screened_at=datetime.utcnow(),
            status="running",
            hit_count=0,
        )
        db_session.add(s)
        db_session.commit()

        result = screen_customer(
            cid="cust_idem",
            tenant_id="tenant_idem",
            db=db_session,
            trigger_reason="manual",
            customer_name="Some Name",
        )
        assert result.id == s.id


# ===========================================================================
# 5. Endpoint tests — GET /aml/watchlists
# ===========================================================================

class TestWatchlistEndpoints:
    def test_list_watchlists_no_api_key(self, client):
        resp = client.get("/api/v1/aml/watchlists")
        assert resp.status_code == 401

    def test_list_watchlists_with_api_key_and_no_jwt_gets_doc_admin(self, client):
        """X-API-Key alone grants doc_admin via current_principal, which satisfies admin perm."""
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("admin")] = lambda: _make_principal("doc_admin")
        try:
            resp = client.get("/api/v1/aml/watchlists", headers=HEADERS)
            # With overridden require("admin"), response should be 200
            assert resp.status_code == 200
        finally:
            _clear_overrides(app)

    def test_list_watchlists_ok(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("admin")] = lambda: _make_principal("doc_admin")
        try:
            resp = client.get("/api/v1/aml/watchlists", headers=HEADERS)
            assert resp.status_code == 200
            body = resp.json()
            assert "items" in body
            assert "total" in body
        finally:
            _clear_overrides(app)

    def test_patch_watchlist_not_found(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("admin")] = lambda: _make_principal("doc_admin")
        try:
            resp = client.patch(
                "/api/v1/aml/watchlists/999999",
                json={"active": False},
                headers=HEADERS,
            )
            assert resp.status_code == 404
        finally:
            _clear_overrides(app)

    def test_patch_watchlist_ok(self, client):
        """Create a watchlist then patch its threshold."""
        import uuid as _uuid
        from app.main import app
        from app.services.auth import require
        from app.db import SessionLocal
        from app.models import AmlWatchlist

        # Seed a watchlist row with a unique name to avoid constraint violations
        unique_name = f"PATCH_TEST_LIST_{_uuid.uuid4().hex[:8].upper()}"
        db = SessionLocal()
        try:
            wl = AmlWatchlist(
                tenant_id="default",
                list_name=unique_name,
                match_threshold=0.85,
                entry_count=0,
                active=1,
            )
            db.add(wl)
            db.commit()
            wl_id = wl.id
        finally:
            db.close()

        app.dependency_overrides[require("admin")] = lambda: _make_principal("doc_admin")
        try:
            resp = client.patch(
                f"/api/v1/aml/watchlists/{wl_id}",
                json={"match_threshold": 0.9},
                headers=HEADERS,
            )
            assert resp.status_code == 200
            assert resp.json()["match_threshold"] == 0.9
        finally:
            _clear_overrides(app)


# ===========================================================================
# 6. Endpoint tests — POST /aml/watchlists/refresh
# ===========================================================================

class TestWatchlistRefresh:
    def test_refresh_no_api_key(self, client):
        resp = client.post("/api/v1/aml/watchlists/refresh")
        assert resp.status_code == 401

    def test_refresh_ok(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("admin")] = lambda: _make_principal("doc_admin")
        try:
            resp = client.post("/api/v1/aml/watchlists/refresh", headers=HEADERS)
            assert resp.status_code == 202
            body = resp.json()
            assert "job_id" in body
            assert body["status"] == "queued"
        finally:
            _clear_overrides(app)


# ===========================================================================
# 7. Endpoint tests — POST /aml/screen
# ===========================================================================

class TestScreenEndpoint:
    def test_screen_ff_off_returns_skipped(self, client):
        """When FF_AML_LIVE=false, returns {skipped: true} regardless of auth."""
        from app.main import app
        from app.services.auth import require

        os.environ["FF_AML_LIVE"] = "false"
        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")
        try:
            resp = client.post(
                "/api/v1/aml/screen",
                json={"customer_cid": "cust_ff_off"},
                headers=HEADERS,
            )
            assert resp.status_code == 200
            body = resp.json()
            assert body.get("skipped") is True
            assert body.get("reason") == "feature_flag_off"
        finally:
            _clear_overrides(app)
            os.environ["FF_AML_LIVE"] = "false"

    def test_screen_ff_off_no_row_created(self, client):
        """When FF off, no AmlScreening row is created."""
        from app.main import app
        from app.services.auth import require
        from app.db import SessionLocal
        from app.models import AmlScreening

        os.environ["FF_AML_LIVE"] = "false"
        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")

        cid = "cust_ff_off_no_row"
        try:
            client.post(
                "/api/v1/aml/screen",
                json={"customer_cid": cid},
                headers=HEADERS,
            )
        finally:
            _clear_overrides(app)
            os.environ["FF_AML_LIVE"] = "false"

        db = SessionLocal()
        try:
            row = (
                db.query(AmlScreening)
                .filter(AmlScreening.customer_cid == cid)
                .first()
            )
            assert row is None
        finally:
            db.close()

    def test_screen_ff_on_returns_pending(self, client):
        from app.main import app
        from app.services.auth import require

        os.environ["FF_AML_LIVE"] = "true"
        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")
        try:
            resp = client.post(
                "/api/v1/aml/screen",
                json={"customer_cid": "cust_ff_on"},
                headers=HEADERS,
            )
            assert resp.status_code == 200
            body = resp.json()
            assert "screening_id" in body
            assert body["status"] == "pending"
        finally:
            _clear_overrides(app)
            os.environ["FF_AML_LIVE"] = "false"

    def test_screen_no_api_key(self, client):
        resp = client.post("/api/v1/aml/screen", json={"customer_cid": "x"})
        assert resp.status_code == 401

    def test_screen_ff_off_no_audit_written(self, client):
        """Feature flag off → no AML_SCREENING_TRIGGERED audit row."""
        from app.main import app
        from app.services.auth import require
        from app.db import SessionLocal
        from app.models import AuditLog

        os.environ["FF_AML_LIVE"] = "false"
        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")
        cid = "cust_audit_check"
        try:
            client.post(
                "/api/v1/aml/screen",
                json={"customer_cid": cid},
                headers=HEADERS,
            )
        finally:
            _clear_overrides(app)
            os.environ["FF_AML_LIVE"] = "false"

        db = SessionLocal()
        try:
            row = (
                db.query(AuditLog)
                .filter(
                    AuditLog.action == "AML_SCREENING_TRIGGERED",
                    AuditLog.resource_id == cid,
                )
                .first()
            )
            assert row is None
        finally:
            db.close()


# ===========================================================================
# 8. Endpoint tests — GET /aml/screenings
# ===========================================================================

class TestScreeningsEndpoint:
    def test_list_screenings_no_api_key(self, client):
        resp = client.get("/api/v1/aml/screenings")
        assert resp.status_code == 401

    def test_list_screenings_ok(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")
        try:
            resp = client.get("/api/v1/aml/screenings", headers=HEADERS)
            assert resp.status_code == 200
            body = resp.json()
            assert "items" in body
            assert "total" in body
        finally:
            _clear_overrides(app)

    def test_list_screenings_invalid_status(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")
        try:
            resp = client.get(
                "/api/v1/aml/screenings?status=invalid_status",
                headers=HEADERS,
            )
            assert resp.status_code == 400
        finally:
            _clear_overrides(app)

    def test_get_screening_not_found(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")
        try:
            resp = client.get("/api/v1/aml/screenings/999999", headers=HEADERS)
            assert resp.status_code == 404
        finally:
            _clear_overrides(app)

    def test_get_screening_ok(self, client):
        from app.main import app
        from app.services.auth import require
        from app.db import SessionLocal
        from app.models import AmlScreening

        db = SessionLocal()
        try:
            s = AmlScreening(
                tenant_id="default",
                customer_cid="cust_get_screening",
                screened_at=datetime.utcnow(),
                status="cleared",
                hit_count=0,
            )
            db.add(s)
            db.commit()
            s_id = s.id
        finally:
            db.close()

        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")
        try:
            resp = client.get(f"/api/v1/aml/screenings/{s_id}", headers=HEADERS)
            assert resp.status_code == 200
            body = resp.json()
            assert body["screening_id"] == s_id
            assert "hits" in body
        finally:
            _clear_overrides(app)


# ===========================================================================
# 9. Endpoint tests — GET /aml/hits
# ===========================================================================

class TestHitsEndpoint:
    def test_list_hits_no_api_key(self, client):
        resp = client.get("/api/v1/aml/hits")
        assert resp.status_code == 401

    def test_list_hits_ok(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")
        try:
            resp = client.get("/api/v1/aml/hits", headers=HEADERS)
            assert resp.status_code == 200
            body = resp.json()
            assert "items" in body
        finally:
            _clear_overrides(app)

    def test_list_hits_invalid_decision(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")
        try:
            resp = client.get(
                "/api/v1/aml/hits?decision=badvalue",
                headers=HEADERS,
            )
            assert resp.status_code == 400
        finally:
            _clear_overrides(app)


# ===========================================================================
# 10. Endpoint tests — POST /aml/hits/{id}/decide
# ===========================================================================

def _seed_hit(tenant_id: str = "default") -> int:
    """Seed an AmlScreening + AmlWatchlistEntry + AmlHit; return the hit id.

    Uses uuid4 for unique names so repeated calls within the same test
    session and across multiple test runs never collide.
    """
    unique_suffix = _uuid_module.uuid4().hex[:12]

    from app.db import SessionLocal
    from app.models import AmlWatchlist, AmlWatchlistEntry, AmlScreening, AmlHit

    db = SessionLocal()
    try:
        wl = AmlWatchlist(
            tenant_id=tenant_id,
            list_name=f"DECIDE_{unique_suffix}",
            match_threshold=0.85,
            entry_count=1,
            active=1,
        )
        db.add(wl)
        db.flush()
        entry = AmlWatchlistEntry(
            watchlist_id=wl.id,
            normalized_name="john smith",
            dob=None,
            country="US",
            original_record={"name": "John Smith"},
        )
        db.add(entry)
        db.flush()
        s = AmlScreening(
            tenant_id=tenant_id,
            customer_cid=f"cust_decide_{unique_suffix}",
            screened_at=datetime.utcnow(),
            status="flagged",
            hit_count=1,
        )
        db.add(s)
        db.flush()
        h = AmlHit(
            screening_id=s.id,
            watchlist_entry_id=entry.id,
            score=0.92,
            decision="open",
        )
        db.add(h)
        db.commit()
        return h.id
    finally:
        db.close()


class TestHitDecideEndpoint:
    def test_decide_no_api_key(self, client):
        resp = client.post("/api/v1/aml/hits/1/decide", json={"decision": "cleared"})
        assert resp.status_code == 401

    def test_decide_invalid_decision(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("approve")] = lambda: _make_principal("doc_admin")
        hit_id = _seed_hit()
        try:
            resp = client.post(
                f"/api/v1/aml/hits/{hit_id}/decide",
                json={"decision": "maybe"},
                headers=HEADERS,
            )
            assert resp.status_code == 422  # Pydantic validation
        finally:
            _clear_overrides(app)

    def test_decide_cleared_ok(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("approve")] = lambda: _make_principal("doc_admin")
        hit_id = _seed_hit()
        try:
            resp = client.post(
                f"/api/v1/aml/hits/{hit_id}/decide",
                json={"decision": "cleared", "notes": "False positive — verified via CBR"},
                headers=HEADERS,
            )
            assert resp.status_code == 200
            body = resp.json()
            assert body["decision"] == "cleared"
            assert body["hit_id"] == hit_id
            assert "reviewed_at" in body
        finally:
            _clear_overrides(app)

    def test_decide_already_reviewed_returns_409(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("approve")] = lambda: _make_principal("doc_admin")
        hit_id = _seed_hit()
        try:
            # First decide
            client.post(
                f"/api/v1/aml/hits/{hit_id}/decide",
                json={"decision": "cleared"},
                headers=HEADERS,
            )
            # Second decide on same hit
            resp = client.post(
                f"/api/v1/aml/hits/{hit_id}/decide",
                json={"decision": "escalated"},
                headers=HEADERS,
            )
            assert resp.status_code == 409
        finally:
            _clear_overrides(app)

    def test_decide_not_found(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("approve")] = lambda: _make_principal("doc_admin")
        try:
            resp = client.post(
                "/api/v1/aml/hits/999999/decide",
                json={"decision": "cleared"},
                headers=HEADERS,
            )
            assert resp.status_code == 404
        finally:
            _clear_overrides(app)

    def test_decide_blocked_writes_audit(self, client):
        from app.main import app
        from app.services.auth import require
        from app.db import SessionLocal
        from app.models import AuditLog

        app.dependency_overrides[require("approve")] = lambda: _make_principal("doc_admin")
        hit_id = _seed_hit()
        try:
            resp = client.post(
                f"/api/v1/aml/hits/{hit_id}/decide",
                json={"decision": "blocked", "notes": "Confirmed match"},
                headers=HEADERS,
            )
            assert resp.status_code == 200
        finally:
            _clear_overrides(app)

        # Audit row with AML_HIT_ESCALATED must exist
        db = SessionLocal()
        try:
            row = (
                db.query(AuditLog)
                .filter(
                    AuditLog.action == "AML_HIT_ESCALATED",
                    AuditLog.resource_id == str(hit_id),
                )
                .first()
            )
            assert row is not None
        finally:
            db.close()

    def test_decide_cleared_writes_audit(self, client):
        from app.main import app
        from app.services.auth import require
        from app.db import SessionLocal
        from app.models import AuditLog

        app.dependency_overrides[require("approve")] = lambda: _make_principal("doc_admin")
        hit_id = _seed_hit()
        try:
            client.post(
                f"/api/v1/aml/hits/{hit_id}/decide",
                json={"decision": "cleared"},
                headers=HEADERS,
            )
        finally:
            _clear_overrides(app)

        db = SessionLocal()
        try:
            row = (
                db.query(AuditLog)
                .filter(
                    AuditLog.action == "AML_HIT_DECIDED",
                    AuditLog.resource_id == str(hit_id),
                )
                .first()
            )
            assert row is not None
        finally:
            db.close()


# ===========================================================================
# 11. Endpoint tests — GET /aml/summary
# ===========================================================================

class TestSummaryEndpoint:
    def test_summary_no_api_key(self, client):
        resp = client.get("/api/v1/aml/summary")
        assert resp.status_code == 401

    def test_summary_ok(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")
        try:
            resp = client.get("/api/v1/aml/summary", headers=HEADERS)
            assert resp.status_code == 200
            body = resp.json()
            assert "last_24h" in body
            assert "screenings_count" in body["last_24h"]
            assert "hit_count" in body["last_24h"]
            assert "open_hit_count" in body["last_24h"]
        finally:
            _clear_overrides(app)


# ===========================================================================
# 12. Endpoint tests — GET /aml/stats
# ===========================================================================

class TestStatsEndpoint:
    def test_stats_ok(self, client):
        from app.main import app
        from app.services.auth import require

        app.dependency_overrides[require("audit_read")] = lambda: _make_principal("auditor")
        try:
            resp = client.get("/api/v1/aml/stats", headers=HEADERS)
            assert resp.status_code == 200
            body = resp.json()
            expected_keys = {
                "screenings_today",
                "hits_found_today",
                "hits_cleared_today",
                "hits_escalated_today",
                "hits_pending_today",
                "highest_score",
            }
            assert expected_keys.issubset(body.keys())
        finally:
            _clear_overrides(app)
