/* =========================================================================
   Verifies the Neon database matches what the app expects, and prints row
   counts for reconciliation against Supabase.        Usage:  npm run db:check
   Read-only — writes nothing.
   ========================================================================= */
"use strict";

require("dotenv").config();

const { pool, many, one } = require("../server/db");

const EXPECTED_TABLES = [
  "users", "teams", "profiles", "salespersons", "sales", "challenges", "password_reset_tokens",
  "training_progress", "quiz_attempts", "notifications",
  "clients", "compensation_settings", "payroll_periods", "birthday_reminders",
];
const EXPECTED_FUNCTIONS = [
  "team_id_of", "role_of", "invite_info", "handle_new_user", "apply_sale",
  "apply_sale_client", "birthday_falls_on", "days_until_birthday", "today_casablanca",
];
const EXPECTED_TRIGGERS = ["on_auth_user_created", "on_sale_insert", "on_sale_insert_client"];
const EXPECTED_INDEXES = [
  "idx_users_email_lower", "idx_salespersons_team", "idx_salespersons_invite",
  "idx_sales_team", "idx_sales_created", "idx_challenges_team",
  "idx_quiz_attempts_user", "idx_notifications_team",
  "idx_clients_phone_uniq", "idx_clients_team", "idx_clients_rep",
  "idx_clients_birthday", "idx_sales_client", "idx_payroll_team_period",
];

let failures = 0;
const mark = (ok, label, extra) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "MISS"}  ${label}${extra ? "  " + extra : ""}`);
};

async function main() {
  const version = await one("select version() as v");
  console.log("Connected to:", version.v.split(",")[0]);
  console.log();

  console.log("Tables");
  const tables = (await many(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`
  )).map((r) => r.table_name);
  EXPECTED_TABLES.forEach((t) => mark(tables.includes(t), t));

  console.log("\nFunctions");
  const fns = (await many(
    `select routine_name from information_schema.routines where routine_schema = 'public'`
  )).map((r) => r.routine_name);
  EXPECTED_FUNCTIONS.forEach((f) => mark(fns.includes(f), f + "()"));

  console.log("\nTriggers");
  const trg = (await many(
    `select tgname from pg_trigger where not tgisinternal`
  )).map((r) => r.tgname);
  EXPECTED_TRIGGERS.forEach((t) => mark(trg.includes(t), t));

  console.log("\nIndexes");
  const idx = (await many(
    `select indexname from pg_indexes where schemaname = 'public'`
  )).map((r) => r.indexname);
  EXPECTED_INDEXES.forEach((i) => mark(idx.includes(i), i));

  console.log("\nForeign keys");
  const fks = await many(
    `select tc.table_name, kcu.column_name, ccu.table_name as ref_table
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
      order by tc.table_name, kcu.column_name`
  );
  fks.forEach((f) => console.log(`  OK    ${f.table_name}.${f.column_name} -> ${f.ref_table}`));

  console.log("\nRow counts  (compare these against Supabase)");
  for (const t of EXPECTED_TABLES) {
    if (!tables.includes(t)) continue;
    const { count } = await one(`select count(*)::int as count from public.${t}`);
    console.log(`  ${String(count).padStart(7)}  ${t}`);
  }

  console.log();
  if (failures) {
    console.error(`${failures} expected object(s) missing — run: npm run db:migrate`);
    process.exitCode = 1;
  } else {
    console.log("Schema matches db/schema.sql.");
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("\nCheck failed:", err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
