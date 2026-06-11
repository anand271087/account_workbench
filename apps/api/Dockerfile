# Multi-stage Dockerfile.
# Same image runs the API or the Celery worker — set CMD via docker-compose.
FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# OS packages: libmagic for python-magic, plus aws CLI + SSM plugin so the
# Redshift SSM port-forward tunnel can start at lifespan time (same code
# path as local dev — see app/core/redshift.py:start_tunnel).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# AWS CLI v2 (multi-arch detect)
RUN ARCH="$(uname -m)" \
 && case "$ARCH" in \
      x86_64)  AWS_PKG="awscli-exe-linux-x86_64.zip" ;; \
      aarch64) AWS_PKG="awscli-exe-linux-aarch64.zip" ;; \
      *) echo "unsupported arch $ARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://awscli.amazonaws.com/$AWS_PKG" -o /tmp/awscliv2.zip \
 && unzip -q /tmp/awscliv2.zip -d /tmp \
 && /tmp/aws/install --update \
 && rm -rf /tmp/aws /tmp/awscliv2.zip

# session-manager-plugin (required by `aws ssm start-session`)
RUN ARCH="$(uname -m)" \
 && case "$ARCH" in \
      x86_64)  SMP_URL="https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" ;; \
      aarch64) SMP_URL="https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_arm64/session-manager-plugin.deb" ;; \
      *) echo "unsupported arch $ARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "$SMP_URL" -o /tmp/smp.deb \
 && dpkg -i /tmp/smp.deb \
 && rm /tmp/smp.deb

# Install uv (fast, reproducible Python pkg manager)
COPY --from=ghcr.io/astral-sh/uv:0.5.0 /uv /usr/local/bin/uv

# Dependency layer (cached unless pyproject/lock changes).
# Use uv sync --frozen for a reproducible env matching local dev.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Application code
COPY app ./app

# Non-root user
RUN useradd -m -u 1000 awb && chown -R awb:awb /app
USER awb

EXPOSE 8000

# Default: run the API. docker-compose.prod.yml overrides CMD for the worker container.
CMD [".venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
