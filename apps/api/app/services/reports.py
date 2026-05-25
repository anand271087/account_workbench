"""M31 — Intelligence & Reports · QBR / MBR / Utilization HTML generation.

Three report types, each a self-contained inline-styled HTML document.
The frontend renders the output inside an iframe preview and offers a
"Download HTML" button. PPT/PDF export is a v1.1 backlog item — needs
python-pptx + reportlab templates.

Each generator takes:
  - the Account ORM row
  - latest non-signed-off Checkpoints
  - latest SuccessMetrics
  - the platform_intel jsonb (M29/M30)

and stitches them together. No DB writes — pure read + format.
"""

from __future__ import annotations

import html
from datetime import date, datetime
from typing import Any


def _escape(value: Any) -> str:
    if value is None:
        return ""
    return html.escape(str(value))


def _section_style(color: str) -> str:
    return (
        "background:#fff;border:1px solid #e4eaf6;border-radius:14px;"
        f"padding:18px 22px;margin:0 0 14px;border-top:3px solid {color}"
    )


def _frame_styles() -> str:
    return (
        "body{font-family:-apple-system,Segoe UI,Inter,sans-serif;"
        "background:#f6f8fb;color:#0d1b2e;margin:0;padding:24px 32px}"
        "h1{font-size:22px;margin:0 0 4px}"
        "h2{font-size:15px;margin:0 0 10px}"
        ".sub{color:#64748b;font-size:12px;margin-bottom:18px}"
        "table{width:100%;border-collapse:collapse;font-size:12px}"
        "th{text-align:left;font-size:10px;text-transform:uppercase;"
        "letter-spacing:.05em;color:#64748b;padding:6px 4px;"
        "border-bottom:1px solid #e4eaf6}"
        "td{padding:6px 4px;border-bottom:1px solid #f0f4fb}"
        ".kpi{display:inline-block;background:#f8f9fc;border-radius:10px;"
        "padding:10px 14px;margin-right:8px;min-width:120px;text-align:center}"
        ".kpi-v{font-size:20px;font-weight:800}"
        ".kpi-l{font-size:10px;color:#64748b;margin-top:2px}"
        ".pill{display:inline-block;padding:2px 8px;border-radius:10px;"
        "font-size:10px;font-weight:600}"
    )


def _header(account_name: str, title: str, period_label: str) -> str:
    today_str = date.today().strftime("%d %b %Y")
    return f"""
    <div style="margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <h1>{_escape(title)} — {_escape(account_name)}</h1>
          <div class="sub">Generated {today_str} · Period: {_escape(period_label)}</div>
        </div>
        <div style="font-size:11px;color:#94a3b8">Beroe Account Workbench</div>
      </div>
    </div>
    """


# ============================================================
# QBR
# ============================================================


def generate_qbr_html(
    *,
    account: Any,
    checkpoints: list[Any],
    metrics: list[Any],
    plays: list[Any],
) -> str:
    pi = account.platform_intel or {}
    usage = pi.get("usage", {})
    modules = pi.get("modules", {})
    abi = pi.get("abi", {})
    cat_intel = pi.get("cat_intel", {})
    benchmark = pi.get("benchmark", {})

    # Engagement scope (Account Kit data: from solutioning + engagement;
    # we keep this lightweight — basic header + ACV summary).
    acv = float(account.current_acv or 0)
    target_acv = float(account.target_acv or 0)

    # Checkpoints — signed off this cycle.
    cp_rows = "".join(
        f"<tr><td>{_escape(cp.type)}</td>"
        f"<td>{_escape(cp.scheduled_date)}</td>"
        f"<td>{_escape(cp.status)}</td>"
        f"<td>{_escape(cp.held_date or '—')}</td></tr>"
        for cp in checkpoints
    )

    # Metrics.
    met_rows = "".join(
        f"<tr><td>{_escape(m.name)}</td>"
        f"<td>{_escape(m.target_value or '—')}</td>"
        f"<td><b>{_escape(m.current_value or '—')}</b></td>"
        f"<td>{_escape(m.metric_type)}</td></tr>"
        for m in metrics
    )

    # Top categories from cat_intel.
    top_cat_rows = "".join(
        f"<tr><td>{_escape(c.get('name'))}</td>"
        f"<td>{_escape(c.get('visits'))}</td>"
        f"<td>{_escape(c.get('heat'))}</td></tr>"
        for c in (cat_intel.get("top_cats") or [])
    )

    # Plays (expansion pipeline).
    play_rows = "".join(
        f"<tr><td>{_escape(p.title)}</td>"
        f"<td>{_escape(p.prob)}%</td>"
        f"<td>${_escape(int(float(p.value_usd or 0) / 1000))}K</td>"
        f"<td>{_escape(', '.join(p.modes or []))}</td></tr>"
        for p in plays
    )

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>QBR — {_escape(account.name)}</title>
<style>{_frame_styles()}</style></head><body>
{_header(account.name, 'Quarterly Business Review', 'Q3 FY26')}

<section style="{_section_style('#4A00F8')}">
  <h2>1. Engagement Scope</h2>
  <div class="kpi"><div class="kpi-v">${_escape(int(acv/1000))}K</div>
    <div class="kpi-l">Current ACV</div></div>
  <div class="kpi"><div class="kpi-v">${_escape(int(target_acv/1000))}K</div>
    <div class="kpi-l">Target ACV</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(account.tier or '—')}</div>
    <div class="kpi-l">Tier</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(account.account_type or '—')}</div>
    <div class="kpi-l">Type</div></div>
</section>

<section style="{_section_style('#40CC8F')}">
  <h2>2. Usage Analysis</h2>
  <div class="kpi"><div class="kpi-v">{_escape(usage.get('licensed_users', 0))}</div>
    <div class="kpi-l">Licensed Users</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(usage.get('active_seats', 0))}</div>
    <div class="kpi-l">Active Seats</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(modules.get('mmd', 0))}</div>
    <div class="kpi-l">Market Monitor</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(modules.get('abi', 0))}</div>
    <div class="kpi-l">Abi Queries</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(modules.get('sd', 0))}</div>
    <div class="kpi-l">Supplier Discovery</div></div>
</section>

<section style="{_section_style('#C344C7')}">
  <h2>3. Category Trends</h2>
  {f'<table><thead><tr><th>Category</th><th>Visits</th><th>Heat</th></tr></thead><tbody>{top_cat_rows}</tbody></table>' if top_cat_rows else '<div class="sub">No category data recorded for this period.</div>'}
</section>

<section style="{_section_style('#EF9637')}">
  <h2>4. Abi Usage</h2>
  <div class="sub">{_escape(abi.get('insight') or 'Insight not yet captured.')}</div>
  <table>
    <tr><th>Total Queries</th><td><b>{_escape(abi.get('total_queries', 0))}</b></td></tr>
    <tr><th>Queries / User</th><td>{_escape(abi.get('queries_per_user', 0))}</td></tr>
    <tr><th>Resolution Rate</th><td>{_escape(abi.get('resolution_rate', '—'))}</td></tr>
    <tr><th>Avg Response</th><td>{_escape(abi.get('avg_response', '—'))}</td></tr>
  </table>
</section>

<section style="{_section_style('#35E1D4')}">
  <h2>5. Success Metrics — Progress vs Target</h2>
  {f'<table><thead><tr><th>Metric</th><th>Target</th><th>Current</th><th>Type</th></tr></thead><tbody>{met_rows}</tbody></table>' if met_rows else '<div class="sub">No metrics defined yet.</div>'}
</section>

<section style="{_section_style('#FD576B')}">
  <h2>6. Checkpoint Cadence</h2>
  {f'<table><thead><tr><th>Type</th><th>Scheduled</th><th>Status</th><th>Held</th></tr></thead><tbody>{cp_rows}</tbody></table>' if cp_rows else '<div class="sub">No checkpoints scheduled yet.</div>'}
</section>

<section style="{_section_style('#a830b0')}">
  <h2>7. Industry Benchmark</h2>
  <div class="kpi"><div class="kpi-v">{_escape(benchmark.get('avg_health', 0))}</div>
    <div class="kpi-l">Health Avg</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(benchmark.get('avg_seat_pct', 0))}%</div>
    <div class="kpi-l">Seat % Avg</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(benchmark.get('avg_abi', 0))}</div>
    <div class="kpi-l">Abi Avg</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(benchmark.get('avg_logins', 0))}</div>
    <div class="kpi-l">Logins Avg</div></div>
</section>

<section style="{_section_style('#2fb87a')}">
  <h2>8. Expansion Pipeline</h2>
  {f'<table><thead><tr><th>Play</th><th>Probability</th><th>Value</th><th>Modes</th></tr></thead><tbody>{play_rows}</tbody></table>' if play_rows else '<div class="sub">No expansion plays in the plan yet.</div>'}
</section>

<div style="margin-top:18px;font-size:10px;color:#94a3b8;text-align:right">
  © Beroe — Confidential. Generated {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
</div>
</body></html>"""


# ============================================================
# MBR
# ============================================================


def generate_mbr_html(
    *,
    account: Any,
    checkpoints: list[Any],
    metrics: list[Any],
) -> str:
    pi = account.platform_intel or {}
    usage = pi.get("usage", {})
    modules = pi.get("modules", {})

    cp_rows = "".join(
        f"<tr><td>{_escape(cp.type)}</td>"
        f"<td>{_escape(cp.scheduled_date)}</td>"
        f"<td>{_escape(cp.status)}</td></tr>"
        for cp in checkpoints[:3]
    )

    met_rows = "".join(
        f"<tr><td>{_escape(m.name)}</td>"
        f"<td><b>{_escape(m.current_value or '—')}</b></td>"
        f"<td>{_escape(m.target_value or '—')}</td></tr>"
        for m in metrics[:5]
    )

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>MBR — {_escape(account.name)}</title>
<style>{_frame_styles()}</style></head><body>
{_header(account.name, 'Monthly Business Review', 'Last 30 days')}

<section style="{_section_style('#4A00F8')}">
  <h2>This Month's Highlights</h2>
  <div class="kpi"><div class="kpi-v">{_escape(usage.get('active_seats', 0))}</div>
    <div class="kpi-l">Active Seats</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(modules.get('abi', 0))}</div>
    <div class="kpi-l">Abi Queries</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(modules.get('mmd', 0))}</div>
    <div class="kpi-l">MM Sessions</div></div>
  <div class="kpi"><div class="kpi-v">{_escape(modules.get('sd', 0))}</div>
    <div class="kpi-l">Supplier Searches</div></div>
</section>

<section style="{_section_style('#EF9637')}">
  <h2>Open Checkpoints</h2>
  {f'<table><thead><tr><th>Type</th><th>Scheduled</th><th>Status</th></tr></thead><tbody>{cp_rows}</tbody></table>' if cp_rows else '<div class="sub">No open checkpoints.</div>'}
</section>

<section style="{_section_style('#40CC8F')}">
  <h2>Success Metrics Snapshot</h2>
  {f'<table><thead><tr><th>Metric</th><th>Current</th><th>Target</th></tr></thead><tbody>{met_rows}</tbody></table>' if met_rows else '<div class="sub">No metrics defined.</div>'}
</section>

<section style="{_section_style('#a830b0')}">
  <h2>Action Items</h2>
  <ul style="font-size:12px;color:#64748b;line-height:1.8">
    <li>Confirm next QBR date with the assigned CSM.</li>
    <li>Review the open checkpoints above and update statuses.</li>
    <li>If any metric is below 50% of target, escalate via the soft-signals panel.</li>
  </ul>
</section>

<div style="margin-top:18px;font-size:10px;color:#94a3b8;text-align:right">
  © Beroe — Confidential. Generated {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
</div>
</body></html>"""


# ============================================================
# Utilization Report
# ============================================================


def generate_utilization_html(*, account: Any, super_users: list[dict]) -> str:
    pi = account.platform_intel or {}
    usage = pi.get("usage", {})
    modules = pi.get("modules", {})
    licensed = int(usage.get("licensed_users") or 0)
    active = int(usage.get("active_seats") or 0)
    inactive = max(0, licensed - active)
    adoption_pct = round((active / licensed) * 100) if licensed else 0

    su_rows = "".join(
        f"<tr><td><b>{_escape(u.get('name'))}</b><br>"
        f"<span style='font-size:10px;color:#94a3b8'>{_escape(u.get('role') or '')}</span></td>"
        f"<td>{_escape(u.get('logins', 0))}</td>"
        f"<td>{_escape(u.get('cw_views', 0))}</td>"
        f"<td>{_escape(u.get('abi_queries', 0))}</td>"
        f"<td>{_escape(u.get('sd_searches', 0))}</td>"
        f"<td>{_escape(u.get('hours', 0))}h</td></tr>"
        for u in super_users
    )

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Utilization — {_escape(account.name)}</title>
<style>{_frame_styles()}</style></head><body>
{_header(account.name, 'Utilization Report', 'Last 90 days')}

<section style="{_section_style('#4A00F8')}">
  <h2>Adoption Overview</h2>
  <div class="kpi"><div class="kpi-v">{licensed}</div>
    <div class="kpi-l">Licensed</div></div>
  <div class="kpi"><div class="kpi-v" style="color:#40CC8F">{active}</div>
    <div class="kpi-l">Active</div></div>
  <div class="kpi"><div class="kpi-v" style="color:#FD576B">{inactive}</div>
    <div class="kpi-l">Inactive</div></div>
  <div class="kpi"><div class="kpi-v">{adoption_pct}%</div>
    <div class="kpi-l">Adoption</div></div>
</section>

<section style="{_section_style('#40CC8F')}">
  <h2>Module-Wise Usage</h2>
  <table>
    <tr><th>Module</th><th>Sessions</th></tr>
    <tr><td>Market Monitor</td><td><b>{_escape(modules.get('mmd', 0))}</b></td></tr>
    <tr><td>Abi Queries</td><td><b>{_escape(modules.get('abi', 0))}</b></td></tr>
    <tr><td>Supplier Discovery</td><td><b>{_escape(modules.get('sd', 0))}</b></td></tr>
    <tr><td>Downloads</td><td><b>{_escape(modules.get('dl', 0))}</b></td></tr>
    <tr><td>Benchmarks</td><td><b>{_escape(modules.get('bm', 0))}</b></td></tr>
  </table>
</section>

<section style="{_section_style('#EF9637')}">
  <h2>Top Users (Super Users)</h2>
  {f'<table><thead><tr><th>User</th><th>Logins</th><th>CW Views</th><th>Abi</th><th>SD</th><th>Hours</th></tr></thead><tbody>{su_rows}</tbody></table>' if su_rows else '<div class="sub">No super-user data captured.</div>'}
</section>

<div style="margin-top:18px;font-size:10px;color:#94a3b8;text-align:right">
  © Beroe — Confidential. Generated {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
</div>
</body></html>"""


# ============================================================
# VDD (Value Delivery Document) — Row 53 (25-May-2026)
# ============================================================


def generate_vdd_html(*, account: Any) -> str:
    """Render the saved VDD jsonb as a downloadable single-page HTML doc.

    Pulls from `accounts.value_delivery_document` directly so the export
    mirrors what the user sees in the M22 VDD tab. PPT export remains
    v1.1 backlog (needs python-pptx templates).
    """
    vdd = account.value_delivery_document or {}
    locked_at = getattr(account, "vdd_locked_at", None)

    priorities = vdd.get("client_strategic_priorities") or []
    metrics = vdd.get("agreed_success_metrics") or []
    approach = vdd.get("beroes_approach") or []
    value_delivered = vdd.get("value_delivered") or []
    exec_summary = vdd.get("exec_summary") or ""

    def _sum(rows, key):
        total = 0.0
        for r in rows:
            try:
                total += float(r.get(key) or 0)
            except (TypeError, ValueError):
                continue
        return round(total, 2)

    ident = _sum(value_delivered, "identified_musd")
    comm = _sum(value_delivered, "committed_musd")
    impl = _sum(value_delivered, "implemented_musd")

    def _list_items(items: list, label_keys: list[str]) -> str:
        if not items:
            return f"<div class='sub'>No {label_keys[0]} captured.</div>"
        rows_html = ""
        for it in items:
            if isinstance(it, str):
                rows_html += f"<li>{_escape(it)}</li>"
                continue
            primary = next(
                (str(it.get(k)) for k in label_keys if it.get(k)), str(it)
            )
            rows_html += f"<li>{_escape(primary)}</li>"
        return f"<ul>{rows_html}</ul>"

    metrics_table = ""
    if metrics:
        rows = "".join(
            f"<tr><td><b>{_escape(m.get('name'))}</b></td>"
            f"<td>{_escape(m.get('target') or '—')}</td>"
            f"<td>{_escape(m.get('current') or '—')}</td>"
            f"<td>{_escape(m.get('status') or '—')}</td></tr>"
            for m in metrics
        )
        metrics_table = (
            "<table><thead><tr><th>Metric</th><th>Target</th>"
            "<th>Current</th><th>Status</th></tr></thead>"
            f"<tbody>{rows}</tbody></table>"
        )

    approach_table = ""
    if approach:
        rows = "".join(
            f"<tr><td><b>{_escape(a.get('initiative_name'))}</b></td>"
            f"<td>{_escape(', '.join(a.get('levers') or []) or '—')}</td>"
            f"<td>{_escape(a.get('stage') or '—')}</td>"
            f"<td>{_escape(a.get('approach') or '—')}</td></tr>"
            for a in approach
        )
        approach_table = (
            "<table><thead><tr><th>Initiative</th><th>Levers</th>"
            "<th>Stage</th><th>Approach</th></tr></thead>"
            f"<tbody>{rows}</tbody></table>"
        )

    delivered_table = ""
    if value_delivered:
        rows = "".join(
            f"<tr><td><b>{_escape(v.get('initiative_name'))}</b></td>"
            f"<td>${_escape(v.get('identified_musd') or 0)}M</td>"
            f"<td>${_escape(v.get('committed_musd') or 0)}M</td>"
            f"<td>${_escape(v.get('implemented_musd') or 0)}M</td>"
            f"<td>{_escape(v.get('note') or '')}</td></tr>"
            for v in value_delivered
        )
        delivered_table = (
            "<table><thead><tr><th>Initiative</th>"
            "<th>$ Identified</th><th>$ Committed</th>"
            "<th>$ Implemented</th><th>Note</th></tr></thead>"
            f"<tbody>{rows}</tbody></table>"
        )

    locked_banner = (
        f'<div style="background:#f0fdf4;border:1px solid #bbf7d0;'
        f'border-radius:8px;padding:8px 12px;margin-bottom:12px;'
        f'font-size:11px;color:#166534">🔒 Locked on '
        f'{locked_at.strftime("%d %b %Y")}</div>'
        if locked_at
        else ""
    )
    exec_section = (
        f'<section style="{_section_style("#0D1117")}">'
        f'<h2>Executive summary</h2>'
        f'<p style="white-space:pre-wrap;font-size:12px;line-height:1.55">'
        f'{_escape(exec_summary)}</p></section>'
        if exec_summary
        else ""
    )

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Value Delivery Document — {_escape(account.name)}</title>
<style>{_frame_styles()}</style></head><body>
{_header(account.name, 'Value Delivery Document', 'Renewal-readiness evidence')}

{locked_banner}

<section style="{_section_style('#4A00F8')}">
  <h2>CSM-attributed value rollup</h2>
  <div class="kpi"><div class="kpi-v">${ident}M</div><div class="kpi-l">Identified</div></div>
  <div class="kpi"><div class="kpi-v" style="color:#EF9637">${comm}M</div><div class="kpi-l">Committed</div></div>
  <div class="kpi"><div class="kpi-v" style="color:#40CC8F">${impl}M</div><div class="kpi-l">Implemented</div></div>
</section>

<section style="{_section_style('#4A00F8')}">
  <h2>Client strategic priorities</h2>
  {_list_items(priorities, ['text', 'name', 'title'])}
</section>

<section style="{_section_style('#EF9637')}">
  <h2>Agreed success metrics</h2>
  {metrics_table or '<div class="sub">No metrics captured.</div>'}
</section>

<section style="{_section_style('#a830b0')}">
  <h2>Beroe's approach per initiative</h2>
  {approach_table or '<div class="sub">No approach captured.</div>'}
</section>

<section style="{_section_style('#40CC8F')}">
  <h2>Value delivered</h2>
  {delivered_table or '<div class="sub">No value-delivered entries.</div>'}
</section>

{exec_section}

<div style="margin-top:18px;font-size:10px;color:#94a3b8;text-align:right">
  © Beroe — Confidential. Generated {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
</div>
</body></html>"""
