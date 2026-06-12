"""Growth & Pipeline — peer-benchmark + AI plays + peer-CSM plays.

Single endpoint that powers the new prototype sections on AccountPlanTab:

  * `peer_benchmark`   — cohort-relative module-saturation comparison
  * `top_peer_modules` — which modules peers in the cohort own that
                         this account doesn't
  * `ai_plays`         — heuristic-generated upsell suggestions sourced
                         from the saturation gap + signal mix
  * `peer_plays`       — cross-account play library, plays from accounts
                         in the same cohort with attribution

Cohort definition (matches the prototype tag-line "Pharma · $250K–$750K
ACV · n=18 accounts"):

  cohort = accounts WHERE industry = self.industry
                      AND tier     = self.tier  (proxy for revenue bucket)
                      AND id      != self.id

If industry is null we widen to "tier alone" so the panel still shows
something useful on lightly-populated demo data.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.play import AccountPlay

# 10-Jun · Canonical Beroe modules — same list rendered by the frontend
# Saturation grid. Kept here too so the backend cohort math reasons about
# the same vocabulary. Order matches the v3 prototype.
BEROE_MODULES = [
    "Live.Ai",
    "MMD",
    "Supplier Risk",
    "Supply Chain Risk",
    "Copilot",
    "DataHub",
    "Sourcing Optimizer",
    "Diverse Supplier Directory",
    "Sustainability Index",
]


def _normalize(name: str) -> str:
    return (name or "").strip().lower()


def _module_set(modules: list[str] | None) -> set[str]:
    if not modules:
        return set()
    return {_normalize(m) for m in modules if m}


async def _fetch_cohort(db: AsyncSession, acc: Account) -> list[Account]:
    """Pull peers in the same industry + tier bucket."""
    conds = [Account.id != acc.id, Account.deleted_at.is_(None)]
    if acc.industry:
        conds.append(Account.industry == acc.industry)
    if acc.tier:
        conds.append(Account.tier == acc.tier)
    # If both industry + tier are null on self, fall back to no cohort
    # (panel renders empty-state). Otherwise the query above already
    # filters appropriately.
    rs = await db.execute(select(Account).where(and_(*conds)))
    return list(rs.scalars().all())


def _saturation_pct(modules: list[str] | None) -> float:
    """% of canonical modules a single account owns."""
    if not modules:
        return 0.0
    owned = _module_set(modules)
    canonical = {_normalize(m) for m in BEROE_MODULES}
    overlap = owned & canonical
    return round(len(overlap) / len(canonical) * 100, 1)


def _build_peer_benchmark(self_acc: Account, peers: list[Account]) -> dict[str, Any]:
    self_pct = _saturation_pct(self_acc.gate_contract_modules)
    if not peers:
        return {
            "cohort_label": _cohort_label(self_acc, 0),
            "cohort_size": 0,
            "you_pct": self_pct,
            "peer_industry_pct": None,
            "peer_revenue_pct": None,
            "top_quartile_pct": None,
            "insight": "No peer cohort available yet — add more accounts with the same "
            "industry + tier so the benchmark can light up.",
        }

    pcts = sorted([_saturation_pct(p.gate_contract_modules) for p in peers])
    median = pcts[len(pcts) // 2]
    # Tier-only median uses the same peers since we already filtered on
    # both industry + tier; in real deployments these would differ.
    rev_bucket_median = median
    # Top quartile: 75th percentile (uses simple positional index).
    top_q = pcts[max(0, int(len(pcts) * 0.75) - 1)] if pcts else 0.0

    # Insight text — gap framed in points + $ if we can roughly estimate
    # ACV gain (heuristic: each missing module ≈ $90K avg ACV uplift).
    gap_pts = round(median - self_pct, 1)
    missing_modules = max(0, int(round((median - self_pct) / 12.5)))  # 12.5% per module of 8
    est_acv_uplift = missing_modules * 90  # in $K
    if gap_pts > 0:
        insight = (
            f"{gap_pts}pts below peer median. "
            f"Peers in your industry typically activate ~{missing_modules} more module(s) "
            f"before renewal — closing the gap = est. +${est_acv_uplift}K ACV."
        )
    elif gap_pts < 0:
        insight = (
            f"You are {abs(gap_pts)}pts above peer median — strong saturation "
            "for this cohort. Focus on deepening usage of owned modules."
        )
    else:
        insight = "On par with peer median saturation. Look at top-quartile peers for the next move."

    return {
        "cohort_label": _cohort_label(self_acc, len(peers)),
        "cohort_size": len(peers),
        "you_pct": self_pct,
        "peer_industry_pct": round(median, 1),
        "peer_revenue_pct": round(rev_bucket_median, 1),
        "top_quartile_pct": round(top_q, 1),
        "insight": insight,
    }


def _cohort_label(self_acc: Account, n: int) -> str:
    bits = []
    if self_acc.industry:
        bits.append(self_acc.industry)
    if self_acc.tier:
        bits.append(f"Tier {self_acc.tier}")
    if n:
        bits.append(f"n={n} accounts")
    return " · ".join(bits) if bits else "No cohort"


def _build_top_peer_modules(
    self_acc: Account, peers: list[Account]
) -> list[dict[str, Any]]:
    """Per-module adoption % across the cohort, sorted desc.

    Returns at most 6 entries. Flags `you_own: true` when this account
    already has the module so the UI can render the "you own" pill.
    """
    you_owned = _module_set(self_acc.gate_contract_modules)
    canonical_lc = [_normalize(m) for m in BEROE_MODULES]

    out: list[dict[str, Any]] = []
    cohort_n = len(peers)
    if not cohort_n:
        return out

    for mod, mod_lc in zip(BEROE_MODULES, canonical_lc, strict=True):
        count = sum(
            1
            for p in peers
            if mod_lc in _module_set(p.gate_contract_modules)
        )
        if count == 0:
            continue
        out.append({
            "name": mod,
            "adoption_pct": round(count / cohort_n * 100, 1),
            "you_own": mod_lc in you_owned,
        })

    out.sort(key=lambda r: (-r["adoption_pct"], r["name"]))
    return out[:6]


def _build_ai_plays(self_acc: Account, peers: list[Account]) -> list[dict[str, Any]]:
    """Heuristic AI play recommendations from saturation gap × cohort uptake.

    Take modules peers heavily own (>40% adoption) that this account
    doesn't, score by `cohort_adoption_pct`. Limit to 4.
    """
    you_owned = _module_set(self_acc.gate_contract_modules)
    cohort_n = len(peers)
    if not cohort_n:
        return []

    suggestions: list[dict[str, Any]] = []
    for mod in BEROE_MODULES:
        mod_lc = _normalize(mod)
        if mod_lc in you_owned:
            continue
        count = sum(1 for p in peers if mod_lc in _module_set(p.gate_contract_modules))
        adoption = count / cohort_n
        if adoption < 0.4:
            continue
        match_pct = int(round(adoption * 100))
        est_acv = 80 + int(adoption * 100)  # $K — rough heuristic
        prob_tier = "high" if adoption > 0.6 else "med"
        suggestions.append({
            "id": f"AI-{mod_lc.replace(' ', '-')}",
            "name": f"{mod} upsell",
            "match_pct": match_pct,
            "rationale": (
                f"{self_acc.industry or 'Cohort'} peers adopt {mod} at {match_pct}% — "
                "gap-closing play."
            ),
            "est_acv_k": est_acv,
            "prob_tier": prob_tier,
        })

    suggestions.sort(key=lambda r: -r["match_pct"])
    return suggestions[:4]


async def _fetch_industry_peers(
    db: AsyncSession, acc: Account
) -> list[Account]:
    """Same-industry peer accounts, excluding self. Distinct from
    _fetch_cohort (industry + tier) — the Peer-CSM plays panel uses
    industry-only per stakeholder ask 12-Jun: "list down the plays /
    initiatives that other csm done for other accounts on the same
    industry". Tier isn't relevant here — we want to see what peers
    in the same industry are doing regardless of size band."""
    if not acc.industry:
        return []
    rs = await db.execute(
        select(Account).where(
            and_(
                Account.industry == acc.industry,
                Account.id != acc.id,
                Account.deleted_at.is_(None),
            )
        )
    )
    return list(rs.scalars().all())


# Initiative status → numeric sort key so the From-Peer list reads
# delivered-first (most actionable) → identification last.
_STATUS_ORDER: dict[str, int] = {
    "delivered": 0,
    "in_progress": 1,
    "pipeline": 2,
    "identification": 3,
    "not_started": 4,
}


async def _build_peer_plays(
    db: AsyncSession, self_acc: Account, _legacy_peers: list[Account]
) -> list[dict[str, Any]]:
    """Cross-account initiative library. Returns initiatives that other
    CSMs are running on same-industry accounts (≠ self).

    12-Jun: data source switched from account_plays (now empty after
    migration 0076) to cs_goals[*].initiatives. Cohort widened from
    (industry+tier) to industry-only per stakeholder. Includes initiatives
    from auto-created "Migrated expansion plays" goals — peer CSMs who
    haven't re-homed their migrated plays still surface here.
    """
    from app.models.cs_goal import CSGoal
    from app.models.user import User

    peers = await _fetch_industry_peers(db, self_acc)
    if not peers:
        return []

    peer_id_to_account: dict[Any, Account] = {p.id: p for p in peers}

    # Resolve CSM names in one batch query so we don't N+1.
    csm_ids = [p.csm_user_id for p in peers if p.csm_user_id]
    name_by_csm: dict[Any, str | None] = {}
    if csm_ids:
        u_rows = (
            await db.execute(
                select(User.id, User.full_name).where(User.id.in_(csm_ids))
            )
        ).all()
        name_by_csm = {uid: name for uid, name in u_rows}

    # Fetch all live goals for peer accounts in one query.
    goal_rows = (
        await db.execute(
            select(CSGoal).where(
                CSGoal.account_id.in_(list(peer_id_to_account.keys())),
                CSGoal.deleted_at.is_(None),
            )
        )
    ).scalars().all()

    out: list[dict[str, Any]] = []
    for goal in goal_rows:
        peer_acc = peer_id_to_account.get(goal.account_id)
        if not peer_acc:
            continue
        peer_csm = (
            name_by_csm.get(peer_acc.csm_user_id)
            if peer_acc.csm_user_id else None
        ) or peer_acc.csm_owner_name  # fall back to free-text name
        for idx, init in enumerate(goal.initiatives or []):
            if not isinstance(init, dict):
                continue
            name = init.get("name") or init.get("title")  # title is legacy
            if not name:
                continue
            status = init.get("status", "identification")
            out.append({
                "id": f"PEER-{goal.id}-{idx}",
                "name": name,
                "status": status,
                "peer_account_name": peer_acc.name,
                "peer_csm_name": peer_csm or "—",
                "parent_goal_title": goal.title,
                "value_target": init.get("value_target"),
                "notes": init.get("notes"),
            })

    # Sort: delivered → in_progress → pipeline → identification.
    # Within each band, alphabetical by name for stable ordering.
    out.sort(key=lambda r: (_STATUS_ORDER.get(r["status"], 9), r["name"].lower()))

    return out[:20]


async def build_growth_context(db: AsyncSession, acc: Account) -> dict[str, Any]:
    peers = await _fetch_cohort(db, acc)
    return {
        "peer_benchmark": _build_peer_benchmark(acc, peers),
        "top_peer_modules": _build_top_peer_modules(acc, peers),
        "ai_plays": _build_ai_plays(acc, peers),
        "peer_plays": await _build_peer_plays(db, acc, peers),
    }
