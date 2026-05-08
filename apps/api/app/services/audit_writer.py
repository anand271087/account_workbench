"""Auto-writes audit_log entries on every insert/update/delete to audited tables.

Hooks into SQLAlchemy `Session.before_flush`. Writes one audit row per CHANGED FIELD
on UPDATE so every field has its own old→new pair (BRD requirement).

The current user (who's making the change) is read from a contextvar set by the
auth dependency. The request_id is similarly contextvar-backed. Both are optional
— if absent (e.g. a worker job, or a test that doesn't go through the auth dep),
the row is still written with `changed_by_user_id = NULL`.
"""

from __future__ import annotations

import json
from contextvars import ContextVar
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.audit import AuditLog
from app.models.contact import ClientContact
from app.models.engagement import AccountEngagement

# ============================================================
# Per-request context: current user_id + request_id
# ============================================================

current_user_id_var: ContextVar[UUID | None] = ContextVar("current_user_id", default=None)
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


# ============================================================
# Which models get audit-logged + how to derive their account_id
# ============================================================

AUDITED_MODELS: tuple[type, ...] = (Account, AccountEngagement, ClientContact)


def _get_account_id(obj: object) -> UUID | None:
    """Return the account_id this row rolls up to (None if not applicable).

    For `accounts` rows, the `id` IS the account_id.
    For child tables, look for an `account_id` column.
    """
    if isinstance(obj, Account):
        return obj.id
    if hasattr(obj, "account_id"):
        return getattr(obj, "account_id")
    return None


# ============================================================
# JSON serialization for old/new values
# ============================================================


def _json_safe(v: Any) -> Any:
    """Coerce a Python value into a JSON-serialisable shape."""
    if v is None:
        return None
    if isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (UUID, datetime, date)):
        return str(v)
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (list, tuple)):
        return [_json_safe(x) for x in v]
    if isinstance(v, dict):
        return {k: _json_safe(x) for k, x in v.items()}
    return str(v)


def _wrap(field: str, value: Any, account_id: UUID | None) -> dict:
    """Build the JSONB blob written to old_value / new_value.

    Always include `account_id` so AK02's activity-feed JSONB containment
    `new_value @> {"account_id": "..."}` filter works for child rows.
    """
    out: dict[str, Any] = {field: _json_safe(value)}
    if account_id is not None:
        out["account_id"] = str(account_id)
    return out


def _full_snapshot(obj: object, account_id: UUID | None) -> dict:
    """Snapshot of the full row — used for INSERT (new_value) and DELETE (old_value)."""
    state = inspect(obj)
    snap: dict[str, Any] = {}
    for attr in state.attrs:
        snap[attr.key] = _json_safe(getattr(obj, attr.key))
    if account_id is not None:
        snap["account_id"] = str(account_id)
    return snap


# ============================================================
# The listener
# ============================================================


@event.listens_for(Session, "before_flush")
def _before_flush(session: Session, _flush_context, _instances) -> None:
    user_id = current_user_id_var.get()
    request_id = request_id_var.get()

    new_audit_rows: list[AuditLog] = []

    for obj in session.new:
        if isinstance(obj, AUDITED_MODELS):
            account_id = _get_account_id(obj)
            new_audit_rows.append(
                AuditLog(
                    table_name=obj.__tablename__,
                    row_id=getattr(obj, "id", None),
                    action="insert",
                    changed_by_user_id=user_id,
                    field_name=None,
                    old_value=None,
                    new_value=_full_snapshot(obj, account_id),
                    request_id=request_id,
                )
            )

    for obj in session.dirty:
        if not isinstance(obj, AUDITED_MODELS):
            continue
        if not session.is_modified(obj, include_collections=False):
            continue

        state = inspect(obj)
        account_id = _get_account_id(obj)
        row_id = getattr(obj, "id", None)

        for attr in state.attrs:
            hist = attr.history
            if not hist.has_changes():
                continue
            old_val = hist.deleted[0] if hist.deleted else None
            new_val = hist.added[0] if hist.added else getattr(obj, attr.key)

            new_audit_rows.append(
                AuditLog(
                    table_name=obj.__tablename__,
                    row_id=row_id,
                    action="update",
                    changed_by_user_id=user_id,
                    field_name=attr.key,
                    old_value=_wrap(attr.key, old_val, account_id),
                    new_value=_wrap(attr.key, new_val, account_id),
                    request_id=request_id,
                )
            )

    for obj in session.deleted:
        if isinstance(obj, AUDITED_MODELS):
            account_id = _get_account_id(obj)
            new_audit_rows.append(
                AuditLog(
                    table_name=obj.__tablename__,
                    row_id=getattr(obj, "id", None),
                    action="delete",
                    changed_by_user_id=user_id,
                    field_name=None,
                    old_value=_full_snapshot(obj, account_id),
                    new_value=None,
                    request_id=request_id,
                )
            )

    for row in new_audit_rows:
        session.add(row)


def install_audit_listeners() -> None:
    """No-op idempotency hook — importing this module already installs the listener
    via the @event.listens_for decorator. Call from app startup so the listener
    is registered before the first request."""
    return None
