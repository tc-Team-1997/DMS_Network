"""Render the STRIDE threat model to docs/THREAT-MODEL.md.

Wire into the release pipeline:
    python scripts/generate_threat_model.py > docs/THREAT-MODEL.md
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.stride import build_markdown

if __name__ == "__main__":
    print(build_markdown())
