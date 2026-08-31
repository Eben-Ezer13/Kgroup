/* =========================================================================
   Verifie un deploiement en ligne, sans y ecrire quoi que ce soit.

   Usage :
     node scripts/verify-deploy.js https://votre-projet.vercel.app
     npm run verify -- https://votre-projet.vercel.app

   Toutes les requetes sont en lecture seule : aucun compte n'est cree, aucune
   donnee n'est modifiee. Le script peut donc etre lance sur la production.
   ========================================================================= */
"use strict";

const BASE = (process.argv[2] || process.env.APP_URL || "").replace(/\/+$/, "");

if (!BASE) {
  console.error(
    "Indiquez l'URL du deploiement :\n" +
    "  node scripts/verify-deploy.js https://votre-projet.vercel.app"
  );
  process.exit(1);
}

let pass = 0, fail = 0, warnCount = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`  OK    ${label}`); }
  else { fail++; console.log(`  ECHEC ${label}${detail ? "  -> " + detail : ""}`); }
};
const warn = (label, detail) => {
  warnCount++;
  console.log(`  NOTE  ${label}${detail ? "  -> " + detail : ""}`);
};

async function get(path, options = {}) {
  const res = await fetch(BASE + path, { redirect: "manual", ...options });
  const text = await res.text().catch(() => "");
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* pas du JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

async function main() {
  console.log(`Verification de ${BASE}\n`);

  /* ---- 1. L'API repond et voit la base ---- */
  console.log("API");
  let health;
  try {
    health = await get("/api/health");
  } catch (err) {
    console.log(`  ECHEC site injoignable -> ${err.message}`);
    process.exit(1);
  }

  if (health.status === 200 && health.json && health.json.connected) {
    ok("/api/health : base connectee", true);
  } else if (health.json && health.json.reason === "not_configured") {
    fail++;
    console.log("  ECHEC /api/health : DATABASE_URL n'est pas definie sur l'hebergeur");
    console.log("        -> ajoutez-la dans les variables d'environnement, puis redeployez");
  } else if (health.json && health.json.reason === "unreachable") {
    fail++;
    console.log("  ECHEC /api/health : base injoignable (chaine incorrecte, ou projet Neon en veille)");
  } else if (health.status === 404) {
    fail++;
    console.log("  ECHEC /api/health : 404 — la fonction API n'est pas deployee");
    console.log("        -> verifiez api/index.js (Vercel) ou netlify/functions/api.js (Netlify)");
  } else {
    fail++;
    console.log(`  ECHEC /api/health : HTTP ${health.status}  ${health.text.slice(0, 120)}`);
  }

  ok("le routage /api/* atteint bien l'application",
     health.status !== 404,
     `HTTP ${health.status}`);

  /* ---- 2. Les regles d'acces tiennent ---- */
  console.log("\nAcces");
  const protectedRoutes = ["/api/clients", "/api/salespersons", "/api/payroll/team"];
  for (const route of protectedRoutes) {
    const r = await get(route);
    ok(`${route} refuse un visiteur anonyme`, r.status === 401 || r.status === 403,
       `HTTP ${r.status}`);
  }
  const unknown = await get("/api/nexiste-pas");
  ok("une route inconnue renvoie 404", unknown.status === 404, `HTTP ${unknown.status}`);

  const cron = await get("/api/reminders/run", { method: "POST" });
  ok("le declencheur des rappels exige son secret",
     cron.status === 401 || cron.status === 503, `HTTP ${cron.status}`);
  if (cron.status === 503) {
    warn("CRON_SECRET n'est pas defini : les rappels d'anniversaire ne partiront pas");
  }

  /* ---- 3. Les pages sont servies ---- */
  console.log("\nPages");
  for (const page of ["/", "/login.html", "/clients.html", "/formation.html", "/guide-utilisation.html"]) {
    const r = await get(page);
    ok(`${page} est servie`, r.status === 200, `HTTP ${r.status}`);
  }

  /* ---- 4. Rien de sensible n'est publie ---- */
  console.log("\nEtancheite");
  const leaks = ["/.env", "/package.json", "/server/db.js", "/db/schema.sql", "/scripts/lint.js"];
  for (const path of leaks) {
    const r = await get(path);
    // Tout sauf 200 convient : 404, 403, ou une redirection vers la page d'erreur.
    ok(`${path} n'est pas accessible`, r.status !== 200, `HTTP ${r.status}`);
  }

  /* ---- 5. En-tetes de securite ---- */
  console.log("\nEn-tetes");
  const home = await get("/login.html");
  const expected = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  for (const [name, value] of Object.entries(expected)) {
    const got = home.headers.get(name);
    if (got === value) ok(`${name}: ${value}`, true);
    else warn(`${name} absent ou different`, got || "absent");
  }

  /* ---- Bilan ---- */
  console.log(`\n${pass} verification(s) reussie(s), ${fail} echec(s), ${warnCount} remarque(s)`);
  if (fail === 0) {
    console.log("\nLe deploiement est operationnel.");
  } else {
    console.log("\nCorrigez les points ci-dessus, puis relancez ce script.");
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nErreur inattendue :", err.message);
  process.exit(1);
});
