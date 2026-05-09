"""LocalEmbedding — delegates to the docbrain Ollama embedding pipeline.

Uses nomic-embed-text via Ollama (already configured in docbrain/llm.py).
Falls back to a deterministic zero-vector stub if Ollama is unreachable,
logging a prominent warning. Replace with sentence-transformers or BGE-M3
for production air-gap deployments that cannot run Ollama.

sentence-transformers==2.7.0 is in requirements-extras.txt but NOT in the
default requirements.txt, so we do not attempt to import it here — the
Ollama path is the intended local default.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import logging

from ...providers_base import EmbeddingProvider

log = logging.getLogger(__name__)

_STUB_DIM = 384


class LocalEmbedding(EmbeddingProvider):
    """Embedding provider backed by Ollama's nomic-embed-text model.

    Delegates to app.services.docbrain.llm.embed() for each text.
    When Ollama is unreachable the embed() function returns an empty list;
    we substitute a zero-vector stub and warn loudly.
    """

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one embedding vector per input text.

        Attempts the Ollama path first. On failure, returns a stub zero-vector
        of dimension 384 and logs a warning. The stub is intentionally
        non-random so tests get deterministic output without Ollama running.
        """
        try:
            from app.services.docbrain.llm import embed as _ollama_embed
        except ImportError:
            log.warning(
                "LocalEmbedding: docbrain.llm not available — "
                "returning stub embeddings. Replace with sentence-transformers "
                "or Ollama for production use."
            )
            return [[0.0] * _STUB_DIM for _ in texts]

        results: list[list[float]] = []
        for text in texts:
            vec = _ollama_embed(text)
            if not vec:
                log.warning(
                    "LocalEmbedding: Ollama returned empty vector for text of "
                    "length %d — stub embedding used. Replace with "
                    "sentence-transformers or Ollama for production use.",
                    len(text),
                )
                vec = [0.0] * _STUB_DIM
            results.append(vec)
        return results
