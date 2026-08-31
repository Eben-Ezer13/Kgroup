/* =========================================================================
   Tests de la correction des quiz — la partie qui doit être incorruptible.
   Aucune base de données : on teste server/training.js directement.
   ========================================================================= */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const training = require("../server/training");

/* ---- Intégrité du contenu ---------------------------------------------- */
test("les deux journées de formation existent", () => {
  assert.deepStrictEqual(training.quizIds().sort(), ["jour1", "jour2"]);
});

test("chaque question est bien formée et a une réponse valide", () => {
  for (const quizId of training.quizIds()) {
    const quiz = training.QUIZZES[quizId];
    assert.ok(quiz.questions.length >= 5, `${quizId} doit avoir au moins 5 questions`);
    quiz.questions.forEach((q, i) => {
      assert.ok(q.q && q.q.length > 5, `${quizId} q${i}: intitulé manquant`);
      assert.ok(Array.isArray(q.choices) && q.choices.length >= 2, `${quizId} q${i}: choix insuffisants`);
      assert.ok(
        Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length,
        `${quizId} q${i}: index de réponse hors bornes`
      );
      assert.ok(q.why && q.why.length > 5, `${quizId} q${i}: explication manquante`);
      // Des choix dupliqués rendraient une question ambiguë.
      assert.strictEqual(new Set(q.choices).size, q.choices.length, `${quizId} q${i}: choix dupliqués`);
    });
  }
});

test("chaque leçon référencée par le contenu est autorisée côté serveur", () => {
  // La liste blanche doit couvrir les deux journées : 7 leçons + 9 leçons.
  assert.ok(training.LESSON_IDS.length >= 16);
  assert.strictEqual(new Set(training.LESSON_IDS).size, training.LESSON_IDS.length, "identifiants dupliqués");
  assert.ok(training.LESSON_IDS.every((id) => /^j[12]-[a-z-]+$/.test(id)), "format d'identifiant inattendu");
});

/* ---- Le point critique : les réponses ne fuitent pas ------------------- */
test("la version envoyée au navigateur ne contient aucune bonne réponse", () => {
  for (const quizId of training.quizIds()) {
    const pub = training.publicQuiz(quizId);
    const serialized = JSON.stringify(pub);

    pub.questions.forEach((q) => {
      assert.strictEqual(q.answer, undefined, "l'index de la bonne réponse ne doit pas être envoyé");
      assert.strictEqual(q.why, undefined, "l'explication ne doit pas être envoyée avant la remise");
    });
    assert.ok(!serialized.includes('"answer"'), "le mot-clé answer apparaît dans la charge utile");
    assert.ok(!serialized.includes('"why"'), "le mot-clé why apparaît dans la charge utile");
  }
});

test("publicQuiz expose le barème et le nombre de questions", () => {
  const pub = training.publicQuiz("jour1");
  assert.strictEqual(pub.total, training.QUIZZES.jour1.questions.length);
  assert.strictEqual(pub.pass_mark, Math.ceil(pub.total * training.PASS_RATIO));
  assert.strictEqual(pub.questions.length, pub.total);
});

test("un quiz inconnu ne renvoie rien", () => {
  assert.strictEqual(training.publicQuiz("jour99"), null);
  assert.strictEqual(training.grade("jour99", []), null);
});

/* ---- Correction --------------------------------------------------------- */
test("un sans-faute est réussi", () => {
  const quiz = training.QUIZZES.jour1;
  const perfect = quiz.questions.map((q) => q.answer);
  const r = training.grade("jour1", perfect);
  assert.strictEqual(r.score, quiz.questions.length);
  assert.strictEqual(r.passed, true);
  assert.ok(r.corrections.every((c) => c.correct));
});

test("tout faux est refusé", () => {
  const quiz = training.QUIZZES.jour2;
  // On choisit systématiquement un index différent de la bonne réponse.
  const wrong = quiz.questions.map((q) => (q.answer + 1) % q.choices.length);
  const r = training.grade("jour2", wrong);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.passed, false);
});

test("le seuil de réussite est de 70 %", () => {
  const quiz = training.QUIZZES.jour1;
  const total = quiz.questions.length;
  const passMark = Math.ceil(total * 0.7);

  // Juste en dessous du seuil -> échec
  const under = quiz.questions.map((q, i) =>
    i < passMark - 1 ? q.answer : (q.answer + 1) % q.choices.length);
  const rUnder = training.grade("jour1", under);
  assert.strictEqual(rUnder.score, passMark - 1);
  assert.strictEqual(rUnder.passed, false);

  // Pile au seuil -> réussite
  const at = quiz.questions.map((q, i) =>
    i < passMark ? q.answer : (q.answer + 1) % q.choices.length);
  const rAt = training.grade("jour1", at);
  assert.strictEqual(rAt.score, passMark);
  assert.strictEqual(rAt.passed, true);
});

test("une copie vide, partielle ou malformée ne rapporte aucun point indu", () => {
  const total = training.QUIZZES.jour1.questions.length;

  for (const bogus of [[], null, undefined, "triche", { score: 999 }, [null, null]]) {
    const r = training.grade("jour1", bogus);
    assert.strictEqual(r.score, 0, `entrée ${JSON.stringify(bogus)} ne doit rien rapporter`);
    assert.strictEqual(r.passed, false);
    assert.strictEqual(r.total, total);
  }
});

test("des index hors bornes ne comptent jamais comme justes", () => {
  const quiz = training.QUIZZES.jour2;
  const r = training.grade("jour2", quiz.questions.map(() => 99));
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.passed, false);
});

test("un score ne peut pas dépasser le nombre de questions", () => {
  const quiz = training.QUIZZES.jour1;
  // Plus de réponses que de questions : le surplus est ignoré.
  const tooMany = [...quiz.questions.map((q) => q.answer), 0, 0, 0, 0];
  const r = training.grade("jour1", tooMany);
  assert.strictEqual(r.score, quiz.questions.length);
  assert.strictEqual(r.corrections.length, quiz.questions.length);
});

/* ---- Badges ------------------------------------------------------------- */
test("chaque quiz porte son badge, et le diplôme est distinct", () => {
  assert.strictEqual(training.badgeFor("jour1"), "olfactif");
  assert.strictEqual(training.badgeFor("jour2"), "vendeur");
  assert.strictEqual(training.badgeFor("jour99"), null);
  assert.strictEqual(training.GRADUATE_BADGE, "diplome");
  assert.ok(!["olfactif", "vendeur"].includes(training.GRADUATE_BADGE));
});
