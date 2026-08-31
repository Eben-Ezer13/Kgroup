/* =========================================================================
   KGROUP — Neon PostgreSQL connection pool
   -------------------------------------------------------------------------
   One place that knows how to talk to the database. Everything else in
   server/ goes through `query()` / `tx()` and never sees a connection string.

   DATABASE_URL lives ONLY in the environment (.env locally, the host's env
   panel in production). It is never logged, never returned in a response, and
   never shipped to the browser.

   POURQUOI LA CREATION EST PARESSEUSE
   Ce module a longtemps leve une exception AU CHARGEMENT quand DATABASE_URL
   manquait. Consequence sur un hebergeur ou la variable n'a pas ete definie :
   `require` echouait, toute la fonction serverless mourait, et l'appelant
   recevait un 502 accompagne d'une trace d'execution — au lieu d'un 503 propre
   disant simplement que la base n'est pas configuree.
   Le pool est donc cree a la PREMIERE UTILISATION. Les routes continuent de
   repondre, /api/health signale clairement le probleme, et les scripts en
   ligne de commande echouent toujours immediatement avec le meme message
   puisqu'ils destructurent `pool` des leur chargement.
   ========================================================================= */
"use strict";

const { Pool, types } = require("pg");

/* -------------------------------------------------------------------------
   Les colonnes DATE sont lues comme du TEXTE, pas comme des objets Date.

   Par defaut, pg convertit une `date` en Date JS positionnee a MINUIT LOCAL.
   Un `.toISOString()` la ramene ensuite en UTC et peut reculer d'un jour :
   au Maroc (UTC+1 depuis 2018), le 2020-08-31 devenait 2020-08-30. Un client
   ne apres 2018 aurait donc ete fete la veille de son anniversaire.

   Une `date` n'a de toute facon pas d'heure ni de fuseau : la rendre telle
   qu'elle est stockee, « AAAA-MM-JJ », supprime la conversion et donc le bug.
   Cela vaut pour clients.birthday, challenges.ends, payroll_periods.period et
   birthday_reminders.remind_on.
   ------------------------------------------------------------------------- */
const PG_TYPE_DATE = 1082;
types.setTypeParser(PG_TYPE_DATE, (value) => value);

const MISSING_URL_MESSAGE =
  "DATABASE_URL is not set. Locally: copy .env.example to .env and paste your " +
  "Neon connection string (Neon console -> Connection Details -> Pooled connection). " +
  "In production: add it to your host's environment variables, then redeploy.";

/**
 * Ou lire la chaine de connexion, par ordre de priorite.
 *
 * NETLIFY_DATABASE_URL est injectee automatiquement par l'extension Neon de
 * Netlify. L'accepter evite d'avoir a recopier a la main une valeur que la
 * plateforme fournit deja — et evite surtout d'en maintenir deux, qui
 * finiraient par diverger. Une DATABASE_URL definie explicitement reste
 * prioritaire : c'est celle que l'operateur a voulu.
 */
const URL_SOURCES = ["DATABASE_URL", "NETLIFY_DATABASE_URL"];

/** La chaine de connexion effective, ou null. */
function connectionString() {
  for (const name of URL_SOURCES) {
    const v = process.env[name];
    if (v) return v;
  }
  return null;
}

/** Vrai si l'application dispose d'une chaine de connexion. */
const isConfigured = () => Boolean(connectionString());

let _pool = null;

/** Cree le pool au premier appel, puis le reutilise. */
function getPool() {
  if (_pool) return _pool;
  const url = connectionString();
  if (!url) throw new Error(MISSING_URL_MESSAGE);

  /* Neon always requires TLS. Its certificates are publicly trusted, so normal
     verification works — we only turn the flag on, never disable checking. */
  _pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: true },
    // Serverless/edge hosts recycle containers aggressively; keep the pool small
    // so a burst of cold starts cannot exhaust Neon's connection limit.
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });

  /* A pool-level error (Neon scaling to zero, network blip) must not take the
     process down — the next query simply opens a fresh connection. */
  _pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });

  return _pool;
}

/** Run a single parameterised statement. Always use $1/$2 placeholders. */
async function query(text, params) {
  return getPool().query(text, params);
}

/** Convenience: first row of a query, or null. */
async function one(text, params) {
  const { rows } = await getPool().query(text, params);
  return rows[0] || null;
}

/** Convenience: all rows of a query. */
async function many(text, params) {
  const { rows } = await getPool().query(text, params);
  return rows;
}

/**
 * Run `fn` inside a transaction. Rolls back on any throw.
 * Used where several writes must land together (e.g. password reset).
 */
async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* connection already gone — nothing to roll back */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Cheap liveness probe used by GET /api/health. */
async function ping() {
  const { rows } = await getPool().query("select 1 as ok");
  return rows[0].ok === 1;
}

module.exports = {
  // Getter : `const db = require("./db")` ne declenche rien, tandis que
  // `const { pool } = require("./db")` (les scripts CLI) echoue tout de suite
  // avec le message ci-dessus — ce qui est exactement ce qu'on veut d'un script.
  get pool() {
    return getPool();
  },
  isConfigured,
  MISSING_URL_MESSAGE,
  query,
  one,
  many,
  tx,
  ping,
};
