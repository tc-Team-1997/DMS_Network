import jwt
import pytest
from fastapi.testclient import TestClient

from zordms_ai.app import create_app
from zordms_ai.settings import Settings

# Well-known test secret — must match Settings.jwt_secret in test fixtures below
# Must be >= 32 bytes for HS256 (RFC 7518 §3.2)
TEST_JWT_SECRET = "test-secret-do-not-use-in-prod-x1"


def make_token(secret: str = TEST_JWT_SECRET, **extra) -> str:
    """Return a signed HS256 Bearer token for use in tests."""
    payload = {"sub": "test-user", "role": "ai-service", **extra}
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture
def settings() -> Settings:
    return Settings(
        database_url="sqlite+pysqlite:///:memory:",
        vllm_base_url="http://vllm.test/v1",
        vllm_api_key="EMPTY",
        classifier_model="granite-3.2-vision-2b",
        extractor_model="qwen2.5-vl-7b",
        inference_mode="cpu_degraded",
        jwt_secret=TEST_JWT_SECRET,
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Default auth headers carrying a valid test JWT."""
    return {"Authorization": f"Bearer {make_token()}"}
