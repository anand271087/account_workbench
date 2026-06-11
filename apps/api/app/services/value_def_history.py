"""Shared helper for appending entries to
account_solutioning.value_definition_history.

The history list captures every value the field has held over time so
the Solutioning tab's revision-history panel can offer Restore on any
prior snapshot. Two callers write through this helper:

  1. POST /solutioning/lock handler (worker side) — when a VPD upload
     pushes a fresh AI summary into value_definition (source='vpd').
  2. PATCH /solutioning route — when a Solutioning user or a Sales rep
     manually edits the field (source='user').

Both paths share one risk: the row may carry a value_definition that
was set BEFORE the history mechanism existed (legacy data). On the
first overwrite, that original content would be lost unless we
explicitly seed it. `append_value_definition_version()` handles that
by pushing a synthetic '(prior state)' entry into the history before
the new entry — only when the current value isn't already represented
by the latest history entry.

The helper is idempotent: if the new value equals the current value
(or matches the latest history entry exactly), no entry is appended.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any


def append_value_definition_version(
    *,
    row: Any,
    new_value: str | None,
    source: str,
    edited_by: str | None,
    edited_by_name: str | None,
    document_id: str | None = None,
) -> None:
    """Idempotent append of one entry to row.value_definition_history.

    Also seeds the history with the CURRENT value_definition (as a
    synthetic '(prior state)' entry) when the current value would
    otherwise be lost. Mutates `row` in place.

    No-ops when:
      * new_value (normalised) equals current value (nothing changed)
      * new_value (normalised) equals the latest history entry's value
        (preventing duplicate appends from idempotent re-PATCHes)
    """
    new_norm = (new_value or "").strip()
    cur_norm = (row.value_definition or "").strip()

    # Nothing actually changed → don't touch history.
    if new_norm == cur_norm:
        return

    history: list[dict[str, Any]] = copy.deepcopy(
        list(row.value_definition_history or [])
    )
    last_value = (history[-1].get("value") or "").strip() if history else ""

    # Seed the previous state into history if it isn't represented yet.
    # Only fires when the current value is non-empty AND the latest
    # history entry (if any) doesn't already match it.
    if cur_norm and cur_norm != last_value:
        history.append({
            "value": row.value_definition or "",
            "source": "user",
            "edited_by": None,
            "edited_by_name": "(prior state)",
            "edited_at": datetime.now(timezone.utc).isoformat(),
            "document_id": None,
        })

    # Append the new state.
    history.append({
        "value": new_value or "",
        "source": source,
        "edited_by": edited_by,
        "edited_by_name": edited_by_name,
        "edited_at": datetime.now(timezone.utc).isoformat(),
        "document_id": document_id,
    })
    row.value_definition_history = history
