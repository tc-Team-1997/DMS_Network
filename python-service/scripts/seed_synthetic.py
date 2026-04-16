"""Seed the database with synthetic Egyptian customers + documents.

    python scripts/seed_synthetic.py --customers 200 --docs 3
"""
import sys, argparse, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal, Base, engine
from app.services.test_data import generate


if __name__ == "__main__":
    Base.metadata.create_all(bind=engine)
    ap = argparse.ArgumentParser()
    ap.add_argument("--customers", type=int, default=50)
    ap.add_argument("--docs", type=int, default=3)
    args = ap.parse_args()
    db = SessionLocal()
    try:
        print(json.dumps(generate(db, args.customers, args.docs),
                         indent=2, default=str, ensure_ascii=False))
    finally:
        db.close()
