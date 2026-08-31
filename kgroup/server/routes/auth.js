/* =========================================================================
   KGROUP — /api/auth/*  (the endpoints behind window.KGAuth)
   -------------------------------------------------------------------------
   Each route reproduces one Supabase Auth call, including the shape of what it
   returned, so api.js can keep the browser-facing KGAuth contract unchanged.

     supabase.auth.signUp                 -> POST   /api/auth/signup
     supabase.auth.signInWithPassword     -> POST   /api/auth/signin
     supabase.auth.signInWithOAuth        -> GET    /api/auth/google (+ callback)
     supabase.auth.signOut                -> POST   /api/auth/signout
     supabase.auth.getUser                -> GET    /api/auth/user
     supabase.auth.updateUser({password}) -> POST   /api/auth/password
     supabase.auth.resetPasswordForEmail  -> POST   /api/auth/reset
     (recovery link lands on the app)     -> POST   /api/auth/reset/confirm
     supabase.rpc('invite_info')          -> GET    /api/auth/invite?code=
   ========================================================================= */
"use strict";

const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");

const db = require("../db");
const auth = require("../auth");
const mailer = require("../mailer");
const { HttpError } = require("../policies");

const router = express.Router();

const REQUIRE_CONFIRMATION = String(process.env.REQUIRE_EMAIL_CONFIRMATION || "") === "true";
const MIN_PASSWORD = 6; // matches the client-side checks in login.html / register.html

const normalizeEmail = (e) => String(e || "").trim().toLowerCase();

/** The public URL of the static site, used to build links in emails/redirects. */
function appUrl(req) {
  const configured = process.env.APP_URL;
  const base = configured || `${req.protocol}://${req.get("host")}`;
  return base.endsWith("/") ? base : base + "/";
}

/** The session payload the browser client stores, mirroring Supabase's shape. */
function sessionPayload(user, token) {
  return {
    user: {
      id: user.id,
      email: user.email,
      user_metadata: user.raw_user_meta_data || {},
      created_at: user.created_at,
    },
    session: token ? { access_token: token } : null,
  };
}

/* ------------------------------------------------------------------ *
 * SIGN UP                                                             *
 * ------------------------------------------------------------------ */
router.post("/signup", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const fullName = (req.body.full_name || "").trim() || email.split("@")[0];
    const role = req.body.role === "salesperson" ? "salesperson" : "admin";
    const inviteCode = req.body.invite_code ? String(req.body.invite_code) : null;

    if (!email || !email.includes("@")) throw new HttpError(400, "Please enter a valid email address.");
    if (password.length < MIN_PASSWORD) {
      throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters.`);
    }

    const existing = await db.one(`select id from public.users where lower(email) = $1`, [email]);
    if (existing) throw new HttpError(409, "An account with this email already exists.");

    // raw_user_meta_data is what handle_new_user() reads to decide between the
    // admin path (create a team) and the salesperson path (claim a roster row).
    const meta = { full_name: fullName, role };
    if (inviteCode) meta.invite_code = inviteCode;

    const user = await db.one(
      `insert into public.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at)
       values ($1, $2, $3::jsonb, $4)
       returning id, email, raw_user_meta_data, created_at, email_confirmed_at`,
      [email, await auth.hashPassword(password), JSON.stringify(meta), REQUIRE_CONFIRMATION ? null : new Date()]
    );

    // With confirmation required there is no session yet — exactly the
    // `res.user && !res.session` branch login.html and register.html handle.
    if (REQUIRE_CONFIRMATION) return res.status(201).json(sessionPayload(user, null));

    const token = auth.signSession(user);
    auth.setSessionCookie(res, token);
    return res.status(201).json(sessionPayload(user, token));
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * SIGN IN                                                             *
 * ------------------------------------------------------------------ */
router.post("/signin", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    if (!email || !password) throw new HttpError(400, "Please enter your email and password.");

    const user = await db.one(
      `select id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at
         from public.users where lower(email) = $1`,
      [email]
    );

    // Same generic message whether the address is unknown or the password is
    // wrong, so the endpoint cannot be used to enumerate accounts.
    const ok = user && (await auth.verifyPassword(password, user.encrypted_password));
    if (!ok) throw new HttpError(401, "Invalid login credentials.");

    if (REQUIRE_CONFIRMATION && !user.email_confirmed_at) {
      throw new HttpError(403, "Please confirm your email address before signing in.");
    }

    const token = auth.signSession(user);
    auth.setSessionCookie(res, token);
    return res.json(sessionPayload(user, token));
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * SIGN OUT                                                            *
 * ------------------------------------------------------------------ */
router.post("/signout", (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * CURRENT USER                                                        *
 * ------------------------------------------------------------------ */
router.get("/user", (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      user_metadata: req.user.raw_user_meta_data || {},
      created_at: req.user.created_at,
    },
  });
});

/* ------------------------------------------------------------------ *
 * CHANGE PASSWORD (signed in)                                         *
 * ------------------------------------------------------------------ */
router.post("/password", auth.requireUser, async (req, res, next) => {
  try {
    const password = String(req.body.password || "");
    if (password.length < MIN_PASSWORD) {
      throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters.`);
    }
    await db.query(
      `update public.users set encrypted_password = $2, updated_at = now() where id = $1`,
      [req.user.id, await auth.hashPassword(password)]
    );
    // Re-issue the session so the current tab keeps working after the change.
    auth.setSessionCookie(res, auth.signSession(req.user));
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * FORGOT PASSWORD                                                     *
 * ------------------------------------------------------------------ */
router.post("/reset", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) throw new HttpError(400, "Please enter your email address.");

    const user = await db.one(`select id, email from public.users where lower(email) = $1`, [email]);
    if (user) {
      const token = await auth.issueResetToken(user.id, 60);
      const link = `${appUrl(req)}reset-password.html?token=${encodeURIComponent(token)}`;
      const { subject, html, text } = mailer.resetEmail(link);
      await mailer.send({ to: user.email, subject, html, text });
    }

    // Always the same answer, whether or not the address exists — matching
    // Supabase's behaviour and avoiding account enumeration.
    return res.json({
      ok: true,
      mailer_configured: mailer.isConfigured(),
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/reset/confirm", async (req, res, next) => {
  try {
    const token = String(req.body.token || "");
    const password = String(req.body.password || "");
    if (!token) throw new HttpError(400, "This reset link is missing its token.");
    if (password.length < MIN_PASSWORD) {
      throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters.`);
    }
    const userId = await auth.consumeResetToken(token, password);
    if (!userId) throw new HttpError(400, "This reset link is invalid or has expired.");
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * INVITE LOOKUP  (was supabase.rpc('invite_info'))                    *
 * ------------------------------------------------------------------ */
router.get("/invite", async (req, res, next) => {
  try {
    const code = String(req.query.code || "");
    if (!code) return res.json({ invite: null });
    const row = await db.one(`select * from public.invite_info($1)`, [code]);
    return res.json({ invite: row || null });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * GOOGLE OAUTH  (was supabase.auth.signInWithOAuth)                   *
 * -------------------------------------------------------------------
 * Supabase brokered this for us. Here it is the standard authorization-code
 * flow against Google directly. It stays dormant — and says so clearly —
 * until GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are configured.
 * ------------------------------------------------------------------ */
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const googleConfigured = () => Boolean(GOOGLE_ID && GOOGLE_SECRET);

const redirectUri = (req) =>
  process.env.GOOGLE_REDIRECT_URI ||
  `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

router.get("/google", (req, res) => {
  if (!googleConfigured()) {
    return res.status(501).json({
      error:
        "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, " +
        "and add this app's callback URL in the Google Cloud console.",
    });
  }
  // `state` is a short-lived signed token — it is verified on the way back, so
  // a forged callback cannot start a session.
  const state = jwt.sign(
    { n: crypto.randomBytes(8).toString("hex"), next: String(req.query.next || "dashboard.html") },
    process.env.JWT_SECRET || "dev",
    { expiresIn: "10m" }
  );
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GOOGLE_ID);
  url.searchParams.set("redirect_uri", redirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return res.redirect(url.toString());
});

router.get("/google/callback", async (req, res, next) => {
  try {
    if (!googleConfigured()) throw new HttpError(501, "Google sign-in is not configured.");

    let next_ = "dashboard.html";
    try {
      const claims = jwt.verify(String(req.query.state || ""), process.env.JWT_SECRET || "dev");
      if (claims && claims.next) next_ = claims.next;
    } catch (_) {
      throw new HttpError(400, "This Google sign-in link is invalid or has expired.");
    }

    const code = String(req.query.code || "");
    if (!code) throw new HttpError(400, "Google did not return an authorization code.");

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_ID,
        client_secret: GOOGLE_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new HttpError(502, "Google rejected the sign-in attempt.");
    const tokens = await tokenRes.json();

    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) throw new HttpError(502, "Could not read your Google profile.");
    const info = await infoRes.json();

    const email = normalizeEmail(info.email);
    if (!email) throw new HttpError(400, "Your Google account did not share an email address.");

    let user = await db.one(
      `select id, email, raw_user_meta_data, created_at from public.users where lower(email) = $1`,
      [email]
    );

    if (user) {
      // Existing account (possibly password-based) — link the provider.
      await db.query(
        `update public.users
            set provider = 'google', provider_id = $2, email_confirmed_at = coalesce(email_confirmed_at, now()),
                updated_at = now()
          where id = $1`,
        [user.id, info.sub || null]
      );
    } else {
      // New Google user. The signup trigger gives them a team + admin profile,
      // matching what the Google button on the admin login page produced before.
      const meta = { full_name: info.name || email.split("@")[0], role: "admin" };
      user = await db.one(
        `insert into public.users (email, provider, provider_id, raw_user_meta_data, email_confirmed_at)
         values ($1, 'google', $2, $3::jsonb, now())
         returning id, email, raw_user_meta_data, created_at`,
        [email, info.sub || null, JSON.stringify(meta)]
      );
    }

    auth.setSessionCookie(res, auth.signSession(user));
    return res.redirect(appUrl(req) + next_);
  } catch (err) {
    return next(err);
  }
});

router.get("/google/status", (_req, res) => res.json({ configured: googleConfigured() }));

module.exports = router;
