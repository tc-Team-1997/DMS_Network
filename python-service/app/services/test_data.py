"""Synthetic EG customer + document generator.

Produces realistic Arabic-first names + English transliterations, EG-format CIDs,
EG-valid 14-digit national IDs, plausible DOB / issue / expiry dates, and the
matching Document rows. All rows tagged `uploaded_by='synthetic'` so they can
be purged in one query before going to prod.

Zero external dependency — bundled name lists avoid heavyweight `faker-ar`.
"""
from __future__ import annotations
import hashlib
import random
import string
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ..models import Document
from .crdt import stamp as crdt_stamp


FIRST_NAMES_M = [
    ("أحمد", "Ahmed"), ("محمد", "Mohamed"), ("محمود", "Mahmoud"),
    ("علي", "Ali"), ("عمر", "Omar"), ("يوسف", "Youssef"),
    ("خالد", "Khaled"), ("مصطفى", "Mostafa"), ("حسن", "Hassan"),
    ("إبراهيم", "Ibrahim"), ("طارق", "Tarek"), ("سامر", "Samer"),
]
FIRST_NAMES_F = [
    ("فاطمة", "Fatma"), ("عائشة", "Aisha"), ("سارة", "Sara"),
    ("مريم", "Mariam"), ("نور", "Nour"), ("هند", "Hind"),
    ("دينا", "Dina"), ("ياسمين", "Yasmin"), ("ليلى", "Layla"),
    ("إيمان", "Iman"), ("حنان", "Hanan"), ("سلمى", "Salma"),
]
FAMILY_NAMES = [
    ("حسن", "Hassan"), ("علي", "Aly"), ("إبراهيم", "Ibrahim"),
    ("عبد الله", "Abdullah"), ("عبد الرحمن", "Abdelrahman"),
    ("شوقي", "Shawky"), ("عوض", "Awad"), ("كامل", "Kamal"),
    ("رشاد", "Rashad"), ("السيد", "El-Sayed"), ("الصادق", "El-Sadek"),
    ("الشريف", "El-Sherif"), ("الشامي", "El-Shamy"),
]
GOVS = [
    ("01", "Cairo", "Cairo West"), ("02", "Alexandria", "Alexandria HQ"),
    ("12", "Dakahlia", "Mansoura"), ("13", "Sharqia", "Zagazig"),
    ("21", "Giza", "Giza"),       ("23", "Minya", "Minya"),
    ("27", "Qena", "Qena"),        ("32", "Red Sea", "Hurghada"),
]


def _rand_name(gender: str) -> tuple[str, str]:
    first = random.choice(FIRST_NAMES_M if gender == "m" else FIRST_NAMES_F)
    father = random.choice(FIRST_NAMES_M)
    family = random.choice(FAMILY_NAMES)
    ar = f"{first[0]} {father[0]} {family[0]}"
    en = f"{first[1]} {father[1]} {family[1]}"
    return ar, en


def _eg_national_id(dob: datetime, gov_code: str, gender: str) -> str:
    """14-digit EG ID: C YYMMDD GG NNN S K (century + dob + gov + serial + sex + check)."""
    century = "2" if dob.year >= 2000 else "3"   # 2 for 1900s ??? Actually: 2 for 1900, 3 for 2000
    # Real CBE encoding: 2 = 1900-1999, 3 = 2000+. Keep simple and safe for demo.
    if dob.year >= 2000:
        century = "3"
    else:
        century = "2"
    base = (
        century
        + f"{dob.year % 100:02d}{dob.month:02d}{dob.day:02d}"
        + gov_code
        + f"{random.randint(0, 999):03d}"
        + ("1" if gender == "m" else "2")
    )
    # Mod-11 style check (good enough for synthetic data).
    check = sum(int(c) * ((i % 7) + 1) for i, c in enumerate(base)) % 10
    return base + str(check)


def _cid(i: int) -> str:
    year = datetime.utcnow().year
    tag = "".join(random.choices(string.ascii_uppercase, k=3))
    return f"EGY-{year}-{i:06d}-{tag}"


def _make_doc(cid: str, branch: str, doc_type: str, dob: datetime,
              name_en: str) -> Document:
    now = datetime.utcnow()
    issue = now - timedelta(days=random.randint(30, 5 * 365))
    expiry = issue + timedelta(days=7 * 365)
    synthetic_payload = f"{name_en}|{doc_type}|{cid}|{random.random()}".encode()
    digest = hashlib.sha256(synthetic_payload).hexdigest()
    return Document(
        filename=f"storage/documents/synthetic_{digest[:10]}.pdf",
        original_name=f"{doc_type}_{cid}.pdf",
        mime_type="application/pdf",
        size_bytes=random.randint(50_000, 2_500_000),
        sha256=digest,
        doc_type=doc_type,
        customer_cid=cid,
        branch=branch,
        tenant="default",
        status="captured",
        issue_date=issue.date().isoformat(),
        expiry_date=expiry.date().isoformat(),
        uploaded_by="synthetic",
        sync_clock=crdt_stamp(None),
        created_at=now - timedelta(days=random.randint(0, 120)),
    )


def generate(db: Session, n_customers: int = 50,
             docs_per_customer: int = 3) -> dict[str, Any]:
    created: list[dict] = []
    for i in range(1, n_customers + 1):
        gender = random.choice(("m", "f"))
        ar, en = _rand_name(gender)
        gov_code, gov_name, branch = random.choice(GOVS)
        dob = datetime.utcnow() - timedelta(days=random.randint(18 * 365, 60 * 365))
        cid = _cid(i)
        nid = _eg_national_id(dob, gov_code, gender)
        wanted = random.sample(
            ["passport", "national_id", "utility_bill", "loan_application"],
            docs_per_customer,
        )
        docs = []
        for dt in wanted:
            d = _make_doc(cid, branch, dt, dob, en)
            db.add(d)
            docs.append(dt)
        created.append({"cid": cid, "ar": ar, "en": en, "gov": gov_name,
                        "national_id": nid, "dob": dob.date().isoformat(),
                        "docs": docs})
    db.commit()
    return {"customers": len(created), "documents": len(created) * docs_per_customer,
            "sample": created[:5]}


def purge(db: Session) -> dict:
    n = db.query(Document).filter(Document.uploaded_by == "synthetic").delete(
        synchronize_session=False)
    db.commit()
    return {"purged": n}
