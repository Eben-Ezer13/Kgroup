import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to run migrations.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL("../neon-schema.sql", import.meta.url), "utf8"));
  console.log("Neon schema applied.");
} finally {
  await pool.end();
}
