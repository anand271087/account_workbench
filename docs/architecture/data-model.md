# Data Model

> **Status:** Schema defined in the build plan. M2 ships first migration (auth/RBAC tables); M5–M7 ship the AK03 tables. This document is the source of truth that migrations realize.

## Entity-relationship summary

```
users ─┬─ teams (M:1)
       ├─ account_assignments ─── accounts ─┬─ account_engagement (1:1)
       │                                    ├─ client_contacts (1:N)
       │                                    ├─ documents (1:N) ─── document_links ─── client_contacts (M:N)
       │                                    └─ account_discovery_summary (1:1)
       │
       └─ audit_log (writes from all tables)

jobs ── documents (1:N)
lookup_categories
lookup_geographies
lookup_roles
```

## Tables (Sprint 1 scope)

### `users`
| col | type | notes |
|---|---|---|
| id | uuid PK | from Supabase Auth |
| email | text unique | |
| full_name | text | |
| role | text | one of 11 BRD roles |
| team_id | uuid FK → teams | nullable |
| created_at | timestamptz | |
| deleted_at | timestamptz | soft delete |

### `accounts`
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| slug | text unique | |
| industry, region, country | text | |
| csm_user_id | uuid FK → users | |
| co_user_id | uuid FK → users | Commercial Owner |
| category, tier, account_type, segment | text | |
| current_acv, target_acv | numeric | |
| contract_start, contract_end, renewal_date | date | |
| health_score | int | computed (Sprint 6) |
| last_activity_at | timestamptz | derived from audit_log |
| created_at, updated_at | timestamptz | |
| deleted_at | timestamptz | soft delete |

### `account_engagement` (AK03.a)
| col | type | notes |
|---|---|---|
| account_id | uuid PK FK → accounts | 1:1 |
| sdr_lead, discovery_lead, sales_lead | text | |
| pre_discovery_date | date | |
| target_categories | text[] | references lookup_categories.name |
| engagement_objective | text | min 120 words (UI warning) |
| procurement_maturity | enum (Low/Medium/High) | |
| ai_penetration | enum (Low/Medium/High) | |
| procurement_spend_musd | numeric(12,4) | |
| geographies | text[] | |
| spoc_text, sponsor_text, power_users_text | text | |
| ai_quality_score | smallint (1–5) | |
| ai_quality_dismissed | boolean | |
| updated_at, updated_by | | |

### `client_contacts` (AK03.b)
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| account_id | uuid FK | |
| name, title, email, phone | text | |
| role | enum (Decision Maker/Influencer/End User/Finance/IT) | |
| influence | enum (High/Medium/Low) | |
| is_spoc, is_sponsor | boolean | |
| created_at, updated_at | timestamptz | |
| deleted_at | timestamptz | soft delete; 30d restore window |

### `documents` (AK03.c)
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| account_id | uuid FK | |
| kind | enum (mom/vpd/recording/transcript/email/other) | |
| filename | text | |
| file_hash | text | dedup key per account |
| storage_path | text | Supabase Storage path |
| mime_type, size_bytes | | |
| meeting_date | date | |
| uploaded_by | uuid FK → users | |
| uploaded_at | timestamptz | |
| ai_status | enum (pending/processing/complete/failed) | |
| ai_summary_text | text | |
| extracted_entities | jsonb | `{people, decisions, action_items, dates}` |
| job_id | uuid FK → jobs | |
| deleted_at | | soft delete |

UNIQUE(account_id, file_hash) — same file can't be re-uploaded to same account without override.

### `account_discovery_summary`
1:1 with accounts. Regenerated whenever a document is added/changed/deleted.

### `audit_log`
Append-only. Written by SQLAlchemy event listeners on every UPDATE/DELETE.

| col | type |
|---|---|
| id | uuid PK |
| table_name, row_id | text |
| action | enum (insert/update/delete) |
| changed_by_user_id | uuid |
| changed_at | timestamptz |
| field_name | text |
| old_value, new_value | jsonb |
| request_id | text |

### `jobs`
For polling Celery task status from the frontend.

## RLS policies (high level)

- **CSM:** read+write only rows where they're in `account_assignments`.
- **CS Director / VP — CSM / VP — Sales / Admin:** all rows.
- **Solutioning Manager:** read+write `account_engagement` and `documents` (kind=vpd); read-only elsewhere.
- **Inside Sales Manager:** read+write inside-sales sections (defined when those tables land in v1.1+).
- **Read-only viewer roles (VP — Solutioning, VP — Inside Sales):** SELECT only on all rows in their portfolio scope.

Full SQL in `supabase/migrations/0001_init_schema.sql` (lands M2). RLS is **defense-in-depth** — FastAPI also enforces RBAC via `require_role` and `require_account_access` decorators.

## Audit log expectations

Every PATCH/PUT/DELETE writes one row per changed field with old → new. Inserts write a single row with the full new payload. Deletes write a single tombstone row with the previous payload as `old_value`.
