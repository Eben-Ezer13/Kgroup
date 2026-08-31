/* =========================================================================
   KGROUP — Rappels d'anniversaire automatiques
   -------------------------------------------------------------------------
   POST /api/reminders/run   déclenche le balayage (protégé par un secret)

   FONCTIONNEMENT
   Le balayage parcourt TOUTES les équipes, repère les clients dont
   l'anniversaire tombe demain (J-1) ou aujourd'hui (JOUR-J) en heure marocaine,
   et dépose une notification pour l'équipe.

   IDEMPOTENCE — le point délicat d'un planificateur.
   Chaque rappel est d'abord inséré dans birthday_reminders, dont la clé
   primaire est (client_id, remind_on, kind). Un `on conflict do nothing` qui
   ne renvoie aucune ligne signifie « déjà envoyé » : la notification n'est
   alors pas créée. Le job peut donc tourner toutes les heures, être rejoué,
   ou se déclencher deux fois — un client ne reçoit jamais deux fois le même
   rappel pour la même date.

   DESTINATAIRES
   Les notifications sont déposées au niveau de l'équipe. Qui les lit est
   décidé à la lecture (GET /api/notifications) : un administrateur et un
   chargé de relation client voient tout, un commercial ne voit que celles qui
   concernent ses propres clients.

   PLANIFICATION
   Netlify exécute netlify/functions/birthday-cron.js une fois par heure ; la
   fonction appelle cette route. Sur un hébergeur Node classique, n'importe
   quel cron faisant un POST ici convient.
   ========================================================================= */
"use strict";

const express = require("express");
const crypto = require("crypto");

const db = require("../db");
const { HttpError } = require("../policies");
const crm = require("../crm");

const router = express.Router();

/**
 * Le déclencheur est public (le cron l'appelle sans session), donc il exige un
 * secret. Comparaison à temps constant pour ne pas fuiter le secret octet par
 * octet via le temps de réponse.
 */
function assertAuthorized(req) {
  const expected = process.env.CRON_SECRET || "";
  if (!expected) {
    throw new HttpError(
      503,
      "CRON_SECRET n'est pas configuré : le déclenchement automatique est désactivé."
    );
  }

  // Plusieurs sources acceptées, parce que chaque planificateur a sa convention :
  //   Authorization: Bearer …   Vercel Cron (envoyé automatiquement)
  //   x-cron-secret: …          notre fonction Netlify, et un curl manuel
  //   body/query                dépannage en ligne de commande
  const auth = req.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const given = String(
    bearer || req.get("x-cron-secret") || (req.body && req.body.secret) || req.query.secret || ""
  );

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, "Secret de déclenchement invalide.");
  }
}

/**
 * Un passage de balayage.
 * @param {number} offset 0 = aujourd'hui (JOUR-J), 1 = demain (J-1)
 */
async function sweep(offset, kind) {
  // La date de référence ET la date d'échéance sont calculées en SQL, à partir
  // de today_casablanca() : le résultat ne dépend pas du fuseau du serveur.
  const rows = await db.many(
    `select c.id, c.name, c.phone, c.phone_e164, c.birthday, c.team_id,
            s.name as rep_name, s.auth_id as rep_user_id,
            (public.today_casablanca() + $1::int) as remind_on
       from public.clients c
       left join public.salespersons s on s.id = c.rep_id
      where c.birthday is not null
        and public.birthday_falls_on(c.birthday, public.today_casablanca() + $1::int)`,
    [offset]
  );

  const sent = [];
  for (const c of rows) {
    // Le verrou : si la ligne existe déjà, rien n'est renvoyé et on passe.
    const { rows: claimed } = await db.query(
      `insert into public.birthday_reminders (client_id, remind_on, kind)
       values ($1, $2, $3)
       on conflict (client_id, remind_on, kind) do nothing
       returning client_id`,
      [c.id, c.remind_on, kind]
    );
    if (!claimed.length) continue; // déjà envoyé pour cette date

    const when = kind === "JOUR-J" ? "aujourd'hui" : "demain";
    const emoji = kind === "JOUR-J" ? "🎉" : "🎂";
    await db.query(
      `insert into public.notifications (team_id, actor_id, actor_name, type, title, body)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        c.team_id,
        c.rep_user_id || null,
        c.rep_name || null,
        kind === "JOUR-J" ? "birthday_today" : "birthday_tomorrow",
        `${emoji} Anniversaire ${when} — ${c.name}`,
        [
          `Client : ${c.name}`,
          `Téléphone : ${crm.formatPhone(c.phone || c.phone_e164)}`,
          `Anniversaire : ${crm.birthdayLabel(c.birthday)}`,
          `Commercial : ${c.rep_name || "non attribué"}`,
        ].join(" · "),
      ]
    );
    sent.push({ client_id: c.id, name: c.name, kind });
  }
  return sent;
}

/* GET autant que POST : Vercel Cron invoque ses cibles en GET, la fonction
   Netlify et les tests en POST. Le traitement est identique, et rester
   idempotent rend le choix du verbe sans conséquence. */
router.all("/reminders/run", async (req, res, next) => {
  try {
    if (!["GET", "POST"].includes(req.method)) {
      throw new HttpError(405, "Méthode non autorisée.");
    }
    assertAuthorized(req);
    const today = await db.one(`select public.today_casablanca() as d`);

    const jourJ = await sweep(0, "JOUR-J");
    const jMoins1 = await sweep(1, "J-1");

    return res.json({
      ok: true,
      timezone: crm.TIMEZONE,
      today: String(today.d).slice(0, 10),
      sent: { "JOUR-J": jourJ.length, "J-1": jMoins1.length },
      // Le détail sert au diagnostic ; il ne quitte jamais le job planifié.
      details: [...jourJ, ...jMoins1],
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
