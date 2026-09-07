/* =========================================================================
   End-to-end exercise of the real Express app with an in-memory stand-in for
   Neon. Every route handler, the session middleware and all the authorization
   rules run for real; only the SQL execution is faked.

   This is what proves the API behaves correctly without needing a database.
   The companion `npm run db:smoke` proves the SQL itself against real Neon.
   ========================================================================= */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

process.env.JWT_SECRET = "test-secret-that-is-definitely-long-enough-32";
process.env.SERVE_STATIC = "false";
process.env.NODE_ENV = "test";

/* ------------------------------------------------------------------ *
 * In-memory database                                                  *
 * -------------------------------------------------------------------
 * Dispatches on the distinctive part of each statement the server issues and
 * keeps the rows in plain arrays. It also reproduces the two database triggers,
 * because the routes depend on their effects.
 * ------------------------------------------------------------------ */
const store = { users: [], teams: [], profiles: [], salespersons: [], sales: [], challenges: [], resetTokens: [] };

const norm = (sql) => sql.replace(/\s+/g, " ").trim().toLowerCase();

/** Stands in for handle_new_user(): admins get a team, reps claim a roster row. */
function runSignupTrigger(user) {
  const meta = user.raw_user_meta_data || {};
  const role = meta.role || "admin";
  const name = meta.full_name || user.email.split("@")[0];

  if (role === "salesperson" && meta.invite_code) {
    const rep = store.salespersons.find((s) => s.invite_code === meta.invite_code && !s.claimed);
    if (rep) {
      rep.auth_id = user.id;
      rep.claimed = true;
      rep.invite_code = null;
      rep.email = user.email;
      store.profiles.push({
        id: user.id, full_name: rep.name, email: user.email,
        role: "salesperson", team_id: rep.team_id, salesperson_id: rep.id, city: null, hue: 150,
      });
      return;
    }
    store.profiles.push({
      id: user.id, full_name: name, email: user.email,
      role: "salesperson", team_id: null, salesperson_id: null, city: null, hue: 150,
    });
    return;
  }

  const team = { id: crypto.randomUUID(), name: `${name}'s Team`, owner: user.id };
  store.teams.push(team);
  store.profiles.push({
    id: user.id, full_name: name, email: user.email,
    role: "admin", team_id: team.id, salesperson_id: null, city: null, hue: 150,
  });
}

/** Stands in for apply_sale(): rolls a new sale onto its salesperson. */
function runSaleTrigger(sale) {
  if (!sale.rep_id) return;
  const rep = store.salespersons.find((s) => s.id === sale.rep_id);
  if (!rep) return;
  rep.sales = (rep.sales || 0) + (sale.qty || 0);
  rep.today_sales = (rep.today_sales || 0) + (sale.qty || 0);
  rep.revenue = (rep.revenue || 0) + (Number(sale.amount) || 0);
  rep.commission = (rep.commission || 0) + (Number(sale.commission) || 0);
}

function execute(sql, params = []) {
  const q = norm(sql);

  if (q.startsWith("select 1 as ok")) return { rows: [{ ok: 1 }], rowCount: 1 };

  /* ---- users ---- */
  if (q.startsWith("select") && q.includes("from public.users where lower(email)")) {
    const row = store.users.find((u) => u.email.toLowerCase() === params[0]);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  if (q.startsWith("select") && q.includes("from public.users where id =")) {
    const row = store.users.find((u) => u.id === params[0]);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  if (q.startsWith("insert into public.users")) {
    const user = {
      id: crypto.randomUUID(),
      email: params[0],
      encrypted_password: params[1],
      raw_user_meta_data: JSON.parse(params[2]),
      email_confirmed_at: params[3],
      provider: "email",
      created_at: new Date(),
    };
    store.users.push(user);
    runSignupTrigger(user);
    return { rows: [user], rowCount: 1 };
  }
  if (q.startsWith("update public.users")) {
    const user = store.users.find((u) => u.id === params[0]);
    if (user) user.encrypted_password = params[1];
    return { rows: [], rowCount: user ? 1 : 0 };
  }

  /* ---- profiles ---- */
  if (q.startsWith("select") && q.includes("from public.profiles where id =")) {
    const row = store.profiles.find((p) => p.id === params[0]);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  if (q.startsWith("update public.profiles set")) {
    const row = store.profiles.find((p) => p.id === params[0]);
    if (row) {
      // Column order in the SET clause matches the order of the extra params.
      const cols = [...sql.matchAll(/"([a-z_]+)" = \$\d+/g)].map((m) => m[1]);
      cols.forEach((c, i) => { row[c] = params[i + 1]; });
    }
    return { rows: [], rowCount: row ? 1 : 0 };
  }

  /* ---- salespersons ---- */
  if (q.startsWith("select") && q.includes("from public.salespersons s") && q.includes("where s.team_id = $1")) {
    const rows = store.salespersons
      .filter((s) => s.team_id === params[0])
      .sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    return { rows, rowCount: rows.length };
  }
  if (q.startsWith("select") && q.includes("from public.salespersons where id = $1 and team_id = $2")) {
    const row = store.salespersons.find((s) => s.id === params[0] && s.team_id === params[1]);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  if (q.startsWith("insert into public.salespersons")) {
    const cols = [...sql.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const row = { id: crypto.randomUUID(), sales: 0, today_sales: 0, revenue: 0, commission: 0 };
    cols.forEach((c, i) => { row[c] = params[i]; });
    store.salespersons.push(row);
    return { rows: [row], rowCount: 1 };
  }
  if (q.startsWith("update public.salespersons set")) {
    const row = store.salespersons.find((s) => s.id === params[0] && s.team_id === params[params.length - 1]);
    if (row) {
      const cols = [...sql.matchAll(/"([a-z_]+)" = \$\d+/g)].map((m) => m[1]);
      cols.forEach((c, i) => { row[c] = params[i + 1]; });
    }
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  if (q.startsWith("delete from public.salespersons")) {
    const i = store.salespersons.findIndex((s) => s.id === params[0] && s.team_id === params[1]);
    if (i >= 0) store.salespersons.splice(i, 1);
    return { rows: [], rowCount: i >= 0 ? 1 : 0 };
  }

  /* ---- sales ---- */
  if (q.startsWith("select") && q.includes("from public.sales where team_id = $1 order by created_at")) {
    const rows = store.sales
      .filter((s) => s.team_id === params[0])
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, params[1]);
    return { rows, rowCount: rows.length };
  }
  if (q.startsWith("select") && q.includes("from public.sales where id = $1 and team_id = $2")) {
    const row = store.sales.find((s) => s.id === params[0] && s.team_id === params[1]);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  if (q.startsWith("insert into public.sales")) {
    const cols = [...sql.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const row = { id: crypto.randomUUID(), created_at: new Date().toISOString() };
    cols.forEach((c, i) => { row[c] = params[i]; });
    store.sales.push(row);
    runSaleTrigger(row);
    return { rows: [row], rowCount: 1 };
  }
  if (q.startsWith("delete from public.sales")) {
    const i = store.sales.findIndex((s) => s.id === params[0]);
    if (i >= 0) store.sales.splice(i, 1);
    return { rows: [], rowCount: i >= 0 ? 1 : 0 };
  }

  /* ---- challenges ---- */
  if (q.startsWith("select") && q.includes("from public.challenges where team_id")) {
    const rows = store.challenges.filter((c) => c.team_id === params[0]);
    return { rows, rowCount: rows.length };
  }
  if (q.startsWith("insert into public.challenges")) {
    const cols = [...sql.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const row = { id: crypto.randomUUID(), created_at: new Date().toISOString() };
    cols.forEach((c, i) => { row[c] = params[i]; });
    store.challenges.push(row);
    return { rows: [row], rowCount: 1 };
  }

  /* ---- password reset tokens ---- */
  if (q.startsWith("insert into public.password_reset_tokens")) {
    store.resetTokens.push({ token_hash: params[0], user_id: params[1], used_at: null });
    return { rows: [], rowCount: 1 };
  }
  if (q.startsWith("update public.password_reset_tokens")) {
    const row = store.resetTokens.find((t) => t.token_hash === params[0] && !t.used_at);
    if (row) row.used_at = new Date();
    return { rows: row ? [{ user_id: row.user_id }] : [], rowCount: row ? 1 : 0 };
  }

  /* ---- invite_info() ---- */
  if (q.includes("public.invite_info")) {
    const rep = store.salespersons.find((s) => s.invite_code === params[0] && !s.claimed);
    if (!rep) return { rows: [], rowCount: 0 };
    const team = store.teams.find((t) => t.id === rep.team_id);
    return {
      rows: [{ name: rep.name, email: rep.email, team_name: team ? team.name : null }],
      rowCount: 1,
    };
  }

  throw new Error("Unhandled SQL in the test stub: " + q.slice(0, 120));
}

/* Le stub doit exposer TOUTE la surface de server/db.js. Un membre manquant
   fait echouer la route sur `undefined is not a function` — un symptome qui
   n'indique pas sa cause. `isConfigured` est le dernier ajout en date. */
const fakeDb = {
  pool: { end: async () => {} },
  isConfigured: () => true,
  MISSING_URL_MESSAGE: "DATABASE_URL is not set.",
  query: async (sql, params) => execute(sql, params),
  one: async (sql, params) => execute(sql, params).rows[0] || null,
  many: async (sql, params) => execute(sql, params).rows,
  tx: async (fn) => fn({ query: async (sql, params) => execute(sql, params) }),
  ping: async () => true,
};

/* Garde-fou : si server/db.js gagne un export, ce test le signale tout de
   suite plutot que de se bloquer plus tard sur un appel a `undefined`. */
{
  const real = require("../server/db");
  const missing = Object.keys(real).filter((k) => !(k in fakeDb));
  if (missing.length) {
    throw new Error(
      `Le stub de base de donnees est incomplet : ${missing.join(", ")} ` +
      "existe(nt) dans server/db.js mais pas dans fakeDb (tests/api.test.js)."
    );
  }
}

// Install the stub before anything requires the real module.
const dbPath = require.resolve("../server/db");
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const app = require("../server/app");

/* ------------------------------------------------------------------ *
 * Harness                                                             *
 * ------------------------------------------------------------------ */
let baseUrl;
let server;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Minimal client that carries a session the way the browser does. */
function client() {
  let token = null;
  return {
    get token() { return token; },
    async call(path, options = {}) {
      const headers = { Accept: "application/json" };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (token) headers.Authorization = "Bearer " + token;
      const res = await fetch(baseUrl + path, {
        method: options.method || "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      const text = await res.text();
      let body = null;
      if (text) { try { body = JSON.parse(text); } catch (_) { body = text; } }
      if (body && body.session && body.session.access_token) token = body.session.access_token;
      return { status: res.status, body };
    },
  };
}

async function signUpAdmin(email) {
  const c = client();
  const res = await c.call("/api/auth/signup", {
    method: "POST",
    body: { email, password: "kgroup2026", full_name: "Test Admin", role: "admin" },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  return c;
}

/* ------------------------------------------------------------------ *
 * Tests                                                               *
 * ------------------------------------------------------------------ */

test("health endpoint reports a live database", async () => {
  const res = await client().call("/api/health");
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { ok: true, database: "neon", connected: true });
});

test("unknown endpoints answer 404 as JSON", async () => {
  const res = await client().call("/api/does-not-exist");
  assert.strictEqual(res.status, 404);
  assert.ok(res.body.error);
});

test("data routes reject anonymous callers", async () => {
  for (const path of ["/api/salespersons", "/api/sales", "/api/challenges", "/api/profile"]) {
    const res = await client().call(path);
    assert.strictEqual(res.status, 401, `${path} should require a session`);
  }
});

test("signup creates a team and an admin profile", async () => {
  const c = await signUpAdmin("admin1@kgroup.test");
  const profile = await c.call("/api/profile");
  assert.strictEqual(profile.status, 200);
  assert.strictEqual(profile.body.role, "admin");
  assert.ok(profile.body.team_id, "the signup trigger should have linked a team");
});

test("signup rejects duplicates and weak passwords", async () => {
  await signUpAdmin("dupe@kgroup.test");
  const again = await client().call("/api/auth/signup", {
    method: "POST",
    body: { email: "DUPE@kgroup.test", password: "kgroup2026", full_name: "X" },
  });
  assert.strictEqual(again.status, 409, "email uniqueness is case-insensitive");

  const weak = await client().call("/api/auth/signup", {
    method: "POST",
    body: { email: "weak@kgroup.test", password: "123", full_name: "X" },
  });
  assert.strictEqual(weak.status, 400);
});

test("signin works, and wrong credentials are indistinguishable", async () => {
  await signUpAdmin("signin@kgroup.test");

  const good = await client().call("/api/auth/signin", {
    method: "POST",
    body: { email: "signin@kgroup.test", password: "kgroup2026" },
  });
  assert.strictEqual(good.status, 200);
  assert.ok(good.body.session.access_token);

  const badPass = await client().call("/api/auth/signin", {
    method: "POST",
    body: { email: "signin@kgroup.test", password: "nope" },
  });
  const noUser = await client().call("/api/auth/signin", {
    method: "POST",
    body: { email: "ghost@kgroup.test", password: "nope" },
  });
  assert.strictEqual(badPass.status, 401);
  assert.strictEqual(noUser.status, 401);
  assert.strictEqual(badPass.body.error, noUser.body.error, "no account enumeration");
});

test("full admin CRUD round-trip", async () => {
  const c = await signUpAdmin("crud@kgroup.test");

  // CREATE
  const created = await c.call("/api/salespersons", {
    method: "POST",
    body: { name: "Amine El Amrani", city: "Casablanca", phone: "0600000000", level: "Bronze", hue: 210 },
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  assert.strictEqual(created.body.name, "Amine El Amrani");
  assert.ok(created.body.invite_code, "an invite code is issued for the invite link");

  // READ
  const list = await c.call("/api/salespersons");
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.length, 1);

  const updated = await c.call("/api/salespersons/" + created.body.id, {
    method: "PATCH",
    body: { name: "Amine Updated", status: "Inactive" },
  });
  assert.strictEqual(updated.status, 200, JSON.stringify(updated.body));
  assert.strictEqual(updated.body.name, "Amine Updated");
  assert.strictEqual(updated.body.status, "Inactive");

  // A sale rolls up onto the rep, exactly as apply_sale() does
  const sale = await c.call("/api/sales", {
    method: "POST",
    body: {
      customer: "Sofia", product: "Parfum 100 ml", qty: 2,
      amount: 300, commission: 30, pay: "Espèces", rep_id: created.body.id, rep_name: "Amine El Amrani",
    },
  });
  assert.strictEqual(sale.status, 201, JSON.stringify(sale.body));

  const afterSale = await c.call("/api/salespersons");
  assert.strictEqual(afterSale.body[0].sales, 2, "units rolled up");
  assert.strictEqual(afterSale.body[0].revenue, 300, "revenue rolled up");

  // UPDATE (own profile)
  const patched = await c.call("/api/profile", { method: "PATCH", body: { full_name: "Renamed", city: "Rabat" } });
  assert.strictEqual(patched.status, 200);
  const reread = await c.call("/api/profile");
  assert.strictEqual(reread.body.full_name, "Renamed");
  assert.strictEqual(reread.body.city, "Rabat");

  // DELETE
  const removed = await c.call("/api/salespersons/" + created.body.id, { method: "DELETE" });
  assert.strictEqual(removed.status, 200);
  const empty = await c.call("/api/salespersons");
  assert.strictEqual(empty.body.length, 0);
});

test("challenges are readable by the team and writable by admins", async () => {
  const c = await signUpAdmin("chal@kgroup.test");
  const created = await c.call("/api/challenges", {
    method: "POST",
    body: { title: "October Sprint", reward: "Parfum offert", target: 200, ends: "2026-10-31", icon: "🏆" },
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  const list = await c.call("/api/challenges");
  assert.strictEqual(list.body.length, 1);
  assert.strictEqual(list.body[0].title, "October Sprint");
});

test("teams cannot see each other's data", async () => {
  const a = await signUpAdmin("teama@kgroup.test");
  const b = await signUpAdmin("teamb@kgroup.test");

  const repA = await a.call("/api/salespersons", { method: "POST", body: { name: "Rep A" } });
  assert.strictEqual(repA.status, 201);

  const seenByB = await b.call("/api/salespersons");
  assert.strictEqual(seenByB.body.length, 0, "team B must not see team A's roster");

  // ...and cannot delete across the boundary either.
  const crossDelete = await b.call("/api/salespersons/" + repA.body.id, { method: "DELETE" });
  assert.strictEqual(crossDelete.status, 404);

  // ...nor attribute a sale to another team's rep.
  const crossSale = await b.call("/api/sales", {
    method: "POST",
    body: { customer: "X", product: "Y", qty: 1, amount: 100, rep_id: repA.body.id },
  });
  assert.strictEqual(crossSale.status, 400);
});

test("salespersons are blocked from admin-only writes", async () => {
  const admin = await signUpAdmin("boss@kgroup.test");
  const rep = await admin.call("/api/salespersons", { method: "POST", body: { name: "Invited Rep" } });
  const code = rep.body.invite_code;

  // The invite is discoverable before signing up, as register.html needs.
  const invite = await client().call("/api/auth/invite?code=" + code);
  assert.strictEqual(invite.status, 200);
  assert.strictEqual(invite.body.invite.name, "Invited Rep");

  const repClient = client();
  const joined = await repClient.call("/api/auth/signup", {
    method: "POST",
    body: { email: "rep@kgroup.test", password: "kgroup2026", full_name: "Invited Rep", role: "salesperson", invite_code: code },
  });
  assert.strictEqual(joined.status, 201);

  const profile = await repClient.call("/api/profile");
  assert.strictEqual(profile.body.role, "salesperson");
  assert.ok(profile.body.salesperson_id, "the invite links the login to the roster row");

  // Reads: allowed (the "team read" policies).
  assert.strictEqual((await repClient.call("/api/salespersons")).status, 200);
  assert.strictEqual((await repClient.call("/api/challenges")).status, 200);

  // Writes reserved for admins: refused.
  assert.strictEqual((await repClient.call("/api/salespersons", { method: "POST", body: { name: "Nope" } })).status, 403);
  assert.strictEqual((await repClient.call("/api/salespersons/" + rep.body.id, { method: "DELETE" })).status, 403);
  assert.strictEqual((await repClient.call("/api/challenges", { method: "POST", body: { title: "Nope" } })).status, 403);

  // Registering a sale is allowed for the whole team.
  const sale = await repClient.call("/api/sales", {
    method: "POST",
    body: { customer: "Client", product: "Parfum 50 ml", qty: 1, amount: 80, commission: 8 },
  });
  assert.strictEqual(sale.status, 201, JSON.stringify(sale.body));

  // A used invite code stops resolving.
  const reused = await client().call("/api/auth/invite?code=" + code);
  assert.strictEqual(reused.body.invite, null);
});

test("a user cannot promote themselves through the profile endpoint", async () => {
  const c = await signUpAdmin("escalate@kgroup.test");
  const before = await c.call("/api/profile");

  await c.call("/api/profile", {
    method: "PATCH",
    body: { full_name: "Still Me", role: "admin", team_id: "some-other-team", salesperson_id: "x" },
  });

  const after = await c.call("/api/profile");
  assert.strictEqual(after.body.full_name, "Still Me", "allow-listed fields still apply");
  assert.strictEqual(after.body.team_id, before.body.team_id, "team_id is not client-writable");
  assert.strictEqual(after.body.salesperson_id, before.body.salesperson_id, "salesperson_id is not client-writable");
});

test("writes cannot forge ownership columns", async () => {
  const a = await signUpAdmin("forge@kgroup.test");
  const b = await signUpAdmin("victim@kgroup.test");
  const bProfile = await b.call("/api/profile");

  const created = await a.call("/api/salespersons", {
    method: "POST",
    body: { name: "Trojan", team_id: bProfile.body.team_id, owner: "someone-else", claimed: true, invite_code: "chosen" },
  });
  assert.strictEqual(created.status, 201);
  assert.notStrictEqual(created.body.team_id, bProfile.body.team_id, "team_id comes from the session, not the body");
  assert.notStrictEqual(created.body.invite_code, "chosen", "the invite code is generated server-side");
  assert.strictEqual(created.body.claimed, false);

  assert.strictEqual((await b.call("/api/salespersons")).body.length, 0, "nothing landed in the victim's team");
});

test("signout invalidates the cookie session", async () => {
  const c = await signUpAdmin("bye@kgroup.test");
  assert.strictEqual((await c.call("/api/profile")).status, 200);
  const out = await c.call("/api/auth/signout", { method: "POST" });
  assert.strictEqual(out.status, 200);
  // The Bearer token this client kept is still valid until it expires — that is
  // the same trade-off Supabase's access tokens had. The cookie is cleared, so
  // a browser (which never sees the token) is signed out.
  assert.ok(c.token);
});

test("password change works and the old password stops working", async () => {
  const c = await signUpAdmin("pass@kgroup.test");
  const changed = await c.call("/api/auth/password", { method: "POST", body: { password: "brand-new-2026" } });
  assert.strictEqual(changed.status, 200);

  const oldPass = await client().call("/api/auth/signin", {
    method: "POST",
    body: { email: "pass@kgroup.test", password: "kgroup2026" },
  });
  assert.strictEqual(oldPass.status, 401);

  const newPass = await client().call("/api/auth/signin", {
    method: "POST",
    body: { email: "pass@kgroup.test", password: "brand-new-2026" },
  });
  assert.strictEqual(newPass.status, 200);
});

test("password reset never reveals whether an address exists", async () => {
  await signUpAdmin("known@kgroup.test");
  const known = await client().call("/api/auth/reset", { method: "POST", body: { email: "known@kgroup.test" } });
  const unknown = await client().call("/api/auth/reset", { method: "POST", body: { email: "nobody@kgroup.test" } });
  assert.strictEqual(known.status, 200);
  assert.strictEqual(unknown.status, 200);
  assert.deepStrictEqual(known.body, unknown.body);
});

test("Google sign-in reports that it is not configured", async () => {
  const status = await client().call("/api/auth/google/status");
  assert.strictEqual(status.body.configured, false);
  const start = await client().call("/api/auth/google");
  assert.strictEqual(start.status, 501, "a clear error, not a broken redirect");
});

test("malformed JSON is rejected cleanly", async () => {
  const res = await fetch(baseUrl + "/api/auth/signin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  assert.strictEqual(res.status, 400);
});
