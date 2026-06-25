"""HTTP client that calls the Search service to retrieve grounding context.

The search service is at SEARCH_URL (default http://localhost:4004).
We call GET /search?q=<question>&limit=5 and pass the caller's Authorization
Bearer token through.  If the service is unreachable we return an empty list
and a degraded flag so the copilot can compose an honest answer.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_SEARCH_URL = "http://localhost:4004"
_TIMEOUT = 5.0  # seconds


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

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{search_url.rstrip('/')}/search",
                params={"q": question, "limit": limit},
                headers=headers,
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
                    title=str(item.get("title", item.get("name", "Untitled"))),
                    snippet=str(item.get("snippet", item.get("content", item.get("text", "")))),
                    score=float(item.get("score", item.get("_score", 1.0))),
                )
            )
    return SearchResult(hits=hits)
