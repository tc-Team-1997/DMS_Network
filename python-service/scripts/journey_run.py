"""Run a customer-journey simulation against a live DMS.

    python scripts/journey_run.py                       # run all
    python scripts/journey_run.py branch_onboarding
    BASE=http://dms.nbe.local:443 python scripts/journey_run.py
"""
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.journey import run, run_all

BASE = os.environ.get("BASE", "http://127.0.0.1:8000")
KEY = os.environ.get("API_KEY", "dev-key-change-me")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        print(json.dumps(run(sys.argv[1], BASE, KEY), indent=2, default=str))
    else:
        print(json.dumps(run_all(BASE, KEY), indent=2, default=str))
