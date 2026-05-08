# Threat Model

> STRIDE-style threat model. Updated when each feature is built.

## System assets
- **Account data** — sensitive client engagement notes, contact info, contracts
- **AI extracted entities** — derived from MOMs/VPDs which may contain confidential strategy
- **Files in Supabase Storage** — original MOMs, VPDs, transcripts
- **User credentials** — managed by Supabase Auth (out of our threat surface)

## Trust boundaries
1. Browser ↔ Vercel-served frontend (TLS)
2. Frontend ↔ FastAPI (TLS + JWT)
3. FastAPI ↔ Supabase (TLS + service role key)
4. FastAPI ↔ Anthropic (TLS + API key)
5. Worker ↔ Redis ↔ Supabase Storage

## STRIDE per boundary

### S — Spoofing
- **Attacker spoofs another user:** mitigated by JWT signature verification (HS256, signed with `SUPABASE_JWT_SECRET`).
- **Attacker spoofs the API to the worker:** worker uses internal-only Redis (not exposed publicly).
- **Attacker spoofs Supabase:** TLS pinning is overkill; we trust DNS + Supabase TLS.

### T — Tampering
- **Tampering with JWT:** signature breaks, request rejected.
- **Tampering with file at rest:** Supabase Storage uses S3 with integrity hashes; we additionally store `file_hash` and verify on download.
- **SQL injection:** SQLAlchemy parameterized queries; zero raw SQL.

### R — Repudiation
- **User denies an action:** every UPDATE/DELETE is logged in `audit_log` with `changed_by_user_id`, `changed_at`, `request_id`. Combined with Supabase Auth login logs, action attribution is robust.

### I — Information Disclosure
- **Data leak via leaked service role key:** mitigated by RLS as second wall + secrets policy + monitoring.
- **Cross-account leak via missing RLS:** every table has explicit RLS; tested via `tests/test_rls.py`.
- **AI prompt injection leaking other users' data:** Claude calls are scoped per request — prompts never include data from other accounts. Worker fetches data using user's effective permissions.
- **Browser-side data exposure:** only `VITE_*` (public) vars in browser bundle.

### D — Denial of Service
- **Mass file uploads:** rate limit + max size + Celery queue with bounded concurrency.
- **Expensive AI queries:** Redis cache (7-day TTL) for repeat prompts; cost log per call alerts on spikes.
- **DB exhaustion:** SQLAlchemy connection pool capped; `slowapi` rate limit per IP.

### E — Elevation of Privilege
- **CSM tries to access another CSM's account:** RBAC layer + RLS layer reject.
- **User tries admin action via direct API call:** `require_role` decorator returns 403; RLS denies row.
- **Stolen JWT:** valid until expiry (8h) — partial mitigation. Options: refresh-token rotation (default), revocation list (deferred to v1.1 if needed), shorter JWT TTL.

## Per-feature additions
- **AK03.c MOM upload (M7):** MIME spoofing, malware in document, infinite-loop prompt-injection, files containing PII shared cross-account. Mitigations: MIME validation, AV scan (Phase 2), Claude prompt scoping, RLS on `documents`.
- **F01 password reset (M2):** time-limited token (30min), one-time use, rate-limited.

## Out of threat surface
- DDoS at network layer (Vercel + Render handle)
- Physical security (Supabase, AWS responsibility)
- Operating-system CVEs of Supabase/Render hosts (provider responsibility)
