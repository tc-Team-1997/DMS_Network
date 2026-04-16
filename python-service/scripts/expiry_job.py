"""Nightly job: find expiring documents and print/push notifications.
Run via cron / Windows Task Scheduler:
    python scripts/expiry_job.py --within-days 30
"""
import sys
import argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal
from app.services.alerts import expiring_documents


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--within-days", type=int, default=30)
    args = ap.parse_args()

    db = SessionLocal()
    try:
        items = expiring_documents(db, args.within_days)
        print(f"Found {len(items)} document(s) expiring within {args.within_days} days:")
        for it in items:
            print(f"  [{it['severity'].upper():>8}] #{it['id']} {it['original_name']} "
                  f"({it['doc_type']}) CID={it['customer_cid']} "
                  f"expiry={it['expiry_date']} days_left={it['days_left']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
