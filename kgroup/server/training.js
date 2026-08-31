/* =========================================================================
   KGROUP — Formation commerciale : définition des quiz
   -------------------------------------------------------------------------
   Contenu tiré des deux supports de formation Kgroup Parfumery :
     Jour 1 — « Formation Kgroup Parfumery » (univers olfactif)
     Jour 2 — « Devenir un commercial performant » (stratégie de vente)

   Les bonnes réponses vivent UNIQUEMENT ici, côté serveur. Le navigateur
   reçoit les questions via publicQuiz(), qui retire l'index de la bonne
   réponse et l'explication : un commercial ne peut donc pas lire les réponses
   dans les outils de développement, ni renvoyer un score fabriqué — c'est le
   serveur qui corrige et qui décide du badge.

   Le contenu des leçons (la matière à lire) est côté client dans
   training-content.js : il n'a rien de secret et évite un aller-retour réseau.
   ========================================================================= */
"use strict";

/** Seuil de réussite, commun aux deux quiz. */
const PASS_RATIO = 0.7;

const QUIZZES = {
  jour1: {
    id: "jour1",
    title: "Quiz Jour 1 — L'univers olfactif",
    badge: "olfactif",
    questions: [
      {
        q: "À quelle famille olfactive appartient « Essence d'ébène » ?",
        choices: ["Florale", "Boisée", "Gourmande", "Fraîche"],
        answer: 1,
        why: "Essence d'ébène est un parfum boisé & épicé, pour un homme élégant, mature et confiant.",
      },
      {
        q: "Combien de temps durent les notes de tête ?",
        choices: ["15 à 30 minutes", "2 à 4 heures", "Plusieurs heures", "Toute la journée"],
        answer: 0,
        why: "Les notes de tête (bergamote, citron, mandarine) sont la première impression : 15 à 30 minutes.",
      },
      {
        q: "Quelles matières composent typiquement les notes de fond ?",
        choices: [
          "Bergamote, citron, mandarine",
          "Jasmin, rose, tubéreuse",
          "Musc, ambre, vanille, patchouli",
          "Menthe, eucalyptus, citron vert",
        ],
        answer: 2,
        why: "Les notes de fond sont la signature durable du parfum : musc, ambre, vanille, patchouli.",
      },
      {
        q: "Combien de temps tiennent les notes de cœur ?",
        choices: ["15 à 30 minutes", "2 à 4 heures", "8 heures", "Elles ne tiennent pas"],
        answer: 1,
        why: "Les notes de cœur (jasmin, rose, tubéreuse) portent la personnalité du parfum pendant 2 à 4 heures.",
      },
      {
        q: "Quel parfum unisexe Kgroup signifie « Bienvenue » ?",
        choices: ["Harmattan", "Terre d'Afrique", "Akwaba", "Djembe"],
        answer: 2,
        why: "Akwaba signifie « Bienvenue » : chaleureux, rassembleur, convivial.",
      },
      {
        q: "Comment décrit-on « Soleil de Kalahari » ?",
        choices: [
          "Chaleureuse et sensuelle — vanille, jasmin & accord chaud",
          "Fraîche et sportive — agrumes",
          "Boisée et masculine — cèdre",
          "Verte et herbacée — menthe",
        ],
        answer: 0,
        why: "Soleil de Kalahari est un parfum femme chaleureux et sensuel : vanille, jasmin et accord chaud.",
      },
      {
        q: "« Aminata » se caractérise par quelles notes ?",
        choices: [
          "Musc et patchouli",
          "Fleur d'oranger & mandarine",
          "Cuir et tabac",
          "Ambre et encens",
        ],
        answer: 1,
        why: "Aminata est moderne et lumineuse : fleur d'oranger et mandarine.",
      },
      {
        q: "Quelle famille olfactive regroupe « La vie est belle », « Bonbon » et « Boss alive » ?",
        choices: ["Orientale", "Boisée", "Fraîche", "Gourmande"],
        answer: 3,
        why: "Ce sont des parfums gourmands.",
      },
      {
        q: "Quel est le profil de « Terre d'Afrique » ?",
        choices: [
          "Léger et discret",
          "Puissant, authentique, enraciné",
          "Sucré et enfantin",
          "Frais et aquatique",
        ],
        answer: 1,
        why: "Terre d'Afrique est puissant, authentique et enraciné : notes terreuses, épicées et chaleureuses.",
      },
      {
        q: "Quelles sont les trois valeurs de Kgroup Parfumery ?",
        choices: [
          "Rapidité, Volume, Prix",
          "Authenticité, Excellence, Passion",
          "Tradition, Discrétion, Économie",
          "Innovation, Vitesse, Quantité",
        ],
        answer: 1,
        why: "Authenticité, Excellence et Passion sont les trois valeurs de la marque.",
      },
    ],
  },

  jour2: {
    id: "jour2",
    title: "Quiz Jour 2 — La stratégie de vente",
    badge: "vendeur",
    questions: [
      {
        q: "Combien de parfums proposer au maximum lors d'un même conseil ?",
        choices: ["1 seul", "2 à 3", "5 à 6", "Tout le catalogue"],
        answer: 1,
        why: "La règle d'or : jamais plus de 2 à 3 parfums. Trop de choix paralyse le client et ralentit la décision.",
      },
      {
        q: "Quel est l'ordre correct du processus de vente ?",
        choices: [
          "Découverte → Accroche → Test → Proposition → Conclusion",
          "Accroche → Découverte → Proposition → Test → Conclusion",
          "Proposition → Accroche → Découverte → Test → Conclusion",
          "Accroche → Proposition → Test → Découverte → Conclusion",
        ],
        answer: 1,
        why: "Accroche, Découverte, Proposition, Test, Conclusion : on capte, on comprend, puis seulement on propose.",
      },
      {
        q: "Le client dit « C'est cher ». Quelle est la bonne réponse ?",
        choices: [
          "« Je peux vous faire une réduction. »",
          "« C'est le prix du marché. »",
          "« C'est un parfum longue tenue avec une qualité premium… »",
          "« Alors regardez un autre produit. »",
        ],
        answer: 2,
        why: "On ne casse pas le prix : on recadre sur la valeur — longue tenue et qualité premium.",
      },
      {
        q: "Le client dit « Je réfléchis ». Quelle est la bonne réponse ?",
        choices: [
          "« Pas de souci, revenez quand vous voulez. »",
          "« Qu'est-ce qui vous fait hésiter ? »",
          "« C'est le dernier en stock ! »",
          "« Vous avez tort de réfléchir. »",
        ],
        answer: 1,
        why: "Une question ouverte fait ressortir la vraie objection, au lieu de laisser partir le client.",
      },
      {
        q: "Laquelle de ces attitudes est une erreur de débutant ?",
        choices: [
          "Écouter le client",
          "Poser des questions de découverte",
          "Proposer trop de parfums",
          "Faire tester le parfum",
        ],
        answer: 2,
        why: "Parler trop vite, proposer trop de parfums, forcer la vente et ne pas écouter : les quatre erreurs classiques.",
      },
      {
        q: "En quoi consiste la technique de la « Projection » ?",
        choices: [
          "Projeter le chiffre d'affaires du mois",
          "Vaporiser le parfum de loin",
          "Aider le client à s'imaginer avec le parfum (« Imaginez-vous… »)",
          "Comparer avec un parfum concurrent",
        ],
        answer: 2,
        why: "« Imaginez-vous… » : on aide le client à se projeter, ce qui crée le désir.",
      },
      {
        q: "Quelle technique consiste à raconter l'histoire du parfum ?",
        choices: ["SONCAS", "Storytelling", "Projection", "Closing"],
        answer: 1,
        why: "Le storytelling crée un lien émotionnel fort autour du parfum.",
      },
      {
        q: "À quoi sert la méthode SONCAS ?",
        choices: [
          "À calculer la commission",
          "À identifier le profil psychologique du client pour adapter l'argumentaire",
          "À classer les familles olfactives",
          "À gérer le stock",
        ],
        answer: 1,
        why: "SONCAS sert à cerner le profil du client et à adapter le discours en conséquence.",
      },
      {
        q: "Quelle formule de clôture est recommandée ?",
        choices: [
          "« Vous prenez quelque chose ou pas ? »",
          "« Je vous prépare lequel ? »",
          "« Réfléchissez et revenez. »",
          "« C'est comme vous voulez. »",
        ],
        answer: 1,
        why: "« Je vous prépare lequel ? » suppose la vente et crée une décision rapide et agréable.",
      },
      {
        q: "Selon la formation, que vend réellement un commercial Kgroup ?",
        choices: ["Un flacon", "Une émotion", "Une remise", "Un volume en millilitres"],
        answer: 1,
        why: "« On ne vend pas un parfum, on vend une émotion. »",
      },
    ],
  },
};

/** Les identifiants de leçons que le client a le droit de marquer comme lues. */
const LESSON_IDS = [
  "j1-marque", "j1-familles", "j1-notes", "j1-homme", "j1-femme", "j1-unisexe", "j1-exercices",
  "j2-objectifs", "j2-posture", "j2-erreurs", "j2-processus", "j2-accroche",
  "j2-regle-or", "j2-techniques", "j2-objections", "j2-cloture",
];

/** Badge décerné quand les deux quiz sont réussis. */
const GRADUATE_BADGE = "diplome";

/** La version envoyée au navigateur : sans `answer` ni `why`. */
function publicQuiz(quizId) {
  const quiz = QUIZZES[quizId];
  if (!quiz) return null;
  return {
    id: quiz.id,
    title: quiz.title,
    total: quiz.questions.length,
    pass_mark: Math.ceil(quiz.questions.length * PASS_RATIO),
    questions: quiz.questions.map((q, i) => ({ i, q: q.q, choices: q.choices })),
  };
}

/**
 * Corrige une copie.
 * @param {string} quizId
 * @param {Array<number>} answers  index choisi pour chaque question, dans l'ordre
 * @returns {{score:number,total:number,passed:boolean,pass_mark:number,corrections:Array}}
 */
function grade(quizId, answers) {
  const quiz = QUIZZES[quizId];
  if (!quiz) return null;
  const given = Array.isArray(answers) ? answers : [];
  let score = 0;

  const corrections = quiz.questions.map((q, i) => {
    // Une question sans réponse compte comme fausse, jamais comme juste.
    const picked = Number.isInteger(given[i]) ? given[i] : null;
    const correct = picked === q.answer;
    if (correct) score++;
    return { i, correct, picked, answer: q.answer, why: q.why };
  });

  const total = quiz.questions.length;
  const passMark = Math.ceil(total * PASS_RATIO);
  return { score, total, passed: score >= passMark, pass_mark: passMark, corrections };
}

module.exports = {
  QUIZZES,
  LESSON_IDS,
  GRADUATE_BADGE,
  PASS_RATIO,
  publicQuiz,
  grade,
  quizIds: () => Object.keys(QUIZZES),
  badgeFor: (quizId) => (QUIZZES[quizId] ? QUIZZES[quizId].badge : null),
};
