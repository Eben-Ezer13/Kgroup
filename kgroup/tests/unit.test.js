/* =========================================================================
   Tests that need no database — the pure logic that decides who may do what,
   plus the password and session primitives that replaced Supabase Auth.
   Run with:  npm test
   ========================================================================= */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

// server/db.js refuses to load without a connection string. Nothing here opens
// a connection; pg only dials out on the first query.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?sslmode=require";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-that-is-definitely-long-enough-32";

const { HttpError, teamScope, roleOf, isAdmin, requireAdmin, canMutateSale } = require("../server/policies");
const auth = require("../server/auth");

const req = (user, profile) => ({ user, profile });
const ADMIN = req({ id: "u-admin" }, { id: "u-admin", role: "admin", team_id: "team-1" });
const REP = req({ id: "u-rep" }, { id: "u-rep", role: "salesperson", team_id: "team-1" });
const OTHER_TEAM = req({ id: "u-x" }, { id: "u-x", role: "admin", team_id: "team-2" });
const NO_TEAM = req({ id: "u-new" }, { id: "u-new", role: "admin", team_id: null });

/* ---- teamScope: the "team_id = my_team_id()" predicate ------------------ */
test("teamScope returns the caller's team", () => {
  assert.strictEqual(teamScope(ADMIN), "team-1");
  assert.strictEqual(teamScope(REP), "team-1");
  assert.strictEqual(teamScope(OTHER_TEAM), "team-2");
});

test("teamScope throws rather than returning a null scope", () => {
  // A null scope would silently produce a query matching nothing — or, if a
  // WHERE clause were ever dropped, everything. Failing loudly is the point.
  assert.throws(() => teamScope(NO_TEAM), (err) => err instanceof HttpError && err.status === 403);
});

/* ---- roles -------------------------------------------------------------- */
test("roleOf defaults to admin exactly as KGAuth.role() did", () => {
  assert.strictEqual(roleOf(ADMIN), "admin");
  assert.strictEqual(roleOf(REP), "salesperson");
  assert.strictEqual(roleOf(req({ id: "u" }, null)), "admin");
});

test("requireAdmin mirrors my_role() = 'admin'", () => {
  assert.doesNotThrow(() => requireAdmin(ADMIN));
  assert.throws(() => requireAdmin(REP), (err) => err instanceof HttpError && err.status === 403);
});

test("isAdmin distinguishes the two roles", () => {
  assert.strictEqual(isAdmin(ADMIN), true);
  assert.strictEqual(isAdmin(REP), false);
});

/* ---- sales: mine or admin ---------------------------------------------- */
test("canMutateSale allows owners and admins only", () => {
  const ownSale = { id: "s1", owner: "u-rep" };
  const otherSale = { id: "s2", owner: "u-someone-else" };

  assert.strictEqual(canMutateSale(REP, ownSale), true, "a rep may touch their own sale");
  assert.strictEqual(canMutateSale(REP, otherSale), false, "a rep may not touch someone else's");
  assert.strictEqual(canMutateSale(ADMIN, otherSale), true, "an admin may touch any team sale");
});

/* ---- passwords ---------------------------------------------------------- */
test("password hashing round-trips and rejects wrong input", async () => {
  const hash = await auth.hashPassword("kgroup2026");
  assert.match(hash, /^\$2[aby]\$/, "bcrypt format, so Supabase hashes stay verifiable");
  assert.strictEqual(await auth.verifyPassword("kgroup2026", hash), true);
  assert.strictEqual(await auth.verifyPassword("wrong", hash), false);
});

test("password verification survives missing or malformed hashes", async () => {
  // An OAuth-only account has encrypted_password = null; that must be a failed
  // login, not a crash, and not an accidental success.
  assert.strictEqual(await auth.verifyPassword("anything", null), false);
  assert.strictEqual(await auth.verifyPassword("anything", "not-a-bcrypt-hash"), false);
});

/* ---- sessions ----------------------------------------------------------- */
test("session tokens round-trip and carry the user id", () => {
  const token = auth.signSession({ id: "user-123", email: "a@b.co" });
  const claims = auth.verifySession(token);
  assert.strictEqual(claims.sub, "user-123");
  assert.strictEqual(claims.email, "a@b.co");
});

test("tampered or foreign tokens are rejected", () => {
  const token = auth.signSession({ id: "user-123", email: "a@b.co" });
  assert.strictEqual(auth.verifySession(token.slice(0, -3) + "aaa"), null);
  assert.strictEqual(auth.verifySession("not.a.token"), null);
  assert.strictEqual(auth.verifySession(""), null);
});
