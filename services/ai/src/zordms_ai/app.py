import logging

from fastapi import FastAPI

from zordms_ai.api.copilot import copilot_router
from zordms_ai.api.compliance import compliance_router
from zordms_ai.api.translate import translate_router
from zordms_ai.api.fraud import fraud_router
from zordms_ai.api.idp import idp_router
from zordms_ai.api.ocr import ocr_router
from zordms_ai.api.review import review_router
from zordms_ai.classify.classifier import Classifier
from zordms_ai.classify.field_inference import FieldInferer
from zordms_ai.db import Base, make_engine, make_session_factory
from zordms_ai.extract.extractor import Extractor
from zordms_ai.inference.ollama_adapter import OllamaVisionAdapter
from zordms_ai.inference import ollama_client
from zordms_ai.inference.vllm_client import VLLMClient
from zordms_ai.pipeline.orchestrator import Orchestrator
from zordms_ai.review import models as _review_models  # noqa: F401 — registers ReviewItem with Base
from zordms_ai.seeds import seed_review_queue
from zordms_ai.settings import Settings, get_settings

logger = logging.getLogger(__name__)


def _resolve_vision_client(settings: Settings):
    """Return the vision inference client based on AI_BACKEND resolution.

    Resolution order for "auto":
      1. If Ollama is reachable -> OllamaVisionAdapter
      2. Otherwise -> VLLMClient (existing path)

    For "ollama"  -> always OllamaVisionAdapter
    For "vllm"    -> always VLLMClient
    For "mock"    -> VLLMClient pointing at vllm_base_url (tests mock HTTP)
    """
    backend = settings.ai_backend

    if backend == "ollama" or (
        backend == "auto"
        and ollama_client.is_available(settings.ollama_base_url)
    ):
        logger.info(
            "AI backend: ollama (model=%s, url=%s)",
            settings.ollama_vlm_model,
            settings.ollama_base_url,
        )
        return OllamaVisionAdapter(
            base_url=settings.ollama_base_url,
            vlm_model=settings.ollama_vlm_model,
            timeout_s=settings.ollama_timeout_s,
        )

    logger.info(
        "AI backend: vllm (url=%s)",
        settings.vllm_base_url,
    )
    return VLLMClient(settings.vllm_base_url, settings.vllm_api_key, settings.request_timeout_s)


def make_components(settings: Settings):
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)
    # Populate the review queue with realistic Bhutan-bank sample data on
    # every startup.  The call is idempotent — rows are only inserted when
    # none of the seed doc_ids already exist in the table.
    seed_review_queue(session_factory)
    vision_client = _resolve_vision_client(settings)
    # Classifier uses the VLM model; pass the resolved model name for Ollama,
    # or the existing classifier_model for vLLM (VLLMClient ignores the model
    # field on the adapter — it's embedded in OllamaVisionAdapter).
    classifier = Classifier(vision_client, settings.ollama_vlm_model if isinstance(vision_client, OllamaVisionAdapter) else settings.classifier_model)
    extractor = Extractor(vision_client, settings.ollama_vlm_model if isinstance(vision_client, OllamaVisionAdapter) else settings.extractor_model)
    orchestrator = Orchestrator(classifier, extractor, session_factory)
    field_inferer = FieldInferer(
        vision_client,
        settings.ollama_vlm_model
        if isinstance(vision_client, OllamaVisionAdapter)
        else settings.extractor_model,
    )
    return {
        "vllm": vision_client,
        "session_factory": session_factory,
        "classifier": classifier,
        "extractor": extractor,
        "orchestrator": orchestrator,
        "field_inferer": field_inferer,
    }


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="ZorDMS AI / IDP", version="0.1.0")
    app.state.settings = settings
    for key, value in make_components(settings).items():
        setattr(app.state, key, value)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "ai-idp", "mode": settings.inference_mode}

    app.include_router(ocr_router)
    app.include_router(idp_router)
    app.include_router(review_router)
    app.include_router(compliance_router)
    app.include_router(translate_router)
    app.include_router(fraud_router)
    app.include_router(copilot_router)
    return app
