"""Simple CLI for common DMS ops (list, ocr, dup-scan, workflow).

Usage:
    python scripts/cli.py list
    python scripts/cli.py upload <path> --type passport --cid EGY-2024-00847
    python scripts/cli.py ocr <doc_id>
    python scripts/cli.py dup <doc_id>
    python scripts/cli.py wf <doc_id> --stage maker --action approve --actor "Ahmed M."
"""
import sys
import argparse
import json
import os
from pathlib import Path

import httpx

BASE = os.environ.get("DMS_BASE_URL", "http://localhost:8000")
KEY = os.environ.get("DMS_API_KEY", "dev-key-change-me")
H = {"X-API-Key": KEY}


def cmd_list(args):
    r = httpx.get(f"{BASE}/api/v1/documents", headers=H, params={"limit": args.limit})
    for d in r.json():
        print(f"#{d['id']:>4} {d['status']:>10} {d['doc_type'] or '-':<16} "
              f"{(d['customer_cid'] or '-'):<24} {d['original_name']}")


def cmd_upload(args):
    with open(args.path, "rb") as f:
        files = {"file": (Path(args.path).name, f.read())}
    data = {k: v for k, v in {
        "doc_type": args.type, "customer_cid": args.cid, "branch": args.branch,
        "expiry_date": args.expiry, "uploaded_by": args.user,
    }.items() if v}
    r = httpx.post(f"{BASE}/api/v1/documents", headers=H, files=files, data=data)
    print(json.dumps(r.json(), indent=2))


def cmd_ocr(args):
    r = httpx.post(f"{BASE}/api/v1/ocr/{args.doc_id}", headers=H, timeout=60)
    print(json.dumps(r.json(), indent=2))


def cmd_dup(args):
    r = httpx.post(f"{BASE}/api/v1/duplicates/{args.doc_id}/scan", headers=H)
    print(json.dumps(r.json(), indent=2))


def cmd_wf(args):
    body = {"stage": args.stage, "action": args.action, "actor": args.actor, "comment": args.comment}
    r = httpx.post(f"{BASE}/api/v1/workflow/{args.doc_id}/actions",
                   headers={**H, "Content-Type": "application/json"},
                   json=body)
    print(json.dumps(r.json(), indent=2))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list"); p.add_argument("--limit", type=int, default=50); p.set_defaults(func=cmd_list)

    p = sub.add_parser("upload")
    p.add_argument("path"); p.add_argument("--type"); p.add_argument("--cid")
    p.add_argument("--branch"); p.add_argument("--expiry"); p.add_argument("--user", default="cli")
    p.set_defaults(func=cmd_upload)

    p = sub.add_parser("ocr"); p.add_argument("doc_id", type=int); p.set_defaults(func=cmd_ocr)
    p = sub.add_parser("dup"); p.add_argument("doc_id", type=int); p.set_defaults(func=cmd_dup)

    p = sub.add_parser("wf")
    p.add_argument("doc_id", type=int)
    p.add_argument("--stage", required=True); p.add_argument("--action", required=True)
    p.add_argument("--actor", required=True); p.add_argument("--comment", default="")
    p.set_defaults(func=cmd_wf)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
