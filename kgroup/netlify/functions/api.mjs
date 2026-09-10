import { neon } from "@neondatabase/serverless";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const TTL_DAYS = Math.max(1, Number(process.env.SESSION_TTL_DAYS || 14));
const COOKIE = process.env.SESSION_COOKIE_NAME || "kg_session";
const APP_URL = (process.env.APP_URL || "http://localhost:8888").replace(/\/$/, "");
const sql = () => {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured");
  return neon(process.env.DATABASE_URL);
};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});
const fail = (message, status = 400) => json({ error: message }, status);
const safeText = (value, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const emailOf = value => safeText(value, 254).toLowerCase();
const token = () => randomBytes(32).toString("base64url");
const digest = value => createHash("sha256").update(value).digest("hex");
const parseCookies = request => Object.fromEntries((request.headers.get("cookie") || "").split(";").map(v => v.trim().split(/=(.*)/s)).filter(([k]) => k));
const cookie = (value, maxAge = TTL_DAYS * 86400) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${APP_URL.startsWith("https://") ? "; Secure" : ""}`;
const passwordHash = async password => {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString("base64url")}`;
};
const passwordMatches = async (password, encoded) => {
  const [, salt, expected] = String(encoded || "").split("$");
  if (!salt || !expected) return false;
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const target = Buffer.from(expected, "base64url");
  return actual.length === target.length && timingSafeEqual(actual, target);
};
const bodyOf = async request => { try { return await request.json(); } catch { return {}; } };

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error("Email delivery is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error("Unable to send email");
}

async function issueEmailToken(db, userId, purpose) {
  const raw = token();
  await db`delete from email_tokens where user_id = ${userId} and purpose = ${purpose} and used_at is null`;
  await db`insert into email_tokens (user_id, purpose, token_hash, expires_at)
    values (${userId}, ${purpose}, ${digest(raw)}, now() + interval '1 hour')`;
  return raw;
}
async function sessionUser(request) {
  const raw = parseCookies(request)[COOKIE];
  if (!raw) return null;
  const db = sql();
  const rows = await db`select u.id, u.email, u.full_name, u.role, u.team_id, u.salesperson_id, u.city, u.hue, u.email_verified_at
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${digest(raw)} and s.expires_at > now()`;
  return rows[0] || null;
}
const publicUser = user => user && ({ id: user.id, email: user.email, full_name: user.full_name, role: user.role, team_id: user.team_id, salesperson_id: user.salesperson_id, city: user.city, hue: user.hue, email_verified: Boolean(user.email_verified_at) });
async function requireUser(request) { const user = await sessionUser(request); if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 }); return user; }
function requireAdmin(user) { if (user.role !== "admin") throw Object.assign(new Error("Administrator access required"), { status: 403 }); }
async function requireTeamEntity(db, table, id, user) {
  const rows = table === "salespersons"
    ? await db`select * from salespersons where id = ${id} and team_id = ${user.team_id}`
    : await db`select * from challenges where id = ${id} and team_id = ${user.team_id}`;
  if (!rows[0]) throw Object.assign(new Error("Resource not found"), { status: 404 });
  return rows[0];
}
function routeOf(request) {
  const path = new URL(request.url).pathname;
  const at = path.indexOf("/api/");
  return at >= 0 ? path.slice(at + 4) || "/" : (path.endsWith("/api") ? "/" : path);
}

async function authRoutes(request, path) {
  const db = sql();
  const data = await bodyOf(request);
  if (path === "/auth/signup" && request.method === "POST") {
    const email = emailOf(data.email), name = safeText(data.fullName, 120), password = String(data.password || ""), inviteCode = safeText(data.inviteCode, 100);
    if (!/^\S+@\S+\.\S+$/.test(email) || !name || password.length < 10) return fail("Enter a valid name, email and password of at least 10 characters.");
    let role = "admin", teamId = null, salespersonId = null;
    if (inviteCode) {
      const invited = await db`select id, team_id, name from salespersons where invite_code = ${inviteCode} and claimed = false`;
      if (!invited[0]) return fail("This invitation is invalid or has already been used.");
      role = "salesperson"; teamId = invited[0].team_id; salespersonId = invited[0].id;
    }
    const exists = await db`select id from users where email = ${email}`;
    if (exists[0]) return fail("An account already exists for this email.", 409);
    const hash = await passwordHash(password);
    const created = await db`insert into users (email, password_hash, full_name, role, team_id, salesperson_id)
      values (${email}, ${hash}, ${name}, ${role}, ${teamId}, ${salespersonId}) returning id, email, full_name`;
    const user = created[0];
    if (role === "admin") {
      const team = await db`insert into teams (name, owner) values (${name + "'s Team"}, ${user.id}) returning id`;
      await db`update users set team_id = ${team[0].id} where id = ${user.id}`;
    } else {
      await db`update salespersons set auth_id = ${user.id}, claimed = true, invite_code = null, email = ${email} where id = ${salespersonId}`;
    }
    try {
      const verify = await issueEmailToken(db, user.id, "verify_email");
      await sendEmail(email, "Confirm your KGROUP email", `<p>Hello ${name},</p><p><a href="${APP_URL}/login.html?verify=${encodeURIComponent(verify)}">Confirm your email address</a>.</p><p>This link expires in one hour.</p>`);
    } catch (error) {
      // Keep the account unverified. The user can request a fresh link once email delivery is configured.
      return json({ pendingVerification: true, emailSent: false, message: "Account created, but email delivery is not configured." }, 201);
    }
    return json({ pendingVerification: true, emailSent: true }, 201);
  }
  if (path === "/auth/confirm" && request.method === "POST") {
    const raw = safeText(data.token, 200); if (!raw) return fail("Confirmation token is required.");
    const found = await db`select id, user_id from email_tokens where token_hash = ${digest(raw)} and purpose = 'verify_email' and used_at is null and expires_at > now()`;
    if (!found[0]) return fail("This confirmation link is invalid or expired.");
    await db`update email_tokens set used_at = now() where id = ${found[0].id}`;
    await db`update users set email_verified_at = now(), updated_at = now() where id = ${found[0].user_id}`;
    return json({ ok: true });
  }
  if (path === "/auth/signin" && request.method === "POST") {
    const email = emailOf(data.email), password = String(data.password || "");
    const rows = await db`select * from users where email = ${email}`;
    const user = rows[0];
    if (!user || !user.password_hash || !(await passwordMatches(password, user.password_hash))) return fail("Invalid email or password.", 401);
    if (!user.email_verified_at) return fail("Please confirm your email address before signing in.", 403);
    const raw = token();
    await db`insert into sessions (user_id, token_hash, expires_at) values (${user.id}, ${digest(raw)}, now() + (${TTL_DAYS} * interval '1 day'))`;
    return json({ user: publicUser(user) }, 200, { "set-cookie": cookie(raw) });
  }
  if (path === "/auth/signout" && request.method === "POST") {
    const raw = parseCookies(request)[COOKIE]; if (raw) await db`delete from sessions where token_hash = ${digest(raw)}`;
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }
  if (path === "/auth/me" && request.method === "GET") return json({ user: publicUser(await sessionUser(request)) });
  if (path === "/auth/reset/request" && request.method === "POST") {
    const email = emailOf(data.email), rows = await db`select id, full_name from users where email = ${email}`;
    if (rows[0]) {
      try {
        const raw = await issueEmailToken(db, rows[0].id, "reset_password");
        await sendEmail(email, "Reset your KGROUP password", `<p>Hello ${rows[0].full_name},</p><p><a href="${APP_URL}/login.html?reset=${encodeURIComponent(raw)}">Choose a new password</a>.</p><p>This link expires in one hour.</p>`);
      } catch { /* Do not disclose whether delivery configuration exists for a given account. */ }
    }
    return json({ ok: true });
  }
  if (path === "/auth/verify/request" && request.method === "POST") {
    const email = emailOf(data.email), rows = await db`select id, full_name, email_verified_at from users where email = ${email}`;
    if (rows[0] && !rows[0].email_verified_at) {
      const raw = await issueEmailToken(db, rows[0].id, "verify_email");
      await sendEmail(email, "Confirm your KGROUP email", `<p>Hello ${rows[0].full_name},</p><p><a href="${APP_URL}/login.html?verify=${encodeURIComponent(raw)}">Confirm your email address</a>.</p>`);
    }
    return json({ ok: true });
  }
  if (path === "/auth/reset/confirm" && request.method === "POST") {
    const raw = safeText(data.token, 200), password = String(data.password || "");
    if (!raw || password.length < 10) return fail("Use a valid reset link and a password of at least 10 characters.");
    const found = await db`select id, user_id from email_tokens where token_hash = ${digest(raw)} and purpose = 'reset_password' and used_at is null and expires_at > now()`;
    if (!found[0]) return fail("This password-reset link is invalid or expired.");
    await db`update users set password_hash = ${await passwordHash(password)}, updated_at = now() where id = ${found[0].user_id}`;
    await db`update email_tokens set used_at = now() where id = ${found[0].id}`;
    await db`delete from sessions where user_id = ${found[0].user_id}`;
    return json({ ok: true });
  }
  if (path === "/auth/password" && request.method === "PUT") {
    const user = await requireUser(request), password = String(data.password || "");
    if (password.length < 10) return fail("Password must contain at least 10 characters.");
    await db`update users set password_hash = ${await passwordHash(password)}, updated_at = now() where id = ${user.id}`;
    await db`delete from sessions where user_id = ${user.id} and token_hash <> ${digest(parseCookies(request)[COOKIE] || "")}`;
    return json({ ok: true });
  }
  if (path === "/auth/google" && request.method === "GET") return fail("Google OAuth is not configured. See README.md.", 501);
  return null;
}

async function dataRoutes(request, path) {
  const db = sql(); const user = await requireUser(request); const data = await bodyOf(request);
  if (!user.team_id) return fail("Your account is not linked to a team.", 403);
  if (path === "/profile" && request.method === "GET") return json({ profile: publicUser(user) });
  if (path === "/profile" && request.method === "PUT") {
    const name = safeText(data.full_name, 120), city = safeText(data.city, 100) || null;
    if (!name) return fail("Name is required.");
    const rows = await db`update users set full_name = ${name}, city = ${city}, updated_at = now() where id = ${user.id} returning id, email, full_name, role, team_id, salesperson_id, city, hue, email_verified_at`;
    return json({ profile: publicUser(rows[0]) });
  }
  if (path === "/salespersons" && request.method === "GET") { const rows = await db`select * from salespersons where team_id = ${user.team_id} order by revenue desc`; return json({ salespersons: rows }); }
  if (path === "/salespersons" && request.method === "POST") {
    requireAdmin(user); const name = safeText(data.name, 120); if (!name) return fail("Name is required.");
    const code = randomBytes(12).toString("hex");
    const rows = await db`insert into salespersons (owner, team_id, invite_code, name, city, phone, email, level, hue)
      values (${user.id}, ${user.team_id}, ${code}, ${name}, ${safeText(data.city,100)||null}, ${safeText(data.phone,50)||null}, ${emailOf(data.email)||null}, ${safeText(data.level,30)||'Rookie'}, ${Number.isInteger(data.hue) ? data.hue : 150}) returning *`;
    return json({ salesperson: rows[0] }, 201);
  }
  if (path.startsWith("/salespersons/") && request.method === "DELETE") {
    requireAdmin(user); const id = path.split("/")[2]; await requireTeamEntity(db, "salespersons", id, user); await db`delete from salespersons where id = ${id} and team_id = ${user.team_id}`; return json({ ok: true });
  }
  if (path === "/sales" && request.method === "GET") { const rows = await db`select * from sales where team_id = ${user.team_id} order by created_at desc limit 1000`; return json({ sales: rows }); }
  if (path === "/sales" && request.method === "POST") {
    const customer = safeText(data.customer, 160), product = safeText(data.product, 120), qty = Number(data.qty), amount = Number(data.amount), commission = Number(data.commission || 0), repId = safeText(data.rep_id, 100) || null;
    if (!customer || !product || !Number.isInteger(qty) || qty < 1 || !Number.isSafeInteger(amount) || amount < 0 || !repId) return fail("Invalid sale details.");
    const rep = await requireTeamEntity(db, "salespersons", repId, user);
    if (user.role === "salesperson" && user.salesperson_id !== rep.id) return fail("Salespersons can only register their own sales.", 403);
    const date = data.created_at ? new Date(data.created_at) : new Date(); if (Number.isNaN(date.getTime()) || date > new Date()) return fail("Invalid sale date.");
    const rows = await db`insert into sales (owner, team_id, rep_id, rep_name, customer, product, qty, amount, commission, pay, remarks, created_at)
      values (${user.id}, ${user.team_id}, ${rep.id}, ${rep.name}, ${customer}, ${product}, ${qty}, ${amount}, ${commission}, ${safeText(data.pay,40)||'Card'}, ${safeText(data.remarks,1000)||null}, ${date.toISOString()}) returning *`;
    return json({ sale: rows[0] }, 201);
  }
  if (path === "/challenges" && request.method === "GET") { const rows = await db`select c.*, count(cp.user_id)::int as participants from challenges c left join challenge_participants cp on cp.challenge_id = c.id where c.team_id = ${user.team_id} group by c.id order by c.created_at desc`; return json({ challenges: rows }); }
  if (path === "/challenges" && request.method === "POST") {
    requireAdmin(user); const title = safeText(data.title, 160), reward = safeText(data.reward, 200); if (!title || !reward) return fail("Title and reward are required.");
    const rows = await db`insert into challenges (owner, team_id, title, description, reward, target, ends, icon)
      values (${user.id}, ${user.team_id}, ${title}, ${safeText(data.description,1000)||null}, ${reward}, ${Math.max(1, Number.parseInt(data.target,10)||100)}, ${safeText(data.ends,10)||null}, ${safeText(data.icon,20)||'🏆'}) returning *`;
    return json({ challenge: rows[0] }, 201);
  }
  if (path.startsWith("/challenges/") && path.endsWith("/join") && request.method === "POST") {
    const id = path.split("/")[2]; await requireTeamEntity(db, "challenges", id, user); await db`insert into challenge_participants (challenge_id, user_id) values (${id}, ${user.id}) on conflict do nothing`; return json({ ok: true });
  }
  return fail("Endpoint not found.", 404);
}

export default async request => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { allow: "GET,POST,PUT,DELETE,OPTIONS" } });
    const path = routeOf(request);
    if (path === "/health") return json({ ok: true, database: Boolean(process.env.DATABASE_URL), email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) });
    if (path.startsWith("/auth/")) { const response = await authRoutes(request, path); return response || fail("Endpoint not found.", 404); }
    return await dataRoutes(request, path);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error("Kgroup API failure", { name: error.name, message: error.message });
    return fail(status >= 500 ? "An unexpected server error occurred." : error.message, status);
  }
};
