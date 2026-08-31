/* =========================================================================
   KGROUP — local / self-hosted entry point
   Loads .env, then serves the API and the static site on one origin.
   ========================================================================= */
"use strict";

require("dotenv").config();

const app = require("./app");

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`KGROUP running on http://localhost:${PORT}`);
  console.log(`  API      http://localhost:${PORT}/api/health`);
  console.log(`  App      http://localhost:${PORT}/login.html`);
});
