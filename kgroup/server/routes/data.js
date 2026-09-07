/* =========================================================================
   KGROUP — /api/*  (the endpoints behind window.KGDB)
   -------------------------------------------------------------------------
   One route per Supabase table call the browser used to make:

     supabase.from("salespersons").select().order("revenue")  -> GET    /api/salespersons
     supabase.from("salespersons").insert()                   -> POST   /api/salespersons
     supabase.from("salespersons").delete().eq("id", …)       -> DELETE /api/salespersons/:id
     supabase.from("sales").select().order("created_at").limit -> GET   /api/sales?limit=
     supabase.from("sales").insert()                          -> POST   /api/sales
     supabase.from("profiles").select().eq("id", uid).single() -> GET   /api/profile
     supabase.from("profiles").update().eq("id", uid)         -> PATCH  /api/profile
     supabase.from("challenges").select().order("created_at") -> GET    /api/challenges
     supabase.from("challenges").insert()                     -> POST   /api/challenges

   Ordering, limits and returned columns match the originals exactly, so
   KGData.hydrate() keeps mapping rows the same way.

   The browser used to send whole objects that Supabase spread straight into the
   INSERT. Here each write picks its columns from an explicit allow-list: the
   client can still set everything the UI ever set, but can no longer forge
   `owner`, `team_id`, `auth_id`, `invite_code`, `claimed` or `id` — the columns
   the authorization rules themselves depend on.
   ========================================================================= */
"use strict";

const crypto = require("crypto");
const express = require("express");

const db = require("../db");
const { requireUser } = require("../auth");
const { HttpError, teamScope, requireAdmin, canMutateSale } = require("../policies");
const crm = require("../crm");

const router = express.Router();

/** Keeps only allow-listed keys whose value the client actually supplied. */
function pick(source, allowed) {
  const out = {};
  for (const key of allowed) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/** Builds a parameterised INSERT from a plain object. */
function insertSql(table, values, returning = "*") {
  const keys = Object.keys(values);
  const cols = keys.map((k) => `"${k}"`).join(", ");
  const params = keys.map((_, i) => `$${i + 1}`).join(", ");
  return {
    text: `insert into public.${table} (${cols}) values (${params}) returning ${returning}`,
    values: keys.map((k) => values[k]),
  };
}

/* Every route below takes `requireUser` explicitly. A router-wide guard would
   also swallow unknown paths under /api and answer them 401 instead of 404, so
   the guard is attached per route — every new route MUST include it. */

/* ------------------------------------------------------------------ *
 * SALESPERSONS                                                        *
 * ------------------------------------------------------------------ */
const SALESPERSON_FIELDS = [
  "name", "city", "phone", "email", "level", "status", "target",
  "hue", "sales", "today_sales", "revenue", "commission", "xp", "xp_to_next", "badges",
];

router.get("/salespersons", requireUser, async (req, res, next) => {
  try {
    const rows = await db.many(
      `select s.*, coalesce(p.role, 'salesperson') as role
         from public.salespersons s
         left join public.profiles p on p.salesperson_id = s.id
        where s.team_id = $1
        order by s.revenue desc`,
      [teamScope(req)]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post("/salespersons", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const teamId = teamScope(req);

    const fields = pick(req.body || {}, SALESPERSON_FIELDS);
    if (!fields.name || !String(fields.name).trim()) {
      throw new HttpError(400, "A salesperson needs a name.");
    }
    if (fields.badges !== undefined) fields.badges = JSON.stringify(fields.badges);

    // The invite code is generated server-side. The old client generated it and
    // sent it along, which meant a caller could pick a guessable code.
    const inviteCode = crypto.randomBytes(6).toString("hex");

    const { text, values } = insertSql("salespersons", {
      owner: req.user.id,
      team_id: teamId,
      invite_code: inviteCode,
      claimed: false,
      ...fields,
    });
    const { rows } = await db.query(text, values);
    return res.status(201).json(rows[0]); // includes invite_code -> builds the invite link
  } catch (err) {
    return next(err);
  }
});

router.patch("/salespersons/:id", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const requestedRole = req.body && req.body.role !== undefined
      ? String(req.body.role)
      : null;
    if (requestedRole !== null) {
      const { ASSIGNABLE_ROLES } = require("../policies");
      if (!ASSIGNABLE_ROLES.includes(requestedRole)) {
        throw new HttpError(400, `Rôle invalide. Valeurs acceptées : ${ASSIGNABLE_ROLES.join(", ")}.`);
      }
    }
    const fields = pick(req.body || {}, SALESPERSON_FIELDS);
    if (fields.name !== undefined && !String(fields.name).trim()) {
      throw new HttpError(400, "A salesperson needs a name.");
    }
    if (fields.badges !== undefined) fields.badges = JSON.stringify(fields.badges);
    const keys = Object.keys(fields);
    if (!keys.length) throw new HttpError(400, "No salesperson changes supplied.");

    const setSql = keys.map((key, index) => `"${key}" = $${index + 2}`).join(", ");
    const { rows } = await db.query(
      `update public.salespersons set ${setSql}
         where id = $1 and team_id = $${keys.length + 2}
       returning *`,
      [req.params.id, ...keys.map((key) => fields[key]), teamScope(req)]
    );
    if (!rows.length) throw new HttpError(404, "That salesperson is not on your team.");
    if (requestedRole !== null) {
      const { rowCount } = await db.query(
        `update public.profiles p
            set role = $2
           from public.salespersons s
          where s.id = $1 and s.team_id = $3 and p.id = s.auth_id`,
        [req.params.id, requestedRole, teamScope(req)]
      );
      if (!rowCount) {
        throw new HttpError(400, "Ce commercial doit d'abord activer son invitation.");
      }
      rows[0].role = requestedRole;
    }
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete("/salespersons/:id", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const { rowCount } = await db.query(
      `delete from public.salespersons where id = $1 and team_id = $2`,
      [req.params.id, teamScope(req)]
    );
    if (!rowCount) throw new HttpError(404, "That salesperson is not on your team.");
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * SALES                                                               *
 * ------------------------------------------------------------------ */
const SALE_FIELDS = [
  "customer", "product", "qty", "amount", "commission",
  "pay", "rep_id", "rep_name", "remarks", "created_at",
];

/* Champs client acceptes au moment de la vente (section CLIENT du formulaire). */
const SALE_CLIENT_FIELDS = ["client_id", "client_phone", "client_birthday"];

/**
 * Retrouve ou cree le client rattache a une vente.
 *
 * Regle anti-doublon : la cle est le NUMERO normalise, unique par equipe. Si
 * le client existe deja on le reutilise tel quel -- on ne lui vole pas son
 * commercial responsable, meme si la vente est realisee par quelqu un d autre.
 * C est ce qui permet a `clients.rep_id` (responsable de la relation) et
 * `sales.rep_id` (auteur de la vente) de diverger sans perdre l historique.
 *
 * Sans numero exploitable, la vente reste enregistree sans client : le nom
 * libre `sales.customer` continue de faire foi, comme avant cette evolution.
 *
 * @returns {Promise<string|null>} l id du client, ou null
 */
async function resolveClient(req, teamId, body, fields) {
  // 1. Un client explicitement choisi dans le formulaire.
  if (body.client_id) {
    const found = await db.one(
      `select id from public.clients where id = $1 and team_id = $2`, [body.client_id, teamId]
    );
    if (!found) throw new HttpError(400, "Ce client n appartient pas a votre equipe.");
    return found.id;
  }

  const phone = crm.normalizePhone(body.client_phone);
  if (!phone) {
    // Un numero saisi mais invalide doit etre signale, pas ignore en silence.
    if (String(body.client_phone || "").trim()) {
      throw new HttpError(400, "Le numero de telephone du client n est pas valide.");
    }
    return null;
  }

  const existing = await db.one(
    `select id, birthday from public.clients where team_id = $1 and phone_e164 = $2`, [teamId, phone]
  );

  if (existing) {
    // Enrichissement : on complete une date d anniversaire manquante, sans
    // jamais ecraser une valeur deja connue.
    if (!existing.birthday && body.client_birthday) {
      const b = String(body.client_birthday).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(b)) {
        await db.query(`update public.clients set birthday = $2 where id = $1`, [existing.id, b]);
      }
    }
    return existing.id;
  }

  // 2. Creation. Le responsable par defaut est l auteur de la vente.
  const name = String(fields.customer || "").trim();
  if (!name) return null;
  const birthday = /^\d{4}-\d{2}-\d{2}$/.test(String(body.client_birthday || "").slice(0, 10))
    ? String(body.client_birthday).slice(0, 10)
    : null;
  const repId = fields.rep_id || (req.profile && req.profile.salesperson_id) || null;

  const { rows } = await db.query(
    `insert into public.clients (team_id, rep_id, name, phone, phone_e164, birthday)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (team_id, phone_e164) where phone_e164 is not null
       do update set name = clients.name
     returning id`,
    [teamId, repId, name, String(body.client_phone).trim(), phone, birthday]
  );
  return rows[0].id;
}

router.get("/sales", requireUser, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 5000);
    const rows = await db.many(
      `select * from public.sales where team_id = $1 order by created_at desc limit $2`,
      [teamScope(req), limit]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post("/sales", requireUser, async (req, res, next) => {
  try {
    const teamId = teamScope(req);
    const fields = pick(req.body || {}, SALE_FIELDS);

    if (!fields.customer || !String(fields.customer).trim()) {
      throw new HttpError(400, "A sale needs a customer.");
    }
    if (!fields.product || !String(fields.product).trim()) {
      throw new HttpError(400, "A sale needs a product.");
    }
    if (fields.rep_id === "") fields.rep_id = null;

    // A sale credits its rep through the apply_sale() trigger, so the rep must
    // be on the caller's own team. Supabase's RLS never checked this.
    if (fields.rep_id) {
      const rep = await db.one(
        `select id from public.salespersons where id = $1 and team_id = $2`,
        [fields.rep_id, teamId]
      );
      if (!rep) throw new HttpError(400, "That salesperson is not on your team.");
    }

    // Le client est resolu AVANT l insertion : le trigger on_sale_insert_client
    // met a jour ses totaux au moment ou la vente est ecrite.
    const clientId = await resolveClient(req, teamId, req.body || {}, fields);

    const { text, values } = insertSql("sales", {
      owner: req.user.id,
      team_id: teamId,
      ...(clientId ? { client_id: clientId } : {}),
      ...fields,
    });
    const { rows } = await db.query(text, values);
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

/* Kept for parity with the "sales: mine or admin update/delete" policies, which
   the current UI does not call but the schema granted. */
router.delete("/sales/:id", requireUser, async (req, res, next) => {
  try {
    const sale = await db.one(
      `select id, owner from public.sales where id = $1 and team_id = $2`,
      [req.params.id, teamScope(req)]
    );
    if (!sale) throw new HttpError(404, "That sale is not on your team.");
    if (!canMutateSale(req, sale)) throw new HttpError(403, "You can only remove your own sales.");
    await db.query(`delete from public.sales where id = $1`, [sale.id]);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * PROFILE                                                             *
 * ------------------------------------------------------------------ */
const PROFILE_FIELDS = ["full_name", "city", "hue"];

router.get("/profile", requireUser, async (req, res, next) => {
  try {
    const row = await db.one(`select * from public.profiles where id = $1`, [req.user.id]);
    return res.json(row || null);
  } catch (err) {
    return next(err);
  }
});

router.patch("/profile", requireUser, async (req, res, next) => {
  try {
    // "profiles: self update" — the WHERE clause is the caller's own id, so
    // there is no path to another user's row. `role` and `team_id` are not in
    // the allow-list: they were writable under RLS, which let any user promote
    // themselves to admin.
    const fields = pick(req.body || {}, PROFILE_FIELDS);
    const keys = Object.keys(fields);
    if (!keys.length) return res.json({ ok: true });

    const setSql = keys.map((k, i) => `"${k}" = $${i + 2}`).join(", ");
    await db.query(
      `update public.profiles set ${setSql} where id = $1`,
      [req.user.id, ...keys.map((k) => fields[k])]
    );
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * CHALLENGES                                                          *
 * ------------------------------------------------------------------ */
const CHALLENGE_FIELDS = ["title", "description", "reward", "icon", "hue", "target", "current", "ends"];

router.get("/challenges", requireUser, async (req, res, next) => {
  try {
    const rows = await db.many(
      `select * from public.challenges where team_id = $1 order by created_at desc`,
      [teamScope(req)]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post("/challenges", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const teamId = teamScope(req);
    const fields = pick(req.body || {}, CHALLENGE_FIELDS);
    if (!fields.title || !String(fields.title).trim()) {
      throw new HttpError(400, "A challenge needs a title.");
    }
    if (fields.ends === "") fields.ends = null;

    const { text, values } = insertSql("challenges", {
      owner: req.user.id,
      team_id: teamId,
      ...fields,
    });
    const { rows } = await db.query(text, values);
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
