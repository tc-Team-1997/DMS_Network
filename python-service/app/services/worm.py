"""WORM (Write-Once-Read-Many) filesystem-level immutability service.

Supports macOS (chflags uchg / -uchg) and Linux (chattr +i / -i).
Windows is explicitly out of scope — callers receive a clear RuntimeError.

Public surface
--------------
apply_immutable_flag(path)      — set OS immutable flag on the file
release_immutable_flag(path)    — remove OS immutable flag from the file
compute_sha256(path)            — compute hex SHA-256 of file on disk
verify_integrity(document_id, db) — full integrity check for one document

All path arguments must be Path objects or absolute path strings.
PII note: only the filename portion (basename) is ever logged; full paths
are never emitted to structured logs.
"""
from __future__ import annotations

import hashlib
import logging
import os
import platform
import subprocess
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# OS detection
# ---------------------------------------------------------------------------

_SYSTEM = platform.system()  # "Darwin" | "Linux" | "Windows" | ...


def _assert_supported() -> None:
    """Raise RuntimeError if the host OS does not support WORM flag ops."""
    if _SYSTEM not in ("Darwin", "Linux"):
        raise RuntimeError(
            f"WORM OS flag operations are not supported on {_SYSTEM}. "
            "Supported: Darwin (macOS), Linux."
        )


# ---------------------------------------------------------------------------
# OS flag management
# ---------------------------------------------------------------------------

def apply_immutable_flag(path: str | Path) -> None:
    """Set the OS immutable flag on *path*.

    macOS  : chflags uchg <path>
    Linux  : chattr +i <path>

    Raises RuntimeError on Windows or unsupported OS.
    Raises subprocess.CalledProcessError if the OS command fails (e.g. EPERM).
    """
    _assert_supported()
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Cannot lock non-existent file: {p.name}")

    if _SYSTEM == "Darwin":
        cmd = ["chflags", "uchg", str(p)]
    else:  # Linux
        cmd = ["chattr", "+i", str(p)]

    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"Failed to set immutable flag on {p.name}: "
            f"{exc.stderr.decode(errors='replace').strip()}"
        ) from exc

    log.info(
        "worm.apply_immutable_flag",
        extra={"filename": p.name, "os": _SYSTEM},
    )


def release_immutable_flag(path: str | Path) -> None:
    """Remove the OS immutable flag from *path*.

    macOS  : chflags -uchg <path>  (note: no space before flag on macOS — see man chflags)
    Linux  : chattr -i <path>

    Safe to call on a file that is not currently immutable (idempotent).
    Raises RuntimeError on Windows or unsupported OS.
    """
    _assert_supported()
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Cannot release lock on non-existent file: {p.name}")

    if _SYSTEM == "Darwin":
        cmd = ["chflags", "nouchg", str(p)]
    else:  # Linux
        cmd = ["chattr", "-i", str(p)]

    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"Failed to release immutable flag on {p.name}: "
            f"{exc.stderr.decode(errors='replace').strip()}"
        ) from exc

    log.info(
        "worm.release_immutable_flag",
        extra={"filename": p.name, "os": _SYSTEM},
    )


def is_immutable(path: str | Path) -> bool:
    """Return True if *path* currently has the OS immutable flag set.

    macOS : checks stat -f%Sf flags for 'uchg'
    Linux : parses lsattr output for 'i' attribute
    Returns False (not True) on any probe failure so callers degrade gracefully.
    """
    _assert_supported()
    p = Path(path)
    if not p.exists():
        return False

    try:
        if _SYSTEM == "Darwin":
            result = subprocess.run(
                ["stat", "-f", "%Sf", str(p)],
                check=True,
                capture_output=True,
                text=True,
            )
            return "uchg" in result.stdout
        else:  # Linux
            result = subprocess.run(
                ["lsattr", str(p)],
                check=True,
                capture_output=True,
                text=True,
            )
            # lsattr output: "----i--------e-- /path/to/file"
            # The attribute string is the first token before the space.
            attrs = result.stdout.split()[0] if result.stdout.strip() else ""
            return "i" in attrs
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "worm.is_immutable probe failed for %s: %s", p.name, exc
        )
        return False


# ---------------------------------------------------------------------------
# SHA-256 helper
# ---------------------------------------------------------------------------

def compute_sha256(path: str | Path) -> str:
    """Return the lowercase hex SHA-256 digest of the file at *path*."""
    p = Path(path)
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Integrity verification
# ---------------------------------------------------------------------------

def verify_integrity(document_id: int, db: "Session") -> dict:
    """Verify WORM integrity for a single document.

    Returns a dict:
        {
            "document_id": int,
            "tampered": bool,
            "os_flag_set": bool,
            "sha256_baseline": str | None,
            "sha256_current": str | None,
            "locked_at": datetime | None,
            "unlock_after": datetime | None,
            "file_missing": bool,
        }

    If the document is not WORM-locked the call is a no-op and returns
    tampered=False, os_flag_set=False, sha256_current=None.
    """
    from ..models import Document

    doc: Document | None = db.query(Document).filter(
        Document.id == document_id
    ).first()

    result: dict = {
        "document_id": document_id,
        "tampered": False,
        "os_flag_set": False,
        "sha256_baseline": None,
        "sha256_current": None,
        "locked_at": doc.worm_locked_at if doc else None,
        "unlock_after": doc.worm_unlock_after if doc else None,
        "file_missing": False,
    }

    if doc is None or doc.worm_locked_at is None:
        return result

    # Resolve file path from the stored filename.
    from ..config import settings
    storage_dir = Path(settings.STORAGE_DIR)
    file_path = storage_dir / doc.filename if doc.filename else None

    if file_path is None or not file_path.exists():
        result["file_missing"] = True
        log.error(
            "worm.verify_integrity: file missing for document_id=%d filename=%s",
            document_id,
            doc.filename or "<empty>",
        )
        return result

    result["sha256_baseline"] = doc.sha256_at_lock

    # Check OS flag.
    try:
        result["os_flag_set"] = is_immutable(file_path)
    except RuntimeError:
        result["os_flag_set"] = False

    # Recompute hash.
    try:
        current = compute_sha256(file_path)
        result["sha256_current"] = current
        if doc.sha256_at_lock and current != doc.sha256_at_lock:
            result["tampered"] = True
            log.error(
                "worm.verify_integrity: TAMPERED document_id=%d "
                "expected=%s actual=%s",
                document_id,
                doc.sha256_at_lock[:16] + "...",
                current[:16] + "...",
            )
    except OSError as exc:
        log.error(
            "worm.verify_integrity: cannot read file for document_id=%d: %s",
            document_id,
            exc,
        )

    return result


# ---------------------------------------------------------------------------
# Batch verification (used by nightly job endpoint)
# ---------------------------------------------------------------------------

def verify_all_locked(db: "Session", tenant: str) -> dict:
    """Walk all WORM-locked documents for *tenant* and verify each.

    Returns a summary dict compatible with the verify-batch response shape.
    """
    from ..models import Document, AuditLog, AlertRecord

    rows = (
        db.query(Document)
        .filter(
            Document.tenant == tenant,
            Document.worm_locked_at.isnot(None),
        )
        .all()
    )

    summary = {
        "examined": 0,
        "ok": 0,
        "tampered": 0,
        "missing": 0,
        "ran_at": datetime.utcnow().isoformat() + "Z",
    }

    for doc in rows:
        summary["examined"] += 1
        result = verify_integrity(doc.id, db)

        if result["file_missing"]:
            summary["missing"] += 1
            # Create critical alert.
            db.add(AlertRecord(
                user_sub="worm_verifier",
                level="critical",
                title=f"WORM: file missing for document {doc.id}",
                message=(
                    f"Locked document id={doc.id} filename={doc.filename} "
                    f"is missing from storage. Manual forensics required."
                ),
            ))
            db.add(AuditLog(
                tenant=tenant,
                actor="worm_verifier",
                action="WORM_TAMPERING_DETECTED",
                resource_type="document",
                resource_id=str(doc.id),
                detail="file_missing=true",
            ))
        elif result["tampered"]:
            summary["tampered"] += 1
            db.add(AlertRecord(
                user_sub="worm_verifier",
                level="critical",
                title=f"WORM: tamper detected for document {doc.id}",
                message=(
                    f"SHA-256 mismatch for locked document id={doc.id}. "
                    f"Baseline={result['sha256_baseline']!r} "
                    f"Current={result['sha256_current']!r}. "
                    "Forensic review required."
                ),
            ))
            db.add(AuditLog(
                tenant=tenant,
                actor="worm_verifier",
                action="WORM_TAMPERING_DETECTED",
                resource_type="document",
                resource_id=str(doc.id),
                detail=(
                    f"expected_sha256={result['sha256_baseline']} "
                    f"actual_sha256={result['sha256_current']}"
                ),
            ))
        else:
            summary["ok"] += 1

    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001
        log.error("worm.verify_all_locked: commit failed: %s", exc)
        db.rollback()

    return summary
