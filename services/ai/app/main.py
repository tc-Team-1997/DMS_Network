from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="ZorDMS AI/IDP Service", version="0.0.0")

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


app = create_app()
