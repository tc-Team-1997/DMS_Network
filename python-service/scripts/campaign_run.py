"""Nightly expiry campaign.

    python scripts/campaign_run.py           # dry-run
    python scripts/campaign_run.py --send    # actually dispatch
"""
import sys, json, argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal
from app.services.expiry_campaign import run_campaign


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--send", action="store_true")
    ap.add_argument("--tenant", default="default")
    args = ap.parse_args()
    db = SessionLocal()
    try:
        print(json.dumps(run_campaign(db, tenant=args.tenant, dry_run=not args.send), indent=2, default=str))
    finally:
        db.close()


if __name__ == "__main__":
    main()
