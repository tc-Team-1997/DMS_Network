"""Board-level executive 1-pager.

Pulls the quarter's headline KPIs + CBE compliance posture + SLO performance +
top risks into a single PDF that a CEO can read in 90 seconds. Regenerated on
demand (for a board meeting) or on a schedule (first of each month).

Output: `storage/reports/exec_<YYYYMM>.pdf`

Engine: pypdf-free. We emit a tiny hand-rolled PDF using Pillow → PDF export,
so the feature works with only the base deps. If `reportlab` is installed,
we use it for a nicer layout.
"""
from __future__ import annotations
import io
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..models import (
    Document, WorkflowStep, ComplianceScore, WatchlistMatch, UsageEvent,
)


REPORTS_DIR = Path(settings.STORAGE_DIR).parent / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)


def _gather(db: Session, tenant: str = "default",
            quarter_start: datetime | None = None) -> dict[str, Any]:
    now = datetime.utcnow()
    q0 = quarter_start or (now - timedelta(days=90))
    total_docs = db.query(func.count(Document.id)).filter(
        Document.tenant == tenant).scalar() or 0
    q_docs = db.query(func.count(Document.id)).filter(
        Document.tenant == tenant, Document.created_at >= q0).scalar() or 0
    actions = db.query(func.count(WorkflowStep.id)).filter(
        WorkflowStep.created_at >= q0).scalar() or 0
    aml_open = db.query(func.count(WatchlistMatch.id)).filter(
        WatchlistMatch.status == "open").scalar() or 0

    # Compliance posture: latest score per control.
    scores = (db.query(ComplianceScore.framework, func.avg(ComplianceScore.score))
              .filter(ComplianceScore.tenant == tenant,
                      ComplianceScore.measured_at >= q0)
              .group_by(ComplianceScore.framework).all())
    posture = {fw: round(float(avg or 0), 3) for fw, avg in scores}

    # Top features by usage (proxy for adoption).
    top_features = (db.query(UsageEvent.feature, func.count(UsageEvent.id))
                    .filter(UsageEvent.created_at >= q0)
                    .group_by(UsageEvent.feature)
                    .order_by(func.count(UsageEvent.id).desc())
                    .limit(5).all())

    return {
        "period": {"start": q0.date().isoformat(), "end": now.date().isoformat()},
        "tenant": tenant,
        "kpis": {
            "total_documents": int(total_docs),
            "quarter_inflow": int(q_docs),
            "workflow_actions": int(actions),
            "open_aml_matches": int(aml_open),
        },
        "compliance_posture": posture,
        "top_features": [{"feature": f, "hits": int(n)} for f, n in top_features],
    }


def _render_reportlab(data: dict) -> bytes | None:
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
        from reportlab.lib.units import cm
    except Exception:
        return None

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4

    # Header band
    c.setFillColorRGB(0.04, 0.09, 0.17)
    c.rect(0, H - 3 * cm, W, 3 * cm, fill=1, stroke=0)
    c.setFillColorRGB(0.91, 0.79, 0.42)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(2 * cm, H - 2 * cm, "National Bank of Egypt")
    c.setFont("Helvetica", 11)
    c.setFillColorRGB(0.85, 0.88, 0.94)
    c.drawString(2 * cm, H - 2.6 * cm,
                 f"Executive Brief — Document Management · {data['period']['start']} → {data['period']['end']}")

    # KPI row
    c.setFillColorRGB(0.1, 0.1, 0.1)
    y = H - 4.5 * cm
    c.setFont("Helvetica-Bold", 14)
    c.drawString(2 * cm, y, "Quarter KPIs")
    y -= 0.8 * cm
    c.setFont("Helvetica", 11)
    for k, v in data["kpis"].items():
        c.drawString(2 * cm, y, f"{k.replace('_', ' ').title():26}  {v:,}")
        y -= 0.6 * cm

    # Compliance posture
    y -= 0.4 * cm
    c.setFont("Helvetica-Bold", 14)
    c.drawString(2 * cm, y, "Compliance Posture")
    y -= 0.8 * cm
    c.setFont("Helvetica", 11)
    if not data["compliance_posture"]:
        c.drawString(2 * cm, y, "No measurements in window.")
        y -= 0.6 * cm
    for fw, score in data["compliance_posture"].items():
        bar = "█" * int(score * 20) + "░" * (20 - int(score * 20))
        c.drawString(2 * cm, y, f"{fw:12}  {bar}  {int(score * 100)}%")
        y -= 0.6 * cm

    # Top features
    y -= 0.4 * cm
    c.setFont("Helvetica-Bold", 14)
    c.drawString(2 * cm, y, "Top Features by Adoption")
    y -= 0.8 * cm
    c.setFont("Helvetica", 11)
    for f in data["top_features"]:
        c.drawString(2 * cm, y, f"• {f['feature']:30}  {f['hits']:,} hits")
        y -= 0.55 * cm

    # Footer
    c.setFont("Helvetica-Oblique", 8)
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.drawString(2 * cm, 1.5 * cm,
                 f"Generated {datetime.utcnow().isoformat()}Z · Tenant: {data['tenant']} · "
                 f"Distribute board-only — contains strategic KPIs.")

    c.showPage()
    c.save()
    return buf.getvalue()


def _render_pil(data: dict) -> bytes:
    """Fallback: render the same text onto an A4 image and export as PDF."""
    from PIL import Image, ImageDraw, ImageFont
    W, H = 1240, 1754  # A4 @ 150 DPI
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 180], fill=(10, 22, 40))
    try:
        title = ImageFont.truetype("arial.ttf", 36)
        body = ImageFont.truetype("arial.ttf", 18)
    except Exception:
        title = ImageFont.load_default()
        body = ImageFont.load_default()
    d.text((60, 45), "National Bank of Egypt", fill=(232, 201, 107), font=title)
    d.text((60, 120),
           f"Executive Brief — DMS · {data['period']['start']} → {data['period']['end']}",
           fill=(217, 223, 234), font=body)
    y = 220
    d.text((60, y), "Quarter KPIs", fill=(10, 10, 10), font=title); y += 55
    for k, v in data["kpis"].items():
        d.text((60, y), f"{k.replace('_', ' ').title():26}  {v:,}",
               fill=(10, 10, 10), font=body)
        y += 30
    y += 30
    d.text((60, y), "Compliance Posture", fill=(10, 10, 10), font=title); y += 55
    for fw, s in data["compliance_posture"].items():
        d.text((60, y), f"{fw:12}  {int(s * 100)}%", fill=(10, 10, 10), font=body); y += 30
    y += 30
    d.text((60, y), "Top Features by Adoption", fill=(10, 10, 10), font=title); y += 55
    for f in data["top_features"]:
        d.text((60, y), f"• {f['feature']:30}  {f['hits']:,} hits",
               fill=(10, 10, 10), font=body); y += 30

    buf = io.BytesIO()
    img.save(buf, "PDF", resolution=150.0)
    return buf.getvalue()


def build(db: Session, tenant: str = "default") -> tuple[Path, dict]:
    data = _gather(db, tenant)
    pdf = _render_reportlab(data) or _render_pil(data)
    stamp = datetime.utcnow().strftime("%Y%m")
    out = REPORTS_DIR / f"exec_{tenant}_{stamp}.pdf"
    out.write_bytes(pdf)
    return out, data
