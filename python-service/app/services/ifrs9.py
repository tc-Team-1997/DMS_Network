"""IFRS 9 ECL aggregation with FX normalization.

Reads loan-application e-form submissions (fields: amount, currency, stage) and
normalizes every amount into the reporting currency. Stage-based ECL is computed
with simple default rates; real IFRS 9 engines plug in PD/LGD/EAD externally.
"""
from __future__ import annotations
import json
from datetime import datetime
from sqlalchemy.orm import Session

from ..models import EForm, EFormSubmission
from . import fx as fxsvc


DEFAULT_ECL_RATES = {1: 0.01, 2: 0.08, 3: 0.40}  # stage → PD×LGD ballpark


def portfolio_ecl(db: Session, reporting_ccy: str = "EGP",
                  as_of: datetime | None = None, tenant: str = "default") -> dict:
    # Pull every loan_application submission for the tenant.
    form_keys = ["loan_application", "loan_app", "loan_app_v1"]
    forms = db.query(EForm).filter(EForm.tenant == tenant, EForm.key.in_(form_keys)).all()
    form_ids = [f.id for f in forms]
    rows = db.query(EFormSubmission).filter(EFormSubmission.form_id.in_(form_ids)).all() if form_ids else []

    buckets = {1: 0.0, 2: 0.0, 3: 0.0}
    ecl_buckets = {1: 0.0, 2: 0.0, 3: 0.0}
    missing_rate: list[int] = []
    details: list[dict] = []

    for r in rows:
        data = json.loads(r.data_json or "{}")
        amount = data.get("amount") or data.get("amount_egp") or data.get("principal")
        ccy = (data.get("currency") or reporting_ccy).upper()
        stage = int(data.get("ifrs9_stage") or data.get("stage") or 1)
        if amount is None:
            continue
        amt_norm = fxsvc.convert(db, float(amount), ccy, reporting_ccy, as_of)
        if amt_norm is None:
            missing_rate.append(r.id)
            continue
        buckets[stage] = buckets.get(stage, 0.0) + amt_norm
        ecl = amt_norm * DEFAULT_ECL_RATES.get(stage, 0.01)
        ecl_buckets[stage] = ecl_buckets.get(stage, 0.0) + ecl
        details.append({"submission_id": r.id, "stage": stage,
                        "amount": amount, "currency": ccy,
                        f"amount_{reporting_ccy.lower()}": round(amt_norm, 2),
                        "ecl": round(ecl, 2)})

    total = sum(buckets.values())
    total_ecl = sum(ecl_buckets.values())
    return {
        "reporting_currency": reporting_ccy,
        "as_of": (as_of or datetime.utcnow()).isoformat(),
        "tenant": tenant,
        "totals": {
            "exposure": round(total, 2),
            "ecl": round(total_ecl, 2),
            "coverage_ratio": round(total_ecl / total, 4) if total else 0.0,
        },
        "by_stage": {str(k): {"exposure": round(v, 2), "ecl": round(ecl_buckets[k], 2)}
                     for k, v in buckets.items()},
        "missing_fx_submission_ids": missing_rate,
        "detail_count": len(details),
    }
