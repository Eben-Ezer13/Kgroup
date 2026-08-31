/* =========================================================================
   KGROUP — /api/payroll/*  et  /api/compensation-settings
   -------------------------------------------------------------------------
     GET   /api/payroll?month=YYYY-MM        ma rémunération du mois
     GET   /api/payroll/team?month=YYYY-MM   (admin) toute l'équipe + synthèse
     GET   /api/payroll/history              (admin) évolution mensuelle
     POST  /api/payroll/close                (admin) clôturer un mois
     GET   /api/compensation-settings        paramètres de l'équipe
     PUT   /api/compensation-settings        (admin) les modifier

   FORMULE — reprise du contrat KGroup déjà encodé dans l'application :
     total = salaire fixe + commissions (Art. 3) + bonus du mois (Art. 4)

   Un mois EN_COURS est recalculé à chaque appel depuis les ventes réelles :
   c'est ce qui rend l'estimation quasi temps réel après chaque vente.
   Un mois CLÔTURÉ/VALIDÉ/PAYÉ est lu tel quel, avec les paramètres figés au
   moment de la clôture — changer les règles plus tard ne réécrit aucune paie.
   ========================================================================= */
"use strict";

const express = require("express");

const db = require("../db");
const { requireUser } = require("../auth");
const { HttpError, teamScope, requireAdmin, canSeeAllPayroll } = require("../policies");
const crm = require("../crm");

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Helpers                                                             *
 * ------------------------------------------------------------------ */

/** "YYYY-MM" → "YYYY-MM-01". Le mois courant (Maroc) par défaut. */
function periodFromQuery(month) {
  const m = String(month || "").trim();
  if (!m) return crm.periodStart(crm.todayLocal());
  if (!/^\d{4}-\d{2}$/.test(m)) throw new HttpError(400, "Le mois doit être au format AAAA-MM.");
  return `${m}-01`;
}

async function settingsFor(teamId) {
  const row = await db.one(`select * from public.compensation_settings where team_id = $1`, [teamId]);
  if (row) return { ...crm.DEFAULT_SETTINGS, ...row };
  // Une équipe créée avant cette fonctionnalité n'a pas encore de ligne.
  await db.query(
    `insert into public.compensation_settings (team_id) values ($1) on conflict do nothing`, [teamId]
  );
  return { ...crm.DEFAULT_SETTINGS };
}

/**
 * Agrégats réels du mois pour chaque commercial de l'équipe.
 * Une vente compte dans le mois de son `created_at`, lu en heure marocaine :
 * une vente saisie le 31 à 23 h ne bascule pas sur le mois suivant.
 */
async function monthlyTotals(teamId, period) {
  return db.many(
    `select s.rep_id,
            count(*)::int                     as sales_count,
            coalesce(sum(s.qty), 0)::int      as units,
            coalesce(sum(s.amount), 0)::bigint     as revenue,
            coalesce(sum(s.commission), 0)::bigint as commission
       from public.sales s
      where s.team_id = $1
        and s.rep_id is not null
        and date_trunc('month', (s.created_at at time zone 'Africa/Casablanca')) = $2::date
      group by s.rep_id`,
    [teamId, period]
  );
}

/** Ligne de paie d'un commercial : figée si clôturée, recalculée sinon. */
function buildLine(rep, totals, settings, stored) {
  if (stored && crm.isPeriodLocked(stored.status)) {
    return {
      rep_id: rep.id,
      rep_name: rep.name,
      sales_count: stored.sales_count,
      revenue: Number(stored.revenue) || 0,
      commission: Number(stored.commission) || 0,
      bonus: Number(stored.bonus) || 0,
      salary_base: Number(stored.salary_base) || 0,
      total: Number(stored.total) || 0,
      status: stored.status,
      currency: (stored.settings && stored.settings.currency) || settings.currency,
      // La paie figée conserve les paramètres qui l'ont produite.
      settings: stored.settings || null,
      locked: true,
    };
  }
  const t = totals || { sales_count: 0, revenue: 0, commission: 0 };
  const c = crm.computeCompensation(t, settings);
  return {
    rep_id: rep.id,
    rep_name: rep.name,
    sales_count: c.sales_count,
    revenue: c.revenue,
    commission: c.commission,
    bonus: c.bonus,
    bonus_tier: c.bonus_tier,
    bonus_next: c.bonus_next,
    salary_base: c.salary_base,
    total: c.total,
    status: (stored && stored.status) || "EN_COURS",
    currency: c.currency,
    locked: false,
  };
}

async function linesFor(teamId, period, repFilter) {
  const settings = await settingsFor(teamId);
  const reps = await db.many(
    repFilter
      ? `select id, name from public.salespersons where team_id = $1 and id = $2`
      : `select id, name from public.salespersons where team_id = $1 order by name`,
    repFilter ? [teamId, repFilter] : [teamId]
  );
  const totals = await monthlyTotals(teamId, period);
  const byRep = Object.fromEntries(totals.map((t) => [t.rep_id, t]));
  const stored = await db.many(
    `select * from public.payroll_periods where team_id = $1 and period = $2`, [teamId, period]
  );
  const storedByRep = Object.fromEntries(stored.map((s) => [s.rep_id, s]));

  return {
    settings,
    lines: reps.map((r) => buildLine(r, byRep[r.id], settings, storedByRep[r.id])),
  };
}

/* ------------------------------------------------------------------ *
 * MA RÉMUNÉRATION                                                     *
 * ------------------------------------------------------------------ */
router.get("/payroll", requireUser, async (req, res, next) => {
  try {
    const teamId = teamScope(req);
    const period = periodFromQuery(req.query.month);
    const repId = req.profile && req.profile.salesperson_id;

    if (!repId) {
      // Un administrateur n'a pas de fiche commercial : il n'a pas de paie
      // propre, on le renvoie explicitement vers la vue équipe.
      return res.json({ period, line: null, reason: "no_salesperson_record" });
    }

    const { settings, lines } = await linesFor(teamId, period, repId);
    return res.json({ period, timezone: crm.TIMEZONE, settings, line: lines[0] || null });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * VUE ÉQUIPE (administrateur)                                         *
 * ------------------------------------------------------------------ */
router.get("/payroll/team", requireUser, async (req, res, next) => {
  try {
    if (!canSeeAllPayroll(req)) {
      throw new HttpError(403, "Seul un administrateur peut consulter la rémunération de l'équipe.");
    }
    const teamId = teamScope(req);
    const period = periodFromQuery(req.query.month);
    const { settings, lines } = await linesFor(teamId, period);

    const sum = (k) => lines.reduce((n, l) => n + (Number(l[k]) || 0), 0);
    return res.json({
      period,
      timezone: crm.TIMEZONE,
      settings,
      lines,
      summary: {
        reps: lines.length,
        sales_count: sum("sales_count"),
        revenue: sum("revenue"),
        commission: sum("commission"),
        bonus: sum("bonus"),
        salary_base: sum("salary_base"),
        total: sum("total"),
        currency: settings.currency,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * HISTORIQUE                                                          *
 * ------------------------------------------------------------------ */
router.get("/payroll/history", requireUser, async (req, res, next) => {
  try {
    const teamId = teamScope(req);
    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
    const mine = !canSeeAllPayroll(req);
    const repId = req.profile && req.profile.salesperson_id;
    if (mine && !repId) return res.json({ months: [] });

    // Les mois clôturés sont lus depuis payroll_periods (figés) ; les mois
    // encore ouverts sont recalculés depuis les ventes.
    const rows = await db.many(
      `with periods as (
         select generate_series(
           date_trunc('month', public.today_casablanca()) - ($2::int - 1) * interval '1 month',
           date_trunc('month', public.today_casablanca()),
           interval '1 month'
         )::date as period
       )
       select p.period,
              coalesce(sum(s.amount), 0)::bigint     as revenue,
              coalesce(sum(s.commission), 0)::bigint as commission,
              count(s.id)::int                       as sales_count
         from periods p
         left join public.sales s
           on s.team_id = $1
          and date_trunc('month', (s.created_at at time zone 'Africa/Casablanca')) = p.period
          and ($3::uuid is null or s.rep_id = $3::uuid)
        group by p.period
        order by p.period`,
      [teamId, months, mine ? repId : null]
    );

    const settings = await settingsFor(teamId);
    const stored = await db.many(
      `select period, status, total, commission, bonus, salary_base, sales_count, revenue
         from public.payroll_periods
        where team_id = $1 ${mine ? "and rep_id = $2" : ""}`,
      mine ? [teamId, repId] : [teamId]
    );
    const lockedByPeriod = {};
    for (const s of stored) {
      if (!crm.isPeriodLocked(s.status)) continue;
      const key = String(s.period).slice(0, 10);
      const acc = lockedByPeriod[key] || { total: 0, commission: 0, bonus: 0, sales_count: 0, revenue: 0, status: s.status };
      acc.total += Number(s.total) || 0;
      acc.commission += Number(s.commission) || 0;
      acc.bonus += Number(s.bonus) || 0;
      acc.sales_count += s.sales_count || 0;
      acc.revenue += Number(s.revenue) || 0;
      lockedByPeriod[key] = acc;
    }

    return res.json({
      months: rows.map((r) => {
        const key = String(r.period).slice(0, 10);
        const locked = lockedByPeriod[key];
        if (locked) return { period: key, ...locked, locked: true };
        const c = crm.computeCompensation(
          { sales_count: r.sales_count, revenue: Number(r.revenue), commission: Number(r.commission) },
          settings
        );
        return {
          period: key,
          sales_count: c.sales_count, revenue: c.revenue,
          commission: c.commission, bonus: c.bonus,
          salary_base: mine ? c.salary_base : 0, // la synthèse équipe agrège ailleurs
          total: mine ? c.total : c.commission + c.bonus,
          status: "EN_COURS", locked: false,
        };
      }),
      currency: settings.currency,
      scope: mine ? "me" : "team",
    });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * CLÔTURE D'UN MOIS                                                   *
 * -------------------------------------------------------------------
 * Fige la paie de chaque commercial ET une copie des paramètres utilisés.
 * Le mois en cours ne peut pas être clôturé : il n'est pas terminé.
 * ------------------------------------------------------------------ */
router.post("/payroll/close", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const teamId = teamScope(req);
    const period = periodFromQuery(req.body && req.body.month);
    const status = String((req.body && req.body.status) || "CLOTURE");
    if (!["CLOTURE", "VALIDEE", "PAYEE"].includes(status)) {
      throw new HttpError(400, "Statut invalide. Valeurs acceptées : CLOTURE, VALIDEE, PAYEE.");
    }
    if (period >= crm.periodStart(crm.todayLocal())) {
      throw new HttpError(400, "Le mois en cours ne peut pas être clôturé avant sa fin.");
    }

    const { settings, lines } = await linesFor(teamId, period);

    const saved = await db.tx(async (client) => {
      const out = [];
      for (const l of lines) {
        const { rows } = await client.query(
          `insert into public.payroll_periods
             (team_id, rep_id, period, sales_count, revenue, commission, bonus,
              salary_base, total, status, settings, closed_at, closed_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb, now(), $12)
           on conflict (rep_id, period) do update set
             sales_count = excluded.sales_count, revenue = excluded.revenue,
             commission  = excluded.commission,  bonus   = excluded.bonus,
             salary_base = excluded.salary_base, total   = excluded.total,
             status      = excluded.status,      settings = excluded.settings,
             closed_at   = now(),                closed_by = excluded.closed_by
           returning *`,
          [teamId, l.rep_id, period, l.sales_count, l.revenue, l.commission, l.bonus,
           l.salary_base, l.total, status, JSON.stringify(settings), req.user.id]
        );
        out.push(rows[0]);
      }
      return out;
    });

    return res.json({ ok: true, period, status, closed: saved.length });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * PARAMÈTRES DE RÉMUNÉRATION                                          *
 * ------------------------------------------------------------------ */
router.get("/compensation-settings", requireUser, async (req, res, next) => {
  try {
    return res.json(await settingsFor(teamScope(req)));
  } catch (err) {
    return next(err);
  }
});

router.put("/compensation-settings", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const teamId = teamScope(req);
    const b = req.body || {};

    const salaryBase = Math.max(0, Math.round(Number(b.salary_base) || 0));
    const mode = b.commission_mode === "percent" ? "percent" : "per_unit";
    const rate = Math.min(100, Math.max(0, Number(b.commission_rate) || 0));

    let tiers = b.bonus_tiers;
    if (tiers !== undefined) {
      if (!Array.isArray(tiers)) throw new HttpError(400, "Les paliers de bonus doivent être une liste.");
      tiers = tiers
        .map((t) => ({
          sales: Math.max(0, Math.round(Number(t.sales) || 0)),
          bonus: Math.max(0, Math.round(Number(t.bonus) || 0)),
          extra: String(t.extra || "").trim() || null,
        }))
        .sort((a, b2) => a.sales - b2.sales);
    }

    const { rows } = await db.query(
      `insert into public.compensation_settings
         (team_id, salary_base, commission_mode, commission_rate, bonus_tiers, currency, updated_at, updated_by)
       values ($1,$2,$3,$4,coalesce($5::jsonb, $8::jsonb),$6, now(), $7)
       on conflict (team_id) do update set
         salary_base = excluded.salary_base,
         commission_mode = excluded.commission_mode,
         commission_rate = excluded.commission_rate,
         bonus_tiers = coalesce($5::jsonb, compensation_settings.bonus_tiers),
         currency = excluded.currency,
         updated_at = now(), updated_by = excluded.updated_by
       returning *`,
      [teamId, salaryBase, mode, rate,
       tiers === undefined ? null : JSON.stringify(tiers),
       String(b.currency || "DHS"), req.user.id,
       // Paliers de repli a la PREMIERE ecriture : sans ce parametre, un PUT
       // sans bonus_tiers insererait un tableau vide et effacerait l Art. 4.
       JSON.stringify(crm.DEFAULT_SETTINGS.bonus_tiers)]
    );
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
