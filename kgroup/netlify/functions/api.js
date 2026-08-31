/* =========================================================================
   KGROUP — Netlify Function wrapper
   -------------------------------------------------------------------------
   The project already deploys to Netlify as a static site. This keeps that
   deployment intact: netlify.toml rewrites /api/* to this function, and the
   same Express app from server/app.js handles the request.

   Static files are served by Netlify's CDN, not Express, so SERVE_STATIC is
   forced off before the app is required.
   ========================================================================= */
"use strict";

process.env.SERVE_STATIC = "false";

const serverless = require("serverless-http");
const app = require("../../server/app");

const FUNCTION_PREFIX = "/.netlify/functions/api";

const handler = serverless(app);

/**
 * Depending on the Netlify runtime and how the rewrite fired, the incoming path
 * is either the original `/api/health` or the rewritten
 * `/.netlify/functions/api/api/health`. Express only knows the `/api/...` form,
 * so normalise to that before delegating.
 */
function normalizePath(rawPath) {
  let p = rawPath || "/";
  if (p.startsWith(FUNCTION_PREFIX)) p = p.slice(FUNCTION_PREFIX.length) || "/";
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.startsWith("/api")) p = "/api" + (p === "/" ? "" : p);
  return p;
}

exports.handler = async (event, context) => {
  const path = normalizePath(event.path);
  return handler({ ...event, path, rawPath: path }, context);
};
