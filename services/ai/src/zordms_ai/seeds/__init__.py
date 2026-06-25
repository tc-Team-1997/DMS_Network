"""Seed package for ZorDMS AI service.

Call ``seed_dev_data(session_factory)`` once at startup in non-production
environments to populate the DB with believable Bhutan-bank sample data.
"""

from zordms_ai.seeds.review_queue import seed_review_queue

__all__ = ["seed_review_queue"]
