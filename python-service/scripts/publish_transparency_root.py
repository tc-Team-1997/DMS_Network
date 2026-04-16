"""Hourly cron — publish Merkle root for the previous hour.

    0 * * * * python scripts/publish_transparency_root.py
"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.transparency import publish

if __name__ == "__main__":
    print(json.dumps(publish(hour_offset=0), indent=2))
