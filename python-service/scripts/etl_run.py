"""Nightly ETL for Power BI.

Cron / Windows Task Scheduler:
    0 2 * * *  python scripts/etl_run.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.etl import run_all


if __name__ == "__main__":
    import json
    print(json.dumps(run_all(), indent=2))
