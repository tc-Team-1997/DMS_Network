"""Arabic OCR (Tesseract `ara` traineddata) + hand-written signature extraction.

Two features:
  - `run_bilingual_ocr(path)`: runs Tesseract with `ara+eng` languages.
    Falls back to English-only if Arabic traineddata isn't installed.
  - `extract_signature(path, out_path)`: finds the largest connected ink region in the
    lower 40% of the page, crops and alpha-mats it to PNG — useful for attaching
    a signature sample to the customer master, or pushing it to the digital-sign service.
"""
from __future__ import annotations
from pathlib import Path
from typing import Optional

from ..config import settings

try:
    import pytesseract
    from PIL import Image, ImageOps
    if settings.TESSERACT_CMD:
        pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD
except Exception:
    pytesseract = None


def has_arabic() -> bool:
    if pytesseract is None:
        return False
    try:
        langs = pytesseract.get_languages(config="")
        return "ara" in langs
    except Exception:
        return False


def run_bilingual_ocr(path: str) -> dict:
    if pytesseract is None:
        return {"text": "", "confidence": 0.0, "languages": "none"}
    p = Path(path)
    if not p.exists() or p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}:
        return {"text": "", "confidence": 0.0, "languages": "unsupported"}

    langs = "ara+eng" if has_arabic() else "eng"
    with Image.open(p) as im:
        data = pytesseract.image_to_data(im, lang=langs, output_type=pytesseract.Output.DICT)
        text = pytesseract.image_to_string(im, lang=langs)

    confs = [int(c) for c in data.get("conf", []) if str(c).lstrip("-").isdigit() and int(c) >= 0]
    conf = (sum(confs) / len(confs) / 100.0) if confs else 0.0
    return {"text": text, "confidence": round(conf, 4), "languages": langs}


def extract_signature(path: str, out_path: Optional[str] = None) -> dict:
    """Crop the largest dark blob in the lower 40% of the image to a PNG.

    Good enough for printed forms where the signature is always at the bottom.
    For arbitrary layouts use a dedicated model (e.g. CRAFT/YOLO trained on sigs).
    """
    try:
        from PIL import Image, ImageFilter, ImageChops
    except Exception as e:
        return {"ok": False, "reason": f"PIL missing: {e}"}

    p = Path(path)
    if not p.exists():
        return {"ok": False, "reason": "file not found"}
    if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}:
        return {"ok": False, "reason": "unsupported format (image only)"}

    with Image.open(p).convert("L") as im:
        w, h = im.size
        # Focus on the bottom 40 % where signatures typically sit.
        crop_box = (0, int(h * 0.6), w, h)
        bottom = im.crop(crop_box)
        # Emphasize dark ink, then find the bounding box of non-white pixels.
        bin_img = bottom.point(lambda v: 0 if v < 128 else 255).filter(ImageFilter.MinFilter(3))
        bg = Image.new("L", bin_img.size, 255)
        diff = ImageChops.difference(bin_img, bg)
        bbox = diff.getbbox()
        if not bbox:
            return {"ok": False, "reason": "no ink found"}

        abs_bbox = (bbox[0], bbox[1] + crop_box[1], bbox[2], bbox[3] + crop_box[1])
        sig = im.crop(abs_bbox)

        # Alpha-mat so it composites nicely on top of other docs.
        rgba = sig.convert("RGBA")
        pixels = rgba.load()
        for y in range(rgba.size[1]):
            for x in range(rgba.size[0]):
                r, g, b, _ = pixels[x, y]
                alpha = max(0, 255 - r)  # darker = more opaque
                pixels[x, y] = (0, 0, 0, alpha)

        out = Path(out_path) if out_path else p.with_name(p.stem + ".sig.png")
        rgba.save(out)

    return {"ok": True, "output": str(out),
            "bbox": list(abs_bbox),
            "width": abs_bbox[2] - abs_bbox[0],
            "height": abs_bbox[3] - abs_bbox[1]}
