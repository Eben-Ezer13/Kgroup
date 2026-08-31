/* =========================================================================
   Tests de la logique CRM — téléphone, WhatsApp, anniversaires, rémunération.
   Fonctions pures, aucune base de données.
   ========================================================================= */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const crm = require("../server/crm");

/* ================= TÉLÉPHONE ============================================ */

test("un numéro national marocain devient international", () => {
  assert.strictEqual(crm.normalizePhone("0612345678"), "212612345678");
  assert.strictEqual(crm.normalizePhone("06 12 34 56 78"), "212612345678");
  assert.strictEqual(crm.normalizePhone("06-12-34-56-78"), "212612345678");
  assert.strictEqual(crm.normalizePhone("(06) 12.34.56.78"), "212612345678");
});

test("un numéro déjà international est respecté", () => {
  assert.strictEqual(crm.normalizePhone("+212612345678"), "212612345678");
  assert.strictEqual(crm.normalizePhone("00212612345678"), "212612345678");
  assert.strictEqual(crm.normalizePhone("212612345678"), "212612345678");
  // Un autre pays ne doit pas être ré-préfixé en 212.
  assert.strictEqual(crm.normalizePhone("+33612345678"), "33612345678");
});

test("toutes les écritures du même numéro donnent la même clé", () => {
  const formes = ["0612345678", "06 12 34 56 78", "+212612345678", "00212612345678", "212612345678"];
  const cles = new Set(formes.map((f) => crm.normalizePhone(f)));
  assert.strictEqual(cles.size, 1, "l'unicité par numéro repose sur cette propriété");
});

test("un numéro inutilisable est rejeté, pas deviné", () => {
  for (const mauvais of ["", "   ", null, undefined, "abc", "12", "+", "---"]) {
    assert.strictEqual(crm.normalizePhone(mauvais), null, `« ${mauvais} » doit être rejeté`);
    assert.strictEqual(crm.isValidPhone(mauvais), false);
  }
});

test("l'affichage du numéro est lisible", () => {
  assert.strictEqual(crm.formatPhone("0612345678"), "+212 6 12 34 56 78");
  assert.strictEqual(crm.formatPhone("+33612345678"), "+33612345678");
  // Un numéro invalide est rendu tel quel plutôt que masqué.
  assert.strictEqual(crm.formatPhone("inconnu"), "inconnu");
  assert.strictEqual(crm.formatPhone(null), "");
});

/* ================= WHATSAPP ============================================= */

test("le nom du client est injecté dans le message", () => {
  const msg = crm.birthdayMessage("Jean Dupont");
  assert.ok(msg.startsWith("Bonjour Jean Dupont 🎉"));
  assert.ok(!msg.includes("[NOM DU CLIENT]"), "le marqueur doit être remplacé");
  assert.ok(msg.includes("Kgroup Parfumery"));
  assert.ok(msg.includes("joyeux anniversaire"));
});

test("un nom vide ne laisse pas le marqueur apparent", () => {
  for (const vide of ["", "   ", null, undefined]) {
    const msg = crm.birthdayMessage(vide);
    assert.ok(!msg.includes("[NOM DU CLIENT]"));
    assert.ok(msg.startsWith("Bonjour cher client"));
  }
});

test("le lien WhatsApp est correctement formé et encodé", () => {
  const link = crm.birthdayWhatsappLink("0612345678", "Jean Dupont");
  assert.ok(link.startsWith("https://wa.me/212612345678?text="));

  // Le message doit se retrouver intact après décodage.
  const encoded = link.split("?text=")[1];
  assert.strictEqual(decodeURIComponent(encoded), crm.birthdayMessage("Jean Dupont"));

  // Les caractères problématiques dans une URL doivent être encodés.
  assert.ok(!encoded.includes(" "), "les espaces doivent être encodés");
  assert.ok(!encoded.includes("\n"), "les retours à la ligne doivent être encodés");
  assert.ok(!encoded.includes("&"), "un & non encodé couperait le message");
  assert.ok(!encoded.includes("#"), "un # non encodé tronquerait le message");
  // encodeURIComponent laisse volontairement passer ! ' ( ) * — ils sont légaux
  // dans une query string et WhatsApp les affiche tels quels.
});

test("un nom avec accents, apostrophe ou emoji passe l'encodage", () => {
  const nom = "Zoé Aït-Benhaddou";
  const link = crm.birthdayWhatsappLink("0612345678", nom);
  assert.ok(decodeURIComponent(link.split("?text=")[1]).includes(nom));
});

test("sans numéro exploitable, aucun lien n'est proposé", () => {
  assert.strictEqual(crm.birthdayWhatsappLink(null, "Jean"), null);
  assert.strictEqual(crm.birthdayWhatsappLink("abc", "Jean"), null);
  assert.strictEqual(crm.whatsappLink("", "test"), null);
});

/* ================= ANNIVERSAIRES ======================================== */

test("un anniversaire est reconnu le jour même", () => {
  assert.strictEqual(crm.birthdayFallsOn("1990-08-31", "2026-08-31"), true);
  assert.strictEqual(crm.birthdayFallsOn("1990-08-31", "2026-08-30"), false);
  assert.strictEqual(crm.birthdayFallsOn("1990-08-31", "2026-09-01"), false);
});

test("l'année de naissance n'entre pas en compte", () => {
  assert.strictEqual(crm.birthdayFallsOn("1975-03-14", "2026-03-14"), true);
  assert.strictEqual(crm.birthdayFallsOn("2005-03-14", "2026-03-14"), true);
});

test("aujourd'hui, demain, et plus loin", () => {
  const today = "2026-08-31";
  assert.strictEqual(crm.daysUntilBirthday("1990-08-31", today), 0, "aujourd'hui");
  assert.strictEqual(crm.daysUntilBirthday("1990-09-01", today), 1, "demain");
  assert.strictEqual(crm.daysUntilBirthday("1990-09-07", today), 7);
});

test("le passage d'une année à l'autre est géré", () => {
  // Le 1er janvier vu depuis le 31 décembre : demain, pas dans 364 jours.
  assert.strictEqual(crm.daysUntilBirthday("1990-01-01", "2026-12-31"), 1);
  assert.strictEqual(crm.daysUntilBirthday("1990-12-25", "2026-12-31"), 359);
});

test("le 29 février est fêté le 28 les années non bissextiles", () => {
  // 2026 n'est pas bissextile : on fête le 28.
  assert.strictEqual(crm.birthdayFallsOn("2000-02-29", "2026-02-28"), true);
  assert.strictEqual(crm.birthdayFallsOn("2000-02-29", "2026-03-01"), false);
  // 2028 est bissextile : le vrai 29 février existe.
  assert.strictEqual(crm.isLeapYear(2028), true);
  assert.strictEqual(crm.birthdayFallsOn("2000-02-29", "2028-02-29"), true);
  // 2100 n'est pas bissextile (divisible par 100 mais pas par 400).
  assert.strictEqual(crm.isLeapYear(2100), false);
  assert.strictEqual(crm.isLeapYear(2000), true);
});

test("un client sans date d'anniversaire ne casse rien", () => {
  assert.strictEqual(crm.birthdayFallsOn(null, "2026-08-31"), false);
  assert.strictEqual(crm.daysUntilBirthday(null, "2026-08-31"), null);
  assert.strictEqual(crm.daysUntilBirthday(undefined, "2026-08-31"), null);
  assert.strictEqual(crm.birthdayLabel(null), "—");
});

test("le libellé d'anniversaire est en français, sans l'année", () => {
  assert.strictEqual(crm.birthdayLabel("1990-08-31"), "31 août");
  assert.strictEqual(crm.birthdayLabel("1990-01-01"), "1 janvier");
});

test("la date du jour est celle du Maroc, pas celle du serveur", () => {
  // 23 h 30 UTC le 30 août : au Maroc (UTC+1) on est déjà le 31.
  const nuit = new Date("2026-08-30T23:30:00Z");
  assert.strictEqual(crm.todayLocal("Africa/Casablanca", nuit), "2026-08-31");
  assert.strictEqual(crm.todayLocal("UTC", nuit), "2026-08-30");
  assert.match(crm.todayLocal(), /^\d{4}-\d{2}-\d{2}$/);
});

/* ================= RÉMUNÉRATION ========================================= */

const TOTALS = (n, ca, com) => ({ sales_count: n, revenue: ca, commission: com });

test("la formule reprend le contrat : fixe + commissions + bonus", () => {
  const r = crm.computeCompensation(TOTALS(25, 24000, 1250), { salary_base: 3000 });
  assert.strictEqual(r.commission, 1250, "Art. 3 — somme des commissions des ventes");
  assert.strictEqual(r.bonus, 100, "Art. 4 — palier 20 ventes atteint");
  assert.strictEqual(r.salary_base, 3000);
  assert.strictEqual(r.total, 4350, "3000 + 1250 + 100");
});

test("sans salaire fixe configuré, le total est commissions + bonus", () => {
  // C'est le cas réel du contrat KGroup : aucun fixe.
  const r = crm.computeCompensation(TOTALS(10, 8000, 400), {});
  assert.strictEqual(r.salary_base, 0);
  assert.strictEqual(r.bonus, 0, "10 ventes : sous le premier palier");
  assert.strictEqual(r.total, 400);
});

test("les paliers de bonus se déclenchent aux bons seuils", () => {
  const cas = [
    [0, 0], [19, 0], [20, 100], [39, 100],
    [40, 300], [59, 300], [60, 600], [200, 600],
  ];
  for (const [ventes, attendu] of cas) {
    const r = crm.computeCompensation(TOTALS(ventes, ventes * 100, 0), {});
    assert.strictEqual(r.bonus, attendu, `${ventes} ventes -> ${attendu} DHS`);
  }
});

test("le palier suivant est annoncé, et disparaît au sommet", () => {
  assert.strictEqual(crm.computeCompensation(TOTALS(5, 0, 0), {}).bonus_next.sales, 20);
  assert.strictEqual(crm.computeCompensation(TOTALS(25, 0, 0), {}).bonus_next.sales, 40);
  assert.strictEqual(crm.computeCompensation(TOTALS(100, 0, 0), {}).bonus_next, null);
});

test("les paliers sont configurables et non codés en dur", () => {
  const perso = { bonus_tiers: [{ sales: 5, bonus: 50 }, { sales: 10, bonus: 200 }] };
  assert.strictEqual(crm.computeCompensation(TOTALS(4, 0, 0), perso).bonus, 0);
  assert.strictEqual(crm.computeCompensation(TOTALS(5, 0, 0), perso).bonus, 50);
  assert.strictEqual(crm.computeCompensation(TOTALS(12, 0, 0), perso).bonus, 200);
});

test("des paliers désordonnés sont triés avant application", () => {
  const desordre = { bonus_tiers: [{ sales: 60, bonus: 600 }, { sales: 20, bonus: 100 }, { sales: 40, bonus: 300 }] };
  assert.strictEqual(crm.computeCompensation(TOTALS(45, 0, 0), desordre).bonus, 300);
});

test("le mode pourcentage calcule sur le chiffre d'affaires", () => {
  const r = crm.computeCompensation(
    TOTALS(20, 25000, 1250),
    { commission_mode: "percent", commission_rate: 5 }
  );
  assert.strictEqual(r.commission, 1250, "5 % de 25 000");
  // Le mode per_unit ignore le taux et somme les commissions réelles.
  const u = crm.computeCompensation(TOTALS(20, 25000, 999), { commission_rate: 5 });
  assert.strictEqual(u.commission, 999);
});

test("une nouvelle vente fait monter l'estimation", () => {
  // 18 puis 19 ventes : encore sous le premier palier, donc bonus nul.
  const avant = crm.computeCompensation(TOTALS(18, 24000, 1200), { salary_base: 3000 });
  const apres = crm.computeCompensation(TOTALS(19, 25000, 1250), { salary_base: 3000 });
  assert.strictEqual(avant.total, 4200, "3000 + 1200 + 0");
  assert.strictEqual(apres.total, 4250, "3000 + 1250 + 0");
  assert.ok(apres.total > avant.total, "l'estimation doit suivre les ventes");

  // La 20e vente franchit le palier : le bonus s'ajoute d'un coup.
  const palier = crm.computeCompensation(TOTALS(20, 26000, 1300), { salary_base: 3000 });
  assert.strictEqual(palier.bonus, 100);
  assert.strictEqual(palier.total, 4400, "3000 + 1300 + 100");
});

test("des totaux absents ou aberrants donnent zéro, jamais NaN", () => {
  for (const t of [{}, { sales_count: null }, { revenue: "abc", commission: undefined }]) {
    const r = crm.computeCompensation(t, {});
    assert.strictEqual(Number.isFinite(r.total), true, "le total doit rester un nombre");
    assert.strictEqual(r.total, 0);
  }
});

test("les paramètres appliqués sont retournés, pour pouvoir être figés", () => {
  const r = crm.computeCompensation(TOTALS(20, 1000, 100), { salary_base: 500 });
  assert.strictEqual(r.settings.salary_base, 500);
  assert.ok(Array.isArray(r.settings.bonus_tiers));
});

/* ================= PÉRIODES ============================================= */

test("la période est le 1er du mois", () => {
  assert.strictEqual(crm.periodStart("2026-08-31"), "2026-08-01");
  assert.strictEqual(crm.periodStart("2026-01-01"), "2026-01-01");
  assert.strictEqual(crm.periodStart("2026-12-15"), "2026-12-01");
  assert.match(crm.periodStart(), /^\d{4}-\d{2}-01$/);
});

test("un mois figé ne peut pas être recalculé", () => {
  assert.strictEqual(crm.isPeriodLocked("EN_COURS"), false);
  assert.strictEqual(crm.isPeriodLocked("CLOTURE"), true);
  assert.strictEqual(crm.isPeriodLocked("VALIDEE"), true);
  assert.strictEqual(crm.isPeriodLocked("PAYEE"), true);
  assert.strictEqual(crm.isPeriodLocked(undefined), false);
});

/* ================= DATES VENUES DE LA BASE ==============================
   Regression : pg convertissait une colonne DATE en Date JS a minuit LOCAL.
   Un toISOString() la ramenait en UTC et reculait d'un jour au Maroc
   (UTC+1 depuis 2018) — un client ne en 2020 etait fete la veille.
   server/db.js lit desormais les DATE comme du texte ; ces tests verifient
   que la couche metier traite correctement cette forme.
   ====================================================================== */

test("une date lue en base (texte AAAA-MM-JJ) n'est jamais decalee", () => {
  // Exactement ce que renvoie pg depuis la correction.
  for (const d of ["1990-08-31", "2020-08-31", "2024-02-29", "2026-01-01"]) {
    assert.strictEqual(crm.birthdayFallsOn(d, d), true, `${d} doit tomber sur lui-meme`);
  }
  assert.strictEqual(crm.birthdayLabel("2020-08-31"), "31 août");
  assert.strictEqual(crm.birthdayLabel("2026-01-01"), "1 janvier");
});

test("un anniversaire posterieur a 2018 tombe le bon jour", () => {
  // Le cas qui echouait : ne apres le passage du Maroc a UTC+1.
  assert.strictEqual(crm.daysUntilBirthday("2020-08-31", "2026-08-31"), 0, "aujourd'hui");
  assert.strictEqual(crm.daysUntilBirthday("2020-09-01", "2026-08-31"), 1, "demain");
  assert.strictEqual(crm.daysUntilBirthday("2020-08-30", "2026-08-31"), 364, "hier -> l'an prochain");
});

test("un objet Date reste accepte, pour ne rien casser ailleurs", () => {
  // parts() gere encore les Date : un appelant qui en fournirait une
  // (donnee construite en memoire, test) ne doit pas obtenir un resultat faux.
  const d = new Date(Date.UTC(2020, 7, 31));
  assert.strictEqual(crm.birthdayLabel(d), "31 août");
});
