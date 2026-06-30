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

    # Copilot / RAG settings
    search_url: str = "http://localhost:4004"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    anthropic_model: str = "claude-haiku-4-5"
    openai_model: str = "gpt-4o-mini"

    # ── Ollama local inference (Apple Silicon / M-series) ──────────────────
    # AI_BACKEND: auto | ollama | vllm | mock
    #   auto  = use Ollama when is_available() else fall back to vllm/mock
    #   ollama = always use Ollama (fail loud if not running)
    #   vllm   = always use the remote vLLM endpoint
    #   mock   = no network; deterministic dummy responses (useful in CI)
    ai_backend: Literal["auto", "ollama", "vllm", "mock"] = "auto"
    ollama_base_url: str = "http://localhost:11434"
    ollama_vlm_model: str = "qwen2.5vl:7b"
    ollama_text_model: str = "granite3.3:8b"
    # Generous timeout — first vision call cold-loads a multi-GB model into
    # Metal memory, which far exceeds the 8s vLLM default.
    ollama_timeout_s: float = 180.0

    # §5.4 Semantic search — re-rank copilot retrieval hits by embedding
    # similarity (Ollama). Falls back to keyword order when the model is absent.
    semantic_search_enabled: bool = True
    embed_model: str = "nomic-embed-text"

    @property
    def is_degraded(self) -> bool:
        return self.inference_mode == "cpu_degraded"


@lru_cache
def get_settings() -> Settings:
    return Settings()
