# Intel Offline Source Loaders (Phase 3)

Five sources live outside Redshift (SharePoint / CSV exports). When you
drop a file in and run the matching loader, the corresponding sub-tab
in **Intelligence → Reports** flips from "Awaiting offline CSV load…"
NA pills to live values.

## Quick start

```bash
# Drop your file anywhere and pass the path
uv run python scripts/intel_loaders/load_nnamu.py     ~/Downloads/nnamu_savings_2025-06.xlsx
uv run python scripts/intel_loaders/load_upply.py     ~/Downloads/upply_tracking_q2.csv
uv run python scripts/intel_loaders/load_cirtuo.py    ~/Downloads/cirtuo_q2.xlsx
uv run python scripts/intel_loaders/load_training.py  ~/Downloads/training_attendance.csv
uv run python scripts/intel_loaders/load_nps.py       ~/Downloads/nps_scores.csv

# --dry-run to validate parse without writing
uv run python scripts/intel_loaders/load_nnamu.py file.xlsx --dry-run
```

DSN is read from `apps/api/.env`'s `DATABASE_URL`. All loaders are
idempotent — re-running upserts on `(company_name, report_period)`.

## File format expectations

Every loader is case-insensitive on column names and accepts common
aliases. The **canonical column = the column name in the staging
table**; aliases are listed below.

### nnamu Savings → `intel_nnamu_savings`
| Column | Aliases accepted |
|---|---|
| `company_name` | customer, Customer, Company Name, CompanyName |
| `report_period` | period, month, date, Date (YYYY-MM-01) |
| `initial_comparison_price` | initial, Initial Comparison Price |
| `final_comparison_price` | final, Final Comparison Price |
| `absolute_savings` *(optional)* | savings, Savings (EUR) — auto-derived if absent |
| `savings_pct` *(optional)* | Savings %, Savings Pct — auto-derived if absent |

### Upply Tracking → `intel_upply_tracking`
| Column | Aliases accepted |
|---|---|
| `company_name` | CompanyName, company, Customer |
| `user_email` | UserEmail, email |
| `medium` | Medium, Mode, Transport (AIR / OCEAN / ROADEMEA / ROADNA) |
| `origin` | From |
| `destination` | To |
| `request_date` | RequestDate, Date |

> **Note**: this loader **appends**. Re-running with the same file will
> duplicate rows. To reset:
> ```sql
> truncate public.intel_upply_tracking;
> ```

### Cirtuo Projects → `intel_cirtuo_projects`
| Column | Aliases accepted |
|---|---|
| `company_name` | customer |
| `report_period` | period, month, Date |
| `categories_supported` | projects, Projects Executed |
| `feedback_received` | received |
| `feedback_total` | delivered, Total Delivered |
| `feedback_score_avg` | avg_feedback, Average Feedback, Avg Rating |

### Platform Training → `intel_training_attendance`
| Column | Aliases accepted |
|---|---|
| `company_name` | company, customer |
| `session_date` | date, Training Date |
| `topic` | title, Training Topic *(default: 'General')* |
| `users_attended` | attended, Attendees |
| `users_invited` | invited, Total Users, Licensed Users |

### NPS → `intel_nps_scores`
| Column | Aliases accepted |
|---|---|
| `company_name` | company, customer |
| `report_period` | period, month, Date |
| `nps_score` | NPS, score, NPS Score |
| `promoters_pct` *(optional)* | Promoters % |
| `passives_pct` *(optional)* | Passives % |
| `detractors_pct` *(optional)* | Detractors % |
| `response_count` *(optional)* | responses, N |

## Important: `company_name` must match `accounts.redshift_company_name`

Bundles look up by the canonical Redshift companyname. Use the **exact**
value from `public.accounts.redshift_company_name`:

```sql
select slug, name, redshift_company_name from accounts where redshift_company_name is not null;
```

Currently mapped:
- `Mondelez International`
- `Siemens Energy AG`
- `Sanofi`

If your CSV says "Mondelēz International" (with diacritic), normalize to
match — or update `accounts.redshift_company_name` accordingly.

## Inspecting loaded data

```sql
-- counts
select 'nnamu'  as src, count(*) from public.intel_nnamu_savings   union all
select 'upply'  as src, count(*) from public.intel_upply_tracking  union all
select 'cirtuo' as src, count(*) from public.intel_cirtuo_projects union all
select 'train'  as src, count(*) from public.intel_training_attendance union all
select 'nps'    as src, count(*) from public.intel_nps_scores;

-- per-company breakdown
select company_name, count(*) from public.intel_nnamu_savings group by 1;
```

## Re-running

All loaders except `upply` use `ON CONFLICT … DO UPDATE` keyed on
`(company_name, report_period)` — safe to re-run. Upply appends; reset
the table first if you need a clean reload.

## Schema migration

Tables created by `supabase/migrations/0066_intel_offline_staging.sql`.
Re-run the migration safely (all `CREATE TABLE IF NOT EXISTS`).
