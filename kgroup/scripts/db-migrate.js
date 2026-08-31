/* =========================================================================
   Applies db/schema.sql to the Neon database in DATABASE_URL.
   Idempotent — safe to run repeatedly.        Usage:  npm run db:migrate
   ========================================================================= */
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { pool } = require("../server/db");

/* Applied in this order — later files may depend on earlier ones. */
const MIGRATIONS = [
  "schema.sql",       // v3   base + formation
  "schema-crm.sql",   // v3.2 clients, anniversaires, remuneration
];

async function main() {
  const client = await pool.connect();
  try {
    // Tout dans UNE transaction : un echec a mi-parcours ne laisse rien derriere.
    await client.query("BEGIN");
    for (const name of MIGRATIONS) {
      const sql = fs.readFileSync(path.join(__dirname, "..", "db", name), "utf8");
      console.log(`  applying db/${name}…`);
      await client.query(sql);
    }
    await client.query("COMMIT");
    console.log("Schema applied.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("\nMigration failed:", err.message);
    if (err.position) console.error("  at character offset", err.position);
    await pool.end().catch(() => {});
    process.exit(1);
  });
