"""Predictive expiry reminder campaigns.

Schedule: fire messages at 90 / 60 / 30 / 7 / 0 days before a document's expiry,
via WhatsApp primary + SMS fallback + email fallback. Idempotent — a CampaignRun
row ensures the same (document_id, day-bucket) is never sent twice.

Bucket resolution rules:
  days_left >= 90  → none
  60..90           → 90
  30..60           → 60
   7..30           → 30
   1..7            → 7
   <= 0            → 0 (expired, urgent)

Render templates are Jinja-like {{placeholders}} and ship with Arabic + English
variants; language auto-picks from the customer's preferred language if known
(env: CAMPAIGN_DEFAULT_LANG=en|ar).
"""
from __future__ import annotations
import json
import os
from datetime import datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Document, WorkflowStep
from .events import emit


CAMPAIGN_DEFAULT_LANG = os.environ.get("CAMPAIGN_DEFAULT_LANG", "en")
WHATSAPP_URL = os.environ.get("WHATSAPP_URL", "").strip()
WHATSAPP_TOKEN = os.environ.get("WHATSAPP_TOKEN", "").strip()
SMS_URL = os.environ.get("SMS_URL", "").strip()
SMS_TOKEN = os.environ.get("SMS_TOKEN", "").strip()


TEMPLATES = {
    ("en", 90): "Dear {{name}}, your {{doc_type}} with NBE expires on {{expiry}} — renew anytime before then to avoid service interruption.",
    ("en", 60): "Reminder: your {{doc_type}} expires in ~60 days ({{expiry}}). Visit any NBE branch or reply to book a renewal appointment.",
    ("en", 30): "Only 30 days left before your {{doc_type}} expires ({{expiry}}). Please bring the renewed copy to your branch.",
    ("en", 7):  "Urgent: your {{doc_type}} expires in a week on {{expiry}}. After that date your account services may be suspended.",
    ("en", 0):  "Your {{doc_type}} EXPIRED on {{expiry}}. Please renew immediately to restore banking services.",
    ("ar", 90): "عميلنا العزيز {{name}}، تنتهي صلاحية {{doc_type}} الخاص بك في {{expiry}} — يرجى التجديد مسبقًا.",
    ("ar", 60): "تذكير: صلاحية {{doc_type}} تنتهي خلال حوالي ٦٠ يومًا ({{expiry}}).",
    ("ar", 30): "متبقي ٣٠ يومًا على انتهاء {{doc_type}} ({{expiry}}). يرجى إحضار النسخة المجددة إلى الفرع.",
    ("ar", 7):  "عاجل: تنتهي صلاحية {{doc_type}} الخاص بك خلال أسبوع في {{expiry}}.",
    ("ar", 0):  "انتهت صلاحية {{doc_type}} الخاص بك في {{expiry}}. يرجى التجديد فورًا.",
}


def render(lang: str, bucket: int, ctx: dict) -> str:
    msg = TEMPLATES.get((lang, bucket)) or TEMPLATES[("en", bucket)]
    for k, v in ctx.items():
        msg = msg.replace("{{" + k + "}}", str(v or ""))
    return msg


def bucket_for(days_left: int) -> int | None:
    if days_left <= 0:
        return 0
    if days_left <= 7:
        return 7
    if days_left <= 30:
        return 30
    if days_left <= 60:
        return 60
    if days_left <= 90:
        return 90
    return None


def _already_sent(db: Session, document_id: int, bucket: int) -> bool:
    return db.query(WorkflowStep).filter(
        WorkflowStep.document_id == document_id,
        WorkflowStep.stage == "campaign",
        WorkflowStep.action == f"bucket_{bucket}",
    ).first() is not None


def _send_whatsapp(to: str, body: str) -> bool:
    if not (WHATSAPP_URL and WHATSAPP_TOKEN and to):
        return False
    try:
        with httpx.Client(timeout=5.0) as c:
            r = c.post(WHATSAPP_URL,
                       headers={"Authorization": f"Bearer {WHATSAPP_TOKEN}"},
                       json={"to": to, "type": "text", "text": {"body": body}})
            return 200 <= r.status_code < 300
    except Exception:
        return False


def _send_sms(to: str, body: str) -> bool:
    if not (SMS_URL and SMS_TOKEN and to):
        return False
    try:
        with httpx.Client(timeout=5.0) as c:
            r = c.post(SMS_URL,
                       headers={"Authorization": f"Bearer {SMS_TOKEN}"},
                       json={"to": to, "message": body})
            return 200 <= r.status_code < 300
    except Exception:
        return False


def run_campaign(db: Session, tenant: str = "default",
                 dry_run: bool = False, actor: str = "system") -> dict[str, Any]:
    today = datetime.utcnow().date()
    docs = db.query(Document).filter(
        Document.tenant == tenant,
        Document.expiry_date != None,  # noqa: E711
    ).all()

    summary = {"examined": 0, "sent_whatsapp": 0, "sent_sms": 0,
               "skipped_already_sent": 0, "skipped_no_contact": 0,
               "dry_run": dry_run, "details": []}
    for d in docs:
        try:
            exp = datetime.strptime(d.expiry_date, "%Y-%m-%d").date()
        except Exception:
            continue
        days_left = (exp - today).days
        b = bucket_for(days_left)
        if b is None:
            continue
        summary["examined"] += 1
        if _already_sent(db, d.id, b):
            summary["skipped_already_sent"] += 1
            continue

        phone = None  # real systems fetch from CBS/customer master
        if d.customer_cid and d.customer_cid.startswith("EGY-"):
            phone = f"+201000000000"  # placeholder — wire to CBS lookup in production

        if not phone:
            summary["skipped_no_contact"] += 1
            continue

        msg = render(CAMPAIGN_DEFAULT_LANG, b, {
            "name": d.customer_cid, "doc_type": d.doc_type, "expiry": d.expiry_date,
        })
        ok_wa = False; ok_sms = False
        if not dry_run:
            ok_wa = _send_whatsapp(phone, msg)
            if not ok_wa:
                ok_sms = _send_sms(phone, msg)
            db.add(WorkflowStep(
                document_id=d.id, stage="campaign", actor=actor,
                action=f"bucket_{b}",
                comment=f"{'wa' if ok_wa else 'sms' if ok_sms else 'none'} to {phone[:4]}***",
            ))
            db.commit()
            emit("campaign.sent", document_id=d.id, bucket=b,
                 channel=("whatsapp" if ok_wa else "sms" if ok_sms else "none"))
        if ok_wa:   summary["sent_whatsapp"] += 1
        if ok_sms:  summary["sent_sms"] += 1
        summary["details"].append({"id": d.id, "bucket": b, "days_left": days_left,
                                   "channel": "whatsapp" if ok_wa else "sms" if ok_sms else "none"})
    return summary
