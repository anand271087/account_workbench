# F01 — Login & Authentication

## What it does

Lets a Beroe employee sign in with their email and password, then keeps them signed in for up to 8 hours. After 5 wrong password attempts the account is locked for 15 minutes. A forgotten-password link works from the same screen and is valid for 30 minutes.

The sign-in process is handled by Supabase (a managed authentication provider). The backend never sees the password — it only receives a short-lived signed token from Supabase that proves the user logged in successfully.

## Who uses it

Every user of the Account Workbench. After Sprint 1, all 11 BRD roles share the same login flow:

CSM · CS Team Manager · CS Director · VP — CSM · Commercial Owner · VP — Sales · Solutioning Manager · VP — Solutioning · Inside Sales Manager · VP — Inside Sales · Admin

## How it works (user flow)

1. User opens any AWB URL.
2. If not signed in, they're redirected to **`/login`**.
3. They enter their Beroe email and password and click **Sign in**.
4. The browser sends those credentials to Supabase.
5. Supabase verifies the password (it's stored hashed; we never see it).
6. Supabase returns a signed token (a JWT) valid for 8 hours.
7. The browser asks the backend "who am I?" by calling `/api/v1/me` with the token attached.
8. The backend verifies the token's signature, looks the user up in our `users` table, and returns their full name, email, role, and a list of capabilities (e.g. "can view admin panel").
9. The user lands on their home page and starts using the app.

## Business rules

- **Sign-up is closed.** Only an Admin can create new users (admin user-management UI ships in Sprint 5).
- **Email is the unique identifier.** Two accounts cannot share an email.
- **Lockout:** 5 consecutive failed attempts triggers a 15-minute lockout for that email. Counter resets on success.
- **Session length:** 8 hours of inactivity then the user is signed out and must re-authenticate.
- **Password reset:** "Forgot password" sends an email with a magic link valid for 30 minutes. Clicking the link prompts for a new password.
- **Provisioning gate:** even with a valid Supabase login, if the user is not in the AWB workspace's user table, they get an "Access denied — contact your admin" screen (not a generic 403).
- **No tab can render without authentication.** All routes other than `/login` and `/access-denied` require a signed-in user.

## What it stores

- Email, full name, role, team assignment — in the AWB workspace's `users` table.
- A copy of the user identity in Supabase Auth (managed by Supabase — we don't touch it directly).
- A short-lived (8 h) signed token in the user's browser.
- **Passwords are never stored by AWB.** Supabase stores them as bcrypt hashes.

## What gets logged

Every login, logout, lockout, and password reset is recorded in Supabase Auth's audit log. AWB also logs the same events in our application logs with a request ID for traceability.

## Edge cases user might hit

| Scenario | What happens |
|---|---|
| Wrong password | "Invalid email or password" appears under the form |
| 5 wrong passwords in a row | Account locked 15 min; clear message shown |
| Forgot password | "Forgot password?" link sends email; user can sign in via the link |
| Magic link expired | Asks the user to send a new one |
| Email exists in Supabase but not in AWB workspace | "Access denied — contact your admin" |
| Browser tab idle > 8 h | Next API call fails 401; UI redirects to `/login` |
| User signs out | Token revoked server-side; back to `/login` |
| Beroe SSO (Phase 2) | Same flow with a "Sign in with Beroe" button — no rebuild needed |

## Status

✅ Built (M2). Runs against the real Supabase project.

## Demo

Local: `pnpm dev` then open http://localhost:5173 and sign in with one of the seeded test users (passwords are placeholder until production user list lands).

| Email | Role |
|---|---|
| `anand@beroe-inc.com` | Admin |
| `santosh@beroe-inc.com` | VP — Sales |
| `megha@beroe-inc.com` | CS Director |
| `harish@beroe-inc.com` | CSM |
| `purnima@beroe-inc.com` | Solutioning Manager |
