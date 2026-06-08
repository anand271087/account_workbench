"""Redshift connection — backbone for Intelligence & Reports.

The cluster sits in a private VPC. We reach it the same way the Bifrost
AI gateway is reached: an `aws ssm start-session` port-forwarding tunnel
from this host to a bastion EC2, which itself forwards to the actual
Redshift endpoint via the `AWS-StartPortForwardingSessionToRemoteHost`
document. Once the tunnel is up, `redshift-connector` talks to
`localhost:5439` and the app code never sees the bastion.

Lifecycle (wired in app/main.py lifespan):
  1. on startup → start_tunnel() spawns the `aws ssm` subprocess.
  2. wait_for_tunnel() polls localhost:port for ~30s until it accepts.
  3. Application starts serving.
  4. on shutdown → stop_tunnel() SIGTERMs the subprocess.

Skipping the tunnel:
  * Set REDSHIFT_AUTOSTART_TUNNEL=false in apps/api/.env. The tunnel
    step becomes a no-op; you can open the tunnel manually OR point
    REDSHIFT_HOST at a publicly-reachable cluster.
  * If REDSHIFT_DB is unset, the whole module no-ops — Intelligence &
    Reports falls back to the platform_intel jsonb seeds.
"""

from __future__ import annotations

import logging
import os
import shutil
import signal
import socket
import subprocess
import time
from typing import TYPE_CHECKING

from app.core.config import get_settings

if TYPE_CHECKING:
    import redshift_connector  # type: ignore[import-not-found]

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
    """Spawn `aws ssm start-session` as a child process.

    No-ops if:
      * autostart is disabled,
      * required settings are missing,
      * the local port is already accepting (tunnel already open).
    """
    global _tunnel_proc
    s = get_settings()

    if not s.redshift_autostart_tunnel:
        logger.info("Redshift tunnel auto-start disabled (REDSHIFT_AUTOSTART_TUNNEL=false).")
        return
    if not s.redshift_ssm_target or not s.redshift_ssm_remote_host:
        logger.info(
            "Redshift tunnel skipped — REDSHIFT_SSM_TARGET or "
            "REDSHIFT_SSM_REMOTE_HOST not set."
        )
        return

    # Already up?
    if _port_is_open("127.0.0.1", s.redshift_ssm_local_port, timeout=0.5):
        logger.info(
            "Redshift tunnel already listening on localhost:%d — reusing.",
            s.redshift_ssm_local_port,
        )
        return

    if shutil.which("aws") is None:
        logger.warning("aws CLI not found in PATH — cannot start Redshift tunnel.")
        return
    if shutil.which("session-manager-plugin") is None:
        logger.warning(
            "session-manager-plugin binary not found — install it from "
            "https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html"
        )
        return

    cmd = [
        "aws", "ssm", "start-session",
        "--target", s.redshift_ssm_target,
        "--document-name", s.redshift_ssm_document,
        "--parameters", (
            f"host={s.redshift_ssm_remote_host},"
            f"portNumber={s.redshift_ssm_remote_port},"
            f"localPortNumber={s.redshift_ssm_local_port}"
        ),
    ]

    # Pass AWS creds + region to the subprocess. Boto3 / aws CLI both
    # read these from the environment.
    env = os.environ.copy()
    if s.aws_access_key_id:
        env["AWS_ACCESS_KEY_ID"] = s.aws_access_key_id.get_secret_value()
    if s.aws_secret_access_key:
        env["AWS_SECRET_ACCESS_KEY"] = s.aws_secret_access_key.get_secret_value()
    if s.aws_default_region:
        env["AWS_DEFAULT_REGION"] = s.aws_default_region
    if s.aws_profile:
        env["AWS_PROFILE"] = s.aws_profile

    logger.info(
        "Starting Redshift SSM tunnel → %s:%d via bastion %s …",
        s.redshift_ssm_remote_host,
        s.redshift_ssm_remote_port,
        s.redshift_ssm_target,
    )
    try:
        _tunnel_proc = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            start_new_session=True,  # detach from FastAPI's signal group
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to spawn SSM tunnel: %s", exc)
        return

    # Block briefly until the local port accepts or we give up.
    deadline = time.time() + 30.0
    while time.time() < deadline:
        if _port_is_open("127.0.0.1", s.redshift_ssm_local_port, timeout=0.5):
            logger.info(
                "Redshift tunnel up on localhost:%d (pid %d).",
                s.redshift_ssm_local_port,
                _tunnel_proc.pid,
            )
            return
        # Did the process die already? Log stderr if so.
        if _tunnel_proc.poll() is not None:
            err = b""
            if _tunnel_proc.stderr is not None:
                err = _tunnel_proc.stderr.read() or b""
            logger.error(
                "SSM tunnel exited prematurely (code %s): %s",
                _tunnel_proc.returncode,
                err.decode("utf-8", "replace")[:500],
            )
            _tunnel_proc = None
            return
        time.sleep(0.5)

    logger.warning(
        "Redshift tunnel did not come up within 30s; will keep the subprocess "
        "running in case it's slow to bind. Manual check: nc -z localhost %d",
        s.redshift_ssm_local_port,
    )


def ensure_tunnel() -> bool:
    """Self-heal: if port 5439 isn't listening, restart the SSM tunnel.

    Idempotent. Cheap when the tunnel is already up (single TCP probe).
    Returns True if the tunnel is up after this call, False otherwise.

    Called by `_scalar` / `_rows` in services.redshift_queries on
    Connection-refused errors so the user sees a 1s blip instead of
    all-zeros until the next API restart.
    """
    s = get_settings()
    if _port_is_open("127.0.0.1", s.redshift_ssm_local_port, timeout=0.5):
        return True
    logger.warning(
        "Redshift tunnel dropped — port %d not listening. Re-spawning…",
        s.redshift_ssm_local_port,
    )
    # If we had a process handle but the tunnel died, clear it so
    # start_tunnel() spawns a fresh one.
    global _tunnel_proc
    if _tunnel_proc is not None and _tunnel_proc.poll() is not None:
        _tunnel_proc = None
    start_tunnel()
    return _port_is_open("127.0.0.1", s.redshift_ssm_local_port, timeout=0.5)


def stop_tunnel() -> None:
    """Terminate the SSM tunnel subprocess at FastAPI shutdown."""
    global _tunnel_proc
    if _tunnel_proc is None:
        return
    try:
        os.killpg(os.getpgid(_tunnel_proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not stop SSM tunnel: %s", exc)
    finally:
        _tunnel_proc = None


# ============================================================
# Connection
# ============================================================


def get_connection() -> "redshift_connector.Connection":
    """Open a redshift-connector connection. Caller manages the lifecycle.

    Raises RuntimeError if Redshift isn't configured (missing creds) so
    callers can choose to fall back to platform_intel seed data.
    """
    s = get_settings()
    if not s.redshift_configured:
        raise RuntimeError(
            "Redshift is not configured. Set REDSHIFT_DB / REDSHIFT_USER / "
            "REDSHIFT_PASSWORD in apps/api/.env (and optionally enable the "
            "SSM tunnel)."
        )
    import redshift_connector  # type: ignore[import-not-found]
    return redshift_connector.connect(
        host=s.redshift_host,
        port=s.redshift_port,
        database=s.redshift_db,
        user=s.redshift_user,
        password=s.redshift_password.get_secret_value() if s.redshift_password else "",
        ssl=s.redshift_sslmode == "require",
        timeout=10,
    )


def smoke_test() -> tuple[bool, str]:
    """Run a `SELECT 1` to confirm the tunnel + creds work.
    Returns (ok, message). Never raises — safe to call from startup."""
    s = get_settings()
    if not s.redshift_configured:
        return (False, "Redshift not configured (missing DB / user / password).")
    try:
        conn = get_connection()
    except Exception as exc:  # noqa: BLE001
        return (False, f"Connect failed: {exc}")
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1")
        row = cur.fetchone()
        cur.close()
        conn.close()
        return (True, f"Redshift SELECT 1 → {row}")
    except Exception as exc:  # noqa: BLE001
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass
        return (False, f"Query failed: {exc}")


# ============================================================
# 08-Jun · Connection pool. Was: open + close a fresh Redshift
# connection on every _scalar/_rows call. With 16 bundles × N
# users, that's hundreds of SSL handshakes/min. Now: a process-
# wide pool of up to REDSHIFT_POOL_SIZE connections, FIFO leased
# by the threadpool that runs the sync bundle code.
# ============================================================

import logging as _pool_logging
import queue as _pool_queue
import threading as _pool_threading
from contextlib import contextmanager as _contextmanager
from typing import Iterator as _Iterator

_pool_log = _pool_logging.getLogger(__name__)
_POOL: _pool_queue.Queue | None = None
_POOL_LOCK = _pool_threading.Lock()
_POOL_SIZE = 10  # 16 bundles × N users; 10 covers concurrent load


def _ensure_pool() -> _pool_queue.Queue:
    """Lazily create the pool on first use. Idempotent + thread-safe."""
    global _POOL
    if _POOL is not None:
        return _POOL
    with _POOL_LOCK:
        if _POOL is None:
            _POOL = _pool_queue.Queue(maxsize=_POOL_SIZE)
    return _POOL


def _is_alive(conn) -> bool:  # noqa: ANN001
    """Cheap liveness check — sub-1ms when healthy, fast-fails on broken pipe."""
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        cur.close()
        return True
    except Exception:  # noqa: BLE001
        return False


@_contextmanager
def lease_connection(timeout: float = 30.0) -> _Iterator:
    """Lease one Redshift connection from the pool. Self-heals dead
    connections + opens new ones up to _POOL_SIZE on demand.

    Usage (inside the sync bundle code that runs in run_in_threadpool):

        from app.core.redshift import lease_connection
        with lease_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, params)
            ...

    On exit, the connection goes back to the pool (or is dropped if a
    poisoned-txn exception bubbled out — Redshift's 25P02 cascade).
    """
    pool = _ensure_pool()
    conn = None
    poisoned = False
    try:
        try:
            conn = pool.get_nowait()
            if not _is_alive(conn):
                try: conn.close()
                except Exception: pass  # noqa: BLE001, S110
                conn = None
        except _pool_queue.Empty:
            conn = None

        if conn is None:
            ensure_tunnel()
            conn = get_connection()

        yield conn
    except Exception:
        poisoned = True
        raise
    finally:
        if conn is not None:
            if poisoned:
                try: conn.close()
                except Exception: pass  # noqa: BLE001, S110
            else:
                try:
                    pool.put_nowait(conn)
                except _pool_queue.Full:
                    # Pool already at capacity — drop this connection.
                    try: conn.close()
                    except Exception: pass  # noqa: BLE001, S110


def drain_pool() -> None:
    """Close every pooled connection. Call from FastAPI lifespan shutdown."""
    global _POOL
    if _POOL is None:
        return
    drained = 0
    while True:
        try:
            conn = _POOL.get_nowait()
        except _pool_queue.Empty:
            break
        try: conn.close()
        except Exception: pass  # noqa: BLE001, S110
        drained += 1
    _POOL = None
    _pool_log.info("Redshift pool drained · closed %d connection(s)", drained)
