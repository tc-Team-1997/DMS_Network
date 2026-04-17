"""DocBrain — DocManager's document AI layer.

Local-first: OCR via Tesseract, LLM via Ollama (llama3.2:3b for dev,
swap to llama3.1:70b on-prem tier-1), embeddings via nomic-embed-text,
vector store via sqlite-vec.

Modules:
    ocr        — Tesseract-based OCR, page-level output
    classify   — Llama zero-shot banking-doc classification
    extract    — Llama structured NER (CID, doc number, dates, names, address)
    embed      — Ollama embeddings (768-dim nomic-embed-text)
    vectors    — sqlite-vec wrapper, tenant-scoped collections
    rag        — hybrid BM25 + vector search, Llama answer with citations
"""
from .ocr import ocr_document, OcrResult, OcrPage
from .classify import classify_document, ClassificationResult, DOC_CLASSES
from .extract import extract_entities, ExtractionResult
from .embed import embed_text, EMBED_DIM
from .vectors import upsert_document, vector_search
from .rag import rag_answer, RagAnswer, Citation

__all__ = [
    "ocr_document", "OcrResult", "OcrPage",
    "classify_document", "ClassificationResult", "DOC_CLASSES",
    "extract_entities", "ExtractionResult",
    "embed_text", "EMBED_DIM",
    "upsert_document", "vector_search",
    "rag_answer", "RagAnswer", "Citation",
]
