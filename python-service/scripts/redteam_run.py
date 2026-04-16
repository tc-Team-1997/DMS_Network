"""Run the continuous red-team scorecard.

    BASE=http://127.0.0.1:9002 API_KEY=dev-key-change-me python scripts/redteam_run.py
"""
import os, sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.redteam import run

if __name__ == "__main__":
    r = run(os.environ.get("BASE", "http://127.0.0.1:8000"),
            os.environ.get("API_KEY"))
    print(json.dumps(r, indent=2, default=str))
    sys.exit(0 if r["verdict"] == "pass" else 1)
