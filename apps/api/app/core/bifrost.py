"""Bifrost gateway — internal AI service running in a private VPC.

Same SSM-tunnel pattern as `app/core/redshift.py` — the difference is
which SSM document we use:

  * Redshift   → AWS-StartPortForwardingSessionToRemoteHost
                 (jump through bastion to the cluster endpoint)
  * Bifrost    → AWS-StartPortForwardingSession
                 (direct EC2 port-forward — Bifrost runs on the target)

Bifrost is reachable on port 8087 on the EC2 host. Once the tunnel is
up, the app hits `http://localhost:8087/...` like any HTTP service.

Lifecycle (wired in app/main.py lifespan):
  1. on startup → start_tunnel() spawns the `aws ssm` subprocess
  2. wait_for_tunnel() polls localhost:port for ~30s
  3. Application starts serving
  4. on shutdown → stop_tunnel() SIGTERMs the subprocess

Three deployment shapes, all driven by env vars (no code change):

  (A) Local laptop / Render (outside VPC):
      BIFROST_AUTOSTART_TUNNEL=true + BIFROST_SSM_TARGET + AWS creds.
      Set AI_GATEWAY_URL=http://localhost:8087/v1. Tunnel auto-spawns.

  (B) Production inside the VPC (future):
      BIFROST_AUTOSTART_TUNNEL=false. Set AI_GATEWAY_URL to the
      in-VPC endpoint (e.g. http://bifrost.beroe.internal:8087/v1).
      No tunnel needed.

  (C) Bifrost not configured:
      Leave BIFROST_SSM_TARGET unset + AI_GATEWAY_URL unset. The LLM
      helper falls back to direct Anthropic (or stubs).

Mirror Redshift's smoke_test() so the bootstrap log shows a clear
ok / fail line on startup.
"""

from __future__ import annotations

import logging
import os
import shutil
import signal
import socket
import subprocess
import time

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_tunnel_proc: subprocess.Popen | None = None


# ============================================================
# Tunnel lifecycle
# ============================================================


def _port_is_open(host: str, port: int, timeout: float = 1.0) -> bool:
    """Return True if a TCP SYN to host:port gets accepted."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def start_tunnel() -> None:
    """Spawn `aws ssm start-session` as a child process for Bifrost.

    No-ops if:
      * autostart is disabled,
      * BIFROST_BASE_URL is set (deployment shape B — VPC-direct, no tunnel),
      * required settings are missing,
      * the local port is already accepting (tunnel already open).
    """
    global _tunnel_proc
    s = get_settings()

    if not s.bifrost_autostart_tunnel:
        logger.info("Bifrost tunnel auto-start disabled (BIFROST_AUTOSTART_TUNNEL=false).")
        return
    if not s.bifrost_ssm_target:
        logger.info("Bifrost tunnel skipped — BIFROST_SSM_TARGET not set.")
        return
    # If AI_GATEWAY_URL points anywhere other than localhost, the user
    # has wired up a direct VPC route (deployment shape B). Don't open
    # a tunnel for a gateway the app can already reach.
    if s.ai_gateway_url and "localhost" not in s.ai_gateway_url and "127.0.0.1" not in s.ai_gateway_url:
        logger.info(
            "Bifrost tunnel skipped — AI_GATEWAY_URL=%s is non-local (VPC-direct mode).",
            s.ai_gateway_url,
        )
        return

    if _port_is_open("127.0.0.1", s.bifrost_ssm_local_port, timeout=0.5):
        logger.info(
            "Bifrost tunnel already listening on localhost:%d — reusing.",
            s.bifrost_ssm_local_port,
        )
        return

    if shutil.which("aws") is None:
        logger.warning("aws CLI not found in PATH — cannot start Bifrost tunnel.")
        return
    if shutil.which("session-manager-plugin") is None:
        logger.warning(
            "session-manager-plugin binary not found — install it from "
            "https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html"
        )
        return

    # Bifrost uses the simpler `AWS-StartPortForwardingSession` doc
    # (direct EC2 port-forward). Parameters are JSON-encoded per the
    # exact command the user shared:
    #   '{"portNumber":["8087"],"localPortNumber":["8087"]}'
    import json
    params = json.dumps({
        "portNumber": [str(s.bifrost_ssm_remote_port)],
        "localPortNumber": [str(s.bifrost_ssm_local_port)],
    })

    # Region + profile may be Bifrost-specific (e.g. `bifrost-dev`
    # profile in a different region than the Redshift creds). Fall back
    # to the shared AWS_* settings when not overridden.
    region = s.bifrost_aws_region or s.aws_default_region
    profile = s.bifrost_aws_profile or s.aws_profile

    cmd = [
        "aws", "ssm", "start-session",
        "--target", s.bifrost_ssm_target,
        "--document-name", s.bifrost_ssm_document,
        "--parameters", params,
        "--region", region,
    ]
    if profile:
        cmd.extend(["--profile", profile])

    # Pass AWS creds to subprocess env. Bifrost may have its own creds
    # distinct from the Redshift ones, hence the parallel set.
    env = os.environ.copy()
    if s.bifrost_aws_access_key_id:
        env["AWS_ACCESS_KEY_ID"] = s.bifrost_aws_access_key_id.get_secret_value()
    elif s.aws_access_key_id:
        env["AWS_ACCESS_KEY_ID"] = s.aws_access_key_id.get_secret_value()
    if s.bifrost_aws_secret_access_key:
        env["AWS_SECRET_ACCESS_KEY"] = s.bifrost_aws_secret_access_key.get_secret_value()
    elif s.aws_secret_access_key:
        env["AWS_SECRET_ACCESS_KEY"] = s.aws_secret_access_key.get_secret_value()
    env["AWS_DEFAULT_REGION"] = region
    if profile:
        env["AWS_PROFILE"] = profile

    logger.info(
        "Starting Bifrost SSM tunnel → ec2:%d via target %s (region=%s, profile=%s) …",
        s.bifrost_ssm_remote_port,
        s.bifrost_ssm_target,
        region,
        profile or "<default>",
    )
    try:
        _tunnel_proc = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to spawn Bifrost SSM tunnel: %s", exc)
        return

    deadline = time.time() + 30.0
    while time.time() < deadline:
        if _port_is_open("127.0.0.1", s.bifrost_ssm_local_port, timeout=0.5):
            logger.info(
                "Bifrost tunnel up on localhost:%d (pid %d).",
                s.bifrost_ssm_local_port,
                _tunnel_proc.pid,
            )
            return
        if _tunnel_proc.poll() is not None:
            err = b""
            if _tunnel_proc.stderr is not None:
                err = _tunnel_proc.stderr.read() or b""
            logger.error(
                "Bifrost SSM tunnel exited prematurely (code %s): %s",
                _tunnel_proc.returncode,
                err.decode("utf-8", "replace")[:500],
            )
            _tunnel_proc = None
            return
        time.sleep(0.5)

    logger.warning(
        "Bifrost tunnel did not come up within 30s; subprocess kept running. "
        "Manual check: nc -z localhost %d",
        s.bifrost_ssm_local_port,
    )


def ensure_tunnel() -> bool:
    """Self-heal — if local port is dead, re-spawn the SSM tunnel.

    Idempotent. Returns True if the tunnel is up after this call.
    Skipped (returns True) when AI_GATEWAY_URL points to a non-local
    host (VPC-direct mode — no tunnel needed).
    """
    s = get_settings()
    if s.ai_gateway_url and "localhost" not in s.ai_gateway_url and "127.0.0.1" not in s.ai_gateway_url:
        return True
    if _port_is_open("127.0.0.1", s.bifrost_ssm_local_port, timeout=0.5):
        return True
    logger.warning(
        "Bifrost tunnel dropped — port %d not listening. Re-spawning…",
        s.bifrost_ssm_local_port,
    )
    global _tunnel_proc
    if _tunnel_proc is not None and _tunnel_proc.poll() is not None:
        _tunnel_proc = None
    start_tunnel()
    return _port_is_open("127.0.0.1", s.bifrost_ssm_local_port, timeout=0.5)


def stop_tunnel() -> None:
    """Terminate the Bifrost SSM tunnel subprocess on FastAPI shutdown."""
    global _tunnel_proc
    if _tunnel_proc is None:
        return
    try:
        os.killpg(os.getpgid(_tunnel_proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not stop Bifrost SSM tunnel: %s", exc)
    finally:
        _tunnel_proc = None


# ============================================================
# Client
# ============================================================


def get_probe_url() -> str | None:
    """Return the URL the smoke test should hit, or None if Bifrost is off.

    Falls through in this order:
      1. AI_GATEWAY_URL (set by deployment) — strip path component, hit root
      2. http://<bifrost_host>:<bifrost_port> (default localhost:8087)
      3. None when neither tunnel target nor gateway URL is set
    """
    s = get_settings()
    if s.ai_gateway_url:
        # AI_GATEWAY_URL usually ends with "/v1" — strip to get the host root.
        url = s.ai_gateway_url.rstrip("/")
        if url.endswith("/v1"):
            url = url[:-3]
        return url
    if s.bifrost_ssm_target:
        return f"http://{s.bifrost_host}:{s.bifrost_port}"
    return None


def smoke_test(timeout: float = 5.0) -> tuple[bool, str]:
    """Hit `GET /health` (or `/`) to confirm Bifrost responds.

    Returns (ok, message). Never raises — safe to call from startup.
    Mirrors Redshift's smoke_test contract.
    """
    s = get_settings()
    base = get_probe_url()
    if base is None:
        return (False, "Bifrost not configured (BIFROST_SSM_TARGET / AI_GATEWAY_URL unset).")

    try:
        import httpx
        headers: dict[str, str] = {}
        if s.ai_gateway_api_key:
            headers["x-bf-ak"] = s.ai_gateway_api_key.get_secret_value()
        with httpx.Client(timeout=timeout) as client:
            for path in ("/health", "/"):
                try:
                    r = client.get(f"{base}{path}", headers=headers)
                except httpx.RequestError as exc:
                    return (False, f"Connect failed at {base}{path}: {exc}")
                if r.status_code < 500:
                    return (True, f"Bifrost {path} → HTTP {r.status_code} ({len(r.content)} bytes)")
        return (False, "Bifrost responded with 5xx on both /health and /.")
    except Exception as exc:  # noqa: BLE001
        return (False, f"Bifrost smoke test crashed: {exc}")
