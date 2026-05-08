// One-shot seed script — creates 5 placeholder users in Supabase Auth + public.users.
// Idempotent. Re-run safely; existing users are updated, not duplicated.
//
// Run from repo root:  node scripts/seed_users.mjs
//
// Reads:
//   - apps/api/.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Writes:
//   - auth.users   (via Auth Admin API)
//   - public.users (via PostgREST with service_role key)

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");

function loadEnv(file) {
  const txt = fs.readFileSync(path.join(ROOT, file), "utf8");
  const out = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const apiEnv = loadEnv("apps/api/.env");
const SUPABASE_URL = apiEnv.SUPABASE_URL;
const SR_KEY = apiEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SR_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in apps/api/.env");
  process.exit(1);
}

// === PLACEHOLDER USERS — change later ===
const SEED = [
  { email: "anand@beroe-inc.com",        full_name: "Anand",            role: "admin",                password: "Beroe@Anand2026" },
  { email: "santosh@beroe-inc.com",      full_name: "Santosh Peshkar",  role: "vp_sales",             password: "Beroe@Santosh2026" },
  { email: "harish@beroe-inc.com",       full_name: "Harish S",         role: "csm",                  password: "Beroe@Harish2026" },
  { email: "megha@beroe-inc.com",        full_name: "Megha Aggarwal",   role: "cs_director",          password: "Beroe@Megha2026" },
  { email: "purnima@beroe-inc.com",      full_name: "Purnima",          role: "solutioning_manager",  password: "Beroe@Purnima2026" },
  { email: "team.lead@beroe-inc.com",    full_name: "APAC Team Lead",   role: "cs_team_manager",      password: "Beroe@TeamLead2026" },
  { email: "csm2@beroe-inc.com",         full_name: "Second CSM",       role: "csm",                  password: "Beroe@CSM2_2026" },
];

async function authAdmin(method, path, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      apikey: SR_KEY,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

async function pgRest(method, path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      apikey: SR_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

async function findAuthUser(email) {
  // List users and find by email (the Admin API doesn't take email as a query param)
  const r = await authAdmin("GET", `/users?per_page=200`);
  if (r.status !== 200) return null;
  return r.body.users?.find((u) => u.email === email) || null;
}

async function upsertUser(seed) {
  const existing = await findAuthUser(seed.email);
  let authUser;
  if (existing) {
    // Reset password and metadata so the script is idempotent
    const upd = await authAdmin("PUT", `/users/${existing.id}`, {
      password: seed.password,
      email_confirm: true,
      user_metadata: { full_name: seed.full_name, role: seed.role },
    });
    if (upd.status >= 400) throw new Error(`update auth user failed: ${JSON.stringify(upd.body)}`);
    authUser = upd.body;
    console.log(`  [updated]  ${seed.email}  (auth uid ${authUser.id})`);
  } else {
    const ins = await authAdmin("POST", `/users`, {
      email: seed.email,
      password: seed.password,
      email_confirm: true,
      user_metadata: { full_name: seed.full_name, role: seed.role },
    });
    if (ins.status >= 400) throw new Error(`create auth user failed: ${JSON.stringify(ins.body)}`);
    authUser = ins.body;
    console.log(`  [created]  ${seed.email}  (auth uid ${authUser.id})`);
  }

  // Upsert into public.users (uses unique on id and on email)
  const up = await pgRest("POST", "/users?on_conflict=id", [
    {
      id: authUser.id,
      email: seed.email,
      full_name: seed.full_name,
      role: seed.role,
    },
  ]);
  if (up.status >= 400) throw new Error(`upsert public.users failed: ${JSON.stringify(up.body)}`);
}

console.log("Seeding placeholder users (5)...\n");
for (const s of SEED) {
  try {
    await upsertUser(s);
  } catch (e) {
    console.error(`  [FAIL]    ${s.email}: ${e.message}`);
  }
}

console.log("\nVerifying public.users...");
const verify = await pgRest("GET", "/users?select=email,full_name,role&order=email");
console.table(verify.body);
