from typing import List, Tuple
from sqlalchemy.orm import Session
from rapidfuzz import fuzz

from ..models import Document, OcrResult, DuplicateMatch
from .phash import hamming
from .metrics import DUP_MATCHES


PHASH_THRESHOLD = 10  # hamming distance
TEXT_THRESHOLD = 85   # fuzzy ratio


def find_duplicates(db: Session, doc: Document) -> List[DuplicateMatch]:
    matches: List[DuplicateMatch] = []
    others = db.query(Document).filter(Document.id != doc.id).all()

    for other in others:
        match_type = None
        similarity = 0.0

        if doc.sha256 and other.sha256 and doc.sha256 == other.sha256:
            match_type, similarity = "exact_hash", 1.0
        elif doc.phash and other.phash:
            dist = hamming(doc.phash, other.phash)
            if dist <= PHASH_THRESHOLD:
                match_type, similarity = "near_image", round(1 - dist / 64.0, 4)

        if match_type is None and doc.ocr and other.ocr and doc.ocr.text and other.ocr.text:
            r = fuzz.token_set_ratio(doc.ocr.text, other.ocr.text)
            if r >= TEXT_THRESHOLD:
                match_type, similarity = "near_text", r / 100.0

        if match_type:
            m = DuplicateMatch(
                doc_a=doc.id, doc_b=other.id,
                similarity=similarity, match_type=match_type,
            )
            db.add(m)
            matches.append(m)
            DUP_MATCHES.labels(match_type).inc()

    if matches:
        db.commit()
    return matches
