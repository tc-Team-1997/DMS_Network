from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse

from .config import settings
from .db import Base, engine
from .services import tasks as _tasks_model  # noqa: F401 (registers TaskRun on Base)
from .routers import documents, ocr, workflow, duplicates, integrations, search, dashboard, alerts, signatures, tasks as tasks_router, ws, auth, bi, saml as saml_router, anchor as anchor_router, face as face_router, eforms as eforms_router, siem as siem_router, fraud as fraud_router, vector as vector_router, copilot as copilot_router, portal as portal_router, redaction as redaction_router, retention as retention_router, dsar as dsar_router, cbe as cbe_router, stepup as stepup_router, summarize as summarize_router, customer_risk as customer_risk_router, fx as fx_router, ifrs9 as ifrs9_router, replication as replication_router, provenance as prov_router, campaigns as campaigns_router, aisp as aisp_router, ocr_arabic as ocr_ar_router, dp as dp_router, oidc as oidc_router, adversarial as adversarial_router, encryption as encryption_router, graph as graph_router, voice as voice_router, zkkyc as zk_router, ledger as ledger_router, sustainability as sustainability_router, coach as coach_router, journey as journey_router, live as live_router, usage as usage_router, moderation as moderation_router, remediation as remediation_router, passkeys as passkeys_router, federated as federated_router, watchlist as watchlist_router, covenants as covenants_router, lineage as lineage_router, tenant_keys as tenant_keys_router, abac as abac_router, stamp_search as stamp_router, compliance as compliance_router, workflow_designer as wfd_router, retention_nl as retention_nl_router, test_data as test_data_router, transparency as transparency_router, redteam as redteam_router, doc_diff as doc_diff_router, exec_report as exec_report_router, blast_radius as blast_router, stride as stride_router, lang_router as lang_router_r
from .services import task_handlers  # noqa: F401 (register handlers)
from .services.tasks import start_workers
from .services.metrics import PrometheusMiddleware, metrics_response
from .services.tracing import setup_tracing
from .services.waf import WAFMiddleware
from .services.carbon import CarbonMiddleware
from .services.failpoint import FailpointMiddleware, ENABLED as FAILPOINTS_ON
from .services.usage import UsageMiddleware

Base.metadata.create_all(bind=engine)

app = FastAPI(title=settings.APP_NAME, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)
app.add_middleware(PrometheusMiddleware)
app.add_middleware(WAFMiddleware)
app.add_middleware(CarbonMiddleware)
app.add_middleware(UsageMiddleware)
if FAILPOINTS_ON:
    app.add_middleware(FailpointMiddleware)

BASE_DIR = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


@app.get("/health")
def health():
    return {"status": "ok", "service": settings.APP_NAME, "env": settings.APP_ENV}


@app.get("/metrics")
def metrics():
    return metrics_response()


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html", {"api_key": settings.API_KEY})


app.include_router(documents.router)
app.include_router(ocr.router)
app.include_router(workflow.router)
app.include_router(duplicates.router)
app.include_router(integrations.router)
app.include_router(search.router)
app.include_router(dashboard.router)
app.include_router(alerts.router)
app.include_router(signatures.router)
app.include_router(tasks_router.router)
app.include_router(ws.router)
app.include_router(auth.router)
app.include_router(bi.router)
app.include_router(saml_router.router)
app.include_router(anchor_router.router)
app.include_router(face_router.router)
app.include_router(eforms_router.router)
app.include_router(siem_router.router)
app.include_router(fraud_router.router)
app.include_router(vector_router.router)
app.include_router(copilot_router.router)
app.include_router(portal_router.router)
app.include_router(redaction_router.router)
app.include_router(retention_router.router)
app.include_router(dsar_router.router)
app.include_router(cbe_router.router)
app.include_router(stepup_router.router)
app.include_router(summarize_router.router)
app.include_router(customer_risk_router.router)
app.include_router(fx_router.router)
app.include_router(ifrs9_router.router)
app.include_router(replication_router.router)
app.include_router(prov_router.router)
app.include_router(campaigns_router.router)
app.include_router(aisp_router.router)
app.include_router(ocr_ar_router.router)
app.include_router(dp_router.router)
app.include_router(oidc_router.router)
app.include_router(adversarial_router.router)
app.include_router(encryption_router.router)
app.include_router(graph_router.router)
app.include_router(voice_router.router)
app.include_router(zk_router.router)
app.include_router(ledger_router.router)
app.include_router(sustainability_router.router)
app.include_router(coach_router.router)
app.include_router(journey_router.router)
app.include_router(live_router.router)
app.include_router(usage_router.router)
app.include_router(moderation_router.router)
app.include_router(remediation_router.router)
app.include_router(passkeys_router.router)
app.include_router(federated_router.router)
app.include_router(watchlist_router.router)
app.include_router(covenants_router.router)
app.include_router(lineage_router.router)
app.include_router(tenant_keys_router.router)
app.include_router(abac_router.router)
app.include_router(stamp_router.router)
app.include_router(compliance_router.router)
app.include_router(wfd_router.router)
app.include_router(retention_nl_router.router)
app.include_router(test_data_router.router)
app.include_router(transparency_router.router)
app.include_router(redteam_router.router)
app.include_router(doc_diff_router.router)
app.include_router(exec_report_router.router)
app.include_router(blast_router.router)
app.include_router(stride_router.router)
app.include_router(lang_router_r.router)


setup_tracing(app, engine)


@app.on_event("startup")
async def _startup():
    from .services.queue_rq import is_enabled as _rq_on
    if not _rq_on():
        await start_workers(n=2)
    from .services.remediation import start as start_remediation
    await start_remediation()
