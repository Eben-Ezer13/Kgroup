/* =========================================================================
   Project checks that do not need a database.        Usage:  npm run lint
     1. Every JavaScript file parses.
     2. No credential ever appears in a file the browser or Git can see.
     3. Nothing still points at Supabase.
   Exits non-zero on any failure, so it is safe to gate a deploy on.
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
// `legacy/` holds the retired Supabase files, kept for reference only — nothing
// in the running app loads them, so they are not scanned.
const SKIP_DIRS = new Set(["node_modules", ".git", ".netlify", "dist", "assets", "legacy"]);

/**
 * Strips comments so the scans below judge code, not prose. The files here
 * document the old Supabase calls they replaced, and those comments must not
 * read as leftover Supabase wiring.
 * Leaves `https://` intact by only cutting `//` that is not preceded by a colon.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/^\s*(--|#)[^\n]*$/gm, "");
}

/** Local/placeholder connection strings are not secrets. */
function isPlaceholderDsn(match) {
  return /USER:PASSWORD|YOUR_|xxxx|example\.com|@localhost|@127\.0\.0\.1/i.test(match);
}

let errors = 0;
let warnings = 0;
const fail = (msg) => { errors++; console.error(`  ERROR    ${msg}`); };
const warn = (msg) => { warnings++; console.warn(`  WARNING  ${msg}`); };

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example" && entry.name !== ".gitignore") continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const files = walk(ROOT);
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");

/* ---- 1. Syntax ---------------------------------------------------------- */
console.log("\nJavaScript syntax");
const jsFiles = files.filter((f) => f.endsWith(".js"));
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (err) {
    fail(`${rel(f)} does not parse:\n${(err.stderr || "").toString().trim()}`);
  }
}
console.log(`  checked ${jsFiles.length} file(s)`);

/* ---- 2. Secrets --------------------------------------------------------- */
console.log("\nSecret scan");

// Anything the browser downloads, plus anything committed to Git.
const PUBLIC_EXT = new Set([".js", ".html", ".css", ".md", ".json", ".sql", ".toml", ".yml", ".yaml"]);
const SECRET_PATTERNS = [
  // Captures the host too, so localhost placeholders can be told apart from
  // a real credential pointing at a hosted database.
  [/postgres(?:ql)?:\/\/[^\s"'<>]*:[^\s"'<>@]+@[^\s"'<>/]*/i, "a PostgreSQL connection string with a password"],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, "a JWT (Supabase anon/service key or similar)"],
  [/\bsb_secret_[A-Za-z0-9_-]{10,}/, "a Supabase secret key"],
  [/\bservice_role\b\s*[:=]\s*["'][^"']{20,}/i, "a Supabase service_role key"],
  [/\bre_[A-Za-z0-9]{20,}/, "a Resend API key"],
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, "a Google OAuth client secret"],
];

for (const f of files) {
  const ext = path.extname(f);
  if (!PUBLIC_EXT.has(ext)) continue;
  if (rel(f) === "scripts/lint.js") continue;       // the patterns themselves
  if (rel(f) === ".env.example") continue;          // placeholders only

  const text = fs.readFileSync(f, "utf8");
  for (const [pattern, label] of SECRET_PATTERNS) {
    const m = text.match(pattern);
    if (!m) continue;
    if (isPlaceholderDsn(m[0])) continue;
    fail(`${rel(f)} contains ${label}. Move it to .env and never commit it.`);
  }
}

/* Files the browser downloads must not touch server-only variables. */
for (const f of files) {
  if (!f.endsWith(".js")) continue;
  const r = rel(f);
  if (r.startsWith("server/") || r.startsWith("scripts/") || r.startsWith("netlify/") || r.startsWith("tests/")) {
    continue;
  }
  if (/process\s*\.\s*env\s*\.\s*DATABASE_URL/.test(stripComments(fs.readFileSync(f, "utf8")))) {
    fail(`${r} reads process.env.DATABASE_URL. That value must never reach the browser.`);
  }
}

/* ---- Le vrai danger : un .env VERSIONNE ---------------------------------
 * On interroge git directement plutot que de deduire le resultat du contenu
 * de .gitignore. C est la question qui compte vraiment, et la seule dont la
 * reponse justifie de faire echouer quoi que ce soit.
 * En dehors d un depot git (conteneur de build, dossier telecharge), git
 * repond en erreur : on considere alors qu il n y a rien de suivi. */
function isTrackedByGit(file) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", file], { cwd: ROOT, stdio: "pipe" });
    return true;
  } catch (_) {
    return false; // non suivi, ou pas de depot git ici
  }
}

for (const envFile of [".env", ".env.local", ".env.production"]) {
  if (isTrackedByGit(envFile)) {
    fail(
      `${envFile} est versionne dans git. Retirez-le (git rm --cached ${envFile}) ` +
      "et considerez tous les secrets qu il contenait comme compromis."
    );
  }
}

/* ---- Hygiene du depot : un AVERTISSEMENT, jamais une erreur -------------
 * Un .gitignore incomplet est un probleme a corriger, mais il ne dit rien de
 * la validite du code. Faire echouer un deploiement pour cela bloquerait une
 * mise en production sans rien proteger : a ce stade, ce qui est commite
 * l est deja. */
/* Sur un conteneur d'integration continue, l'absence de .gitignore n'apprend
   rien : la plateforme n'y expédie pas forcément les fichiers de métadonnées
   git, et de toute façon personne ne va y lancer `git add`. On ne signale donc
   ce point que là où il est actionnable — sur la machine d'un développeur. */
const IS_CI = Boolean(
  process.env.CI || process.env.VERCEL || process.env.NETLIFY || process.env.GITHUB_ACTIONS
);

const gitignorePath = path.join(ROOT, ".gitignore");
if (!fs.existsSync(gitignorePath)) {
  if (!IS_CI) {
    warn(".gitignore est absent — sans lui, un `git add .` pourrait versionner .env, dist/ ou node_modules/.");
  }
} else {
  const gitignore = fs.readFileSync(gitignorePath, "utf8");
  // Tolere les fins de ligne Windows (CRLF) : un depot cree sous Windows puis
  // clone sous Linux conserve les retours chariot, ce qui ferait echouer un
  // simple /^...$/m alors que la regle est bien presente.
  const lines = gitignore.split(/\r?\n/).map((l) => l.trim());
  for (const rule of [".env", ".env.*", "node_modules/", "dist/"]) {
    if (!lines.includes(rule)) warn(`.gitignore ne contient pas la regle « ${rule} »`);
  }
}
console.log(`  scanned ${files.filter((f) => PUBLIC_EXT.has(path.extname(f))).length} file(s)`);

/* ---- 3. Leftover Supabase wiring ---------------------------------------- */
console.log("\nSupabase references");
const LIVE_EXT = new Set([".js", ".html", ".toml", ".json"]);
for (const f of files) {
  if (!LIVE_EXT.has(path.extname(f))) continue;
  const r = rel(f);
  if (r === "scripts/lint.js") continue;
  // The one-off importer must keep talking to Supabase.
  if (r === "scripts/import-from-supabase.js") continue;

  const text = stripComments(fs.readFileSync(f, "utf8"));
  if (/@supabase\/supabase-js|cdn\.jsdelivr\.net\/npm\/@supabase|VITE_SUPABASE_/.test(text)) {
    fail(`${r} still loads the Supabase SDK or reads VITE_SUPABASE_* variables.`);
  }
  if (/<script[^>]+src=["']supabase\.js["']/.test(text)) {
    fail(`${r} still includes supabase.js — it should include api.js.`);
  }
  if (/\bsupabase\s*\.\s*(from|auth|storage|rpc)\b/.test(text)) {
    fail(`${r} still makes supabase.* calls.`);
  }
  if (/KG_SUPA_(READY|CONFIGURED)/.test(text)) {
    warn(`${r} references the old KG_SUPA_* globals (now KG_API_*).`);
  }
}

/* ---- Result ------------------------------------------------------------- */
console.log();
if (errors) {
  console.error(`${errors} error(s), ${warnings} warning(s).`);
  process.exit(1);
}
/* Le decompte n'est affiche que s'il y a quelque chose a signaler. Ecrire
   « 0 warning(s) » sur une ligne de succes fait surligner cette ligne en orange
   par les visualiseurs de logs (Vercel, GitHub Actions), qui reperent le mot
   « warning » : un build parfaitement vert semblait alors poser probleme. */
console.log(warnings ? `Lint passed with ${warnings} warning(s).` : "Lint passed.");
