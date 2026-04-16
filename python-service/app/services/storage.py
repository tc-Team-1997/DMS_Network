import hashlib
import os
from pathlib import Path
from ..config import settings


def ensure_storage_dir() -> Path:
    p = Path(settings.STORAGE_DIR)
    p.mkdir(parents=True, exist_ok=True)
    return p


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_bytes(data: bytes, original_name: str) -> tuple[str, str, int]:
    """Return (stored_path, sha256, size)."""
    digest = sha256_bytes(data)
    ext = os.path.splitext(original_name)[1].lower() or ".bin"
    stored_name = f"{digest}{ext}"
    target = ensure_storage_dir() / stored_name
    if not target.exists():
        with open(target, "wb") as f:
            f.write(data)
    return str(target), digest, len(data)
