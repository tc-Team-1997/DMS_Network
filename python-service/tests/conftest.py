"""Shared pytest configuration for python-service tests.

Sets critical environment variables before any test module is imported,
preventing inter-file env-var ordering issues when pytest collects all
test files in a single process.
"""
import os

# These must be set before app.config.settings is instantiated.
# setdefault is safe — won't override if already present in the shell env.
os.environ.setdefault("API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./storage/test.db")

# Ensure no real notification credentials are active during unit tests.
# This prevents accidental emails / SMS if a dev has local creds in their env.
_NOTIFY_KEYS = (
    "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
    "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "TWILIO_WA_FROM",
)
for _k in _NOTIFY_KEYS:
    os.environ.pop(_k, None)
