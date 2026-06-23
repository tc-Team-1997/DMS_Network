from fastapi import FastAPI

from zordms_ai.api.idp import idp_router
from zordms_ai.api.ocr import ocr_router
from zordms_ai.api.review import review_router
from zordms_ai.classify.classifier import Classifier
from zordms_ai.db import Base, make_engine, make_session_factory
from zordms_ai.extract.extractor import Extractor
from zordms_ai.inference.vllm_client import VLLMClient
from zordms_ai.pipeline.orchestrator import Orchestrator
from zordms_ai.review import models as _review_models  # noqa: F401 — registers ReviewItem with Base
from zordms_ai.settings import Settings, get_settings


def make_components(settings: Settings):
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)
    vllm = VLLMClient(settings.vllm_base_url, settings.vllm_api_key, settings.request_timeout_s)
    classifier = Classifier(vllm, settings.classifier_model)
    extractor = Extractor(vllm, settings.extractor_model)
    orchestrator = Orchestrator(classifier, extractor, session_factory)
    return {
        "vllm": vllm,
        "session_factory": session_factory,
        "classifier": classifier,
        "extractor": extractor,
        "orchestrator": orchestrator,
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
    return app
