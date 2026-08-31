/* =========================================================================
   KGROUP — Rappels d'anniversaire planifies (Netlify Scheduled Function)
   -------------------------------------------------------------------------
   Netlify declenche cette fonction toutes les heures (voir netlify.toml).
   Elle appelle POST /api/reminders/run, qui fait le travail et garantit
   l'idempotence via la table birthday_reminders.

   Pourquoi toutes les heures et pas une fois par jour : une execution ratee
   (deploiement, incident) ne doit pas faire sauter les anniversaires du jour.
   Les passages suivants rattrapent, sans jamais renvoyer un rappel deja parti.
   ========================================================================= */
"use strict";

process.env.SERVE_STATIC = "false";

const app = require("../../server/app");

exports.handler = async () => {
  if (!process.env.CRON_SECRET) {
    console.warn("[cron] CRON_SECRET absent — balayage ignore.");
    return { statusCode: 503, body: JSON.stringify({ ok: false, reason: "CRON_SECRET missing" }) };
  }

  // On invoque l'app Express en memoire, sans passer par le reseau :
  // ni DNS, ni TLS, ni URL publique a deviner.
  const serverless = require("serverless-http");
  const handler = serverless(app);
  const res = await handler({
    httpMethod: "POST",
    path: "/api/reminders/run",
    headers: { "content-type": "application/json", "x-cron-secret": process.env.CRON_SECRET },
    body: "{}",
    isBase64Encoded: false,
    queryStringParameters: {},
  }, {});

  console.log("[cron] rappels d'anniversaire :", res.body);
  return res;
};

/* Cadence declaree ici ET dans netlify.toml : Netlify lit l'une ou l'autre
   selon la version du runtime. */
exports.config = { schedule: "@hourly" };
