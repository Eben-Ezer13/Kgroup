/* =========================================================================
   KGROUP — Contenu de la formation commerciale
   -------------------------------------------------------------------------
   Reprise fidèle des deux supports Kgroup Parfumery :
     Jour 1 — « Formation Kgroup Parfumery »            (univers olfactif)
     Jour 2 — « Devenir un commercial performant… »     (stratégie de vente)

   Ce fichier ne contient QUE la matière à lire — rien de confidentiel. Les
   questions de quiz et leurs bonnes réponses vivent côté serveur
   (server/training.js) pour qu'un score ne puisse pas être falsifié.

   Les `id` de leçons doivent correspondre à LESSON_IDS dans server/training.js :
   le serveur refuse tout identifiant qu'il ne connaît pas.

   Exposé en global : window.KG_TRAINING
   ========================================================================= */
(function () {
  "use strict";

  window.KG_TRAINING = {
    days: [
      {
        id: "jour1",
        badge: "olfactif",
        n: 1,
        title: "L'univers olfactif Kgroup",
        subtitle: "Histoire, familles, notes et parfums signatures.",
        icon: "🌿",
        quizTitle: "Quiz Jour 1 — L'univers olfactif",
        lessons: [
          {
            id: "j1-marque",
            title: "Qui sommes-nous ?",
            body: `
              <p>Kgroup Parfumery est une marque inspirée des <b>richesses culturelles africaines
              et mondiales</b>, avec pour mission de proposer des parfums exclusifs permettant à
              chacun d'exprimer sa personnalité.</p>
              <div class="kt-pills">
                <span class="kt-pill">Authenticité</span>
                <span class="kt-pill">Excellence</span>
                <span class="kt-pill">Passion</span>
              </div>
              <blockquote class="kt-quote">« La senteur du luxe »</blockquote>`,
          },
          {
            id: "j1-familles",
            title: "Les 5 familles olfactives",
            body: `
              <p>Savoir rattacher un parfum à sa famille, c'est pouvoir en proposer un autre
              qui plaira au même client.</p>
              <div class="kt-grid">
                <div class="kt-card"><h5>🌸 Florale</h5><p>Fleur de karité, Aminata, J'adore</p></div>
                <div class="kt-card"><h5>🌳 Boisée</h5><p>Essence d'ébène, Kouma, Harmattan</p></div>
                <div class="kt-card"><h5>🔥 Orientale</h5><p>Ivresse d'ambre, Black opium, Tobacco vanille</p></div>
                <div class="kt-card"><h5>💧 Fraîche</h5><p>Harmattan, Lumière du sahel, Acqua di gio</p></div>
                <div class="kt-card"><h5>🍯 Gourmande</h5><p>La vie est belle, Bonbon, Boss alive</p></div>
              </div>`,
          },
          {
            id: "j1-notes",
            title: "Les notes de parfum",
            body: `
              <p>Chaque parfum se révèle en trois temps : la première impression
              (<b>notes de tête</b>), la personnalité (<b>notes de cœur</b>) et la signature
              durable (<b>notes de fond</b>).</p>
              <div class="kt-notes">
                <div class="kt-note" style="--d:1">
                  <b>Notes de tête</b><span class="kt-time">15–30 min</span>
                  <p>Bergamote, citron, mandarine</p>
                </div>
                <div class="kt-note" style="--d:2">
                  <b>Notes de cœur</b><span class="kt-time">2–4 h</span>
                  <p>Jasmin, rose, tubéreuse</p>
                </div>
                <div class="kt-note" style="--d:3">
                  <b>Notes de fond</b><span class="kt-time">Plusieurs heures</span>
                  <p>Musc, ambre, vanille, patchouli</p>
                </div>
              </div>
              <p class="kt-tip">💡 En boutique : ce que le client sent au premier vaporisage
              n'est <b>pas</b> ce qu'il portera dans deux heures. Expliquez-le, cela évite les retours.</p>`,
          },
          {
            id: "j1-homme",
            title: "Parfums Homme",
            body: `
              <div class="kt-grid">
                <div class="kt-card"><h5>Essence d'ébène</h5><p>Homme élégant, mature, confiant<br><i>Notes boisées &amp; épicées</i></p></div>
                <div class="kt-card"><h5>Kouma</h5><p>Charismatique, luxe discret<br><i>Notes boisées &amp; ambrées</i></p></div>
                <div class="kt-card"><h5>Djembe</h5><p>Dynamique, audacieux<br><i>Notes épicées &amp; énergiques</i></p></div>
              </div>`,
          },
          {
            id: "j1-femme",
            title: "Parfums Femme",
            body: `
              <div class="kt-grid">
                <div class="kt-card"><h5>Fleur de karité</h5><p>Douce, élégante, féminine<br><i>Notes florales, exotiques &amp; crémeuses</i></p></div>
                <div class="kt-card"><h5>Soleil de Kalahari</h5><p>Chaleureuse, sensuelle<br><i>Notes vanille, jasmin &amp; accord chaud</i></p></div>
                <div class="kt-card"><h5>Aminata</h5><p>Moderne, lumineuse<br><i>Notes fleur d'oranger &amp; mandarine</i></p></div>
              </div>`,
          },
          {
            id: "j1-unisexe",
            title: "Parfums Unisexe",
            body: `
              <div class="kt-grid">
                <div class="kt-card"><h5>Akwaba — <i>Bienvenue</i></h5><p>Chaleureux, rassembleur, convivial<br><i>Notes accueillantes &amp; chaleureuses</i></p></div>
                <div class="kt-card"><h5>Harmattan</h5><p>Propre, élégant, quotidien<br><i>Notes fraîches &amp; boisées</i></p></div>
                <div class="kt-card"><h5>Terre d'Afrique</h5><p>Puissant, authentique, enraciné<br><i>Notes terreuses, épicées &amp; chaleureuses</i></p></div>
              </div>`,
          },
          {
            id: "j1-exercices",
            title: "Exercices de fin de journée",
            body: `
              <p>À pratiquer en binôme avant de passer le quiz.</p>
              <div class="kt-grid">
                <div class="kt-card kt-accent"><h5>Jeu 1 · Diagnostic client</h5><p>Jeu de rôle — poser des questions, identifier le besoin, proposer le parfum adapté.</p></div>
                <div class="kt-card kt-accent"><h5>Jeu 2 · Vente chronométrée</h5><p>3 minutes pour vendre un parfum. Objectif : convaincre rapidement.</p></div>
                <div class="kt-card kt-accent"><h5>Jeu 3 · Gestion d'objections</h5><p>Chaque participant reçoit une objection au hasard et doit y répondre.</p></div>
              </div>
              <blockquote class="kt-quote">« Je ne vends pas un parfum. Je fais vivre une expérience,
              je révèle une personnalité et je crée une émotion. »<br><small>— Kgroup Parfumery</small></blockquote>`,
          },
        ],
      },

      {
        id: "jour2",
        badge: "vendeur",
        n: 2,
        title: "Devenir un commercial performant",
        subtitle: "Stratégie de vente : accrocher, découvrir, convaincre, conclure.",
        icon: "💼",
        quizTitle: "Quiz Jour 2 — La stratégie de vente",
        lessons: [
          {
            id: "j2-objectifs",
            title: "Objectifs de la journée",
            body: `
              <p>À la fin de cette journée, vous serez capable de :</p>
              <ul class="kt-list">
                <li>Vendre <b>sans forcer</b></li>
                <li>Convaincre <b>en ligne et en physique</b></li>
                <li>Gérer les <b>objections</b></li>
                <li><b>Clôturer</b> une vente rapidement</li>
              </ul>`,
          },
          {
            id: "j2-posture",
            title: "La posture du vendeur",
            body: `
              <blockquote class="kt-quote">« On ne vend pas un parfum, on vend une émotion. »</blockquote>
              <div class="kt-pills">
                <span class="kt-pill">Confiance</span>
                <span class="kt-pill">Écoute</span>
                <span class="kt-pill">Énergie</span>
                <span class="kt-pill">Persuasion douce</span>
              </div>`,
          },
          {
            id: "j2-erreurs",
            title: "Les erreurs des débutants",
            body: `
              <div class="kt-grid">
                <div class="kt-card kt-bad"><h5>❌ Parler trop vite</h5><p>Le client n'a pas le temps de sentir ni de réfléchir.</p></div>
                <div class="kt-card kt-bad"><h5>❌ Proposer trop de parfums</h5><p>Trop de choix paralyse la décision.</p></div>
                <div class="kt-card kt-bad"><h5>❌ Forcer la vente</h5><p>La pression casse la confiance et fait fuir.</p></div>
                <div class="kt-card kt-bad"><h5>❌ Ne pas écouter le client</h5><p>Sans écoute, la proposition tombe à côté.</p></div>
              </div>`,
          },
          {
            id: "j2-processus",
            title: "Le processus de vente",
            body: `
              <p>Un enchaînement simple qui guide chaque interaction, du premier contact
              à la clôture.</p>
              <ol class="kt-steps">
                <li><b>Accroche</b><span>Captiver dès le premier contact</span></li>
                <li><b>Découverte</b><span>Comprendre les préférences du client</span></li>
                <li><b>Proposition</b><span>Présenter 2 à 3 options adaptées</span></li>
                <li><b>Test</b><span>Permettre l'essai et la démonstration</span></li>
                <li><b>Conclusion</b><span>Finaliser et conclure la vente</span></li>
              </ol>`,
          },
          {
            id: "j2-accroche",
            title: "L'accroche & la découverte",
            body: `
              <h5 class="kt-h5">Accroche (en ligne / WhatsApp)</h5>
              <ul class="kt-list">
                <li>« Bonjour 😊 vous cherchez un parfum homme ou femme ? »</li>
                <li>« C'est pour vous ou pour offrir ? »</li>
              </ul>
              <h5 class="kt-h5">Questions de découverte</h5>
              <ul class="kt-list">
                <li>Vous aimez les parfums <b>doux</b> ou <b>forts</b> ?</li>
                <li>Plutôt <b>frais</b> ou <b>sucré</b> ?</li>
                <li>Pour quel usage ? <b>Travail</b> ou <b>sortie</b> ?</li>
              </ul>`,
          },
          {
            id: "j2-regle-or",
            title: "La règle d'or : 2 à 3 parfums maximum",
            body: `
              <p class="kt-tip kt-tip-strong">Ne jamais proposer plus de <b>2 à 3 parfums</b> à la fois.
              Trop de choix paralyse le client et ralentit la décision.</p>
              <p>Mieux vaut deux propositions justes, issues d'une bonne découverte,
              que six propositions au hasard.</p>`,
          },
          {
            id: "j2-techniques",
            title: "Techniques de vente avancées",
            body: `
              <div class="kt-grid">
                <div class="kt-card"><h5>SONCAS</h5><p>Identifier le profil psychologique du client pour adapter votre argumentaire.</p></div>
                <div class="kt-card"><h5>Storytelling</h5><p>Raconter l'histoire du parfum pour créer un lien émotionnel fort.</p></div>
                <div class="kt-card"><h5>Projection</h5><p>« Imaginez-vous… » — aider le client à se projeter avec le parfum.</p></div>
              </div>`,
          },
          {
            id: "j2-objections",
            title: "Gestion des objections",
            body: `
              <div class="kt-obj">
                <div class="kt-obj-row">
                  <div class="kt-obj-q">❌ « C'est cher »</div>
                  <div class="kt-obj-a">👉 « C'est un parfum <b>longue tenue</b> avec une <b>qualité premium</b>… »</div>
                </div>
                <div class="kt-obj-row">
                  <div class="kt-obj-q">❌ « Je réfléchis »</div>
                  <div class="kt-obj-a">👉 « <b>Qu'est-ce qui vous fait hésiter ?</b> »</div>
                </div>
              </div>
              <p class="kt-tip">💡 Une objection n'est pas un refus : c'est une demande d'information.
              On recadre sur la valeur, ou on ouvre par une question.</p>`,
          },
          {
            id: "j2-cloture",
            title: "Clôture & objectif final",
            body: `
              <h5 class="kt-h5">Cas pratique</h5>
              <p>💬 Client : « Je veux un parfum qui attire les hommes »<br>
              → Écouter, découvrir, proposer 2 à 3 options avec projection émotionnelle.</p>
              <h5 class="kt-h5">Formules de clôture</h5>
              <ul class="kt-list">
                <li>« Lequel vous préférez finalement ? »</li>
                <li>« Je vous prépare lequel ? »</li>
              </ul>
              <p class="kt-tip kt-tip-strong">🎯 Objectif final : créer une <b>décision rapide et agréable</b>
              — le client repart satisfait et convaincu.</p>`,
          },
        ],
      },
    ],

    /* Badges décernés par la formation. Repris dans le catalogue de data.js
       pour que le reste de l'application sache les afficher. */
    badges: [
      { key: "olfactif", emoji: "👃", name: "Expert Olfactif", desc: "Quiz Jour 1 réussi" },
      { key: "vendeur", emoji: "💼", name: "Vendeur Confirmé", desc: "Quiz Jour 2 réussi" },
      { key: "diplome", emoji: "🏅", name: "Diplômé Kgroup", desc: "Formation complète validée" },
    ],
  };
})();
