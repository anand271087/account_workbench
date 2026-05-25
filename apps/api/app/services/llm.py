"""Central LLM helper — picks Bifrost gateway > Anthropic direct > stub.

Stakeholder ask (2026-05-22): switch from our personal Anthropic API key to
Beroe's internal Bifrost gateway so the workbench rides on shared infra.

The gateway exposes a fully OpenAI-compatible `/v1/chat/completions`
endpoint. We use plain `httpx` against it so we don't take a hard
dependency on the `openai` SDK (Anthropic SDK is already in the venv;
adding another LLM SDK is friction we don't need).

Routing:

  1. If `AI_GATEWAY_URL` is set → use Bifrost. Model from
     `AI_GATEWAY_MODEL` (default `bedrock/eu.anthropic.claude-sonnet-4-7-…`).
  2. Else if `ANTHROPIC_API_KEY` is set → fall back to direct Anthropic SDK.
     This lets local dev keep working without the SSM tunnel.
  3. Else → raise `NoLLMConfigured`. Callers should already be catching this
     and falling back to their per-feature stub generator.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)


class NoLLMConfigured(RuntimeError):
    """Raised when neither the gateway nor Anthropic is configured."""


def _gateway_call(
    *,
    system: str,
    user_content: str,
    max_tokens: int,
    temperature: float,
    timeout: float,
) -> str:
    """Call Bifrost via OpenAI-compatible REST. Returns the response text."""
    settings = get_settings()
    if not settings.ai_gateway_url:
        raise NoLLMConfigured("AI_GATEWAY_URL not set")

    headers = {"Content-Type": "application/json"}
    # The gateway accepts api_key="dummy" because auth lives in its dashboard.
    # If the caller pinned an x-bf-ak (key) we forward it as a Bifrost auth
    # header — matches the prod curl spec the stakeholder shared.
    if settings.ai_gateway_api_key:
        headers["x-bf-ak"] = settings.ai_gateway_api_key.get_secret_value()

    payload: dict[str, Any] = {
        "model": settings.ai_gateway_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    r = httpx.post(
        settings.ai_gateway_url.rstrip("/") + "/chat/completions",
        headers=headers,
        json=payload,
        timeout=timeout,
    )
    r.raise_for_status()
    body = r.json()
    try:
        return str(body["choices"][0]["message"]["content"] or "")
    except (KeyError, IndexError, TypeError) as e:
        log.warning("gateway response missing choices: %s — raw=%s", e, body)
        return ""


def _anthropic_call(
    *,
    system: str,
    user_content: str,
    max_tokens: int,
    temperature: float,
) -> str:
    """Direct Anthropic SDK fallback."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise NoLLMConfigured("ANTHROPIC_API_KEY not set")

    from anthropic import Anthropic  # type: ignore

    client = Anthropic(api_key=settings.anthropic_api_key.get_secret_value())
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        messages=[{"role": "user", "content": user_content}],
    )
    return "".join(
        b.text for b in msg.content if getattr(b, "type", "") == "text"
    )


def chat_text(
    *,
    system: str,
    user_content: str | dict | list,
    max_tokens: int = 1024,
    temperature: float = 0.3,
    timeout: float = 60.0,
) -> str:
    """Single chat-completion call. Returns the raw response text.

    `user_content` may be a string, dict, or list — non-strings get
    JSON-serialised so the prompt receives a faithful representation.
    """
    if not isinstance(user_content, str):
        user_content = json.dumps(user_content, default=str)

    settings = get_settings()
    # 1. Gateway first if configured.
    if settings.ai_gateway_url:
        return _gateway_call(
            system=system,
            user_content=user_content,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=timeout,
        )
    # 2. Anthropic direct fallback.
    if settings.anthropic_api_key:
        return _anthropic_call(
            system=system,
            user_content=user_content,
            max_tokens=max_tokens,
            temperature=temperature,
        )
    raise NoLLMConfigured(
        "No LLM configured — set AI_GATEWAY_URL or ANTHROPIC_API_KEY"
    )


def is_configured() -> bool:
    """True if some LLM backend is reachable (gateway or Anthropic)."""
    settings = get_settings()
    return bool(settings.ai_gateway_url or settings.anthropic_api_key)


def backend_label() -> str:
    """Human-readable label for the active backend — used in stub badges
    (`is_stub=True` only when neither backend is configured)."""
    settings = get_settings()
    if settings.ai_gateway_url:
        return f"bifrost:{settings.ai_gateway_model}"
    if settings.anthropic_api_key:
        return f"anthropic:{settings.anthropic_model}"
    return "stub"
