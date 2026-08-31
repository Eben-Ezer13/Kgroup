/* =========================================================================
   KGROUP — Express application
   -------------------------------------------------------------------------
   This is the layer Supabase used to provide as a hosted service. It is the
   ONLY process that holds DATABASE_URL; the browser never sees it.

       Frontend (static HTML/JS)
             |  fetch('/api/...')  + session cookie / Bearer token
             v
       Express API  (this file)
             |  parameterised SQL via pg
             v
       Neon PostgreSQL

   Exported as an app rather than a server so the same code can run as a normal
   Node process (server/index.js) or inside a Netlify Function
   (netlify/functions/api.js).
   ========================================================================= */
"use strict";

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const db = require("./db");
const { attachUser } = require("./auth");
const { HttpError } = require("./policies");
const authRoutes = require("./routes/auth");
const dataRoutes = require("./routes/data");
const trainingRoutes = require("./routes/training");
const clientRoutes = require("./routes/clients");
const payrollRoutes = require("./routes/payroll");
const reminderRoutes = require("./routes/reminders");

const app = express();

app.set("trust proxy", 1); // Netlify/Render terminate TLS in front of us

/* ---------------- CORS -------------------------------------------------- *
 * Same-origin deployments need none of this. It only opens up when
 * CORS_ORIGINS is set, and then only for the exact origins listed — never "*",
 * which cannot carry credentials anyway. */
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (allowedOrigins.length) {
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error("Origin not allowed by CORS"));
      },
      credentials: true,
    })
  );
}

app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

/* ---------------- Health ------------------------------------------------ *
 * api.js probes this on load to decide between live mode and the demo data in
 * data.js, so it must stay cheap and must never leak connection details. */
app.get("/api/health", async (_req, res) => {
  // Distinguer les deux pannes possibles fait gagner du temps au diagnostic :
  // une variable d'environnement oubliee ne se corrige pas comme une base
  // injoignable. `reason` reste volontairement un mot-cle sans detail, pour ne
  // rien reveler de l'infrastructure a un appelant anonyme.
  if (!db.isConfigured()) {
    console.error("[health] DATABASE_URL absente de l'environnement du serveur.");
    return res.status(503).json({
      ok: false,
      database: "neon",
      connected: false,
      reason: "not_configured",
    });
  }
  try {
    await db.ping();
    return res.json({ ok: true, database: "neon", connected: true });
  } catch (err) {
    console.error("[health] database unreachable:", err.message);
    return res.status(503).json({
      ok: false,
      database: "neon",
      connected: false,
      reason: "unreachable",
    });
  }
});

/* ---------------- Routes ------------------------------------------------ */
app.use("/api", attachUser);
app.use("/api/auth", authRoutes);
app.use("/api", dataRoutes);
app.use("/api", trainingRoutes);
app.use("/api", clientRoutes);
app.use("/api", payrollRoutes);
app.use("/api", reminderRoutes);

app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown endpoint." }));

/* ---------------- Static site ------------------------------------------- *
 * Serving the HTML from the same origin as the API keeps the session cookie
 * first-party, which is the simplest and safest setup. Disable with
 * SERVE_STATIC=false if the pages are hosted separately.
 *
 * The frontend lives in the repository root alongside the server, so serving
 * the root wholesale would publish server/, scripts/, db/schema.sql, tests/
 * and node_modules/ as well. Only what a browser actually needs is exposed:
 * root-level web assets plus assets/. Everything else 404s. */
if (String(process.env.SERVE_STATIC || "true") !== "false") {
  const root = path.join(__dirname, "..");
  const WEB_ASSET = /\.(?:html|css|js|mjs|map|svg|ico|png|jpe?g|gif|webp|avif|woff2?|webmanifest|txt)$/i;

  app.use((req, res, next) => {
    // Decode first: "%2e%2e%2fserver%2fdb.js" must not slip past the checks.
    let pathname;
    try {
      pathname = decodeURIComponent(req.path);
    } catch (_) {
      return res.status(400).send("Bad request");
    }
    if (pathname === "/") return next();

    const segments = pathname.split("/").filter(Boolean);
    if (segments.some((s) => s === "." || s === ".." || s.startsWith("."))) {
      return res.status(404).send("Not found");
    }

    const isAsset = segments[0] === "assets";
    const isRootWebFile = segments.length === 1 && WEB_ASSET.test(segments[0]);
    // Extensionless root paths are allowed so `extensions: ["html"]` can
    // resolve /dashboard to dashboard.html, as it did on Netlify.
    const isRootPage = segments.length === 1 && !path.extname(segments[0]);

    if (isAsset || isRootWebFile || isRootPage) return next();
    return res.status(404).send("Not found");
  });

  app.use(express.static(root, { extensions: ["html"], dotfiles: "ignore" }));
}

/* ---------------- Errors ------------------------------------------------ *
 * Known failures (HttpError) carry a message meant for the user — the browser
 * shows it verbatim in the same toast/inline slots Supabase errors used to fill.
 * Anything else is logged server-side and reported generically, so a SQL error
 * can never expose schema details or the connection string. */
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed request body." });
  }
  console.error("[api] unhandled error:", err);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
});

module.exports = app;
