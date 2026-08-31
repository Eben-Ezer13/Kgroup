/* =========================================================================
   KGROUP — Authentication (replaces Supabase Auth / GoTrue)
   -------------------------------------------------------------------------
   Supabase Auth was a hosted service; Neon is just a database, so the pieces
   GoTrue provided are reimplemented here:

     GoTrue                              ->  here
     ------------------------------------------------------------------
     auth.users table                    ->  public.users (db/schema.sql)
     bcrypt password hashing             ->  bcryptjs (same $2a/$2b format,
                                             so migrated hashes still verify)
     JWT session + refresh               ->  signSession() / verifySession()
     session persisted in localStorage   ->  httpOnly cookie + Bearer fallback
     auth.uid() inside RLS               ->  req.user.id, checked in policies.js

   The token is issued as an httpOnly cookie (so page JavaScript cannot read
   it) AND returned in the JSON body, which the browser client stores as a
   Bearer fallback. The fallback exists only so the API can be hosted on a
   different origin than the static site, where third-party cookies may be
   blocked.
   ========================================================================= */
"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("./db");

const COOKIE_NAME = "kg_session";
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 7);
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

/* JWT_SECRET is required in production. In development we fall back to a
   per-process random secret: the app still works, but restarting the server
   invalidates sessions — which is a loud enough hint to go set the variable. */
const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET must be set to at least 32 characters in production. " +
        'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  console.warn(
    "[auth] JWT_SECRET is unset or too short — using an ephemeral development " +
      "secret. Sessions will not survive a restart."
  );
  return crypto.randomBytes(48).toString("hex");
})();

/* ------------------------------------------------------------------ *
 * Passwords                                                           *
 * ------------------------------------------------------------------ */
async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/** Verifies against bcrypt hashes, including ones migrated out of Supabase. */
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch (_) {
    return false; // malformed hash in the row — treat as a failed login
  }
}

/* ------------------------------------------------------------------ *
 * Session tokens                                                      *
 * ------------------------------------------------------------------ */
function signSession(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: `${SESSION_TTL_DAYS}d` }
  );
}

function verifySession(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_) {
    return null; // expired / tampered / wrong secret
  }
}

/* Cookies must be `SameSite=None; Secure` when the API and the static site sit
   on different origins, otherwise the browser drops them on cross-site XHR. */
const crossSite = String(process.env.CROSS_SITE_COOKIES || "") === "true";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: crossSite || process.env.NODE_ENV === "production",
    sameSite: crossSite ? "none" : "lax",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

/* ------------------------------------------------------------------ *
 * Request identity                                                    *
 * ------------------------------------------------------------------ */
function tokenFromRequest(req) {
  const header = req.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return (req.cookies && req.cookies[COOKIE_NAME]) || null;
}

/**
 * Resolves the caller into `req.user` (the users row) and `req.profile` (the
 * profiles row) — the two things every authorization rule in policies.js needs.
 * Never rejects; routes decide whether anonymous access is allowed.
 */
async function attachUser(req, _res, next) {
  req.user = null;
  req.profile = null;
  const token = tokenFromRequest(req);
  if (!token) return next();

  const claims = verifySession(token);
  if (!claims || !claims.sub) return next();

  try {
    const user = await db.one(
      `select id, email, email_confirmed_at, provider, raw_user_meta_data, created_at
         from public.users where id = $1`,
      [claims.sub]
    );
    if (!user) return next(); // account deleted since the token was issued
    req.user = user;
    req.profile = await db.one(`select * from public.profiles where id = $1`, [user.id]);
  } catch (err) {
    // A database hiccup must not be mistaken for "signed out" on a write path,
    // so surface it rather than silently downgrading to anonymous.
    return next(err);
  }
  return next();
}

/** Route guard: 401 unless a valid session resolved. */
function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated." });
  return next();
}

/* ------------------------------------------------------------------ *
 * Password-reset tokens                                               *
 * ------------------------------------------------------------------ */
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Returns the raw token to email out; only its hash is stored. */
async function issueResetToken(userId, ttlMinutes = 60) {
  const raw = crypto.randomBytes(32).toString("hex");
  await db.query(
    `insert into public.password_reset_tokens (token_hash, user_id, expires_at)
     values ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [sha256(raw), userId, String(ttlMinutes)]
  );
  return raw;
}

/** Consumes a reset token and sets the new password. Single-use, atomic. */
async function consumeResetToken(rawToken, newPassword) {
  const hash = await hashPassword(newPassword);
  return db.tx(async (client) => {
    const { rows } = await client.query(
      `update public.password_reset_tokens
          set used_at = now()
        where token_hash = $1 and used_at is null and expires_at > now()
        returning user_id`,
      [sha256(rawToken)]
    );
    if (!rows.length) return null; // unknown, expired, or already used
    const userId = rows[0].user_id;
    await client.query(
      `update public.users
          set encrypted_password = $2, updated_at = now()
        where id = $1`,
      [userId, hash]
    );
    return userId;
  });
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireUser,
  issueResetToken,
  consumeResetToken,
};
