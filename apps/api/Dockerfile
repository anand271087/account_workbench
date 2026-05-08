# Multi-stage Dockerfile.
# Same image runs the API or the Celery worker — set CMD via docker-compose.
FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# OS packages: libmagic for python-magic, plus build essentials for any wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast, reproducible Python pkg manager)
COPY --from=ghcr.io/astral-sh/uv:0.5.0 /uv /usr/local/bin/uv

# Dependency layer (cached unless pyproject changes)
COPY pyproject.toml ./
RUN uv pip install --system -e .

# Application code
COPY app ./app

# Non-root user
RUN useradd -m -u 1000 awb && chown -R awb:awb /app
USER awb

EXPOSE 8000

# Default: run the API. docker-compose overrides for the worker.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
