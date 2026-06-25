"""HTTP client that calls the Search service to retrieve grounding context.

The search service is at SEARCH_URL (default http://localhost:4004).
We call GET /search?q=<question>&limit=5 and pass the caller's Authorization
Bearer token through.  If the service is unreachable we return an empty list
and a degraded flag so the copilot can compose an honest answer.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_SEARCH_URL = "http://localhost:4004"
_TIMEOUT = 5.0  # seconds

# Natural-language stopwords dropped before building the retrieval query so that
# verbose questions ("show me the loan documents") still match the corpus.
_STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "of", "for", "to", "in",
    "on", "at", "and", "or", "with", "within", "what", "which", "who", "whom",
    "show", "me", "my", "our", "list", "find", "get", "give", "all", "any", "do",
    "does", "did", "can", "could", "would", "please", "that", "this", "these",
    "those", "next", "last", "over", "by", "from", "how", "when", "where", "i",
    "we", "you", "about", "into", "their", "there",
}


def _keywords(question: str) -> list[str]:
    """Content keywords from a natural-language question."""
    words = re.findall(r"[a-zA-Z0-9]+", question.lower())
    return [w for w in words if len(w) > 2 and w not in _STOPWORDS]


@dataclass
class SearchHit:
    doc_id: str
    title: str
    snippet: str
    score: float = 1.0


@dataclass
class SearchResult:
    hits: list[SearchHit] = field(default_factory=list)
    degraded: bool = False  # True when the search service was unreachable
    error: str | None = None


async def retrieve(
    question: str,
    *,
    search_url: str = _DEFAULT_SEARCH_URL,
    auth_token: str | None = None,
    limit: int = 5,
) -> SearchResult:
    """Fetch the top *limit* search hits for *question* from the Search service.

    Returns a :class:`SearchResult` with ``degraded=True`` and an empty hit list
    when the service is unreachable so the caller can degrade gracefully.
    """
    headers: dict[str, str] = {}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    # Build a high-recall query: OR the content keywords in boolean mode so a
    # verbose question still matches documents (fulltext AND-matches every token).
    keywords = _keywords(question)
    if keywords:
        query_text, query_mode = " OR ".join(keywords), "boolean"
    else:
        query_text, query_mode = question, "fulltext"

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            # The Search service exposes POST /search with a JSON SearchQuery body.
            resp = await client.post(
                f"{search_url.rstrip('/')}/search",
                json={"text": query_text, "mode": query_mode, "page": 1, "pageSize": limit},
                headers={**headers, "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.ConnectError as exc:
        logger.warning("Search service unreachable: %s", exc)
        return SearchResult(degraded=True, error=str(exc))
    except httpx.TimeoutException as exc:
        logger.warning("Search service timeout: %s", exc)
        return SearchResult(degraded=True, error=str(exc))
    except httpx.HTTPStatusError as exc:
        logger.warning("Search service HTTP error %s: %s", exc.response.status_code, exc)
        return SearchResult(degraded=True, error=str(exc))

    # Normalise the response — the search service may return hits in different shapes.
    hits: list[SearchHit] = []
    raw_hits = data if isinstance(data, list) else data.get("hits", data.get("results", []))
    for item in raw_hits[:limit]:
        if isinstance(item, dict):
            hits.append(
                SearchHit(
                    doc_id=str(item.get("doc_id", item.get("id", "unknown"))),
                    title=str(
                        item.get("title")
                        or item.get("name")
                        or (str(item.get("doc_type", "")).replace("_", " ") or None)
                        or item.get("doc_id", "Document")
                    ),
                    snippet=str(item.get("snippet", item.get("content", item.get("text", "")))),
                    score=float(item.get("score", item.get("_score", 1.0))),
                )
            )
    return SearchResult(hits=hits)
