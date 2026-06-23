from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+pysqlite:///:memory:"
    vllm_base_url: str = "http://vllm:8000/v1"
    vllm_api_key: str = "EMPTY"
    classifier_model: str = "granite-3.2-vision-2b"
    extractor_model: str = "qwen2.5-vl-7b"
    inference_mode: Literal["gpu", "cpu_degraded"] = "gpu"
    request_timeout_s: float = 8.0
    review_low_conf_threshold: float = 0.85
    # Shared secret for HS256 JWT verification (must match gateway JWT_SECRET)
    jwt_secret: str = "change-me-in-production"

    @property
    def is_degraded(self) -> bool:
        return self.inference_mode == "cpu_degraded"


@lru_cache
def get_settings() -> Settings:
    return Settings()
