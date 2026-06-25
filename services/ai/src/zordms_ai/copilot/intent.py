"""Intent classification for the copilot — keyword + heuristic approach.

Classifies a question into one of four intents:
  search    — user wants to find/locate documents
  summarize — user wants a summary or overview
  navigate  — user wants to go to a specific screen / workflow
  qa        — general question answering (default)
"""
from __future__ import annotations

import re

# Ordered by specificity — first match wins.
_RULES: list[tuple[str, list[str]]] = [
    ("navigate", [
        r"\b(go to|navigate|open|show me|take me to|where (is|are)|how do i (access|get to|find the))\b",
        r"\b(screen|page|menu|section|dashboard|tab)\b",
    ]),
    ("summarize", [
        r"\b(summar(y|ize|ise)|overview|brief|recap|highlight|give me an? (idea|gist|summary))\b",
        r"\b(latest|recent|last|yesterday|this (week|month|quarter))\b.*\b(document|submission|report|record)\b",
    ]),
    ("search", [
        r"\b(find|search|look for|locate|list|which|what documents|show all|filter|expir(ing|ed)|missing|without|lack(ing)?)\b",
        r"\b(document[s]?|record[s]?|file[s]?|submission[s]?|report[s]?)\b.{0,40}\b(expir|missing|due|overdue|pending)\b",
    ]),
]
_DEFAULT = "qa"


def detect_intent(question: str) -> str:
    """Return the intent label for *question*."""
    text = question.lower()
    for intent, patterns in _RULES:
        if any(re.search(p, text, re.IGNORECASE) for p in patterns):
            return intent
    return _DEFAULT
