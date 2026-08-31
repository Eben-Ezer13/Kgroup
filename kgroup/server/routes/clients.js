/* =========================================================================
   KGROUP — /api/clients/*  et  /api/birthdays
   -------------------------------------------------------------------------
   Le portefeuille client, les fiches, et le tableau des anniversaires.

     GET    /api/clients                liste filtrable
     GET    /api/clients/lookup?phone=  recherche par numéro (préremplissage)
     GET    /api/clients/:id            fiche + historique des ventes
     POST   /api/clients                création manuelle
     PATCH  /api/clients/:id            mise à jour
     GET    /api/birthdays              aujourd'hui / demain / à venir

   PÉRIMÈTRE DE VISIBILITÉ (appliqué en clause WHERE, jamais après coup)
     admin, relation_client  → tout le portefeuille de l'équipe
     salesperson             → uniquement les clients dont il est responsable
   ========================================================================= */
"use strict";

const express = require("express");

const db = require("../db");
const { requireUser } = require("../auth");
const { HttpError, teamScope, canSeeAllClients, isAdmin } = require("../policies");
const crm = require("../crm");

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Périmètre                                                           *
 * -------------------------------------------------------------------
 * Renvoie un fragment SQL + ses paramètres. Un commercial sans fiche
 * (salesperson_id absent) ne voit rien plutôt que tout : en cas de compte
 * mal relié, on refuse par défaut.
 * ------------------------------------------------------------------ */
function scopeFor(req, startIndex = 2) {
  const teamId = teamScope(req);
  if (canSeeAllClients(req)) {
    return { where: "c.team_id = $1", params: [teamId], next: startIndex };
  }
  const repId = req.profile && req.profile.salesperson_id;
  if (!repId) {
    throw new HttpError(
      403,
      "Votre compte n'est pas relié à une fiche commercial : aucun client ne vous est attribué."
    );
  }
  return {
    where: `c.team_id = $1 and c.rep_id = $${startIndex}`,
    params: [teamId, repId],
    next: startIndex + 1,
  };
}

/** Enrichit une ligne client de ce que le navigateur affiche directement. */
function decorate(row, today) {
  const days = crm.daysUntilBirthday(row.birthday, today);
  return {
    ...row,
    total_spent: Number(row.total_spent) || 0,
    phone_display: crm.formatPhone(row.phone || row.phone_e164),
    birthday_label: crm.birthdayLabel(row.birthday),
    days_until_birthday: days,
    // Le lien est construit côté serveur : une seule implémentation du
    // formatage du numéro et du modèle de message, testée une seule fois.
    whatsapp: crm.birthdayWhatsappLink(row.phone_e164 || row.phone, row.name),
  };
}

/* ------------------------------------------------------------------ *
 * LISTE                                                               *
 * ------------------------------------------------------------------ */
router.get("/clients", requireUser, async (req, res, next) => {
  try {
    const scope = scopeFor(req);
    const params = [...scope.params];
    let i = scope.next;
    const filters = [scope.where];

    // Recherche libre : nom OU numéro. Le numéro est normalisé avant
    // comparaison, pour que "06 12..." trouve "+212612...".
    const q = String(req.query.q || "").trim();
    if (q) {
      const phone = crm.normalizePhone(q);
      filters.push(`(lower(c.name) like $${i} or c.phone_e164 like $${i + 1})`);
      params.push(`%${q.toLowerCase()}%`, `%${phone || q.replace(/\D/g, "")}%`);
      i += 2;
    }

    const repId = String(req.query.rep_id || "").trim();
    if (repId) { filters.push(`c.rep_id = $${i}`); params.push(repId); i++; }

    // Filtre "anniversaire dans le mois M" (1-12).
    const month = parseInt(req.query.birthday_month, 10);
    if (month >= 1 && month <= 12) {
      filters.push(`extract(month from c.birthday) = $${i}`);
      params.push(month); i++;
    }
    if (String(req.query.has_birthday || "") === "true") {
      filters.push("c.birthday is not null");
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
    params.push(limit);

    const rows = await db.many(
      `select c.*, s.name as rep_name
         from public.clients c
         left join public.salespersons s on s.id = c.rep_id
        where ${filters.join(" and ")}
        order by c.last_sale_at desc nulls last, c.created_at desc
        limit $${i}`,
      params
    );

    const today = crm.todayLocal();
    return res.json(rows.map((r) => decorate(r, today)));
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * RECHERCHE PAR NUMÉRO — préremplissage du formulaire de vente        *
 * -------------------------------------------------------------------
 * Volontairement limitée au périmètre du demandeur : un commercial ne peut
 * pas énumérer le portefeuille d'un collègue en testant des numéros.
 * ------------------------------------------------------------------ */
router.get("/clients/lookup", requireUser, async (req, res, next) => {
  try {
    const phone = crm.normalizePhone(req.query.phone);
    if (!phone) return res.json({ client: null });

    const scope = scopeFor(req);
    const row = await db.one(
      `select c.*, s.name as rep_name
         from public.clients c
         left join public.salespersons s on s.id = c.rep_id
        where ${scope.where} and c.phone_e164 = $${scope.next}`,
      [...scope.params, phone]
    );
    return res.json({ client: row ? decorate(row, crm.todayLocal()) : null });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * FICHE CLIENT + HISTORIQUE                                           *
 * ------------------------------------------------------------------ */
router.get("/clients/:id", requireUser, async (req, res, next) => {
  try {
    const scope = scopeFor(req);
    const row = await db.one(
      `select c.*, s.name as rep_name
         from public.clients c
         left join public.salespersons s on s.id = c.rep_id
        where ${scope.where} and c.id = $${scope.next}`,
      [...scope.params, req.params.id]
    );
    if (!row) throw new HttpError(404, "Client introuvable.");

    const sales = await db.many(
      `select id, product, qty, amount, commission, pay, rep_name, remarks, created_at
         from public.sales
        where client_id = $1 and team_id = $2
        order by created_at desc limit 100`,
      [row.id, teamScope(req)]
    );

    return res.json({
      client: decorate(row, crm.todayLocal()),
      sales: sales.map((s) => ({ ...s, amount: Number(s.amount) || 0, commission: Number(s.commission) || 0 })),
    });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * CRÉATION / MISE À JOUR                                              *
 * ------------------------------------------------------------------ */
const CLIENT_FIELDS = ["name", "phone", "birthday", "email", "city", "notes"];

/** Nettoie et valide une charge utile client. Partagé création/mise à jour. */
function sanitize(body, { requireName }) {
  const out = {};
  for (const k of CLIENT_FIELDS) if (body[k] !== undefined) out[k] = body[k];

  if (requireName || out.name !== undefined) {
    const name = String(out.name || "").trim();
    if (!name) throw new HttpError(400, "Le nom du client est obligatoire.");
    out.name = name;
  }

  if (out.phone !== undefined) {
    const raw = String(out.phone || "").trim();
    if (!raw) { out.phone = null; out.phone_e164 = null; }
    else {
      const e164 = crm.normalizePhone(raw);
      if (!e164) throw new HttpError(400, "Ce numéro de téléphone n'est pas valide.");
      out.phone = raw;
      out.phone_e164 = e164;
    }
  }

  // L'anniversaire est FACULTATIF : souvent inconnu au moment de la vente.
  if (out.birthday !== undefined) {
    const b = String(out.birthday || "").trim();
    if (!b) out.birthday = null;
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) {
      throw new HttpError(400, "La date d'anniversaire doit être au format AAAA-MM-JJ.");
    } else out.birthday = b;
  }

  for (const k of ["email", "city", "notes"]) {
    if (out[k] !== undefined) out[k] = String(out[k] || "").trim() || null;
  }
  return out;
}

router.post("/clients", requireUser, async (req, res, next) => {
  try {
    const teamId = teamScope(req);
    const fields = sanitize(req.body || {}, { requireName: true });

    // Le responsable par défaut est le commercial qui saisit. Seuls un admin
    // ou un chargé de relation client peuvent l'attribuer à quelqu'un d'autre.
    let repId = (req.profile && req.profile.salesperson_id) || null;
    if (req.body.rep_id && canSeeAllClients(req)) repId = req.body.rep_id;

    if (repId) {
      const rep = await db.one(
        `select id from public.salespersons where id = $1 and team_id = $2`, [repId, teamId]
      );
      if (!rep) throw new HttpError(400, "Ce commercial ne fait pas partie de votre équipe.");
    }

    // Anti-doublon : si le numéro existe déjà dans l'équipe, on renvoie le
    // client existant plutôt que d'échouer sur la contrainte d'unicité.
    if (fields.phone_e164) {
      const existing = await db.one(
        `select * from public.clients where team_id = $1 and phone_e164 = $2`,
        [teamId, fields.phone_e164]
      );
      if (existing) {
        return res.status(200).json({
          client: decorate(existing, crm.todayLocal()),
          created: false,
          message: "Ce numéro correspond déjà à un client existant.",
        });
      }
    }

    const keys = Object.keys(fields);
    const cols = ["team_id", "rep_id", ...keys];
    const values = [teamId, repId, ...keys.map((k) => fields[k])];
    const { rows } = await db.query(
      `insert into public.clients (${cols.map((c) => `"${c}"`).join(", ")})
       values (${cols.map((_, n) => `$${n + 1}`).join(", ")}) returning *`,
      values
    );
    return res.status(201).json({ client: decorate(rows[0], crm.todayLocal()), created: true });
  } catch (err) {
    return next(err);
  }
});

router.patch("/clients/:id", requireUser, async (req, res, next) => {
  try {
    const scope = scopeFor(req);
    const existing = await db.one(
      `select * from public.clients c where ${scope.where} and c.id = $${scope.next}`,
      [...scope.params, req.params.id]
    );
    if (!existing) throw new HttpError(404, "Client introuvable.");

    const fields = sanitize(req.body || {}, { requireName: false });

    // Réattribuer un client est une décision de gestion : un commercial ne
    // peut pas se réaffecter le portefeuille d'un collègue.
    if (req.body.rep_id !== undefined) {
      if (!canSeeAllClients(req)) {
        throw new HttpError(403, "Vous ne pouvez pas changer le commercial responsable.");
      }
      const repId = req.body.rep_id || null;
      if (repId) {
        const rep = await db.one(
          `select id from public.salespersons where id = $1 and team_id = $2`,
          [repId, teamScope(req)]
        );
        if (!rep) throw new HttpError(400, "Ce commercial ne fait pas partie de votre équipe.");
      }
      fields.rep_id = repId;
    }

    const keys = Object.keys(fields);
    if (!keys.length) return res.json({ client: decorate(existing, crm.todayLocal()) });

    // Le numéro doit rester unique dans l'équipe.
    if (fields.phone_e164) {
      const clash = await db.one(
        `select id from public.clients where team_id = $1 and phone_e164 = $2 and id <> $3`,
        [teamScope(req), fields.phone_e164, existing.id]
      );
      if (clash) throw new HttpError(409, "Un autre client utilise déjà ce numéro.");
    }

    const setSql = keys.map((k, n) => `"${k}" = $${n + 2}`).join(", ");
    const { rows } = await db.query(
      `update public.clients set ${setSql} where id = $1 returning *`,
      [existing.id, ...keys.map((k) => fields[k])]
    );
    return res.json({ client: decorate(rows[0], crm.todayLocal()) });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * ANNIVERSAIRES                                                       *
 * -------------------------------------------------------------------
 * days_until_birthday() est évaluée en SQL, à partir de la date locale
 * marocaine (today_casablanca()), pour que le résultat ne dépende jamais du
 * fuseau du serveur qui exécute la requête.
 * ------------------------------------------------------------------ */
router.get("/birthdays", requireUser, async (req, res, next) => {
  try {
    const scope = scopeFor(req);
    const horizon = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 366);

    const rows = await db.many(
      `select c.*, s.name as rep_name,
              public.days_until_birthday(c.birthday, public.today_casablanca()) as days_until
         from public.clients c
         left join public.salespersons s on s.id = c.rep_id
        where ${scope.where}
          and c.birthday is not null
          and public.days_until_birthday(c.birthday, public.today_casablanca()) <= $${scope.next}
        order by days_until asc, c.name asc`,
      [...scope.params, horizon]
    );

    const today = crm.todayLocal();
    const all = rows.map((r) => decorate(r, today));
    return res.json({
      today: crm.todayLocal(),
      timezone: crm.TIMEZONE,
      // `days_until` vient de SQL ; decorate() recalcule la même valeur en JS.
      // Les deux implémentations sont testées sur les mêmes cas.
      todays: all.filter((c) => c.days_until === 0),
      tomorrow: all.filter((c) => c.days_until === 1),
      upcoming: all.filter((c) => c.days_until > 1),
      horizon_days: horizon,
    });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * MEMBRES DE L'ÉQUIPE + ATTRIBUTION DU RÔLE relation_client           *
 * ------------------------------------------------------------------ */
router.get("/team/members", requireUser, async (req, res, next) => {
  try {
    const rows = await db.many(
      `select p.id, p.full_name, p.email, p.role, p.salesperson_id
         from public.profiles p where p.team_id = $1 order by p.full_name`,
      [teamScope(req)]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.patch("/team/members/:userId/role", requireUser, async (req, res, next) => {
  try {
    if (!isAdmin(req)) throw new HttpError(403, "Seul un administrateur peut changer un rôle.");
    const role = String(req.body.role || "");
    const { ASSIGNABLE_ROLES } = require("../policies");
    if (!ASSIGNABLE_ROLES.includes(role)) {
      throw new HttpError(400, `Rôle invalide. Valeurs acceptées : ${ASSIGNABLE_ROLES.join(", ")}.`);
    }
    // Un administrateur ne peut pas se rétrograder lui-même : l'équipe se
    // retrouverait sans personne pour administrer la paie ou le roster.
    if (req.params.userId === req.user.id) {
      throw new HttpError(400, "Vous ne pouvez pas modifier votre propre rôle.");
    }
    const { rowCount } = await db.query(
      `update public.profiles set role = $3 where id = $1 and team_id = $2 and role <> 'admin'`,
      [req.params.userId, teamScope(req), role]
    );
    if (!rowCount) throw new HttpError(404, "Membre introuvable dans votre équipe.");
    return res.json({ ok: true, role });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
