# ZorDMS AI / IDP — FastAPI service image.
# Model weights are NOT baked in; they are mounted from the NFS PVC at runtime
# (air-gap requirement). vLLM runs as a separate GPU pod serving an
# OpenAI-compatible API; this image only needs the HTTP client.
FROM python:3.11-slim AS base

# Tesseract for fallback OCR + poppler for pdf2image
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml ./
COPY src ./src
RUN uv pip install --system --no-cache .[ocr]

ENV INFERENCE_MODE=gpu
EXPOSE 8080
CMD ["uvicorn", "zordms_ai.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080"]
