/* =========================================================================
   KGROUP — /api/training/*  et  /api/notifications
   -------------------------------------------------------------------------
   La section formation : progression de lecture, quiz corrigés côté serveur,
   badges de réussite, et notification des administrateurs de l'équipe.

     GET    /api/training            état complet du parcours (le mien)
     POST   /api/training/lesson     marquer une leçon comme lue
     GET    /api/training/quiz/:id   les questions, SANS les réponses
     POST   /api/training/quiz/:id   remettre sa copie -> correction + badge
     GET    /api/training/team       (admin) où en est chaque commercial
     GET    /api/notifications       le fil de l'équipe
   ========================================================================= */
"use strict";

const express = require("express");

const db = require("../db");
const { requireUser } = require("../auth");
const { HttpError, teamScope, requireAdmin, isAdmin, canSeeAllClients } = require("../policies");
const training = require("../training");

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Helpers                                                             *
 * ------------------------------------------------------------------ */

/** Les quiz réussis par un utilisateur, d'après son meilleur passage. */
async function passedQuizzes(userId) {
  const rows = await db.many(
    `select distinct quiz_id from public.quiz_attempts where user_id = $1 and passed = true`,
    [userId]
  );
  return rows.map((r) => r.quiz_id);
}

/** Les badges mérités, déduits des quiz réussis. Source de vérité unique. */
function badgesFor(passed) {
  const badges = passed.map(training.badgeFor).filter(Boolean);
  const allDone = training.quizIds().every((id) => passed.includes(id));
  if (allDone) badges.push(training.GRADUATE_BADGE);
  return badges;
}

/**
 * Recopie les badges de formation sur la fiche du commercial, pour qu'ils
 * s'affichent dans le classement et sur son profil comme les badges de vente.
 * Un administrateur n'a pas de fiche : dans ce cas il n'y a rien à écrire,
 * ses badges restent déduits de ses passages de quiz.
 */
async function syncBadgesToRoster(req, badges) {
  const salespersonId = req.profile && req.profile.salesperson_id;
  if (!salespersonId || !badges.length) return;
  await db.query(
    `update public.salespersons
        set badges = (
          select coalesce(jsonb_agg(distinct b), '[]'::jsonb)
            from jsonb_array_elements(coalesce(badges, '[]'::jsonb) || $2::jsonb) as b
        )
      where id = $1 and team_id = $3`,
    [salespersonId, JSON.stringify(badges), teamScope(req)]
  );
}

/** Dépose une notification pour l'équipe (lue par les administrateurs). */
async function notifyTeam(req, { type, title, body }) {
  const name =
    (req.profile && req.profile.full_name) || (req.user && req.user.email) || "Un commercial";
  await db.query(
    `insert into public.notifications (team_id, actor_id, actor_name, type, title, body)
     values ($1, $2, $3, $4, $5, $6)`,
    [teamScope(req), req.user.id, name, type, title, body || null]
  );
}

/* ------------------------------------------------------------------ *
 * ÉTAT DU PARCOURS                                                    *
 * ------------------------------------------------------------------ */
router.get("/training", requireUser, async (req, res, next) => {
  try {
    const lessons = await db.many(
      `select lesson_id, completed_at from public.training_progress where user_id = $1`,
      [req.user.id]
    );
    const attempts = await db.many(
      `select quiz_id, score, total, passed, created_at
         from public.quiz_attempts where user_id = $1 order by created_at desc`,
      [req.user.id]
    );
    const passed = [...new Set(attempts.filter((a) => a.passed).map((a) => a.quiz_id))];

    // Le meilleur score par quiz : c'est lui qui s'affiche sur la carte.
    const best = {};
    for (const a of attempts) {
      if (!best[a.quiz_id] || a.score > best[a.quiz_id].score) {
        best[a.quiz_id] = { score: a.score, total: a.total, passed: a.passed };
      }
    }

    return res.json({
      lessons_done: lessons.map((l) => l.lesson_id),
      attempts,
      best,
      passed,
      badges: badgesFor(passed),
      completed: training.quizIds().every((id) => passed.includes(id)),
    });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * PROGRESSION DE LECTURE                                              *
 * ------------------------------------------------------------------ */
router.post("/training/lesson", requireUser, async (req, res, next) => {
  try {
    const lessonId = String((req.body && req.body.lesson_id) || "");
    // Liste blanche : le client ne peut pas inventer d'identifiants de leçon
    // et gonfler artificiellement sa progression.
    if (!training.LESSON_IDS.includes(lessonId)) {
      throw new HttpError(400, "Leçon inconnue.");
    }
    await db.query(
      `insert into public.training_progress (user_id, team_id, lesson_id)
       values ($1, $2, $3)
       on conflict (user_id, lesson_id) do nothing`,
      [req.user.id, teamScope(req), lessonId]
    );
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * QUIZ                                                                *
 * ------------------------------------------------------------------ */
router.get("/training/quiz/:quizId", requireUser, (req, res, next) => {
  try {
    const quiz = training.publicQuiz(req.params.quizId);
    if (!quiz) throw new HttpError(404, "Quiz inconnu.");
    return res.json(quiz); // sans les bonnes réponses
  } catch (err) {
    return next(err);
  }
});

router.post("/training/quiz/:quizId", requireUser, async (req, res, next) => {
  try {
    const quizId = req.params.quizId;
    const result = training.grade(quizId, req.body && req.body.answers);
    if (!result) throw new HttpError(404, "Quiz inconnu.");

    const teamId = teamScope(req);

    // Savoir si le quiz était DÉJÀ réussi avant ce passage : cela évite de
    // renotifier les administrateurs à chaque nouvelle tentative.
    const passedBefore = await passedQuizzes(req.user.id);
    const wasPassed = passedBefore.includes(quizId);

    await db.query(
      `insert into public.quiz_attempts (user_id, team_id, quiz_id, score, total, passed)
       values ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, teamId, quizId, result.score, result.total, result.passed]
    );

    const passedNow = result.passed && !passedBefore.includes(quizId)
      ? [...passedBefore, quizId]
      : passedBefore;
    const badges = badgesFor(passedNow);
    const completed = training.quizIds().every((id) => passedNow.includes(id));

    if (result.passed && !wasPassed) {
      await syncBadgesToRoster(req, badges);

      const quizTitle = training.QUIZZES[quizId].title;
      const who = (req.profile && req.profile.full_name) || req.user.email;
      await notifyTeam(req, {
        type: "quiz_passed",
        title: `${who} a réussi le ${quizTitle}`,
        body: `Score : ${result.score}/${result.total}.`,
      });

      if (completed) {
        await notifyTeam(req, {
          type: "training_completed",
          title: `${who} a terminé toute la formation 🎓`,
          body: "Les deux journées sont validées — badge « Diplômé Kgroup » décerné.",
        });
      }
    }

    return res.json({
      score: result.score,
      total: result.total,
      passed: result.passed,
      pass_mark: result.pass_mark,
      corrections: result.corrections, // les réponses ne sont révélées qu'APRÈS la copie
      badges,
      completed,
      newly_passed: result.passed && !wasPassed,
    });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * VUE ADMINISTRATEUR — où en est l'équipe                             *
 * ------------------------------------------------------------------ */
router.get("/training/team", requireUser, async (req, res, next) => {
  try {
    requireAdmin(req);
    const rows = await db.many(
      `select p.id            as user_id,
              p.full_name,
              p.email,
              p.role,
              coalesce(l.lessons_done, 0)::int as lessons_done,
              coalesce(q.quizzes_passed, 0)::int as quizzes_passed,
              q.best_jour1,
              q.best_jour2,
              q.last_activity
         from public.profiles p
         left join (
           select user_id, count(*) as lessons_done
             from public.training_progress group by user_id
         ) l on l.user_id = p.id
         left join (
           select user_id,
                  count(distinct quiz_id) filter (where passed) as quizzes_passed,
                  max(score) filter (where quiz_id = 'jour1')   as best_jour1,
                  max(score) filter (where quiz_id = 'jour2')   as best_jour2,
                  max(created_at)                               as last_activity
             from public.quiz_attempts group by user_id
         ) q on q.user_id = p.id
        where p.team_id = $1
        order by coalesce(q.quizzes_passed, 0) desc, p.full_name`,
      [teamScope(req)]
    );
    return res.json({
      total_lessons: training.LESSON_IDS.length,
      total_quizzes: training.quizIds().length,
      members: rows,
    });
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------------------ *
 * NOTIFICATIONS DE L'ÉQUIPE                                           *
 * -------------------------------------------------------------------
 * Fil unique, alimenté par la formation (réussites de quiz) ET par le
 * planificateur d'anniversaires.
 *
 * Qui voit quoi :
 *   admin            tout le fil de l'équipe
 *   relation_client  tout le fil aussi — sa mission couvre les anniversaires
 *                    de TOUS les clients (cf. server/policies.js)
 *   salesperson      uniquement ce qui le concerne : ses propres réussites et
 *                    les anniversaires des clients dont il est responsable
 *                    (les rappels portent l'utilisateur du commercial
 *                    responsable comme `actor_id`).
 * ------------------------------------------------------------------ */
router.get("/notifications", requireUser, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const rows = (isAdmin(req) || canSeeAllClients(req))
      ? await db.many(
          `select id, actor_id, actor_name, type, title, body, created_at
             from public.notifications where team_id = $1
            order by created_at desc limit $2`,
          [teamScope(req), limit]
        )
      : await db.many(
          `select id, actor_id, actor_name, type, title, body, created_at
             from public.notifications where team_id = $1 and actor_id = $2
            order by created_at desc limit $3`,
          [teamScope(req), req.user.id, limit]
        );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
