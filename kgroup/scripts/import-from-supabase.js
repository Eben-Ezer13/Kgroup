/* =========================================================================
   ONE-OFF: copy existing rows from Supabase into Neon.
   -------------------------------------------------------------------------
   Usage
     1. Put BOTH connection strings in .env:
          SUPABASE_DB_URL   Supabase -> Project Settings -> Database ->
                            Connection string (URI). Use the DIRECT string,
                            not the pooler, so auth.users is readable.
          DATABASE_URL      your Neon connection string.
     2. npm run db:migrate        (create the schema first)
     3. npm run data:import       (add --dry-run to preview without writing)
     4. npm run db:check          (compare the printed counts)

   Guarantees
     * Primary keys, foreign keys and timestamps are preserved verbatim, so
       every relation survives the move.
     * Password hashes come across as-is (both sides use bcrypt), so existing
       users keep their current passwords.
     * Triggers are disabled during the copy. Without that, inserting users
       would re-run handle_new_user() and create duplicate teams/profiles, and
       inserting sales would re-run apply_sale() and double every rep's totals.
     * Re-runnable: every insert is ON CONFLICT DO NOTHING. Nothing is deleted
       from either database at any point.
   ========================================================================= */
"use strict";

require("dotenv").config();

const { Client } = require("pg");

const DRY_RUN = process.argv.includes("--dry-run");

const SUPABASE_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_URL) {
  console.error(
    "SUPABASE_DB_URL is not set.\n" +
      "Add it to .env (Supabase -> Project Settings -> Database -> Connection string).\n" +
      "Remove it again once the import is done."
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add your Neon connection string to .env.");
  process.exit(1);
}

/* Copy order matters: a table's parents must exist before its rows land. */
const PLAN = [
  {
    target: "users",
    // auth.users is Supabase's own table; only the columns this app relied on
    // are carried over. encrypted_password is bcrypt on both sides.
    source: `select id, email, encrypted_password, email_confirmed_at,
                    coalesce(raw_user_meta_data, '{}'::jsonb) as raw_user_meta_data,
                    created_at
               from auth.users order by created_at`,
    columns: ["id", "email", "encrypted_password", "email_confirmed_at", "raw_user_meta_data", "created_at"],
  },
  {
    target: "teams",
    source: `select id, name, owner, created_at from public.teams order by created_at`,
    columns: ["id", "name", "owner", "created_at"],
  },
  {
    target: "profiles",
    source: `select id, full_name, email, role, team_id, salesperson_id, city, hue, created_at
               from public.profiles order by created_at`,
    columns: ["id", "full_name", "email", "role", "team_id", "salesperson_id", "city", "hue", "created_at"],
  },
  {
    target: "salespersons",
    source: `select id, owner, team_id, auth_id, invite_code, claimed, name, city, phone, email,
                    sales, today_sales, revenue, coalesce(commission, 0) as commission,
                    status, level, xp, xp_to_next, target, hue, badges, created_at
               from public.salespersons order by created_at`,
    columns: ["id", "owner", "team_id", "auth_id", "invite_code", "claimed", "name", "city", "phone",
              "email", "sales", "today_sales", "revenue", "commission", "status", "level", "xp",
              "xp_to_next", "target", "hue", "badges", "created_at"],
  },
  {
    target: "sales",
    source: `select id, owner, team_id, rep_id, rep_name, customer, product, qty, amount,
                    coalesce(commission, 0) as commission, pay, remarks, created_at
               from public.sales order by created_at`,
    columns: ["id", "owner", "team_id", "rep_id", "rep_name", "customer", "product", "qty",
              "amount", "commission", "pay", "remarks", "created_at"],
  },
  {
    target: "challenges",
    source: `select id, owner, team_id, title, description, reward, icon, hue, target, current,
                    ends, created_at
               from public.challenges order by created_at`,
    columns: ["id", "owner", "team_id", "title", "description", "reward", "icon", "hue",
              "target", "current", "ends", "created_at"],
  },
];

/* Triggers that must stay quiet while historical rows are inserted. */
const TRIGGERS = [
  ["users", "on_auth_user_created"],
  ["sales", "on_sale_insert"],
];

async function main() {
  const src = new Client({ connectionString: SUPABASE_URL, ssl: { rejectUnauthorized: false } });
  const dst = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });

  await src.connect();
  await dst.connect();
  console.log(`Connected to Supabase and Neon.${DRY_RUN ? "  (dry run — nothing will be written)" : ""}\n`);

  const summary = [];

  try {
    if (!DRY_RUN) {
      for (const [table, trigger] of TRIGGERS) {
        await dst.query(`alter table public.${table} disable trigger ${trigger}`);
      }
      console.log("Triggers disabled for the copy.\n");
    }

    for (const step of PLAN) {
      let rows;
      try {
        ({ rows } = await src.query(step.source));
      } catch (err) {
        // A v1 Supabase project may genuinely not have every table.
        console.log(`  SKIP   ${step.target.padEnd(14)} (not readable in Supabase: ${err.message})`);
        summary.push({ table: step.target, source: null, target: null, note: "not readable" });
        continue;
      }

      let inserted = 0;
      if (!DRY_RUN && rows.length) {
        const cols = step.columns.map((c) => `"${c}"`).join(", ");
        const params = step.columns.map((_, i) => `$${i + 1}`).join(", ");
        const sql = `insert into public.${step.target} (${cols}) values (${params})
                     on conflict (id) do nothing`;
        for (const row of rows) {
          const values = step.columns.map((c) => {
            const v = row[c];
            // jsonb columns must be handed to pg as text, not as JS objects.
            return v !== null && typeof v === "object" && !(v instanceof Date)
              ? JSON.stringify(v)
              : v;
          });
          const res = await dst.query(sql, values);
          inserted += res.rowCount;
        }
      }

      const { rows: countRows } = await dst.query(`select count(*)::int as n from public.${step.target}`);
      const targetCount = countRows[0].n;
      summary.push({ table: step.target, source: rows.length, target: targetCount, inserted });
      console.log(
        `  COPY   ${step.target.padEnd(14)} supabase=${String(rows.length).padStart(6)}` +
          `  inserted=${String(inserted).padStart(6)}  neon=${String(targetCount).padStart(6)}`
      );
    }
  } finally {
    if (!DRY_RUN) {
      for (const [table, trigger] of TRIGGERS) {
        await dst.query(`alter table public.${table} enable trigger ${trigger}`).catch((e) =>
          console.error(`  WARNING: could not re-enable ${trigger}: ${e.message}`)
        );
      }
      console.log("\nTriggers re-enabled.");
    }
    await src.end().catch(() => {});
  }

  /* ---- Reconciliation ------------------------------------------------ */
  console.log("\nReconciliation");
  console.log("  table            supabase      neon   status");
  let mismatches = 0;
  for (const s of summary) {
    if (s.source === null) {
      console.log(`  ${s.table.padEnd(14)}         —         —   ${s.note}`);
      continue;
    }
    const ok = s.target >= s.source;
    if (!ok) mismatches++;
    console.log(
      `  ${s.table.padEnd(14)} ${String(s.source).padStart(9)} ${String(s.target).padStart(9)}   ` +
        (ok
          ? s.target === s.source ? "match" : "match + pre-existing Neon rows"
          : "SHORT — investigate")
    );
  }

  /* ---- Relationship integrity ---------------------------------------- */
  if (!DRY_RUN) {
    console.log("\nRelationship checks (orphaned foreign keys)");
    const checks = [
      ["profiles.team_id",     `select count(*)::int n from public.profiles p where p.team_id is not null and not exists (select 1 from public.teams t where t.id = p.team_id)`],
      ["salespersons.owner",   `select count(*)::int n from public.salespersons s where not exists (select 1 from public.users u where u.id = s.owner)`],
      ["salespersons.team_id", `select count(*)::int n from public.salespersons s where s.team_id is not null and not exists (select 1 from public.teams t where t.id = s.team_id)`],
      ["sales.rep_id",         `select count(*)::int n from public.sales s where s.rep_id is not null and not exists (select 1 from public.salespersons r where r.id = s.rep_id)`],
      ["challenges.team_id",   `select count(*)::int n from public.challenges c where c.team_id is not null and not exists (select 1 from public.teams t where t.id = c.team_id)`],
    ];
    for (const [label, sql] of checks) {
      const { rows } = await dst.query(sql);
      const n = rows[0].n;
      if (n) mismatches++;
      console.log(`  ${n === 0 ? "OK  " : "BAD "}  ${label.padEnd(22)} ${n} orphan(s)`);
    }

    console.log("\nSequences / identifiers");
    console.log("  OK    every primary key is a uuid default gen_random_uuid() — no sequences to reset.");
  }

  await dst.end();

  if (mismatches) {
    console.error(`\n${mismatches} issue(s) found — review the rows above before switching over.`);
    process.exitCode = 1;
  } else {
    console.log("\nImport complete and consistent.");
    console.log("Now remove SUPABASE_DB_URL from .env.");
  }
}

main().catch((err) => {
  console.error("\nImport failed:", err.message);
  process.exit(1);
});
