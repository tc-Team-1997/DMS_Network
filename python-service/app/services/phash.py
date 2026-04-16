from pathlib import Path
from PIL import Image
import imagehash


def compute_phash(path: str) -> str | None:
    p = Path(path)
    if not p.exists():
        return None
    ext = p.suffix.lower()
    if ext in {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}:
        try:
            with Image.open(p) as im:
                return str(imagehash.phash(im))
        except Exception:
            return None
    return None


def hamming(a: str, b: str) -> int:
    try:
        return imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b)
    except Exception:
        return 999
