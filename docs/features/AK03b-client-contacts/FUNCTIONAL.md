# AK03.b — Client Contacts

## What it does
Captures the client-side stakeholder roster for an account — the people the Beroe team works with on the customer side. Each contact has a name, title, contact details, role on the buying committee, level of influence, and two flags: **SPOC** (single point of contact) and **Sponsor** (executive sponsor). Contacts can be soft-deleted; admins can restore them within 30 days.

## Who uses it

| Role | View | Edit |
|---|---|---|
| Admin | ✅ all accounts | ✅ all accounts |
| CS Director | ✅ all | ✅ all |
| VP — CSM | ✅ all | ✅ all |
| VP — Sales | ✅ all | ❌ |
| VP — Solutioning | ✅ all | ❌ |
| VP — Inside Sales | ✅ all | ❌ |
| CSM | ✅ all | ✅ own portfolio only |
| CS Team Manager | ✅ all | ✅ own + team |
| Solutioning Manager | ✅ all | ✅ all |
| Inside Sales Manager | ✅ assigned | ✅ assigned |
| Commercial Owner | ✅ own | ❌ |

(Per `Roles_Access_Matrix_Reviewed_05072026.xlsx`. Where the matrix and BRD §3.2 narrative disagree, **the matrix wins**.)

## How it works (user flow)

1. From the Account Profile, the user clicks the **Contacts** sub-tab.
2. The system shows a table of active contacts with name, title, email/phone, role, influence pill (High/Medium/Low), and SPOC/Sponsor flags.
3. If the user can edit:
   - Click **+ Add contact** → modal with form (name required; everything else optional).
   - Click **Edit** on a row → same modal pre-filled.
   - Click **Delete** on a row → confirmation, then the row is soft-deleted (still in the database, but hidden from the list).
4. If the user is an admin, they can tick **Show deleted** to see contacts that were soft-deleted in the last 30 days, and **Restore** them.
5. Every change shows up in the account's **Activity** feed (Overview tab) automatically.

## Business rules

- **Name is the only required field.** Everything else is optional and can be filled in later.
- **Email is validated** as a real email address before saving.
- **SPOC** and **Sponsor** are independent — the same person can be both, or neither.
- **Soft delete window:** 30 days. After that, the row is hard-deleted by a future scheduled job (lands in admin tooling sprint).
- **Only admins can restore** a soft-deleted contact.
- **Only admins can view deleted contacts** at all (others see only active rows).

## What it stores

For each contact: name, job title, email, phone, role on the buying committee (Decision Maker / Influencer / End User / Finance / IT), influence level (High / Medium / Low), SPOC flag, Sponsor flag, plus timestamps and the soft-delete date.

## What gets logged

Every insert, update, and delete on a contact creates an entry in the activity feed showing **who** changed **what** **when**, with the old and new values. The entry is scoped to the parent account so it appears on that account's Overview activity feed.

## Edge cases user might hit

| Scenario | What happens |
|---|---|
| Try to save a contact with no name | Shows "Name is required" error inline. |
| Try to save with a malformed email | Server returns 422; modal shows the validation error. |
| CSM tries to add a contact on an account they don't own | Server returns 403; UI hides the **Add contact** button anyway. |
| CSM tries to edit a SPOC/sponsor on someone else's account | Server returns 403; UI shows the contact read-only (no Edit/Delete buttons). |
| Admin tries to restore a contact deleted >30 days ago | Server returns 400 with "Restore window has expired". |
| Non-admin tries to view deleted contacts (URL hack) | Server returns 403; the toggle isn't even shown in the UI. |

## Status
✅ Built — M6.

## Demo
1. Log in as **anand@beroe-inc.com** (admin).
2. Open any account (e.g., Siemens Energy).
3. Click **Contacts** → see 4 seeded contacts incl. SPOC + sponsor.
4. Click **+ Add contact** → fill in just a name → Save.
5. Click **Delete** on the new row → confirm.
6. Tick **Show deleted** → see the deleted row → click **Restore**.
7. Open Overview → see all the activity entries in the feed.
