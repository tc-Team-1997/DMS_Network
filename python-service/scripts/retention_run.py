"""Nightly retention sweep.
    python scripts/retention_run.py --apply     # actually delete/archive
    python scripts/retention_run.py             # dry-run
"""
import sys, argparse, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal
from app.services.retention import apply_due


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="disable dry-run")
    ap.add_argument("--tenant", default=None)
    args = ap.parse_args()
    db = SessionLocal()
    try:
        summary = apply_due(db, dry_run=not args.apply, tenant=args.tenant)
        print(json.dumps(summary, indent=2, default=str))
    finally:
        db.close()


if __name__ == "__main__":
    main()
