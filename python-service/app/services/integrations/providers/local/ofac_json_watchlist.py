"""OfacJsonWatchlist — loads a static JSON watchlist file for AML name screening.

File format (array of objects):
    [
      {
        "name": str,
        "aliases": [str],          # optional
        "dob": str | null,         # ISO-8601 date
        "country": str | null,     # ISO-3166-1 alpha-2
        "list_version": str,       # e.g. "OFAC-20240101"
        "list_id": str             # unique entry identifier
      },
      ...
    ]

The path is read from tenant_config namespace 'aml' key 'watchlist.path' on
every call. Defaults to /var/dms/watchlists/ofac.json when unconfigured.

Matching algorithm: case-insensitive substring check first (O(n) fast path),
then difflib.SequenceMatcher ratio for entries that pass the substring gate.
python-Levenshtein is NOT required. Minimum score threshold: 0.70.

Implementations must re-read tenant_config on every call.
The registry caches the provider instance, not its config.
"""
from __future__ import annotations

import difflib
import json
import logging
import unicodedata
from pathlib import Path
from typing import Optional

from ...providers_base import WatchlistHit, WatchlistProvider, WatchlistVersion

log = logging.getLogger(__name__)

_DEFAULT_PATH = "/var/dms/watchlists/ofac.json"
_MIN_SCORE = 0.70


def _normalize(name: str) -> str:
    """NFKD-normalise, strip non-ASCII, lowercase, collapse whitespace."""
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode("ascii")
    return " ".join(s.lower().split())


class OfacJsonWatchlist(WatchlistProvider):
    """Sanctions/PEP watchlist provider backed by a static local JSON file.

    The file is loaded fresh on every search() call so hot-swapping the JSON
    file (e.g. quarterly air-gap bundle update) takes effect immediately without
    a process restart.

    Scoring uses difflib.SequenceMatcher (Ratcliff/Obershelp) which gives
    character-level similarity. The threshold is 0.70 — adjust via a future
    tenant_config key 'aml.watchlist.threshold' if needed.

    No database writes are performed; this provider is read-only.
    """

    def __init__(self, db=None, tenant_id: str = "default") -> None:
        self._db = db
        self._tenant_id = tenant_id

    def _watchlist_path(self) -> Path:
        """Resolve watchlist file path from tenant_config, falling back to default."""
        if self._db is not None:
            try:
                from app.services.tenant_config import get as cfg_get
                path = cfg_get(
                    self._db,
                    self._tenant_id,
                    "aml",
                    "watchlist.path",
                    default=_DEFAULT_PATH,
                )
                return Path(str(path))
            except Exception:
                pass
        return Path(_DEFAULT_PATH)

    def _load_entries(self) -> list[dict]:
        """Load and parse the watchlist JSON file. Returns [] on any error."""
        path = self._watchlist_path()
        if not path.exists():
            log.warning(
                "OfacJsonWatchlist: watchlist file not found at %s — "
                "returning empty results. Set 'aml.watchlist.path' in "
                "tenant_config or place a file at the default path.",
                path,
            )
            return []
        try:
            with path.open(encoding="utf-8") as fh:
                return json.load(fh)
        except Exception as exc:
            log.error("OfacJsonWatchlist: failed to parse %s: %s", path, exc)
            return []

    def search(
        self,
        name: str,
        *,
        dob: Optional[str] = None,
        country: Optional[str] = None,
    ) -> list[WatchlistHit]:
        """Search for *name* in the watchlist using substring + similarity scoring.

        Algorithm:
          1. Normalise *name* to ASCII-lowercase.
          2. For each entry (plus all aliases), check if the probe is a
             substring of the entry OR if difflib.SequenceMatcher ratio >= 0.70.
          3. Optionally filter by dob / country when both probe and entry have values.
          4. Return hits sorted by descending score.
        """
        if not name or not name.strip():
            return []

        probe = _normalize(name)
        entries = self._load_entries()
        hits: list[WatchlistHit] = []

        for entry in entries:
            candidates: list[str] = [entry.get("name", "")]
            candidates.extend(entry.get("aliases", []) or [])

            best_score = 0.0
            for candidate in candidates:
                if not candidate:
                    continue
                norm_cand = _normalize(candidate)
                # Fast substring path.
                if probe in norm_cand or norm_cand in probe:
                    score = 1.0
                else:
                    score = difflib.SequenceMatcher(None, probe, norm_cand).ratio()
                if score > best_score:
                    best_score = score

            if best_score < _MIN_SCORE:
                continue

            # Optional DOB filter — only apply when both sides have a value.
            entry_dob = entry.get("dob")
            if dob and entry_dob and dob != entry_dob:
                continue

            # Optional country filter.
            entry_country = entry.get("country")
            if country and entry_country and country.upper() != entry_country.upper():
                continue

            hits.append(WatchlistHit(
                name=entry.get("name", ""),
                list_id=str(entry.get("list_id", "")),
                list_version=str(entry.get("list_version", "")),
                score=round(best_score, 4),
                dob=entry_dob,
                country=entry_country,
                aliases=list(entry.get("aliases", []) or []),
            ))

        hits.sort(key=lambda h: h.score, reverse=True)
        return hits

    def list_versions(self) -> list[WatchlistVersion]:
        """Return the distinct list_version values present in the loaded file."""
        entries = self._load_entries()
        version_counts: dict[str, int] = {}
        for entry in entries:
            v = str(entry.get("list_version", "unknown"))
            version_counts[v] = version_counts.get(v, 0) + 1

        return [
            WatchlistVersion(version=v, entry_count=c)
            for v, c in sorted(version_counts.items())
        ]
