"""Unit tests for DSAR Console — Wave C.

Covers:
  - CryptoshreddedError is raised on unwrap_dek() when sentinel is present.
  - encryption.cryptoshred() writes the sentinel and the receipt is correct.
  - services/dsar.lookup() axis validation.
  - services/dsar.inventory() counts (no-data path).
  - services/dsar.create_request() validation.
  - services/dsar.list_requests() SLA timer and OVERDUE escalation.

Uses an in-memory SQLite session so no external services are needed.
"""
import os
import pytest

os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test.db")

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# CryptoshreddedError + encryption.cryptoshred()
# ---------------------------------------------------------------------------

class TestCryptoshreddedError:
    def test_unwrap_raises_on_dek_sentinel(self):
        """unwrap_dek() must raise CryptoshreddedError when wrapped_dek is the sentinel."""
        from app.services.encryption import unwrap_dek, CryptoshreddedError, _SHREDDED_DEK, _SHREDDED_KID
        with pytest.raises(CryptoshreddedError) as exc_info:
            unwrap_dek(_SHREDDED_DEK, "some-key-id", customer_cid="CID-001")
        assert "CID-001" in str(exc_info.value)
        assert "cryptoshredded" in str(exc_info.value).lower()

    def test_unwrap_raises_on_kid_sentinel(self):
        """unwrap_dek() must raise CryptoshreddedError when kms_key_id is the sentinel."""
        from app.services.encryption import unwrap_dek, CryptoshreddedError, _SHREDDED_KID
        with pytest.raises(CryptoshreddedError):
            unwrap_dek("some-valid-looking-base64==", _SHREDDED_KID, customer_cid="CID-002")

    def test_cryptoshredded_error_message_mentions_gdpr(self):
        """The error message must be informative enough for engineers reading traces."""
        from app.services.encryption import CryptoshreddedError
        err = CryptoshreddedError("CID-TEST")
        assert "GDPR" in str(err) or "Art-17" in str(err) or "cryptoshredded" in str(err).lower()

    def test_cryptoshredded_error_has_customer_cid_attr(self):
        from app.services.encryption import CryptoshreddedError
        err = CryptoshreddedError("CID-ATTR-TEST")
        assert err.customer_cid == "CID-ATTR-TEST"


class TestEncryptionCryptoshred:
    def _make_db(self):
        """Return a mock Session that simulates a CustomerDek row."""
        from app.models import CustomerDek
        mock_row = MagicMock(spec=CustomerDek)
        mock_row.customer_cid = "CID-SHRED"
        mock_row.wrapped_dek = "some-wrapped-value"
        mock_row.kms_key_id = "local-kek"

        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = mock_row
        db.commit = MagicMock()
        return db, mock_row

    def test_cryptoshred_sets_sentinels(self):
        from app.services.encryption import cryptoshred, _SHREDDED_DEK, _SHREDDED_KID
        db, row = self._make_db()
        receipt = cryptoshred(db, "CID-SHRED")
        assert row.wrapped_dek == _SHREDDED_DEK
        assert row.kms_key_id == _SHREDDED_KID
        db.commit.assert_called_once()

    def test_cryptoshred_returns_receipt_with_semantic(self):
        from app.services.encryption import cryptoshred
        db, _ = self._make_db()
        receipt = cryptoshred(db, "CID-SHRED")
        assert receipt["action"] == "cryptoshred"
        assert receipt["customer_cid"] == "CID-SHRED"
        assert "semantic" in receipt
        assert "unreadable" in receipt["semantic"]
        assert receipt["dek_destroyed"] is True

    def test_cryptoshred_no_dek_row_still_succeeds(self):
        """If no DEK row exists (no encrypted data), cryptoshred should succeed gracefully."""
        from app.services.encryption import cryptoshred
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        db.commit = MagicMock()
        receipt = cryptoshred(db, "CID-NO-DEK")
        assert receipt["dek_destroyed"] is False
        assert receipt["action"] == "cryptoshred"

    def test_plaintext_dek_raises_after_shred(self):
        """plaintext_dek() must raise CryptoshreddedError when the DEK has been shredded."""
        from app.services.encryption import CryptoshreddedError, _SHREDDED_DEK, _SHREDDED_KID
        from app.models import CustomerDek

        mock_row = MagicMock(spec=CustomerDek)
        mock_row.customer_cid = "CID-POST-SHRED"
        mock_row.wrapped_dek = _SHREDDED_DEK
        mock_row.kms_key_id = _SHREDDED_KID

        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = mock_row

        from app.services import encryption as enc
        with pytest.raises(CryptoshreddedError):
            enc.plaintext_dek(db, "CID-POST-SHRED")


# ---------------------------------------------------------------------------
# services/dsar — lookup axis validation
# ---------------------------------------------------------------------------

class TestDsarLookup:
    def test_invalid_axis_raises(self):
        from app.services.dsar import lookup
        db = MagicMock()
        with pytest.raises(ValueError, match="axis must be one of"):
            lookup(db, "invalid_axis", "some-value")

    def test_valid_cid_axis_queries_customer(self):
        from app.services.dsar import lookup
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = []
        # Also mock the Document fallback
        db.query.return_value.filter.return_value.first.return_value = None
        result = lookup(db, "cid", "CID-XYZ")
        assert isinstance(result, list)


# ---------------------------------------------------------------------------
# services/dsar — inventory (no-data path)
# ---------------------------------------------------------------------------

class TestDsarInventory:
    def test_inventory_returns_zero_counts_when_no_data(self):
        from app.services.dsar import inventory
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = []
        db.query.return_value.filter.return_value.count.return_value = 0
        # cbs_document_links fallback
        db.execute.return_value.scalar.return_value = 0
        counts = inventory(db, "CID-EMPTY")
        assert counts["documents"] == 0
        assert counts["ai_traces"] == 0
        assert counts["audit_events"] == 0
        assert counts["workflows"] == 0
        assert counts["cbs_records"] == 0


# ---------------------------------------------------------------------------
# services/dsar — create_request validation
# ---------------------------------------------------------------------------

class TestDsarCreateRequest:
    def test_invalid_action_raises(self):
        from app.services.dsar import create_request
        db = MagicMock()
        with pytest.raises(ValueError, match="action must be one of"):
            create_request(
                db, tenant_id="nbe", customer_cid="CID-001",
                action="invalid_action", requested_by="admin",
            )

    def test_valid_action_creates_row(self):
        from app.services.dsar import create_request
        db = MagicMock()
        db.add = MagicMock()
        db.commit = MagicMock()
        db.refresh = MagicMock()

        req = create_request(
            db, tenant_id="nbe", customer_cid="CID-001",
            action="article15_export", requested_by="admin",
            regulator="GDPR",
        )
        db.add.assert_called_once()
        db.commit.assert_called_once()
        # The returned object should have the correct action.
        added = db.add.call_args[0][0]
        assert added.action == "article15_export"
        assert added.customer_cid == "CID-001"
        assert added.regulator == "GDPR"


# ---------------------------------------------------------------------------
# services/dsar — list_requests SLA timer
# ---------------------------------------------------------------------------

class TestDsarListRequests:
    def _make_mock_req(self, days_offset: int, status: str = "NEW") -> MagicMock:
        from app.models import DsarRequest
        row = MagicMock(spec=DsarRequest)
        row.id = "test-id"
        row.tenant_id = "nbe"
        row.customer_cid = "CID-001"
        row.action = "article15_export"
        row.status = status
        row.requested_by = "admin"
        row.requested_at = datetime.utcnow()
        row.sla_due_at = datetime.utcnow() + timedelta(days=days_offset)
        row.completed_at = None
        row.regulator = "GDPR"
        row.fulfillment_artifact_path = None
        row.signed_receipt = None
        return row

    def test_overdue_escalation(self):
        from app.services.dsar import list_requests
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
            self._make_mock_req(days_offset=-5, status="NEW"),
        ]
        result = list_requests(db, "nbe")
        assert len(result) == 1
        assert result[0]["status"] == "OVERDUE"
        assert result[0]["days_remaining"] is not None
        assert result[0]["days_remaining"] < 0

    def test_within_sla(self):
        from app.services.dsar import list_requests
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
            self._make_mock_req(days_offset=10, status="NEW"),
        ]
        result = list_requests(db, "nbe")
        assert result[0]["status"] == "NEW"
        assert result[0]["days_remaining"] is not None
        assert result[0]["days_remaining"] >= 9  # allow for execution time

    def test_completed_never_overdue(self):
        """A COMPLETED request should not be escalated to OVERDUE even if past SLA."""
        from app.services.dsar import list_requests
        db = MagicMock()
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
            self._make_mock_req(days_offset=-100, status="COMPLETED"),
        ]
        result = list_requests(db, "nbe")
        # COMPLETED stays COMPLETED.
        assert result[0]["status"] == "COMPLETED"
