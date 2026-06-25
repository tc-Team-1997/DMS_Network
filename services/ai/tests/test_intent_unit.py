"""Micro-level unit tests for copilot.intent.detect_intent.

These exercise edge/ordering cases directly against the function (not the
API), complementing the API-level intent tests in test_copilot.py.
"""
from __future__ import annotations

import pytest

from zordms_ai.copilot.intent import detect_intent


# ── Empty / whitespace / non-keyword input falls through to the qa default ──

@pytest.mark.parametrize("question", ["", "   ", "\n\t", "hello", "blue elephant 42"])
def test_detect_intent_defaults_to_qa(question: str):
    assert detect_intent(question) == "qa"


# ── Case-insensitivity: the implementation lowercases, so uppercase must match ──

def test_detect_intent_is_case_insensitive():
    assert detect_intent("FIND ALL EXPIRED DOCUMENTS") == "search"
    assert detect_intent("Navigate To The Dashboard Screen") == "navigate"


# ── Ordering / specificity: navigate rules are checked before summarize/search ──

def test_navigate_wins_over_search_when_both_match():
    # "open" (navigate) + "page" (navigate) both present alongside "find"/"documents"
    # navigate is earliest in the rule list, so it wins.
    q = "open the page where I can find documents"
    assert detect_intent(q) == "navigate"


def test_summarize_wins_over_search_when_both_match():
    # "overview" (summarize) appears before search rules; no navigate keywords.
    q = "give me an overview and find the recent reports"
    assert detect_intent(q) == "summarize"


# ── navigate requires BOTH a verb pattern AND a screen-noun pattern? No — the
#    rule list uses any-match across a rule's patterns, so a single screen noun
#    is enough to trigger navigate. Document that behaviour. ──

def test_navigate_triggers_on_screen_noun_alone():
    assert detect_intent("the dashboard is slow today") == "navigate"


# ── search edge cases: expiry / missing language ──

@pytest.mark.parametrize("question", [
    "list documents without a signature",
    "which files are expiring soon",
    "locate the missing records",
    "show all submissions lacking a CID",
])
def test_search_keywords(question: str):
    assert detect_intent(question) == "search"


# ── summarize edge: 'recap' / 'highlight' / 'brief' single keywords ──

@pytest.mark.parametrize("question", [
    "recap of the meeting",
    "highlight the key points",
    "a brief on the new policy",
])
def test_summarize_keywords(question: str):
    assert detect_intent(question) == "summarize"


# ── qa: plain analytical questions with no trigger keywords ──

@pytest.mark.parametrize("question", [
    "why does retention matter",
    "explain the difference between AUTO and HUMAN_REVIEW",
])
def test_qa_default_for_analytical_questions(question: str):
    assert detect_intent(question) == "qa"
