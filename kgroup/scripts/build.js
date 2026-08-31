/* =========================================================================
   Build / preflight.                                 Usage:  npm run build
   -------------------------------------------------------------------------
   The frontend is plain HTML/CSS/JS with no bundling step, so there is nothing
   to compile — "building" here means proving the deployment is coherent:
   every page loads the scripts it needs, every asset it references exists, the
   server modules all load, and lint passes. Netlify runs this before deploying.
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let errors = 0;
let warnings = 0;
const fail = (msg) => { errors++; console.error(`  ERROR  ${msg}`); };
const warn = (msg) => { warnings++; console.warn(`  WARN   ${msg}`); };

/* ---- 1. Lint ------------------------------------------------------------ */
console.log("Running lint…");
try {
  execFileSync(process.execPath, [path.join(__dirname, "lint.js")], { stdio: "inherit" });
} catch (_) {
  console.error("\nBuild aborted: lint failed.");
  process.exit(1);
}

/* ---- 2. Required files -------------------------------------------------- */
console.log("\nRequired files");
const REQUIRED = [
  "api.js", "data.js", "dashboard.js", "style.css",
  "training-content.js", "training.css", "formation.html",
  "crm.css", "clients.html", "remuneration.html",
  "db/schema-crm.sql", "server/crm.js", "server/routes/clients.js",
  "server/routes/payroll.js", "server/routes/reminders.js",
  "db/schema.sql", "server/training.js", "server/routes/training.js",
  "server/app.js", "server/db.js", "server/auth.js", "server/policies.js",
  "server/routes/auth.js", "server/routes/data.js",
  "netlify/functions/api.js", "netlify.toml",
  "api/index.js", "vercel.json",
];
for (const f of REQUIRED) {
  if (fs.existsSync(path.join(ROOT, f))) console.log(`  OK     ${f}`);
  else fail(`missing ${f}`);
}

/* Fichiers d'hygiene du depot : utiles au developpeur, sans role dans le build.
   Leur absence est signalee mais ne fait pas echouer un deploiement — sur un
   conteneur de build, ce qui est publie l'est deja de toute facon. */
const IS_CI = Boolean(
  process.env.CI || process.env.VERCEL || process.env.NETLIFY || process.env.GITHUB_ACTIONS
);
const REPO_FILES = [".gitignore", ".env.example"];
for (const f of REPO_FILES) {
  if (fs.existsSync(path.join(ROOT, f))) console.log(`  OK     ${f}`);
  else if (!IS_CI) warn(`${f} absent du depot`);
}

/* ---- 2b. Coherence de vercel.json --------------------------------------- *
 * Le plan Hobby de Vercel n'autorise qu'UNE execution de cron par jour. Une
 * expression plus frequente ne fait pas echouer le build : elle fait echouer
 * le DEPLOIEMENT, apres coup, avec un message qu'on ne voit qu'une fois le
 * temps perdu. On le signale donc ici, ou c'est encore corrigeable.
 * ------------------------------------------------------------------------ */
const vercelPath = path.join(ROOT, "vercel.json");
if (fs.existsSync(vercelPath)) {
  console.log("\nvercel.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
    for (const cron of cfg.crons || []) {
      // Champs cron : minute heure jour mois jour-semaine
      const [minute, hour] = String(cron.schedule || "").split(/\s+/);
      const runsHourlyOrMore = hour === "*" || String(hour).includes("/") ||
                               minute === "*" || String(minute).includes("/");
      if (runsHourlyOrMore) {
        warn(
          `cron "${cron.schedule}" sur ${cron.path} s'execute plus d'une fois par jour — ` +
          "le plan Hobby de Vercel refusera le deploiement (ex. \"0 7 * * *\" pour un passage quotidien)."
        );
      } else {
        console.log(`  OK     cron ${cron.schedule} sur ${cron.path} (quotidien)`);
      }
    }
    if (cfg.outputDirectory !== "dist") {
      fail(`vercel.json : outputDirectory vaut "${cfg.outputDirectory}", attendu "dist"`);
    } else {
      console.log("  OK     outputDirectory: dist");
    }
  } catch (err) {
    fail(`vercel.json illisible : ${err.message}`);
  }
}

/* ---- 3. Page wiring ----------------------------------------------------- */
console.log("\nPage wiring");
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
// Pages that drive the app must load all three scripts, in this order.
const APP_PAGES = new Set([
  "login.html", "register.html", "reset-password.html", "dashboard.html",
  "salesperson.html", "salespersons.html", "sales.html", "ranking.html",
  "challenges.html", "reports.html", "settings.html", "formation.html",
  "clients.html", "remuneration.html",
]);

for (const page of pages) {
  const html = fs.readFileSync(path.join(ROOT, page), "utf8");
  if (APP_PAGES.has(page)) {
    const order = ["data.js", "api.js", "dashboard.js"].map((s) =>
      html.indexOf(`<script src="${s}"></script>`)
    );
    if (order.some((i) => i === -1)) {
      fail(`${page} does not load data.js + api.js + dashboard.js`);
      continue;
    }
    if (!(order[0] < order[1] && order[1] < order[2])) {
      fail(`${page} loads its scripts out of order (data.js, api.js, dashboard.js)`);
      continue;
    }
  }

  // Every local href/src in the MARKUP must resolve. Le contenu des <script>
  // est retire d abord : les href construits dans un template JS
  // (href="${...}") ne designent pas un fichier du depot.
  const markup = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const refs = [...markup.matchAll(/(?:src|href)="([^"#?:]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (ref.startsWith("//") || ref.startsWith("data:") || ref.startsWith("mailto:")) continue;
    if (ref.includes("${")) continue; // placeholder de template, resolu a l execution
    const target = path.join(ROOT, decodeURIComponent(ref));
    if (!fs.existsSync(target)) fail(`${page} references a missing file: ${ref}`);
  }
  // Les scripts inline doivent compiler. `node --check` ne voit que les .js :
  // sans ceci, une apostrophe mal echappee dans un template ne casserait la
  // page qu a l execution, dans le navigateur de l utilisateur.
  const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .filter((code) => code.trim());
  for (const code of scripts) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(code);
    } catch (err) {
      fail(`${page} contains an inline script that does not parse: ${err.message}`);
    }
  }

  console.log(`  OK     ${page}`);
}

/* ---- 4. Server modules load -------------------------------------------- *
 * On verifie seulement que le graphe de modules se charge. Les secrets
 * d'EXECUTION ne concernent pas cette etape : le conteneur de build n'est pas
 * l'environnement d'execution, et sur un hebergeur serverless les variables
 * sont injectees a l'invocation de la fonction, pas ici.
 *
 * On fournit donc des valeurs de substitution le temps du require. Sans elles,
 * le build affichait « JWT_SECRET is unset » — un avertissement exact au sens
 * strict, mais trompeur a cet endroit, et surligne comme un probleme par les
 * visualiseurs de logs. Le vrai garde-fou reste actif la ou il compte : au
 * demarrage de l'application, ou un JWT_SECRET absent avec NODE_ENV=production
 * fait echouer le lancement.
 * ------------------------------------------------------------------------ */
console.log("\nServer modules");
const PLACEHOLDERS = {
  // pg n'ouvre aucune connexion tant qu'aucune requete n'est emise.
  DATABASE_URL: "postgresql://build:check@localhost:5432/buildcheck?sslmode=require",
  JWT_SECRET: "build-check-placeholder-not-a-real-secret-0000",
};
const restore = {};
for (const [key, value] of Object.entries(PLACEHOLDERS)) {
  restore[key] = process.env[key];
  if (!process.env[key]) process.env[key] = value;
}
try {
  require(path.join(ROOT, "server", "app.js"));
  console.log("  OK     server/app.js and its dependencies load");
} catch (err) {
  fail(`server/app.js failed to load: ${err.message}`);
}
for (const [key, previous] of Object.entries(restore)) {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

/* ---- 5. Assemble dist/ -------------------------------------------------- *
 * Le frontend partage son dossier avec le serveur. Publier la racine
 * enverrait server/, scripts/, db/, tests/ et node_modules/ sur le CDN.
 * On assemble donc dans dist/ uniquement ce qu un navigateur telecharge.
 * Les fonctions Netlify, elles, sont bundlees depuis netlify/functions et
 * embarquent server/ par le graphe de dependances — dist/ ne les concerne pas.
 * ------------------------------------------------------------------------ */
console.log();
console.log("Assembling dist/");
const DIST = path.join(ROOT, "dist");

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

/** Fichiers racine publies : les pages et leurs ressources directes. */
const ROOT_ASSETS = [
  ...fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")),
  "style.css", "crm.css", "training.css",
  "api.js", "data.js", "dashboard.js", "training-content.js",
  "favicon.svg",
];

let copied = 0;
for (const f of ROOT_ASSETS) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { fail(`dist: missing ${f}`); continue; }
  fs.copyFileSync(src, path.join(DIST, f));
  copied++;
}

/** assets/ en entier (images, icones). */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else { fs.copyFileSync(s, d); copied++; }
  }
}
if (fs.existsSync(path.join(ROOT, "assets"))) {
  copyDir(path.join(ROOT, "assets"), path.join(DIST, "assets"));
}

/* Garde-fou : rien de sensible ne doit se retrouver dans dist/. */
const FORBIDDEN = [/^\.env/, /^server$/, /^scripts$/, /^db$/, /^tests$/,
                   /^node_modules$/, /^netlify$/, /^legacy$/, /^package.*\.json$/, /\.toml$/];
for (const entry of fs.readdirSync(DIST)) {
  if (FORBIDDEN.some((re) => re.test(entry))) fail(`dist contains ${entry} — it must not be published`);
}

console.log(`  OK     ${copied} file(s) -> dist/`);

/* ---- Result ------------------------------------------------------------- */
console.log();
if (errors) {
  console.error(`Build failed with ${errors} error(s).`);
  process.exit(1);
}
console.log(
  `Build OK — static pages and API are consistent.${warnings ? ` (${warnings} avertissement(s))` : ""}`
);
process.exit(0);
