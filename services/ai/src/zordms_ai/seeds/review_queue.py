"""Seed realistic human-review-queue data for the ZorDMS AI service.

This module inserts Bhutan-bank sample ``review_items`` rows covering every
confidence band and every review status (PENDING / CLAIMED / RESOLVED) so the
Review Queue screen shows real, useful content instead of an empty table.

Idempotency guarantee
---------------------
Insertion is guarded by a ``doc_id`` uniqueness check: if *any* row with one
of our seed ``doc_id`` values already exists the whole seed is skipped.  This
means:

* Re-deploying the service never produces duplicate rows.
* Unit tests that pre-populate their own rows are unaffected (they use
  different ``doc_id`` values).

Confidence bands (from ``routing/confidence.py``)
--------------------------------------------------
* ``>=0.92``   — AUTO_APPROVE  — no SLA
* ``0.85-0.91``— AUTO_VERIFIED — no SLA  (queued for sampled quality check)
* ``0.70-0.84``— SUPERVISOR_REVIEW — 48 h SLA
* ``0.50-0.69``— HUMAN_REVIEW       — 24 h SLA
* ``<0.50``    — REJECT             —  0 h SLA
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from zordms_ai.review.models import ReviewItem

# ---------------------------------------------------------------------------
# Anchor timestamps — all relative to a fixed "demo now" so the data looks
# realistic regardless of when the service first boots.
# ---------------------------------------------------------------------------
_DEMO_NOW = datetime(2026, 6, 23, 9, 0, 0)  # 09:00 BST (Bhutan Standard Time = UTC+6)

# Seed doc_id values — used as the idempotency sentinel.
_SEED_DOC_IDS = {
    "BT-CID-2026-0001",
    "BT-CID-2026-0002",
    "BT-CID-2026-0003",
    "BT-PASS-2026-0004",
    "BT-PASS-2026-0005",
    "BT-LOAN-2026-0006",
    "BT-LOAN-2026-0007",
    "BT-LOAN-2026-0008",
    "BT-CID-2026-0009",
    "BT-PASS-2026-0010",
    "BT-LOAN-2026-0011",
    "BT-CID-2026-0012",
}


def _ts(offset_hours: float) -> datetime:
    """Return _DEMO_NOW shifted by ``offset_hours``."""
    return _DEMO_NOW + timedelta(hours=offset_hours)


# ---------------------------------------------------------------------------
# Payload helpers — produce JSON strings that look like real IDP outputs
# ---------------------------------------------------------------------------

def _cid_payload(
    cid_no: str,
    full_name: str,
    dob: str,
    sex: str,
    dzongkhag: str,
    village: str,
    issue: str,
    expiry: str,
    confidence: float,
) -> str:
    return json.dumps(
        {
            "doc_type": "BT_CID_4G",
            "confidence": confidence,
            "review_flag": confidence < 0.85,
            "cid_no": cid_no,
            "full_name": full_name,
            "dob": dob,
            "sex": sex,
            "dzongkhag": dzongkhag,
            "village": village,
            "issue_date": issue,
            "expiry_date": expiry,
        },
        ensure_ascii=False,
    )


def _passport_payload(
    passport_no: str,
    surname: str,
    given_names: str,
    dob: str,
    sex: str,
    place_of_birth: str,
    issue: str,
    expiry: str,
    confidence: float,
) -> str:
    return json.dumps(
        {
            "doc_type": "BT_PASSPORT",
            "confidence": confidence,
            "review_flag": confidence < 0.85,
            "passport_no": passport_no,
            "surname": surname,
            "given_names": given_names,
            "nationality": "BTN",
            "dob": dob,
            "sex": sex,
            "place_of_birth": place_of_birth,
            "issue_date": issue,
            "expiry_date": expiry,
        },
        ensure_ascii=False,
    )


def _loan_payload(
    application_no: str,
    applicant_cid: str,
    applicant_name: str,
    loan_type: str,
    loan_amount: float,
    branch_code: str,
    submission_date: str,
    officer_id: str,
    confidence: float,
) -> str:
    return json.dumps(
        {
            "doc_type": "BOB_LOAN_APPLICATION",
            "confidence": confidence,
            "review_flag": confidence < 0.85,
            "application_no": application_no,
            "applicant_cid": applicant_cid,
            "applicant_name": applicant_name,
            "loan_type": loan_type,
            "loan_amount": loan_amount,
            "branch_code": branch_code,
            "submission_date": submission_date,
            "officer_id": officer_id,
        },
        ensure_ascii=False,
    )


# ---------------------------------------------------------------------------
# Seed rows definition
# ---------------------------------------------------------------------------
# Each entry maps directly to ReviewItem columns.
# ``sla_deadline`` is derived from ``sla_hours`` if not None.
#
# Statuses used:
#   PENDING  — not yet picked up
#   CLAIMED  — an officer has taken ownership
#   RESOLVED — completed (approved / rejected / corrected)
#
# Confidence bands covered:
#   REJECT          (<0.50)   → sla_hours=0
#   HUMAN_REVIEW    (0.50-0.69) → sla_hours=24
#   SUPERVISOR_REVIEW (0.70-0.84) → sla_hours=48
#   AUTO_VERIFIED   (0.85-0.91) → sla_hours=None
#   AUTO_APPROVE    (>=0.92)  → sla_hours=None  (rare in queue; added for completeness)

_SEED_ROWS: list[dict] = [
    # ── 1. PENDING — HUMAN_REVIEW — BT_CID_4G (low confidence, OCR blur)
    {
        "doc_id": "BT-CID-2026-0001",
        "doc_type": "BT_CID_4G",
        "confidence": 0.54,
        "band": "0.50-0.69",
        "sla_hours": 24,
        "status": "PENDING",
        "claimed_by": None,
        "resolution": None,
        "created_at": _ts(-6),       # arrived 6 h ago
        "payload_json": _cid_payload(
            cid_no="11201050001",
            full_name="Tshering Dorji",
            dob="1987-03-14",
            sex="M",
            dzongkhag="Thimphu",
            village="Motithang",
            issue="2018-07-01",
            expiry="2028-07-01",
            confidence=0.54,
        ),
    },
    # ── 2. PENDING — HUMAN_REVIEW — BT_PASSPORT (watermark interference)
    {
        "doc_id": "BT-PASS-2026-0004",
        "doc_type": "BT_PASSPORT",
        "confidence": 0.61,
        "band": "0.50-0.69",
        "sla_hours": 24,
        "status": "PENDING",
        "claimed_by": None,
        "resolution": None,
        "created_at": _ts(-3),       # arrived 3 h ago
        "payload_json": _passport_payload(
            passport_no="B1234567",
            surname="Wangmo",
            given_names="Pema",
            dob="1994-11-22",
            sex="F",
            place_of_birth="Paro",
            issue="2021-04-10",
            expiry="2031-04-10",
            confidence=0.61,
        ),
    },
    # ── 3. PENDING — SUPERVISOR_REVIEW — BOB_LOAN_APPLICATION (partial fields)
    {
        "doc_id": "BT-LOAN-2026-0006",
        "doc_type": "BOB_LOAN_APPLICATION",
        "confidence": 0.73,
        "band": "0.70-0.84",
        "sla_hours": 48,
        "status": "PENDING",
        "claimed_by": None,
        "resolution": None,
        "created_at": _ts(-12),      # arrived 12 h ago, 36 h remaining
        "payload_json": _loan_payload(
            application_no="BOB-LA-2026-04821",
            applicant_cid="11201070023",
            applicant_name="Kinley Zangmo",
            loan_type="HOME",
            loan_amount=2500000.0,
            branch_code="TMP-01",
            submission_date="2026-06-20",
            officer_id="OFF-0042",
            confidence=0.73,
        ),
    },
    # ── 4. PENDING — SUPERVISOR_REVIEW — BT_CID_4G (stained document)
    {
        "doc_id": "BT-CID-2026-0002",
        "doc_type": "BT_CID_4G",
        "confidence": 0.78,
        "band": "0.70-0.84",
        "sla_hours": 48,
        "status": "PENDING",
        "claimed_by": None,
        "resolution": None,
        "created_at": _ts(-2),       # arrived 2 h ago
        "payload_json": _cid_payload(
            cid_no="12301080045",
            full_name="Sonam Choden",
            dob="1999-06-05",
            sex="F",
            dzongkhag="Punakha",
            village="Lobesa",
            issue="2020-01-15",
            expiry="2030-01-15",
            confidence=0.78,
        ),
    },
    # ── 5. PENDING — AUTO_VERIFIED — BT_PASSPORT (sampled quality check)
    {
        "doc_id": "BT-PASS-2026-0005",
        "doc_type": "BT_PASSPORT",
        "confidence": 0.88,
        "band": "0.85-0.91",
        "sla_hours": None,
        "status": "PENDING",
        "claimed_by": None,
        "resolution": None,
        "created_at": _ts(-1),       # arrived 1 h ago
        "payload_json": _passport_payload(
            passport_no="A9876543",
            surname="Rinzin",
            given_names="Ugyen",
            dob="1982-09-30",
            sex="M",
            place_of_birth="Bumthang",
            issue="2022-10-05",
            expiry="2032-10-05",
            confidence=0.88,
        ),
    },
    # ── 6. PENDING — REJECT band — BOB_LOAN_APPLICATION (very low confidence)
    {
        "doc_id": "BT-LOAN-2026-0007",
        "doc_type": "BOB_LOAN_APPLICATION",
        "confidence": 0.32,
        "band": "<0.50",
        "sla_hours": 0,
        "status": "PENDING",
        "claimed_by": None,
        "resolution": None,
        "created_at": _ts(-0.5),     # arrived 30 min ago — urgent
        "payload_json": _loan_payload(
            application_no="BOB-LA-2026-04899",
            applicant_cid="10101110067",
            applicant_name="Dechen Pelden",
            loan_type="AGRI",
            loan_amount=450000.0,
            branch_code="PAR-02",
            submission_date="2026-06-22",
            officer_id=None,
            confidence=0.32,
        ),
    },
    # ── 7. CLAIMED — HUMAN_REVIEW — BT_CID_4G
    {
        "doc_id": "BT-CID-2026-0003",
        "doc_type": "BT_CID_4G",
        "confidence": 0.58,
        "band": "0.50-0.69",
        "sla_hours": 24,
        "status": "CLAIMED",
        "claimed_by": "user-wangchuk.dorji@bnbl.bt",
        "resolution": None,
        "created_at": _ts(-10),
        "payload_json": _cid_payload(
            cid_no="11401060089",
            full_name="Jigme Namgyel",
            dob="1975-12-01",
            sex="M",
            dzongkhag="Trashigang",
            village="Rangjung",
            issue="2016-03-20",
            expiry="2026-03-20",
            confidence=0.58,
        ),
    },
    # ── 8. CLAIMED — SUPERVISOR_REVIEW — BOB_LOAN_APPLICATION
    {
        "doc_id": "BT-LOAN-2026-0008",
        "doc_type": "BOB_LOAN_APPLICATION",
        "confidence": 0.81,
        "band": "0.70-0.84",
        "sla_hours": 48,
        "status": "CLAIMED",
        "claimed_by": "user-chimi.dorji@bnbl.bt",
        "resolution": None,
        "created_at": _ts(-20),
        "payload_json": _loan_payload(
            application_no="BOB-LA-2026-04750",
            applicant_cid="11701040012",
            applicant_name="Dorji Wangchuk",
            loan_type="BUSINESS",
            loan_amount=8000000.0,
            branch_code="PHU-01",
            submission_date="2026-06-19",
            officer_id="OFF-0018",
            confidence=0.81,
        ),
    },
    # ── 9. CLAIMED — AUTO_VERIFIED — BT_PASSPORT (sampled; senior reviewer)
    {
        "doc_id": "BT-PASS-2026-0010",
        "doc_type": "BT_PASSPORT",
        "confidence": 0.90,
        "band": "0.85-0.91",
        "sla_hours": None,
        "status": "CLAIMED",
        "claimed_by": "user-lhamo.tshering@bnbl.bt",
        "resolution": None,
        "created_at": _ts(-4),
        "payload_json": _passport_payload(
            passport_no="C5551234",
            surname="Gyeltshen",
            given_names="Norbu",
            dob="1990-02-17",
            sex="M",
            place_of_birth="Wangdue Phodrang",
            issue="2023-05-28",
            expiry="2033-05-28",
            confidence=0.90,
        ),
    },
    # ── 10. RESOLVED / APPROVED — HUMAN_REVIEW — BT_CID_4G
    {
        "doc_id": "BT-CID-2026-0009",
        "doc_type": "BT_CID_4G",
        "confidence": 0.65,
        "band": "0.50-0.69",
        "sla_hours": 24,
        "status": "RESOLVED",
        "claimed_by": "user-phuntsho.wangdi@bnbl.bt",
        "resolution": "APPROVED",
        "created_at": _ts(-30),
        "resolved_at": _ts(-26),     # resolved in ~4 h, well within 24 h SLA
        "payload_json": _cid_payload(
            cid_no="12101090034",
            full_name="Karma Yangchen",
            dob="2001-05-19",
            sex="F",
            dzongkhag="Sarpang",
            village="Gelephu",
            issue="2022-08-11",
            expiry="2032-08-11",
            confidence=0.65,
        ),
    },
    # ── 11. RESOLVED / REJECTED — REJECT band — BOB_LOAN_APPLICATION
    {
        "doc_id": "BT-LOAN-2026-0011",
        "doc_type": "BOB_LOAN_APPLICATION",
        "confidence": 0.29,
        "band": "<0.50",
        "sla_hours": 0,
        "status": "RESOLVED",
        "claimed_by": "user-sonam.tobgay@bnbl.bt",
        "resolution": "REJECTED_LOW_CONFIDENCE",
        "created_at": _ts(-48),
        "resolved_at": _ts(-47),     # resolved in 1 h (immediate action for <0.50)
        "payload_json": _loan_payload(
            application_no="BOB-LA-2026-04612",
            applicant_cid="10901020055",
            applicant_name="Tenzin Namgay",
            loan_type="AUTO",
            loan_amount=1200000.0,
            branch_code="SRP-03",
            submission_date="2026-06-18",
            officer_id=None,
            confidence=0.29,
        ),
    },
    # ── 12. RESOLVED / CORRECTED — SUPERVISOR_REVIEW — BT_CID_4G
    {
        "doc_id": "BT-CID-2026-0012",
        "doc_type": "BT_CID_4G",
        "confidence": 0.75,
        "band": "0.70-0.84",
        "sla_hours": 48,
        "status": "RESOLVED",
        "claimed_by": "user-pema.seldon@bnbl.bt",
        "resolution": "CORRECTED_AND_APPROVED",
        "created_at": _ts(-72),
        "resolved_at": _ts(-65),     # resolved in 7 h, within 48 h SLA
        "payload_json": _cid_payload(
            cid_no="11601030078",
            full_name="Sangay Choden",
            dob="1968-08-24",
            sex="F",
            dzongkhag="Mongar",
            village="Kengkhar",
            issue="2015-02-10",
            expiry="2025-02-10",
            confidence=0.75,
        ),
    },
]


def seed_review_queue(session_factory: sessionmaker) -> int:
    """Insert seed review-queue rows if the table is empty of seed data.

    Returns the number of rows inserted (0 if already seeded).
    This function is idempotent: calling it multiple times is safe.
    """
    with session_factory() as session:
        # Guard: skip if any of our sentinel doc_ids already exists.
        existing = session.scalars(
            select(ReviewItem.doc_id).where(
                ReviewItem.doc_id.in_(_SEED_DOC_IDS)
            )
        ).all()
        if existing:
            return 0  # already seeded

        inserted = 0
        for row in _SEED_ROWS:
            hours = row.get("sla_hours")
            created = row["created_at"]
            deadline = (created + timedelta(hours=hours)) if hours is not None and hours > 0 else None
            item = ReviewItem(
                doc_id=row["doc_id"],
                doc_type=row["doc_type"],
                confidence=row["confidence"],
                band=row["band"],
                sla_hours=row.get("sla_hours"),
                sla_deadline=deadline,
                status=row["status"],
                claimed_by=row.get("claimed_by"),
                resolution=row.get("resolution"),
                payload_json=row["payload_json"],
                created_at=created,
                resolved_at=row.get("resolved_at"),
            )
            session.add(item)
            inserted += 1

        session.commit()
        return inserted
