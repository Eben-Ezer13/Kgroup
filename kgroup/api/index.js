/* =========================================================================
   KGROUP — Point d'entree serverless Vercel
   -------------------------------------------------------------------------
   Vercel detecte automatiquement les fichiers du dossier /api et en fait des
   fonctions serverless. Celle-ci sert TOUT /api/* en exposant la meme
   application Express que le serveur local et que la fonction Netlify — une
   seule implementation de l'API, trois facons de l'heberger :

     npm start                  -> server/index.js   (Node classique)
     Netlify                    -> netlify/functions/api.js
     Vercel                     -> ce fichier

   Les fichiers statiques sont servis par le CDN de Vercel depuis dist/,
   pas par Express : SERVE_STATIC est donc force a false.
   ========================================================================= */
"use strict";

process.env.SERVE_STATIC = "false";

const app = require("../server/app");

/**
 * Le runtime Node de Vercel appelle le handler exporte avec (req, res) — la
 * signature exacte d'une application Express, qui peut donc etre exportee
 * telle quelle.
 *
 * Une seule precaution : selon la reecriture qui a amene la requete ici,
 * `req.url` peut avoir perdu son prefixe /api. Les routes Express sont
 * declarees avec ce prefixe, on le retablit donc avant de deleguer.
 */
module.exports = (req, res) => {
  if (!req.url.startsWith("/api")) {
    req.url = "/api" + (req.url === "/" ? "" : req.url);
  }
  return app(req, res);
};
