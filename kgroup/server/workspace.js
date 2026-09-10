"use strict";

const db = require("./db");

let repairPromise = null;

/**
 * Reconciles legacy administrator teams into the shared KGROUP workspace.
 * This is intentionally idempotent so old deployments are repaired on the
 * first authenticated admin request after an upgrade.
 */
async function ensureSharedAdminWorkspace() {
  if (repairPromise) return repairPromise;
  repairPromise = db.tx(async (client) => {
    const { rows: teams } = await client.query(
      `select id from public.teams order by created_at nulls first, id limit 1`
    );
    if (!teams.length) return null;
    const workspaceId = teams[0].id;

    const { rows: availableRows } = await client.query(
      `select table_name
         from information_schema.tables
        where table_schema = 'public' and table_name = any($1::text[])`,
      [[
        "birthday_reminders", "clients", "compensation_settings", "challenges",
        "notifications", "payroll_periods", "profiles", "quiz_attempts",
        "sales", "salespersons", "training_progress",
      ]]
    );
    const available = new Set(availableRows.map((row) => row.table_name));

    if (available.has("sales") && available.has("clients")) await client.query(
      `update public.sales s
          set client_id = (
            select min(keeper.id)
              from public.clients duplicate
              join public.clients keeper
                on keeper.phone_e164 = duplicate.phone_e164
               and keeper.id < duplicate.id
             where duplicate.id = s.client_id
          )
        where exists (
          select 1 from public.clients duplicate
           where duplicate.id = s.client_id
             and duplicate.phone_e164 is not null
             and exists (
               select 1 from public.clients keeper
                where keeper.phone_e164 = duplicate.phone_e164
                  and keeper.id < duplicate.id
             )
        )`
    );
    if (available.has("birthday_reminders") && available.has("clients")) await client.query(
      `delete from public.birthday_reminders br
        using public.clients duplicate
       where br.client_id = duplicate.id
         and duplicate.phone_e164 is not null
         and exists (
           select 1 from public.clients keeper
            where keeper.phone_e164 = duplicate.phone_e164
              and keeper.id < duplicate.id
         )`
    );
    if (available.has("clients")) await client.query(
      `delete from public.clients duplicate
       where duplicate.phone_e164 is not null
         and exists (
           select 1 from public.clients keeper
            where keeper.phone_e164 = duplicate.phone_e164
              and keeper.id < duplicate.id
         )`
    );
    if (available.has("compensation_settings")) {
      await client.query(`delete from public.compensation_settings where team_id <> $1`, [workspaceId]);
    }

    const tables = [
      "profiles", "salespersons", "sales", "challenges", "training_progress",
      "quiz_attempts", "notifications", "clients", "compensation_settings", "payroll_periods",
    ];
    for (const table of tables.filter((name) => available.has(name))) {
      const where = table === "profiles" ? "where role = 'admin'" : "where team_id is not null";
      await client.query(`update public.${table} set team_id = $1 ${where}`, [workspaceId]);
    }
    return workspaceId;
  }).catch((err) => {
    repairPromise = null;
    throw err;
  });
  return repairPromise;
}

module.exports = { ensureSharedAdminWorkspace };
