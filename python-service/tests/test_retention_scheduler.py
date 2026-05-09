"""Tests for the retention scheduler service.

emit is imported inside _run_retention_cycle_sync as a local relative import
so we patch it at the events module level: app.services.events.emit
"""
from __future__ import annotations

import os
import sys

# Ensure the app package is importable from the test runner.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch


# ── mock builder helpers ──────────────────────────────────────────────────────

def _make_doc(doc_id, doc_type, created_at, status="captured", tenant="default"):
    doc = MagicMock()
    doc.id = doc_id
    doc.doc_type = doc_type
    doc.created_at = created_at
    doc.status = status
    doc.tenant = tenant
    doc.filename = f"/storage/{doc_id}.bin"
    return doc


def _make_policy(doc_type, retention_days, action="purge"):
    pol = MagicMock()
    pol.doc_type = doc_type
    pol.retention_days = retention_days
    pol.action = action
    return pol


def _make_db(doc_pol_rows, has_hold=False):
    """Build a mock Session that:
    - Returns doc_pol_rows on the first query chain (.join().limit().all())
    - Returns a hold object (or None) on the second query chain (.filter().first())
    """
    db = MagicMock()

    hold_result = MagicMock() if has_hold else None

    call_count = [0]

    class _DocQuery:
        def join(self, *a, **kw):
            return self
        def limit(self, n):
            return self
        def filter(self, *a, **kw):
            return _HoldQuery()
        def all(self):
            return doc_pol_rows

    class _HoldQuery:
        def filter(self, *a, **kw):
            return self
        def first(self):
            return hold_result

    # Return different objects based on the model being queried.
    from app.models import LegalHold, Document, RetentionPolicy, AuditLog

    def _query_dispatch(*models):
        if len(models) == 1 and models[0] is LegalHold:
            return _HoldQuery()
        return _DocQuery()

    db.query.side_effect = _query_dispatch
    db.add = MagicMock()
    db.commit = MagicMock()
    db.rollback = MagicMock()
    return db


# ── tests ─────────────────────────────────────────────────────────────────────

def test_purge_expired_doc():
    from app.services.retention_scheduler import _run_retention_cycle_sync

    old_date = datetime.utcnow() - timedelta(days=400)
    doc = _make_doc(1, "kyc", old_date)
    pol = _make_policy("kyc", 365, action="purge")

    db = _make_db([(doc, pol)])

    with patch("app.services.events.emit"):
        summary = _run_retention_cycle_sync(db)

    assert summary["purged"] == 1
    assert summary["archived"] == 0
    assert doc.status == "purged"
    assert doc.filename == ""


def test_archive_expired_doc():
    from app.services.retention_scheduler import _run_retention_cycle_sync

    old_date = datetime.utcnow() - timedelta(days=400)
    doc = _make_doc(1, "statement", old_date)
    pol = _make_policy("statement", 365, action="archive_cold")

    db = _make_db([(doc, pol)])

    with patch("app.services.events.emit"):
        summary = _run_retention_cycle_sync(db)

    assert summary["archived"] == 1
    assert summary["purged"] == 0
    assert doc.status == "archived"


def test_skip_not_yet_expired():
    from app.services.retention_scheduler import _run_retention_cycle_sync

    recent_date = datetime.utcnow() - timedelta(days=30)
    doc = _make_doc(1, "kyc", recent_date)
    pol = _make_policy("kyc", 365, action="purge")

    db = _make_db([(doc, pol)])

    with patch("app.services.events.emit"):
        summary = _run_retention_cycle_sync(db)

    assert summary["purged"] == 0
    assert summary["skipped"] == 1
    # Status must not have changed.
    assert doc.status == "captured"


def test_skip_already_purged():
    from app.services.retention_scheduler import _run_retention_cycle_sync

    old_date = datetime.utcnow() - timedelta(days=400)
    doc = _make_doc(1, "kyc", old_date, status="purged")
    pol = _make_policy("kyc", 365, action="purge")

    db = _make_db([(doc, pol)])

    with patch("app.services.events.emit"):
        summary = _run_retention_cycle_sync(db)

    assert summary["purged"] == 0
    assert summary["skipped"] == 1


def test_skip_doc_with_active_hold():
    from app.services.retention_scheduler import _run_retention_cycle_sync

    old_date = datetime.utcnow() - timedelta(days=400)
    doc = _make_doc(1, "kyc", old_date)
    pol = _make_policy("kyc", 365, action="purge")

    db = _make_db([(doc, pol)], has_hold=True)

    with patch("app.services.events.emit"):
        summary = _run_retention_cycle_sync(db)

    assert summary["purged"] == 0
    assert summary["skipped"] == 1


def test_get_last_run_initial_state():
    from app.services.retention_scheduler import get_last_run

    last = get_last_run()
    # Must always contain these keys regardless of whether scheduler ran.
    assert "status" in last
    assert "purged" in last
    assert "archived" in last
    assert "skipped" in last
