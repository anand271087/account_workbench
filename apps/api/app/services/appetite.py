"""M26 — Appetite Score calculator (port of prototype calcAppetiteScore).

Four weighted components → 0..100 → mode:
  * Health           40%   from accounts.health_score
  * Signal mix       25%   placeholder until M27 ships soft_signals
  * Renewal prox.    15%   from gate_renewal_date (M13) → days-to-renewal
  * ARR growth       20%   pipeline (sum prob-weighted plays) vs target

Mode mapping: 0–39 rescue · 40–69 retain · 70–100 expand.

Hard overrides (mirrored from the prototype):
  - `account_type == "Renewal"` is capped at retain (never expand).
  - `tier == "Strategic"` (mapped from prototype's "Hyper Growth")
    additionally requires ≥50% seat utilization to qualify for expand;
    we don't have seat data yet so this gate is currently a no-op.

ARR target table — keyed on our `tier` (Strategic/Enterprise/Growth/
Emerging) × `account_type` (New Logo/Existing/Renewal/Pilot). Mapping
to the prototype's vocab:
  tier:        Strategic→T1   Enterprise→T2  Growth→T3   Emerging→Pre-contract
  acct_type:   New Logo→Hyper Growth   Existing→Standard Growth
               Renewal→Retention       Pilot→New Account
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.models.account import Account
from app.models.play import AccountPlay
from app.models.signal import SoftSignal
from app.schemas.play import AppetiteOut, ModeBreakdown


# Prototype's ARR_TARGETS, keyed on prototype tier names.
_PROTO_ARR_TARGETS: dict[str, dict[str, float]] = {
    "T1": {"Retention": 0.05, "Standard Growth": 0.25, "Hyper Growth": 0.50},
    "T2": {"Retention": 0.05, "Standard Growth": 0.30, "Hyper Growth": 0.60},
    "T3": {"Retention": 0.05, "Standard Growth": 0.35, "Hyper Growth": 0.65},
    "Pre-contract": {
        "Retention": 0.0,
        "Standard Growth": 0.0,
        "Hyper Growth": 0.0,
        "New Account": 0.0,
    },
}

# Mapping our vocab → prototype vocab so the table above keeps working.
_TIER_MAP = {
    "Strategic": "T1",
    "Enterprise": "T2",
    "Growth": "T3",
    "Emerging": "Pre-contract",
}

_TYPE_MAP = {
    "New Logo": "Hyper Growth",
    "Existing": "Standard Growth",
    "Renewal": "Retention",
    "Pilot": "New Account",
}


def _arr_target(tier: str | None, acct_type: str | None) -> float:
    proto_tier = _TIER_MAP.get(tier or "", "Pre-contract")
    proto_type = _TYPE_MAP.get(acct_type or "", "Standard Growth")
    return _PROTO_ARR_TARGETS.get(proto_tier, _PROTO_ARR_TARGETS["Pre-contract"]).get(
        proto_type, 0.0
    )


def _days_to_renewal(acc: Account, today: date) -> int | None:
    """Prefer gate_renewal_date (M13 signed contract) over accounts.renewal_date."""
    renewal = acc.gate_renewal_date or acc.renewal_date
    if renewal is None:
        return None
    return (renewal - today).days


def compute_appetite(
    *,
    acc: Account,
    plays: list[AccountPlay],
    signals: list[SoftSignal] | None = None,
    today: date | None = None,
) -> AppetiteOut:
    today = today or date.today()
    signals = signals or []

    # 1. Health (40%)
    health_score = int(acc.health_score or 50)
    health_pts = round(health_score * 0.40)

    # 2. Signal mix (25%) — prototype rule: count visible active signals
    # by type, score by majority. Default neutral (15) when none.
    visible = [s for s in signals if not s.hidden and s.status == "active"]
    sig_counts = {"expansion": 0, "positive": 0, "neutral": 0, "risk": 0, "critical": 0}
    for s in visible:
        sig_counts[s.type] = sig_counts.get(s.type, 0) + 1
    total = len(visible) or 1
    pos_share = (sig_counts["expansion"] + sig_counts["positive"]) / total
    if pos_share > 0.5:
        sig_pts = 25
    elif sig_counts["neutral"] / total > 0.5:
        sig_pts = 15
    elif sig_counts["risk"] / total > 0.5:
        sig_pts = 8
    elif sig_counts["critical"] / total > 0.3:
        sig_pts = 0
    else:
        sig_pts = 15

    has_risk = sig_counts["risk"] > 0 or sig_counts["critical"] > 0

    # 3. Renewal proximity (15%)
    dtr = _days_to_renewal(acc, today)
    if dtr is None:
        renew_pts = 15
    elif dtr > 180:
        renew_pts = 15
    elif dtr >= 90:
        renew_pts = 10
    elif not has_risk:
        # Close to renewal but no risk on the board → still some buffer.
        renew_pts = 6
    else:
        renew_pts = 0

    # 4. ARR growth (20%)
    acct_type = acc.account_type or "Existing"
    arr_target = _arr_target(acc.tier, acct_type)
    current_acv = float(acc.current_acv or 0)
    target_acv = current_acv * (1.0 + arr_target)
    pipeline = sum(
        float(p.value_usd or 0) * (p.prob / 100.0) for p in plays if not p.hidden
    )
    projected_acv = current_acv + pipeline

    is_new = acct_type == "Pilot" or current_acv == 0 or arr_target == 0
    if is_new:
        arr_pts = 10
        arr_status = "n/a"
    elif projected_acv >= target_acv:
        arr_pts = 20
        arr_status = "on_track"
    elif pipeline > 0:
        arr_pts = 10
        arr_status = "behind"
    else:
        arr_pts = 0
        arr_status = "declining"

    score = max(0, min(100, health_pts + sig_pts + renew_pts + arr_pts))
    if score <= 39:
        recommended = "rescue"
    elif score <= 69:
        recommended = "retain"
    else:
        recommended = "expand"

    # Hard override: Renewal-type accounts never enter expand.
    if acct_type == "Renewal" and recommended == "expand":
        recommended = "retain"

    # Utilization gate placeholder — we don't track seat utilization yet
    # so this is always False. When that data ships, hyper-growth caps
    # at retain when seatUtil < 50%.
    utilization_gate = False

    override = acc.plan_current_mode
    current = override if override in ("rescue", "retain", "expand") else recommended

    return AppetiteOut(
        account_id=acc.id,
        score=score,
        recommended_mode=recommended,
        current_mode=current,
        is_overridden=bool(override) and override != recommended,
        breakdown=ModeBreakdown(
            health_pts=health_pts,
            sig_pts=sig_pts,
            renew_pts=renew_pts,
            arr_pts=arr_pts,
            arr_status=arr_status,
            arr_target_pct=round(arr_target * 100),
            target_acv_usd=Decimal(str(round(target_acv, 2))),
            projected_acv_usd=Decimal(str(round(projected_acv, 2))),
            utilization_gate=utilization_gate,
        ),
        # 28-May bug 28-33 — surface override reason + last 20 history entries.
        override_reason=getattr(acc, "plan_mode_override_reason", None),
        history=(getattr(acc, "plan_mode_history", None) or [])[-20:][::-1],
    )
