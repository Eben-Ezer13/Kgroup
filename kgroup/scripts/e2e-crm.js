/* =========================================================================
   Parcours CRM de bout en bout contre la vraie base Neon.
   Usage :  node scripts/e2e-crm.js            (le serveur doit tourner)
            BASE=http://127.0.0.1:3010 node scripts/e2e-crm.js

   Couvre : client (création/détection par téléphone/historique), vente
   (association client, commission, statistiques), anniversaires (aujourd'hui,
   demain, plus tard, 29 février, sans date, doublon de rappel), WhatsApp,
   rémunération (calcul, changement de mois, historique, clôture) et les
   permissions des trois rôles.

   Tout ce qui est créé est supprimé à la fin.
   ========================================================================= */
"use strict";

require("dotenv").config();

const BASE = process.env.BASE || "http://127.0.0.1:3010";

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? "  -> " + detail : ""}`); }
};
const section = (t) => console.log(`\n${t}`);

/** Client HTTP conservant sa session, comme le ferait un navigateur. */
function client() {
  let cookie = "";
  return {
    async call(path, opts = {}) {
      const headers = { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) };
      const res = await fetch(BASE + path, {
        method: opts.method || "GET",
        headers: { ...headers, ...(opts.headers || {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
      const text = await res.text();
      let body = null;
      if (text) { try { body = JSON.parse(text); } catch (_) { body = text; } }
      return { status: res.status, body };
    },
  };
}

async function main() {
  const stamp = Date.now();
  const admin = client(), rep = client(), rc = client();
  const emails = {
    admin: `crm-admin-${stamp}@kgroup.test`,
    rep: `crm-rep-${stamp}@kgroup.test`,
    rc: `crm-rc-${stamp}@kgroup.test`,
  };

  section("Mise en place — équipe, commercial, chargé de relation client");
  let r = await admin.call("/api/auth/signup", { method: "POST",
    body: { email: emails.admin, password: "kgroup2026", full_name: "Bénédicte K.", role: "admin" } });
  ok("inscription administrateur", r.status === 201, String(r.status));

  r = await admin.call("/api/salespersons", { method: "POST",
    body: { name: "Amine El Amrani", city: "Casablanca" } });
  const repId = r.body.id, inviteRep = r.body.invite_code;
  ok("commercial créé", r.status === 201);

  r = await admin.call("/api/salespersons", { method: "POST", body: { name: "Sofia Benali" } });
  const inviteRc = r.body.invite_code;

  r = await rep.call("/api/auth/signup", { method: "POST",
    body: { email: emails.rep, password: "kgroup2026", full_name: "Amine El Amrani",
            role: "salesperson", invite_code: inviteRep } });
  ok("commercial inscrit via invitation", r.status === 201);

  r = await rc.call("/api/auth/signup", { method: "POST",
    body: { email: emails.rc, password: "kgroup2026", full_name: "Sofia Benali",
            role: "salesperson", invite_code: inviteRc } });
  const rcUserId = r.body.user.id;
  r = await admin.call(`/api/team/members/${rcUserId}/role`, { method: "PATCH",
    body: { role: "relation_client" } });
  ok("rôle relation_client attribué par l'admin", r.status === 200, JSON.stringify(r.body));

  /* ---------------- CLIENT ---------------- */
  section("Client — création automatique depuis une vente");
  const PHONE = "0612345678";
  r = await rep.call("/api/sales", { method: "POST", body: {
    customer: "Jean Dupont", product: "Parfum 100 ml", qty: 2, amount: 300, commission: 30,
    pay: "Espèces", rep_id: repId, rep_name: "Amine El Amrani",
    client_phone: PHONE, client_birthday: "1990-08-31" } });
  ok("vente enregistrée", r.status === 201, JSON.stringify(r.body));
  ok("vente rattachée à un client", Boolean(r.body.client_id));
  const clientId = r.body.client_id;

  r = await rep.call("/api/clients");
  ok("le client apparaît dans le portefeuille", r.body.length === 1, `${r.body.length}`);
  const c0 = r.body[0];
  ok("nom repris de la vente", c0.name === "Jean Dupont");
  ok("numéro normalisé", c0.phone_e164 === "212612345678", c0.phone_e164);
  ok("numéro affiché lisible", c0.phone_display === "+212 6 12 34 56 78", c0.phone_display);
  ok("anniversaire enregistré", String(c0.birthday).slice(0, 10) === "1990-08-31");
  ok("statistiques à jour", c0.sales_count === 1 && c0.total_spent === 300,
     `${c0.sales_count} vente(s) / ${c0.total_spent}`);
  ok("lien WhatsApp généré", String(c0.whatsapp).startsWith("https://wa.me/212612345678?text="));
  ok("message WhatsApp personnalisé",
     decodeURIComponent(String(c0.whatsapp).split("?text=")[1]).includes("Bonjour Jean Dupont"));

  section("Client — détection par téléphone, aucun doublon");
  r = await rep.call(`/api/clients/lookup?phone=${encodeURIComponent("06 12 34 56 78")}`);
  ok("retrouvé malgré un format différent", r.body.client && r.body.client.id === clientId);

  r = await rep.call("/api/sales", { method: "POST", body: {
    customer: "PEU IMPORTE", product: "Parfum 50 ml", qty: 1, amount: 80, commission: 8,
    pay: "Virement", rep_id: repId, rep_name: "Amine El Amrani", client_phone: "+212612345678" } });
  ok("2e vente acceptée", r.status === 201);
  ok("même client réutilisé", r.body.client_id === clientId);

  r = await rep.call("/api/clients");
  ok("toujours un seul client", r.body.length === 1, `${r.body.length}`);
  ok("totaux cumulés", r.body[0].sales_count === 2 && r.body[0].total_spent === 380,
     `${r.body[0].sales_count} / ${r.body[0].total_spent}`);

  section("Client — fiche et historique");
  r = await rep.call(`/api/clients/${clientId}`);
  ok("fiche accessible", r.status === 200);
  ok("historique des ventes complet", r.body.sales.length === 2, `${r.body.sales.length}`);
  ok("commercial responsable indiqué", r.body.client.rep_name === "Amine El Amrani");

  section("Client — numéro invalide et anniversaire facultatif");
  r = await rep.call("/api/sales", { method: "POST", body: {
    customer: "Numéro Cassé", product: "Parfum 30 ml", qty: 1, amount: 50,
    rep_id: repId, client_phone: "abc" } });
  ok("numéro invalide refusé avec un message clair", r.status === 400, JSON.stringify(r.body));

  r = await rep.call("/api/clients", { method: "POST", body: { name: "Sans Anniversaire", phone: "0655555555" } });
  ok("client sans anniversaire accepté", r.status === 201, JSON.stringify(r.body));
  ok("libellé d'anniversaire neutre", r.body.client.birthday_label === "—");

  r = await rep.call("/api/clients", { method: "POST", body: { name: "Doublon", phone: PHONE } });
  ok("doublon renvoyé au lieu d'être créé", r.body.created === false, JSON.stringify(r.body).slice(0, 90));

  /* ---------------- ANNIVERSAIRES ---------------- */
  section("Anniversaires — aujourd'hui, demain, plus tard, 29 février");
  const today = (await admin.call("/api/birthdays")).body.today;
  const [Y, M, D] = today.split("-").map(Number);
  const shift = (n) => new Date(Date.UTC(Y, M - 1, D + n)).toISOString().slice(0, 10);
  const bday = (iso) => "1990" + iso.slice(4);

  await rep.call("/api/clients", { method: "POST", body: { name: "Anniv Aujourdhui", phone: "0611111111", birthday: bday(shift(0)) } });
  await rep.call("/api/clients", { method: "POST", body: { name: "Anniv Demain", phone: "0622222222", birthday: bday(shift(1)) } });
  await rep.call("/api/clients", { method: "POST", body: { name: "Anniv J+4", phone: "0633333333", birthday: bday(shift(4)) } });
  await rep.call("/api/clients", { method: "POST", body: { name: "Anniv 29 fevrier", phone: "0644444444", birthday: "2000-02-29" } });

  r = await rep.call("/api/birthdays?days=7");
  ok("fuseau Africa/Casablanca appliqué", r.body.timezone === "Africa/Casablanca", r.body.timezone);
  ok("anniversaire du jour détecté", r.body.todays.some((c) => c.name === "Anniv Aujourdhui"),
     JSON.stringify(r.body.todays.map((c) => c.name)));
  ok("anniversaire de demain détecté", r.body.tomorrow.some((c) => c.name === "Anniv Demain"));
  ok("anniversaire à J+4 dans « à venir »", r.body.upcoming.some((c) => c.name === "Anniv J+4"));
  ok("client sans date exclu", ![...r.body.todays, ...r.body.tomorrow, ...r.body.upcoming]
     .some((c) => c.name === "Sans Anniversaire"));

  /* ---------------- RAPPELS ---------------- */
  section("Rappels — déclenchement, idempotence, secret");
  r = await admin.call("/api/reminders/run", { method: "POST", body: {} });
  ok("déclenchement refusé sans le bon secret", r.status === 401 || r.status === 503, String(r.status));

  const secret = process.env.CRON_SECRET;
  if (secret) {
    r = await client().call("/api/reminders/run", { method: "POST", headers: { "x-cron-secret": secret }, body: {} });
    const first = r.body.sent;
    ok("balayage exécuté", r.status === 200, JSON.stringify(r.body).slice(0, 120));
    ok("rappels envoyés", (first["JOUR-J"] + first["J-1"]) >= 2, JSON.stringify(first));

    r = await client().call("/api/reminders/run", { method: "POST", headers: { "x-cron-secret": secret }, body: {} });
    const second = r.body.sent;
    ok("2e passage : aucun doublon", second["JOUR-J"] === 0 && second["J-1"] === 0, JSON.stringify(second));

    r = await admin.call("/api/notifications?limit=50");
    ok("notification d'anniversaire déposée",
       r.body.some((n) => n.type === "birthday_today" || n.type === "birthday_tomorrow"));
  } else {
    console.log("  SKIP  balayage des rappels (CRON_SECRET absent de .env)");
  }

  /* ---------------- RÉMUNÉRATION ---------------- */
  section("Rémunération — calcul, temps réel, historique");
  r = await rep.call("/api/payroll");
  const before = r.body.line;
  ok("ligne de paie du commercial", Boolean(before), JSON.stringify(r.body).slice(0, 120));
  ok("commissions sommées (Art. 3)", before.commission === 38, `${before.commission}`);
  ok("bonus nul sous le 1er palier", before.bonus === 0);
  ok("statut estimé", before.status === "EN_COURS" && before.locked === false);
  ok("total = fixe + commissions + bonus",
     before.total === before.salary_base + before.commission + before.bonus);

  await rep.call("/api/sales", { method: "POST", body: {
    customer: "Jean Dupont", product: "Parfum 100 ml", qty: 1, amount: 150, commission: 15,
    rep_id: repId, client_phone: PHONE } });
  r = await rep.call("/api/payroll");
  ok("l'estimation suit la nouvelle vente",
     r.body.line.commission === 53 && r.body.line.total > before.total,
     `${before.commission} -> ${r.body.line.commission}`);

  r = await admin.call("/api/payroll/team");
  ok("vue équipe accessible à l'admin", r.status === 200);
  ok("synthèse cohérente", r.body.summary.commission === 53, JSON.stringify(r.body.summary));
  ok("tous les commerciaux listés", r.body.lines.length === 2, `${r.body.lines.length}`);

  const prevMonth = `${M === 1 ? Y - 1 : Y}-${String(M === 1 ? 12 : M - 1).padStart(2, "0")}`;
  r = await admin.call(`/api/payroll/team?month=${prevMonth}`);
  ok("mois précédent consultable et vide", r.status === 200 && r.body.summary.commission === 0);

  r = await admin.call("/api/payroll/history?months=3");
  ok("historique renvoyé", r.status === 200 && r.body.months.length === 3, `${r.body.months.length}`);

  section("Rémunération — clôture et immuabilité");
  r = await admin.call("/api/payroll/close", { method: "POST", body: { month: today.slice(0, 7) } });
  ok("le mois en cours ne peut pas être clôturé", r.status === 400, JSON.stringify(r.body));

  r = await admin.call("/api/payroll/close", { method: "POST", body: { month: prevMonth, status: "CLOTURE" } });
  ok("mois précédent clôturé", r.status === 200 && r.body.closed === 2, JSON.stringify(r.body));

  await admin.call("/api/compensation-settings", { method: "PUT",
    body: { salary_base: 9999, commission_mode: "per_unit", commission_rate: 0 } });
  r = await admin.call(`/api/payroll/team?month=${prevMonth}`);
  ok("un mois clôturé n'est pas réécrit par un changement de règles",
     r.body.lines.every((l) => l.locked && l.salary_base === 0),
     JSON.stringify(r.body.lines.map((l) => l.salary_base)));

  r = await admin.call("/api/payroll/team");
  ok("le mois en cours, lui, prend le nouveau salaire fixe",
     r.body.lines.every((l) => l.salary_base === 9999),
     JSON.stringify(r.body.lines.map((l) => l.salary_base)));

  await admin.call("/api/compensation-settings", { method: "PUT",
    body: { salary_base: 0, commission_mode: "per_unit", commission_rate: 0 } });

  /* ---------------- PERMISSIONS ---------------- */
  section("Permissions — COMMERCIAL / RELATION_CLIENT / ADMIN");
  r = await rc.call("/api/clients");
  ok("relation_client voit tout le portefeuille", r.body.length >= 6, `${r.body.length}`);
  r = await rep.call("/api/clients");
  const repSees = r.body.length;

  r = await admin.call("/api/clients", { method: "POST",
    body: { name: "Client de Sofia", phone: "0677777777", rep_id: (await admin.call("/api/salespersons")).body.find((s) => s.name === "Sofia Benali").id } });
  ok("admin peut attribuer un client à un autre commercial", r.status === 201);

  r = await rep.call("/api/clients");
  ok("le commercial ne voit pas le client d'un collègue", r.body.length === repSees,
     `${repSees} -> ${r.body.length}`);

  r = await rep.call(`/api/clients/${r.body[0].id}`, { method: "PATCH", body: { rep_id: repId } });
  ok("un commercial ne peut pas se réattribuer un client", r.status === 403, String(r.status));

  r = await rep.call("/api/payroll/team");
  ok("un commercial ne voit pas la paie de l'équipe", r.status === 403);
  r = await rc.call("/api/payroll/team");
  ok("relation_client ne voit pas la paie non plus", r.status === 403);
  r = await rc.call("/api/compensation-settings", { method: "PUT", body: { salary_base: 1 } });
  ok("relation_client ne modifie pas les règles de paie", r.status === 403);
  r = await rep.call(`/api/team/members/${rcUserId}/role`, { method: "PATCH", body: { role: "salesperson" } });
  ok("un commercial ne change pas les rôles", r.status === 403);

  console.log(`\n${pass} réussis, ${fail} échoués`);
  return fail === 0;
}

main()
  .then(async (success) => {
    const { pool } = require("../server/db");
    const del = await pool.query(`delete from public.users where email like $1`, ["crm-%@kgroup.test"]);
    console.log(`Nettoyage : ${del.rowCount} compte(s) de test supprimé(s).`);
    await pool.end();
    process.exit(success ? 0 : 1);
  })
  .catch(async (err) => {
    console.error("\nErreur :", err.message);
    try {
      const { pool } = require("../server/db");
      await pool.query(`delete from public.users where email like $1`, ["crm-%@kgroup.test"]);
      await pool.end();
    } catch (_) { /* rien à nettoyer */ }
    process.exit(1);
  });
