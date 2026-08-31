/* =========================================================================
   End-to-end exercise of the Neon schema: SELECT / INSERT / UPDATE / DELETE,
   foreign keys, constraints, transactions, and both triggers.

   Usage:  npm run db:smoke

   Everything it creates hangs off one throwaway user and is removed at the end
   (ON DELETE CASCADE), so it is safe to run against a database with real data.
   ========================================================================= */
"use strict";

require("dotenv").config();

const { pool, query, one, tx } = require("../server/db");

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? "  -> " + detail : ""}`);
  }
}

async function main() {
  const stamp = Date.now();
  const email = `smoke-${stamp}@kgroup.test`;
  let userId = null;

  try {
    /* ---- INSERT + signup trigger ------------------------------------ */
    console.log("\nSignup trigger (handle_new_user)");
    const user = await one(
      `insert into public.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at)
       values ($1, 'x', $2::jsonb, now()) returning id, email`,
      [email, JSON.stringify({ full_name: "Smoke Admin", role: "admin" })]
    );
    userId = user.id;
    check("user row inserted", Boolean(userId));

    const profile = await one(`select * from public.profiles where id = $1`, [userId]);
    check("profile auto-created", Boolean(profile));
    check("profile role = admin", profile && profile.role === "admin", profile && profile.role);
    check("profile linked to a team", Boolean(profile && profile.team_id));

    const team = await one(`select * from public.teams where id = $1`, [profile.team_id]);
    check("team auto-created", Boolean(team));
    check("team owned by the user", team && team.owner === userId);
    check("team named after the user", team && team.name === "Smoke Admin's Team", team && team.name);

    /* ---- INSERT + relations ----------------------------------------- */
    console.log("\nSalespersons (INSERT, relations, defaults)");
    const rep = await one(
      `insert into public.salespersons (owner, team_id, invite_code, claimed, name, city, hue)
       values ($1, $2, $3, false, 'Smoke Rep', 'Casablanca', 210) returning *`,
      [userId, profile.team_id, `smoke${stamp}`]
    );
    check("salesperson inserted", Boolean(rep && rep.id));
    check("default level = Rookie", rep.level === "Rookie", rep.level);
    check("default xp_to_next = 1700", rep.xp_to_next === 1700, String(rep.xp_to_next));
    check("default badges = []", Array.isArray(rep.badges) && rep.badges.length === 0);
    check("revenue starts at 0", Number(rep.revenue) === 0);

    /* ---- SQL function ------------------------------------------------ */
    console.log("\ninvite_info() lookup");
    const invite = await one(`select * from public.invite_info($1)`, [`smoke${stamp}`]);
    check("invite resolves to the rep", invite && invite.name === "Smoke Rep");
    check("invite reports the team name", invite && invite.team_name === "Smoke Admin's Team");
    const bogus = await one(`select * from public.invite_info($1)`, ["definitely-not-a-code"]);
    check("unknown code returns nothing", bogus === null);

    /* ---- INSERT + roll-up trigger ------------------------------------ */
    console.log("\nSale roll-up trigger (apply_sale)");
    await query(
      `insert into public.sales (owner, team_id, rep_id, rep_name, customer, product, qty, amount, commission, pay)
       values ($1, $2, $3, 'Smoke Rep', 'Smoke Customer', 'Parfum 100 ml', 2, 300, 30, 'Card')`,
      [userId, profile.team_id, rep.id]
    );
    const after = await one(`select * from public.salespersons where id = $1`, [rep.id]);
    check("units rolled up (+2)", after.sales === 2, String(after.sales));
    check("today_sales rolled up (+2)", after.today_sales === 2, String(after.today_sales));
    check("revenue rolled up (+300)", Number(after.revenue) === 300, String(after.revenue));
    check("commission rolled up (+30)", Number(after.commission) === 30, String(after.commission));
    // 300 MAD / 60 = 5, floored at the minimum gain of 10
    check("xp gained (min 10)", after.xp === 10, String(after.xp));
    check("level recalculated", after.level === "Rookie", after.level);
    check("starter badge awarded", JSON.stringify(after.badges).includes("starter"), JSON.stringify(after.badges));

    /* ---- SELECT with the app's own ordering -------------------------- */
    console.log("\nSELECT (same queries the API runs)");
    const listed = await one(
      `select count(*)::int as n from public.salespersons where team_id = $1`, [profile.team_id]
    );
    check("team-scoped roster query", listed.n === 1, String(listed.n));
    const sales = await one(
      `select count(*)::int as n from public.sales where team_id = $1`, [profile.team_id]
    );
    check("team-scoped sales query", sales.n === 1, String(sales.n));

    /* ---- UPDATE ------------------------------------------------------ */
    console.log("\nUPDATE");
    await query(`update public.profiles set full_name = 'Renamed', city = 'Rabat' where id = $1`, [userId]);
    const renamed = await one(`select full_name, city from public.profiles where id = $1`, [userId]);
    check("profile updated", renamed.full_name === "Renamed" && renamed.city === "Rabat");

    /* ---- Constraints ------------------------------------------------- */
    console.log("\nConstraints");
    let rejected = false;
    try {
      await query(
        `insert into public.sales (owner, team_id, customer, product) values ($1, $2, null, 'X')`,
        [userId, profile.team_id]
      );
    } catch (_) { rejected = true; }
    check("NOT NULL on sales.customer enforced", rejected);

    rejected = false;
    try {
      await query(`insert into public.users (email) values ($1)`, [email.toUpperCase()]);
    } catch (_) { rejected = true; }
    check("case-insensitive unique email enforced", rejected);

    rejected = false;
    try {
      await query(
        `insert into public.salespersons (owner, team_id, name)
         values ('00000000-0000-0000-0000-000000000000', $1, 'Orphan')`,
        [profile.team_id]
      );
    } catch (_) { rejected = true; }
    check("FK salespersons.owner -> users enforced", rejected);

    /* ---- Transactions ------------------------------------------------ */
    console.log("\nTransactions");
    const before = (await one(`select count(*)::int as n from public.challenges where team_id = $1`, [profile.team_id])).n;
    try {
      await tx(async (client) => {
        await client.query(
          `insert into public.challenges (owner, team_id, title) values ($1, $2, 'Rolled back')`,
          [userId, profile.team_id]
        );
        throw new Error("deliberate rollback");
      });
    } catch (_) { /* expected */ }
    const afterRollback = (await one(`select count(*)::int as n from public.challenges where team_id = $1`, [profile.team_id])).n;
    check("failed transaction rolled back", afterRollback === before, `${before} -> ${afterRollback}`);

    await tx(async (client) => {
      await client.query(
        `insert into public.challenges (owner, team_id, title, reward, target) values ($1, $2, 'Committed', 'Bonus', 50)`,
        [userId, profile.team_id]
      );
    });
    const afterCommit = (await one(`select count(*)::int as n from public.challenges where team_id = $1`, [profile.team_id])).n;
    check("successful transaction committed", afterCommit === before + 1, `${before} -> ${afterCommit}`);

    /* ---- DELETE + cascade -------------------------------------------- */
    console.log("\nDELETE (cascade)");
    await query(`delete from public.users where id = $1`, [userId]);
    userId = null;
    const orphanProfile = await one(`select id from public.profiles where email = $1`, [email]);
    check("profile cascade-deleted", orphanProfile === null);
    const orphanRep = await one(`select id from public.salespersons where id = $1`, [rep.id]);
    check("salesperson cascade-deleted", orphanRep === null);
    const orphanTeam = await one(`select id from public.teams where id = $1`, [profile.team_id]);
    check("team cascade-deleted", orphanTeam === null);
  } finally {
    if (userId) {
      await query(`delete from public.users where id = $1`, [userId]).catch(() => {});
      console.log("\n(cleaned up the test user)");
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("\nSmoke test errored:", err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
