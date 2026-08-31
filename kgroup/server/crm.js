/* =========================================================================
   KGROUP — Logique métier CRM : téléphone, anniversaires, WhatsApp, paie
   -------------------------------------------------------------------------
   Fonctions pures, sans accès base : c'est ce qui les rend testables au
   unitaire (tests/crm.test.js) et réutilisables côté client comme serveur.

   Aucune règle métier n'est codée en dur ici : la rémunération prend ses
   paramètres depuis compensation_settings (table, une ligne par équipe).
   ========================================================================= */
"use strict";

/* ------------------------------------------------------------------ *
 * TÉLÉPHONE                                                           *
 * -------------------------------------------------------------------
 * Le Maroc est le pays par défaut (indicatif 212), conformément au reste de
 * l'application — villes marocaines, DHS, contrat KGroup. Un numéro déjà
 * international est respecté tel quel.
 * ------------------------------------------------------------------ */
const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || "212";

/**
 * Normalise un numéro pour la recherche, l'unicité et WhatsApp.
 * Renvoie les chiffres en format E.164 SANS le "+", ce qu'attend wa.me.
 * @returns {string|null} null si le numéro est inutilisable
 */
function normalizePhone(raw, countryCode = DEFAULT_COUNTRY_CODE) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  const hadPlus = s.startsWith("+") || s.startsWith("00");
  // On ne garde que les chiffres : espaces, points, tirets et parenthèses sautent.
  let digits = s.replace(/^00/, "").replace(/\D/g, "");
  if (!digits) return null;

  if (hadPlus) {
    // Déjà international : on fait confiance à l'indicatif fourni.
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }

  // Format national marocain : 0612345678 -> 212612345678
  if (digits.startsWith("0")) digits = countryCode + digits.slice(1);
  // Déjà préfixé par l'indicatif sans le "+"
  else if (!digits.startsWith(countryCode)) digits = countryCode + digits;

  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Vrai si le numéro peut être utilisé (recherche, WhatsApp). */
const isValidPhone = (raw) => normalizePhone(raw) !== null;

/** Affichage lisible : +212 6 12 34 56 78 */
function formatPhone(raw) {
  const e164 = normalizePhone(raw);
  if (!e164) return raw == null ? "" : String(raw);
  if (e164.startsWith("212") && e164.length === 12) {
    const n = e164.slice(3);
    return `+212 ${n[0]} ${n.slice(1, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  }
  return "+" + e164;
}

/* ------------------------------------------------------------------ *
 * WHATSAPP                                                            *
 * ------------------------------------------------------------------ */

/** Modèle de message d'anniversaire. `[NOM DU CLIENT]` est remplacé. */
const BIRTHDAY_TEMPLATE = `Bonjour [NOM DU CLIENT] 🎉

Toute l'équipe Kgroup Parfumery vous souhaite un très joyeux anniversaire !

À cette occasion, nous avons le plaisir de vous offrir une promotion exceptionnelle pour célébrer votre anniversaire avec nous.

Profitez-en et n'hésitez pas à nous contacter pour découvrir votre offre.

Encore joyeux anniversaire ! 🎂

Kgroup Parfumery`;

function birthdayMessage(clientName) {
  const name = String(clientName || "").trim() || "cher client";
  return BIRTHDAY_TEMPLATE.replace("[NOM DU CLIENT]", name);
}

/**
 * Lien wa.me — fonctionne sur mobile (ouvre l'app) comme sur desktop
 * (ouvre WhatsApp Web). Le message est PRÉREMPLI, jamais envoyé : c'est
 * l'utilisateur qui valide dans WhatsApp.
 * @returns {string|null} null si le numéro est inutilisable
 */
function whatsappLink(phone, message) {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  return `https://wa.me/${e164}?text=${encodeURIComponent(message || "")}`;
}

const birthdayWhatsappLink = (phone, name) => whatsappLink(phone, birthdayMessage(name));

/* ------------------------------------------------------------------ *
 * ANNIVERSAIRES                                                       *
 * -------------------------------------------------------------------
 * Miroir JavaScript des fonctions SQL birthday_falls_on() /
 * days_until_birthday(). Les deux implémentations sont testées sur les mêmes
 * cas, dont le 29 février.
 * ------------------------------------------------------------------ */
const TIMEZONE = process.env.APP_TIMEZONE || "Africa/Casablanca";

/** Date du jour au Maroc, en "YYYY-MM-DD", quelle que soit la zone du serveur. */
function todayLocal(tz = TIMEZONE, now = new Date()) {
  // en-CA rend directement le format ISO court.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

const isLeapYear = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

/** Découpe "YYYY-MM-DD" (ou une Date) sans passer par le fuseau local. */
function parts(dateish) {
  if (dateish == null) return null;
  const s = dateish instanceof Date
    ? dateish.toISOString().slice(0, 10)
    : String(dateish).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/**
 * L'anniversaire `birthday` tombe-t-il le jour `day` ?
 * Un 29 février est fêté le 28 les années non bissextiles.
 */
function birthdayFallsOn(birthday, day) {
  const b = parts(birthday), t = parts(day);
  if (!b || !t) return false;
  if (b.m === t.m && b.d === t.d) return true;
  if (b.m === 2 && b.d === 29 && !isLeapYear(t.y) && t.m === 2 && t.d === 28) return true;
  return false;
}

/** Nombre de jours avant le prochain anniversaire (0 = aujourd'hui), ou null. */
function daysUntilBirthday(birthday, today) {
  const t = parts(today);
  if (!parts(birthday) || !t) return null;
  const base = Date.UTC(t.y, t.m - 1, t.d);
  for (let i = 0; i <= 366; i++) {
    const d = new Date(base + i * 86400000).toISOString().slice(0, 10);
    if (birthdayFallsOn(birthday, d)) return i;
  }
  return null;
}

/** "31 août" — libellé court, sans l'année de naissance. */
function birthdayLabel(birthday) {
  const b = parts(birthday);
  if (!b) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(2000, b.m - 1, b.d)));
}

/* ------------------------------------------------------------------ *
 * RÉMUNÉRATION                                                        *
 * -------------------------------------------------------------------
 * Reprend la formule DÉJÀ en vigueur dans l'application (contrat KGroup) :
 *   commission — Art. 3, montant par unité selon le produit, déjà stocké
 *                dans sales.commission au moment de la vente
 *   bonus      — Art. 4, palier atteint selon le nombre de ventes DU MOIS
 *   salaire fixe — absent du contrat, donc 0 par défaut, mais configurable
 * ------------------------------------------------------------------ */

/** Paramètres appliqués quand une équipe n'a pas encore de ligne dédiée. */
const DEFAULT_SETTINGS = {
  salary_base: 0,
  commission_mode: "per_unit",
  commission_rate: 0,
  bonus_tiers: [
    { sales: 20, bonus: 100, extra: "Code promo" },
    { sales: 40, bonus: 300, extra: "Parfum offert" },
    { sales: 60, bonus: 600, extra: "Parfums offerts" },
  ],
  currency: "DHS",
};

/**
 * Palier de bonus atteint pour un nombre de ventes mensuelles.
 * @returns {{tier: object|null, next: object|null, bonus: number}}
 */
function bonusFor(salesCount, tiers) {
  const list = (Array.isArray(tiers) && tiers.length ? tiers : DEFAULT_SETTINGS.bonus_tiers)
    .slice()
    .sort((a, b) => a.sales - b.sales);
  let tier = null;
  for (const t of list) if (salesCount >= t.sales) tier = t;
  const next = list.find((t) => salesCount < t.sales) || null;
  return { tier, next, bonus: tier ? Number(tier.bonus) || 0 : 0 };
}

/**
 * Rémunération d'un commercial pour un mois donné.
 * @param {{sales_count:number, revenue:number, commission:number}} totals
 *        agrégats du mois, calculés en base
 * @param {object} settings  ligne compensation_settings de l'équipe
 */
function computeCompensation(totals, settings) {
  const cfg = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const salesCount = Number(totals.sales_count) || 0;
  const revenue = Number(totals.revenue) || 0;

  // Art. 3 — par défaut on somme les commissions déjà figées sur chaque vente,
  // ce qui garde exactement le montant affiché au commercial au moment de la
  // vente. Le mode 'percent' n'existe que si l'admin le choisit explicitement.
  const commission = cfg.commission_mode === "percent"
    ? Math.round(revenue * (Number(cfg.commission_rate) || 0) / 100)
    : Number(totals.commission) || 0;

  const { tier, next, bonus } = bonusFor(salesCount, cfg.bonus_tiers);
  const salaryBase = Number(cfg.salary_base) || 0;

  return {
    sales_count: salesCount,
    revenue,
    commission,
    bonus,
    bonus_tier: tier,
    bonus_next: next,
    salary_base: salaryBase,
    total: salaryBase + commission + bonus,
    currency: cfg.currency || "DHS",
    settings: cfg,
  };
}

/** "2026-08-01" — 1er jour du mois, clé de period dans payroll_periods. */
function periodStart(dateish) {
  const p = parts(dateish) || parts(todayLocal());
  return `${p.y}-${String(p.m).padStart(2, "0")}-01`;
}

/** Vrai si la période est déjà figée : plus aucun recalcul ne doit l'écraser. */
const isPeriodLocked = (status) => ["CLOTURE", "VALIDEE", "PAYEE"].includes(status);

module.exports = {
  DEFAULT_COUNTRY_CODE,
  TIMEZONE,
  DEFAULT_SETTINGS,
  BIRTHDAY_TEMPLATE,
  normalizePhone,
  isValidPhone,
  formatPhone,
  birthdayMessage,
  whatsappLink,
  birthdayWhatsappLink,
  todayLocal,
  isLeapYear,
  birthdayFallsOn,
  daysUntilBirthday,
  birthdayLabel,
  bonusFor,
  computeCompensation,
  periodStart,
  isPeriodLocked,
};
