import pytest
from fastapi.testclient import TestClient

from zordms_ai.app import create_app
from zordms_ai.settings import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(
        database_url="sqlite+pysqlite:///:memory:",
        vllm_base_url="http://vllm.test/v1",
        vllm_api_key="EMPTY",
        classifier_model="granite-3.2-vision-2b",
        extractor_model="qwen2.5-vl-7b",
        inference_mode="cpu_degraded",
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))
