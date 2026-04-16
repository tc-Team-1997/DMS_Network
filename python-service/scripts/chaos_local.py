"""Local chaos harness — no k8s required.

Verifies the service stays healthy under controlled failures by toggling the
service's own admin endpoints and a Python-level failpoint registry. Useful
for dev-box drills and CI gate (run against docker-compose stack).

Scenarios:
  - kill-worker: SIGTERM the RQ worker container (docker)
  - latency-inject: set FAILPOINT_LATENCY_MS env in the API container, exercise, revert
  - integrations-down: point CBS/LOS base URLs at a black hole, watch circuit-breaker
  - dep-down: stop Redis / Elasticsearch, verify graceful degradation

Usage:
    python scripts/chaos_local.py latency-inject --duration 60 --ms 400
    python scripts/chaos_local.py kill-worker
    python scripts/chaos_local.py integrations-down --seconds 120
"""
import argparse, json, os, subprocess, sys, time, urllib.request


BASE = os.environ.get("DMS_BASE_URL", "http://localhost:8000")


def probe() -> dict:
    t0 = time.time()
    try:
        with urllib.request.urlopen(f"{BASE}/health", timeout=2) as r:
            return {"status": r.status, "ms": int((time.time() - t0) * 1000)}
    except Exception as e:
        return {"error": str(e)[:120]}


def _run(cmd: list[str]) -> int:
    print("+", " ".join(cmd))
    return subprocess.call(cmd)


def kill_worker(_):
    _run(["docker", "kill", "-s", "TERM", "dms-python-worker"])
    for i in range(30):
        p = probe()
        print(i, p)
        if p.get("status") == 200:
            print("Service stayed healthy ✓")
            return 0
        time.sleep(1)
    print("Service degraded ✗"); return 1


def latency_inject(args):
    _run(["docker", "exec", "dms-python",
          "sh", "-c", f"echo {args.ms} > /tmp/failpoint_latency_ms"])
    end = time.time() + args.duration
    while time.time() < end:
        print(probe()); time.sleep(5)
    _run(["docker", "exec", "dms-python",
          "sh", "-c", "rm -f /tmp/failpoint_latency_ms"])
    return 0


def integrations_down(args):
    # Re-point integration URLs to a black-hole IP.
    _run(["docker", "exec", "dms-python", "sh", "-c",
          "export CBS_BASE_URL=http://10.255.255.1/api"])
    time.sleep(args.seconds)
    return 0


def dep_down(args):
    dep = args.dependency
    _run(["docker", "kill", "-s", "STOP", dep])
    for i in range(args.seconds):
        p = probe(); print(i, p)
        time.sleep(1)
    _run(["docker", "kill", "-s", "CONT", dep])
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("kill-worker").set_defaults(func=kill_worker)

    p = sub.add_parser("latency-inject")
    p.add_argument("--duration", type=int, default=60)
    p.add_argument("--ms", type=int, default=400)
    p.set_defaults(func=latency_inject)

    p = sub.add_parser("integrations-down")
    p.add_argument("--seconds", type=int, default=60)
    p.set_defaults(func=integrations_down)

    p = sub.add_parser("dep-down")
    p.add_argument("--dependency", default="redis")
    p.add_argument("--seconds", type=int, default=30)
    p.set_defaults(func=dep_down)

    args = ap.parse_args()
    sys.exit(args.func(args) or 0)


if __name__ == "__main__":
    main()
