/* =========================================================================
   KGROUP SALES PERFORMANCE PLATFORM — App Engine
   Vanilla JS. Handles layout injection, theming, charts (Canvas),
   counters, modals, toasts, tables, and page-specific rendering.
   ========================================================================= */
(function () {
  "use strict";
  const KG = window.KG || {};
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* -----------------------------------------------------------------------
     1. ICON LIBRARY  (inline SVG — professional, no external deps)
     Stroke icons drawn from a Feather-style set.
  ----------------------------------------------------------------------- */
  const IC = {
    grid:      '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
    bag:       '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
    users:     '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    trophy:    '<path d="M6 9a6 6 0 0 0 12 0V3H6zM6 5H3a3 3 0 0 0 3 3M18 5h3a3 3 0 0 1-3 3M9 21h6M12 15v6"/>',
    flag:      '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
    gift:      '<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7"/>',
    chart:     '<path d="M3 3v18h18M7 15l3-4 3 3 4-6"/>',
    file:      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6"/>',
    bell:      '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
    gear:      '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V22a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 20.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.6 15a1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 3.6 1.65 1.65 0 0 0 9 2.09V2a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 14 3.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 8c.14.31.22.66.22 1a1.65 1.65 0 0 0 1.29 1.51H22a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/>',
    logout:    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    search:    '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    menu:      '<path d="M3 12h18M3 6h18M3 18h18"/>',
    // Repli de la barre laterale : glyphe « panneau lateral », volontairement
    // different du hamburger pour que les deux boutons ne se confondent pas.
    panel:     '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    sun:       '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
    moon:      '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    plus:      '<path d="M12 5v14M5 12h14"/>',
    check:     '<path d="M20 6 9 17l-5-5"/>',
    x:         '<path d="M18 6 6 18M6 6l12 12"/>',
    star:      '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
    eye:       '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff:    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-6.5 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22M9.9 9.9a3 3 0 1 0 4.2 4.2"/>',
    edit:      '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    trash:     '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    mail:      '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="m22 6-10 7L2 6"/>',
    lock:      '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    phone:     '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    card:      '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    cash:      '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    transfer:  '<path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>',
    calendar:  '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    download:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    print:     '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>',
    filter:    '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    arrowUp:   '<path d="M12 19V5M5 12l7-7 7 7"/>',
    arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    sort:      '<path d="M8 6h13M8 12h9M8 18h5M3 8l3-3 3 3M6 5v14"/>',
    clock:     '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    dollar:    '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    zap:       '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    target:    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    medal:     '<circle cx="12" cy="15" r="6"/><path d="M9 9 5 2M15 9l4-7M12 12l1 2 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L9 14.3l2-.3z"/>',
    link:      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    help:      '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    book:      '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/>',
    heart:     '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21.2l7.7-7.8 1.1-1a5.5 5.5 0 0 0 0-7.8z"/>',
    google:    '<path d="M22 12c0-.6-.05-1.2-.15-1.8H12v3.6h5.6a4.8 4.8 0 0 1-2.08 3.15v2.6h3.36C20.85 17.9 22 15.25 22 12z" fill="#4285F4" stroke="none"/><path d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.36-2.6c-.93.62-2.12.98-3.26.98-2.5 0-4.62-1.69-5.38-3.96H3.16v2.68A10 10 0 0 0 12 22z" fill="#34A853" stroke="none"/><path d="M6.62 13.99a6 6 0 0 1 0-3.83V7.48H3.16a10 10 0 0 0 0 9.04z" fill="#FBBC05" stroke="none"/><path d="M12 5.4c1.47 0 2.79.51 3.82 1.5l2.85-2.85C16.95 2.42 14.7 1.5 12 1.5A10 10 0 0 0 3.16 7.48l3.46 2.68C7.38 7.9 9.5 5.4 12 5.4z" fill="#EA4335" stroke="none"/>',
  };
  function icon(name, cls) {
    const raw = IC[name] || IC.grid;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="${cls||""}">${raw}</svg>`;
  }
  window.icon = icon;

  // Emerald KGROUP logo mark (SVG) — clean perfume bottle + K monogram
  const LOGO = `<svg class="logo-mark" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="KGROUP Parfumery">
    <circle cx="24" cy="24" r="23" fill="#0B7A4B"/>
    <rect x="20.5" y="7.5" width="7" height="6.6" rx="1.6" fill="#fff"/>
    <rect x="22.2" y="13.6" width="3.6" height="3" fill="#fff"/>
    <path d="M15.5 21.6c0-2.5 3-4.1 8.5-4.1s8.5 1.6 8.5 4.1v10.4c0 3-3 5-8.5 5s-8.5-2-8.5-5z" fill="#fff"/>
    <path d="M22 23v9.4M22 28l5-5M22 27.8l5.2 5" stroke="#0B7A4B" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M18.5 12.5l2.4 2.4M17.8 16l3 .8" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.9"/>
  </svg>`;
  window.KG_LOGO = LOGO;

  /* -----------------------------------------------------------------------
     1b. INTERNATIONALISATION (i18n) — English / French, persisted
     Elements opt in with data-i18n="key" (text) or data-i18n-ph="key"
     (placeholder). Add languages by extending DICT.
  ----------------------------------------------------------------------- */
  const DICT = {
    en: {
      "nav.dashboard":"Dashboard","nav.sales":"Sales","nav.salespersons":"Salespersons",
      "nav.ranking":"Rankings","nav.challenges":"Challenges","nav.rewards":"Rewards",
      "nav.reports":"Reports","nav.notifications":"Notifications","nav.settings":"Settings","nav.logout":"Logout",
      "nav.formation":"Training","nav.clients":"Clients","nav.remuneration":"Payroll",
      "group.main":"Main","group.insights":"Insights","group.system":"System",
      "topbar.search":"Search anything…","lang.title":"Language","topbar.collapse":"Collapse sidebar",
      "greeting.morning":"Good morning","common.viewAll":"View all",
      "btn.newSale":"New Sale","btn.export":"Export","btn.addSalesperson":"Add Salesperson",
      "btn.registerSale":"Register Sale","btn.createChallenge":"Create Challenge",
      "head.dashboard.sub":"Here's what's happening across KGROUP Parfumery today.",
      "head.sales.t":"Register a Sale","head.sales.sub":"Log a new transaction — it updates rankings, XP and challenges instantly.",
      "head.salespersons.t":"Salespersons","head.salespersons.sub":"Manage your luxury fragrance sales team",
      "head.ranking.t":"Rankings 🏆","head.ranking.sub":"Celebrate your top performers across every timeframe.",
      "head.challenges.t":"Challenges 🚩","head.challenges.sub":"Gamified competitions that keep your team hungry and motivated.",
      "head.reports.t":"Reports & Analytics","head.reports.sub":"Deep-dive into KGROUP's performance and export polished reports.",
      "sec.salesPerf":"Sales Performance","sec.salesPerf.sub":"Revenue & units over the last 12 months",
      "sec.quickActions":"Quick Actions","sec.top10":"Top 10 Salespersons","sec.top10.sub":"By revenue this month",
      "sec.recent":"Recent Sales","sec.recent.sub":"Latest transactions","sec.notifications":"Latest Notifications",
      "sec.category":"Sales by Category","sec.monthlyTarget":"Monthly Target",
      "empty.noReps":"No salespersons yet — add your team to start tracking performance.",
      "empty.noSales":"No sales registered yet — your data will appear here.",
    },
    fr: {
      "nav.dashboard":"Tableau de bord","nav.sales":"Ventes","nav.salespersons":"Vendeurs",
      "nav.ranking":"Classements","nav.challenges":"Défis","nav.rewards":"Récompenses",
      "nav.reports":"Rapports","nav.notifications":"Notifications","nav.settings":"Paramètres","nav.logout":"Déconnexion",
      "nav.formation":"Formation","nav.clients":"Clients","nav.remuneration":"Rémunération",
      "group.main":"Principal","group.insights":"Analyses","group.system":"Système",
      "topbar.search":"Rechercher…","lang.title":"Langue","topbar.collapse":"Replier le menu",
      "greeting.morning":"Bonjour","common.viewAll":"Voir tout",
      "btn.newSale":"Nouvelle vente","btn.export":"Exporter","btn.addSalesperson":"Ajouter un vendeur",
      "btn.registerSale":"Enregistrer la vente","btn.createChallenge":"Créer un défi",
      "head.dashboard.sub":"Voici l'activité de KGROUP Parfumery aujourd'hui.",
      "head.sales.t":"Enregistrer une vente","head.sales.sub":"Ajoutez une transaction — classements, XP et défis sont mis à jour instantanément.",
      "head.salespersons.t":"Vendeurs","head.salespersons.sub":"Gérez votre équipe de vente de parfums de luxe",
      "head.ranking.t":"Classements 🏆","head.ranking.sub":"Mettez à l'honneur vos meilleurs vendeurs sur chaque période.",
      "head.challenges.t":"Défis 🚩","head.challenges.sub":"Des compétitions ludiques qui motivent votre équipe.",
      "head.reports.t":"Rapports & Analyses","head.reports.sub":"Analysez la performance de KGROUP et exportez des rapports soignés.",
      "sec.salesPerf":"Performance des ventes","sec.salesPerf.sub":"Revenus et unités sur les 12 derniers mois",
      "sec.quickActions":"Actions rapides","sec.top10":"Top 10 des vendeurs","sec.top10.sub":"Par revenu ce mois-ci",
      "sec.recent":"Ventes récentes","sec.recent.sub":"Dernières transactions","sec.notifications":"Dernières notifications",
      "sec.category":"Ventes par catégorie","sec.monthlyTarget":"Objectif mensuel",
      "empty.noReps":"Aucun vendeur — ajoutez votre équipe pour suivre la performance.",
      "empty.noSales":"Aucune vente enregistrée — vos données apparaîtront ici.",
    },
  };
  const KGI18N = {
    lang: localStorage.getItem("kg-lang") || "en",
    langs: [{ code: "en", label: "English" }, { code: "fr", label: "Français" }],
    t(key) { return (DICT[this.lang] && DICT[this.lang][key]) || DICT.en[key] || key; },
    apply(root) {
      root = root || document;
      root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = this.t(el.getAttribute("data-i18n")); });
      root.querySelectorAll("[data-i18n-ph]").forEach(el => { el.setAttribute("placeholder", this.t(el.getAttribute("data-i18n-ph"))); });
    },
    set(lang) {
      this.lang = lang; localStorage.setItem("kg-lang", lang);
      document.documentElement.setAttribute("lang", lang);
      this.apply(document);
      const lc = document.getElementById("langCode");   // keep the top-bar label in sync
      if (lc) lc.textContent = lang.toUpperCase();
      window.dispatchEvent(new Event("kg:lang"));
    },
  };
  document.documentElement.setAttribute("lang", KGI18N.lang);
  window.KGI18N = KGI18N;
  const t = (k) => KGI18N.t(k);

  /* -----------------------------------------------------------------------
     1c. GUIDED TUTORIAL — role-aware, bilingual (follows the language switch)
     Auto-opens once for new users; reopen anytime via the "?" top-bar button.
  ----------------------------------------------------------------------- */
  const TUTORIAL = {
    admin: [
      { icon: "👋",
        en: { t: "Welcome to KGROUP", b: "This is your sales-performance platform. In under a minute you'll know how to manage your team, track sales, and run challenges. Use the arrows to move through the tour." },
        fr: { t: "Bienvenue sur KGROUP", b: "Voici votre plateforme de performance des ventes. En moins d'une minute, vous saurez gérer votre équipe, suivre les ventes et lancer des défis. Utilisez les flèches pour parcourir le guide." } },
      { icon: "👥",
        en: { t: "Add your team", b: "Open Salespersons → Add Salesperson. After saving, copy the personal invite link and send it (WhatsApp, e-mail…). Your rep opens it, sets a password, and joins your team automatically. You can re-copy the link anytime from the row's link icon." },
        fr: { t: "Ajoutez votre équipe", b: "Ouvrez Vendeurs → Ajouter un vendeur. Après l'enregistrement, copiez le lien d'invitation personnel et envoyez-le (WhatsApp, e-mail…). Votre vendeur l'ouvre, définit un mot de passe et rejoint automatiquement votre équipe. Vous pouvez recopier le lien à tout moment via l'icône de lien de la ligne." } },
      { icon: "🛍️",
        en: { t: "Register a sale", b: "In Sales, pick the customer, product (30 / 50 / 100 ml) and payment method (Espèces, Virement, Mobile Money). The commission (5 / 8 / 15 DHS) is calculated for you, and every sale updates rankings and XP instantly." },
        fr: { t: "Enregistrer une vente", b: "Dans Ventes, choisissez le client, le produit (30 / 50 / 100 ml) et le mode de paiement (Espèces, Virement, Mobile Money). La commission (5 / 8 / 15 DHS) est calculée automatiquement, et chaque vente met à jour les classements et l'XP instantanément." } },
      { icon: "📊",
        en: { t: "Track performance", b: "The Dashboard shows total sales, revenue and your Top 10 — all built from real sales. Rankings move as your team sells. The Reports page adds charts and exports." },
        fr: { t: "Suivez la performance", b: "Le Tableau de bord affiche les ventes totales, le chiffre d'affaires et votre Top 10 — le tout basé sur les ventes réelles. Les classements évoluent au rythme des ventes. La page Rapports ajoute graphiques et exports." } },
      { icon: "🚩",
        en: { t: "Launch challenges", b: "In Challenges → Create Challenge, set a title, a reward and a target. Your whole team sees it and competes for the reward you choose." },
        fr: { t: "Lancez des défis", b: "Dans Défis → Créer un défi, définissez un titre, une récompense et un objectif. Toute votre équipe le voit et se dispute la récompense que vous choisissez." } },
      { icon: "🎁",
        en: { t: "Rewards & bonuses", b: "The Rewards page lists the monthly bonuses from your contract: 20 sales → 100 DHS, 40 → 300, 60 → 600, plus promo codes and free perfumes." },
        fr: { t: "Récompenses & bonus", b: "La page Récompenses liste les bonus mensuels de votre contrat : 20 ventes → 100 DHS, 40 → 300, 60 → 600, ainsi que des codes promo et des parfums offerts." } },
      { icon: "⚙️",
        en: { t: "Settings & language", b: "In Settings you can edit your profile and theme. Switch language (EN / FR) anytime with the language button in the top bar. You're ready — enjoy!" },
        fr: { t: "Paramètres & langue", b: "Dans Paramètres, modifiez votre profil et le thème. Changez de langue (EN / FR) à tout moment via le bouton langue en haut. Vous êtes prêt — profitez-en !" } },
    ],
    salesperson: [
      { icon: "👋",
        en: { t: "Welcome to your dashboard", b: "This is your personal space to track your sales, climb the rankings and earn rewards. Let's take a quick tour." },
        fr: { t: "Bienvenue sur votre tableau de bord", b: "Voici votre espace personnel pour suivre vos ventes, grimper dans les classements et gagner des récompenses. Faisons un tour rapide." } },
      { icon: "🏅",
        en: { t: "Level, XP & badges", b: "Every sale earns XP and levels you up (Rookie → Diamond). You unlock badges for milestones — your first sale, 50 sales, and more." },
        fr: { t: "Niveau, XP & badges", b: "Chaque vente rapporte de l'XP et vous fait monter de niveau (Rookie → Diamond). Vous débloquez des badges pour des étapes clés — votre première vente, 50 ventes, et plus." } },
      { icon: "🛍️",
        en: { t: "Register your sales", b: "Go to Sales to log a sale: customer, product and payment method. Sales are registered under your name — and each one boosts your XP and ranking." },
        fr: { t: "Enregistrez vos ventes", b: "Allez dans Ventes pour enregistrer une vente : client, produit et mode de paiement. Les ventes sont enregistrées à votre nom — et chacune augmente votre XP et votre classement." } },
      { icon: "💸",
        en: { t: "How you earn", b: "You earn a commission on every sale (30 ml → 5 DHS, 50 ml → 8, 100 ml → 15) plus monthly bonuses (20 sales → 100 DHS, 40 → 300, 60 → 600). Track them on your dashboard." },
        fr: { t: "Comment vous gagnez", b: "Vous gagnez une commission sur chaque vente (30 ml → 5 DHS, 50 ml → 8, 100 ml → 15) plus des bonus mensuels (20 ventes → 100 DHS, 40 → 300, 60 → 600). Suivez-les sur votre tableau de bord." } },
      { icon: "🏆",
        en: { t: "Compete & win", b: "Check Rankings to see where you stand, and Challenges for competitions with extra rewards. Sell more to climb the leaderboard!" },
        fr: { t: "Rivalisez & gagnez", b: "Consultez Classements pour voir votre position, et Défis pour des compétitions avec des récompenses supplémentaires. Vendez plus pour grimper dans le classement !" } },
      { icon: "⚙️",
        en: { t: "Settings & language", b: "In Settings you can update your profile and switch language (EN / FR) with the language button in the top bar. You're all set — good luck!" },
        fr: { t: "Paramètres & langue", b: "Dans Paramètres, mettez à jour votre profil et changez la langue (EN / FR) via le bouton langue en haut. Tout est prêt — bonne chance !" } },
    ],
  };
  const TUT_L = {
    en: { next: "Next", back: "Back", done: "Got it!", skip: "Skip tour", step: "Step", help: "How to use the site" },
    fr: { next: "Suivant", back: "Retour", done: "Compris !", skip: "Passer", step: "Étape", help: "Comment utiliser le site" },
  };
  const tutL = (k) => (TUT_L[KGI18N.lang] || TUT_L.en)[k];

  function initTutorial() {
    if (document.getElementById("tutorialModal")) return;   // build once
    const role = window.KG_ROLE === "salesperson" ? "salesperson" : "admin";
    const steps = TUTORIAL[role];
    let idx = 0;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "tutorialModal";
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;text-align:center">
        <div style="display:flex;justify-content:flex-end;padding:14px 16px 0">
          <div class="seg" id="tutLang">
            <button data-tl="en">EN</button>
            <button data-tl="fr">FR</button>
          </div>
        </div>
        <div class="modal-body" style="padding:18px 32px 30px">
          <div id="tutIcon" style="font-size:54px;line-height:1;margin-bottom:16px"></div>
          <h3 id="tutTitle" style="font-size:23px;margin-bottom:10px"></h3>
          <p id="tutBody" class="muted" style="font-size:14.5px;line-height:1.65"></p>
          <div id="tutDots" style="display:flex;gap:7px;justify-content:center;margin:24px 0 6px"></div>
          <div id="tutStep" class="muted" style="font-size:12px"></div>
        </div>
        <div class="modal-foot" style="justify-content:space-between">
          <button class="btn btn-ghost btn-sm" id="tutSkip"></button>
          <div class="row gap-2">
            <button class="btn btn-ghost" id="tutBack"></button>
            <button class="btn btn-primary" id="tutNext"></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const g = (id) => overlay.querySelector(id);
    function render() {
      const lang = KGI18N.lang === "fr" ? "fr" : "en";
      const step = steps[idx], c = step[lang] || step.en;
      g("#tutIcon").textContent = step.icon;
      g("#tutTitle").textContent = c.t;
      g("#tutBody").textContent = c.b;
      g("#tutStep").textContent = `${tutL("step")} ${idx + 1} / ${steps.length}`;
      g("#tutDots").innerHTML = steps.map((_, i) =>
        `<span style="width:${i === idx ? "22px" : "8px"};height:8px;border-radius:8px;background:${i === idx ? "var(--brand)" : "var(--line)"};transition:all .3s"></span>`).join("");
      g("#tutBack").style.visibility = idx === 0 ? "hidden" : "visible";
      g("#tutBack").textContent = tutL("back");
      g("#tutNext").textContent = idx === steps.length - 1 ? tutL("done") : tutL("next");
      g("#tutSkip").textContent = tutL("skip");
      g("#tutSkip").style.visibility = idx === steps.length - 1 ? "hidden" : "visible";
      overlay.querySelectorAll("#tutLang button").forEach(b => b.classList.toggle("on", b.dataset.tl === KGI18N.lang));
    }
    function open() {
      localStorage.setItem("kg-tut-" + role, "1"); // seen → won't auto-open again
      idx = 0; render(); overlay.classList.add("open"); document.body.style.overflow = "hidden";
    }
    function close() { overlay.classList.remove("open"); document.body.style.overflow = ""; }

    g("#tutNext").addEventListener("click", () => { if (idx >= steps.length - 1) close(); else { idx++; render(); } });
    g("#tutBack").addEventListener("click", () => { if (idx > 0) { idx--; render(); } });
    g("#tutSkip").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    // In-tutorial language switch → updates the whole app + re-renders this tour
    overlay.querySelectorAll("#tutLang button").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.tl !== KGI18N.lang) KGI18N.set(b.dataset.tl); // fires kg:lang → render()
    }));
    window.addEventListener("kg:lang", () => { if (overlay.classList.contains("open")) render(); });

    window.KGTutorial = { open };
    // Auto-open the very first time this role visits
    if (!localStorage.getItem("kg-tut-" + role)) setTimeout(open, 900);
  }
  window.KG_initTutorial = initTutorial;

  /* -----------------------------------------------------------------------
     2. THEME (dark mode) — persisted
  ----------------------------------------------------------------------- */
  const THEME_KEY = "kg-theme";
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
    $$("[data-theme-ico]").forEach(el => el.innerHTML = icon(t === "dark" ? "sun" : "moon"));
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(cur);
    // Redraw charts with new palette
    setTimeout(() => window.dispatchEvent(new Event("kg:redraw")), 60);
  }
  applyTheme(localStorage.getItem(THEME_KEY) || "light");
  // Exposed so the Settings page can drive theming too
  window.KGTheme = {
    apply: (t) => { applyTheme(t); setTimeout(() => window.dispatchEvent(new Event("kg:redraw")), 60); },
    toggle: toggleTheme,
    current: () => document.documentElement.getAttribute("data-theme") || "light",
  };

  /* -----------------------------------------------------------------------
     3. NAVIGATION MODEL
  ----------------------------------------------------------------------- */
  // Each item declares which roles may see it + its sidebar group.
  // 'dashboard' and 'notifications' hrefs are resolved per-role at render time.
  const NAV = [
    { key: "dashboard",    label: "Dashboard",    icon: "grid",   group: "Main",     roles: ["admin","salesperson","relation_client"] },
    { key: "sales",        label: "Sales",        icon: "bag",    group: "Main",     roles: ["admin","salesperson"], href: "sales.html" },
    { key: "salespersons", label: "Salespersons", icon: "users",  group: "Main",     roles: ["admin"],               href: "salespersons.html" },
    { key: "ranking",      label: "Rankings",     icon: "trophy", group: "Main",     roles: ["admin","salesperson","relation_client"], href: "ranking.html" },
    { key: "challenges",   label: "Challenges",   icon: "flag",   group: "Main",     roles: ["admin","salesperson","relation_client"], href: "challenges.html" },
    { key: "clients",      label: "Clients",      icon: "heart",  group: "Main",     roles: ["admin","salesperson","relation_client"], href: "clients.html" },
    { key: "formation",    label: "Training",     icon: "book",   group: "Main",     roles: ["admin","salesperson","relation_client"], href: "formation.html" },
    { key: "remuneration", label: "Payroll",      icon: "dollar", group: "Insights", roles: ["admin"],               href: "remuneration.html" },
    { key: "rewards",      label: "Rewards",      icon: "gift",   group: "Insights", roles: ["admin","salesperson","relation_client"], href: "challenges.html#rewards" },
    { key: "reports",      label: "Reports",      icon: "file",   group: "Insights", roles: ["admin"],               href: "reports.html" },
    { key: "notifications",label: "Notifications",icon: "bell",   group: "Insights", roles: ["admin","salesperson","relation_client"] },
    { key: "settings",     label: "Settings",     icon: "gear",   group: "System",   roles: ["admin","salesperson","relation_client"], href: "settings.html" },
  ];

  /* -----------------------------------------------------------------------
     4. LAYOUT INJECTION (reusable shell: sidebar + topbar)
     A page opts in with <body data-app data-page="dashboard" data-title="...">
  ----------------------------------------------------------------------- */
  function buildLayout() {
    const body = document.body;
    if (!body.hasAttribute("data-app")) return;
    const page = body.dataset.page || "dashboard";
    const title = body.dataset.title || "Dashboard";
    const me = KG.me || { name: "Admin", initials: "AD" };
    const appRole = window.KG_ROLE || "admin";                 // 'admin' | 'salesperson'
    const role = body.dataset.role || (appRole === "salesperson" ? "Salesperson" : "Administrator");
    const home = appRole === "salesperson" ? "salesperson.html" : "dashboard.html";

    // Resolve role-specific hrefs, then keep only items this role may see
    const visibleNav = NAV
      .filter(n => (n.roles || ["admin"]).includes(appRole))
      .map(n => {
        let href = n.href;
        if (n.key === "dashboard") href = home;
        if (n.key === "notifications") href = home + "#notifs";
        return Object.assign({}, n, { href });
      });
    const groupOrder = ["Main", "Insights", "System"];
    const groupLabels = { Main: "Main", Insights: "Insights", System: "System" };
    const navSections = groupOrder.map(g => {
      const items = visibleNav.filter(n => n.group === g);
      if (!items.length) return "";
      return `<div class="nav-label" data-i18n="group.${g.toLowerCase()}">${t("group." + g.toLowerCase())}</div>` + items.map(navHtml(page)).join("");
    }).join("");

    // Move existing page content into a holder
    const pageContent = body.innerHTML;
    body.innerHTML = "";

    const shell = document.createElement("div");
    shell.className = "app-shell";
    shell.id = "shell";

    // ---- Sidebar (grouped nav sections built via navHtml) ----
    shell.innerHTML = `
      <div class="nav-scrim" id="navScrim"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          ${LOGO}
          <div class="brand-txt">
            <strong>KGROUP</strong>
            <span>Parfumery</span>
          </div>
        </div>
        <nav class="sidebar-nav">
          ${navSections}
          <a href="login.html" class="nav-item" data-nav="logout">${icon("logout")}<span data-i18n="nav.logout">${t("nav.logout")}</span></a>
        </nav>
        <div class="sidebar-foot">
          <div class="sidebar-user">
            ${avatar(me, 38)}
            <div>
              <div class="u-name">${me.name}</div>
              <div class="u-role">${role}</div>
            </div>
          </div>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="icon-btn hamburger" id="hamburger" aria-label="Menu">${icon("menu")}</button>
          <button class="icon-btn collapse-btn" id="collapseBtn" title="${t("topbar.collapse")}" aria-label="${t("topbar.collapse")}">${icon("panel")}</button>
          <div>
            <h1>${title}</h1>
            <div class="crumb">KGROUP • ${title}</div>
          </div>
          <div class="grow"></div>
          <div class="search-box">
            ${icon("search")}
            <input type="text" id="globalSearch" placeholder="Search anything…" data-i18n-ph="topbar.search">
          </div>
          <div class="dropdown" id="langDropdown">
            <button class="icon-btn" id="langBtn" title="Language"><b id="langCode" style="font-size:12px;letter-spacing:.04em">${KGI18N.lang.toUpperCase()}</b></button>
            <div class="dropdown-panel" style="width:180px">
              <div class="dropdown-list" id="langList"></div>
            </div>
          </div>
          <button class="icon-btn" id="helpBtn" title="${tutL("help")}">${icon("help")}</button>
          <button class="icon-btn" id="themeBtn" title="Toggle theme"><span data-theme-ico>${icon("moon")}</span></button>
          <div class="dropdown" id="notifDropdown">
            <button class="icon-btn" id="notifBtn" title="Notifications">${icon("bell")}${badgeFor("notifications") ? '<span class="ping"></span>' : ""}</button>
            <div class="dropdown-panel">
              <div class="dropdown-head">
                <strong>Notifications</strong>
                <a href="#" class="link" id="markAll">Mark all read</a>
              </div>
              <div class="dropdown-list" id="notifList"></div>
              <div class="dropdown-foot"><a href="#" class="link">View all activity</a></div>
            </div>
          </div>
          ${avatar(me, 42)}
        </header>
        <div class="content" id="content"></div>
      </div>`;

    body.appendChild(shell);
    $("#content").innerHTML = pageContent;

    // Fill notifications dropdown
    renderNotifs();

    // Wire interactions
    wireShell();

    // Translate everything now that the shell + page content are in the DOM
    KGI18N.apply(document);

    // Guided tutorial (auto-opens once per role; reopen via the "?" button)
    initTutorial();
  }

  /* ----- "Seen" tracking so nav badges clear after you visit a section ----- */
  const seenKey = (k) => "kg-seen-" + k;
  const getSeen = (k) => parseInt(localStorage.getItem(seenKey(k)) || "0", 10);
  const setSeen = (k, n) => localStorage.setItem(seenKey(k), String(n));

  /* Human "time ago" from a real timestamp (ms). */
  function relTime(ms) {
    if (!ms) return "";
    const diff = Date.now() - ms;
    if (diff < 45000) return "just now";
    const m = Math.floor(diff / 60000);
    if (m < 60) return m + (m === 1 ? " min ago" : " min ago");
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    const d = Math.floor(h / 24);
    if (d === 1) return "Yesterday";
    if (d < 7) return d + " days ago";
    return new Date(ms).toLocaleDateString();
  }
  window.KGrelTime = relTime;

  /* Build the notification feed from REAL activity (sales + challenges),
     newest first, and flag the still-unseen ones as unread. */
  function buildNotifications() {
    const K = window.KG; if (!K) return [];
    const notifs = [];
    // Formation en tete : une reussite est plus notable qu une vente de routine.
    (K.teamNotifications || []).slice(0, 5).forEach(n => notifs.push({
      id: "t:" + n.id,
      type: n.type === "training_completed" ? "gold" : "info",
      icon: "medal",
      title: n.title,
      time: relTime(Date.parse(n.created_at)),
    }));
    (K.recentSales || []).slice(0, 8).forEach(s => notifs.push({
      id: "s:" + s.id, type: "info", icon: "bag",
      title: `New sale — ${s.product}${s.qty > 1 ? " ×" + s.qty : ""}`,
      time: (s.rep ? `by ${s.rep} • ` : "") + relTime(s.at ? Date.parse(s.at) : Date.now() - (s.minsAgo || 0) * 60000),
    }));
    (K.challenges || []).slice(0, 3).forEach(c => notifs.push({
      id: "c:" + c.id, type: "gold", icon: "flag", title: `Challenge: ${c.title}`, time: "Active",
    }));
    // Everything newer than the last item the user acknowledged is "unread"
    const lastSeen = localStorage.getItem("kg-seen-notif-id");
    const idx = lastSeen ? notifs.findIndex(n => n.id === lastSeen) : -1;
    const unread = idx === -1 ? notifs.length : idx;
    notifs.forEach((n, i) => n.unread = i < unread);
    K.notifications = notifs;
    return notifs;
  }

  /* How many unseen items to badge on a given nav item (0 = no badge). */
  function badgeFor(key) {
    const K = window.KG || {};
    if (key === "challenges")    return Math.max(0, (K.challenges || []).length - getSeen("chal"));
    if (key === "notifications") return (K.notifications || []).filter(n => n.unread).length;
    return 0;
  }

  const navHtml = (page) => (n) => {
    const b = badgeFor(n.key);
    return `
    <a href="${n.href}" class="nav-item ${n.key === page ? "active" : ""}" data-nav="${n.key}">
      ${icon(n.icon)}<span data-i18n="nav.${n.key}">${t("nav." + n.key)}</span>
      ${b ? `<span class="nav-badge">${b}</span>` : ""}
    </a>`;
  };

  function avatar(p, size) {
    const s = size || 40;
    const hue = p.hue != null ? p.hue : 150;
    return `<span class="avatar-fallback" style="width:${s}px;height:${s}px;font-size:${Math.round(s*0.36)}px;background:linear-gradient(135deg,hsl(${hue},55%,45%),hsl(${(hue+40)%360},60%,32%))">${p.initials || "?"}</span>`;
  }
  window.kgAvatar = avatar;

  function renderNotifs() {
    const list = $("#notifList");
    if (!list) return;
    if (!(KG.notifications || []).length) {
      list.innerHTML = `<div style="text-align:center;padding:30px 12px;color:var(--muted)">
        <div style="font-size:26px;margin-bottom:6px">🔔</div><div style="font-size:13px">No new activity</div></div>`;
      return;
    }
    const map = { success: ["ico-green","trophy"], info: ["ico-blue","bell"], gold: ["ico-gold","star"] };
    list.innerHTML = (KG.notifications || []).map(n => {
      const [cls] = map[n.type] || map.info;
      return `<div class="notif ${n.unread ? "unread" : ""}">
        <div class="notif-ico ${cls}" style="color:#fff">${icon(n.icon)}</div>
        <div class="grow"><div class="f-title" style="font-size:13.5px;font-weight:600">${n.title}</div>
        <div class="f-time">${n.time}</div></div>
        ${n.unread ? '<span class="dot on" style="align-self:center"></span>' : ""}
      </div>`;
    }).join("");
  }

  function wireShell() {
    const shell = $("#shell");
    // Collapse (desktop) / open (mobile)
    $("#collapseBtn")?.addEventListener("click", () => {
      if (window.innerWidth <= 860) shell.classList.toggle("nav-open");
      else shell.classList.toggle("collapsed");
    });
    $("#hamburger")?.addEventListener("click", () => shell.classList.toggle("nav-open"));
    $("#navScrim")?.addEventListener("click", () => shell.classList.remove("nav-open"));
    $("#themeBtn")?.addEventListener("click", toggleTheme);
    $("#helpBtn")?.addEventListener("click", () => window.KGTutorial && window.KGTutorial.open());

    // Language dropdown
    const langDd = $("#langDropdown");
    const langList = $("#langList");
    function renderLangs() {
      if (!langList) return;
      langList.innerHTML = KGI18N.langs.map(l => `
        <button class="nav-item" data-lang="${l.code}" style="width:100%;text-align:left">
          <b style="width:26px">${l.code.toUpperCase()}</b><span>${l.label}</span>
          ${l.code === KGI18N.lang ? '<span class="grow"></span>' + icon("check") : ""}
        </button>`).join("");
      langList.querySelectorAll("[data-lang]").forEach(b => b.addEventListener("click", () => {
        KGI18N.set(b.dataset.lang);
        $("#langCode").textContent = b.dataset.lang.toUpperCase();
        langDd.classList.remove("open");
        renderLangs();
        toast("success", KGI18N.lang === "fr" ? "Langue : Français" : "Language: English", "");
      }));
    }
    renderLangs();
    $("#langBtn")?.addEventListener("click", (e) => { e.stopPropagation(); langDd.classList.toggle("open"); });
    document.addEventListener("click", (e) => { if (langDd && !langDd.contains(e.target)) langDd.classList.remove("open"); });

    // Real logout → end the API session, then go to login
    $('[data-nav="logout"]')?.addEventListener("click", async (e) => {
      e.preventDefault();
      if (window.KGAuth) { try { await window.KGAuth.signOut(); } catch (_) {} }
      window.location.href = "login.html";
    });

    // Notifications dropdown — opening it marks everything as seen
    const dd = $("#notifDropdown");
    async function refreshNotifications() {
      if (!window.KGTraining || !window.KG_API_CONFIGURED) return;
      const latest = await window.KGTraining.notifications(20);
      if (!latest) return;
      window.KG.teamNotifications = latest;
      buildNotifications();
      renderNotifs();
    }
    function markNotifsSeen() {
      const top = (window.KG.notifications || [])[0];
      if (top) localStorage.setItem("kg-seen-notif-id", top.id);
      (window.KG.notifications || []).forEach(n => n.unread = false);
      $$(".notif.unread").forEach(n => n.classList.remove("unread"));
      $(".ping")?.remove();
      document.querySelector('[data-nav="notifications"] .nav-badge')?.remove();
    }
    $("#notifBtn")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await refreshNotifications();
      dd.classList.toggle("open");
      if (dd.classList.contains("open")) markNotifsSeen();
    });
    document.addEventListener("click", (e) => { if (dd && !dd.contains(e.target)) dd.classList.remove("open"); });
    $("#markAll")?.addEventListener("click", (e) => {
      e.preventDefault();
      markNotifsSeen();
      toast("success", "All caught up", "Notifications marked as read.");
    });

    // Visiting a section via its nav item clears that section's badge
    $('[data-nav="notifications"]')?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!dd) return;
      refreshNotifications();
      dd.classList.add("open");
      markNotifsSeen();
    });
    if (window.KG_API_CONFIGURED) setInterval(refreshNotifications, 60_000);
    $('[data-nav="challenges"]')?.addEventListener("click", () =>
      setSeen("chal", (window.KG.challenges || []).length));

    // Global search → filter any [data-searchable] table on the page
    $("#globalSearch")?.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      $$("[data-searchable] tbody tr").forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });

    // Restore collapsed pref
    if (localStorage.getItem("kg-collapsed") === "1" && window.innerWidth > 860) shell.classList.add("collapsed");
    $("#collapseBtn")?.addEventListener("click", () => {
      if (window.innerWidth > 860) localStorage.setItem("kg-collapsed", shell.classList.contains("collapsed") ? "1" : "0");
    });
  }

  /* -----------------------------------------------------------------------
     5. ANIMATED COUNTERS
  ----------------------------------------------------------------------- */
  function animateCounters(root = document) {
    $$("[data-count]", root).forEach(el => {
      const target = parseFloat(el.dataset.count);
      const dur = 1300, prefix = el.dataset.prefix || "", suffix = el.dataset.suffix || "";
      const isMoney = el.dataset.money === "1";
      let start = null;
      function step(ts) {
        if (!start) start = ts;
        const p = Math.min((ts - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = target * eased;
        el.textContent = prefix + (isMoney ? KG.fmt.moneyShort(val) : KG.fmt.num(val)) + suffix;
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = prefix + (isMoney ? KG.fmt.moneyShort(target) : KG.fmt.num(target)) + suffix;
      }
      requestAnimationFrame(step);
    });
  }
  window.animateCounters = animateCounters;

  /* -----------------------------------------------------------------------
     6. PROGRESS BARS / RINGS animate on reveal
  ----------------------------------------------------------------------- */
  function animateBars(root = document) {
    $$("[data-bar]", root).forEach(el => {
      const pct = el.dataset.bar;
      requestAnimationFrame(() => setTimeout(() => { el.style.width = pct + "%"; }, 120));
    });
  }
  window.animateBars = animateBars;

  function drawRing(el) {
    const pct = +el.dataset.ring;
    const size = 128, sw = 12, r = (size - sw) / 2, c = 2 * Math.PI * r;
    const track = getVar("--line-2"), col = getVar("--brand");
    el.innerHTML = `
      <svg width="${size}" height="${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${track}" stroke-width="${sw}"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}"
          stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" class="ring-prog"/>
      </svg>
      <div class="ring-val"><b>${pct}%</b><span>${el.dataset.ringLabel||"of target"}</span></div>`;
    const prog = el.querySelector(".ring-prog");
    requestAnimationFrame(() => setTimeout(() => {
      prog.style.transition = "stroke-dashoffset 1.4s cubic-bezier(0.16,1,0.3,1)";
      prog.style.strokeDashoffset = c * (1 - pct / 100);
    }, 150));
  }

  /* -----------------------------------------------------------------------
     7. CANVAS CHARTS  (line, bar, sparkline) — hi-DPI, animated
  ----------------------------------------------------------------------- */
  const getVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function setupCanvas(canvas, h) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    return { ctx, w, h };
  }

  function lineChart(canvas, opts) {
    const h = opts.height || 280;
    const { ctx, w } = setupCanvas(canvas, h);
    const pad = { l: 42, r: 16, t: 18, b: 30 };
    const data = opts.data, labels = opts.labels;
    const series = opts.series; // [{values, color, fill}]
    const allVals = series.flatMap(s => s.values);
    const max = (Math.max(...allVals) * 1.12) || 1, min = 0; // || 1 guards all-zero data
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const x = (i, n) => pad.l + (cw * i) / (n - 1);
    const y = (v) => pad.t + ch - ((v - min) / (max - min)) * ch;
    const grid = getVar("--line"), muted = getVar("--muted");

    let t = 0;
    function frame() {
      t = Math.min(t + 0.045, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      ctx.clearRect(0, 0, w, h);

      // grid + y labels
      ctx.font = "11px Inter, sans-serif"; ctx.fillStyle = muted; ctx.textAlign = "right";
      for (let g = 0; g <= 4; g++) {
        const gy = pad.t + (ch * g) / 4;
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
        const val = max - ((max - min) * g) / 4;
        ctx.fillText(KG.fmt.moneyShort(val), pad.l - 8, gy + 4);
      }
      // x labels
      ctx.textAlign = "center";
      labels.forEach((lb, i) => { if (labels.length > 8 && i % 2) return; ctx.fillText(lb, x(i, labels.length), h - 8); });

      // series
      series.forEach(s => {
        const n = s.values.length;
        ctx.beginPath();
        s.values.forEach((v, i) => {
          const px = x(i, n), py = y(v * ease);
          i === 0 ? ctx.moveTo(px, py) : smoothTo(ctx, s.values, i, x, y, ease, n);
        });
        ctx.strokeStyle = s.color; ctx.lineWidth = 3; ctx.lineJoin = "round";
        ctx.stroke();
        if (s.fill) {
          ctx.lineTo(x(n - 1, n), pad.t + ch); ctx.lineTo(x(0, n), pad.t + ch); ctx.closePath();
          const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
          grad.addColorStop(0, s.fill); grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad; ctx.fill();
        }
        // end dot
        if (t >= 1) {
          const lx = x(n - 1, n), ly = y(s.values[n - 1]);
          ctx.beginPath(); ctx.arc(lx, ly, 4.5, 0, 7); ctx.fillStyle = s.color; ctx.fill();
          ctx.beginPath(); ctx.arc(lx, ly, 8, 0, 7); ctx.strokeStyle = s.color; ctx.globalAlpha = .25; ctx.lineWidth = 6; ctx.stroke(); ctx.globalAlpha = 1;
        }
      });
      if (t < 1) requestAnimationFrame(frame);
    }
    frame();
  }
  function smoothTo(ctx, vals, i, x, y, ease, n) {
    // simple curve using midpoints for smoothness
    const x0 = x(i - 1, n), y0 = y(vals[i - 1] * ease);
    const x1 = x(i, n), y1 = y(vals[i] * ease);
    const mx = (x0 + x1) / 2;
    ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1);
  }

  function barChart(canvas, opts) {
    const h = opts.height || 260;
    const { ctx, w } = setupCanvas(canvas, h);
    const pad = { l: 38, r: 12, t: 16, b: 30 };
    const vals = opts.values, labels = opts.labels;
    const max = (Math.max(...vals) * 1.15) || 1; // guard all-zero data
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const bw = (cw / vals.length) * 0.55;
    const gap = (cw / vals.length);
    const grid = getVar("--line"), muted = getVar("--muted"), brand = getVar("--brand"), brand4 = getVar("--brand-400");

    // Empty state — a flat baseline + message beats a garbled axis when there's no data.
    if (Math.max(0, ...vals) <= 0) {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ch); ctx.lineTo(w - pad.r, pad.t + ch); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = "center";
      ctx.font = "12px Inter, sans-serif"; ctx.fillText("No sales yet", w / 2, pad.t + ch / 2);
      ctx.font = "11px Inter, sans-serif";
      vals.forEach((_, i) => { const bx = pad.l + gap * i + (gap - bw) / 2; ctx.fillText(labels[i], bx + bw / 2, h - 8); });
      return;
    }

    let t = 0;
    function frame() {
      t = Math.min(t + 0.05, 1); const ease = 1 - Math.pow(1 - t, 3);
      ctx.clearRect(0, 0, w, h);
      ctx.font = "11px Inter, sans-serif"; ctx.fillStyle = muted; ctx.textAlign = "right";
      for (let g = 0; g <= 4; g++) {
        const gy = pad.t + (ch * g) / 4;
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
        ctx.fillText(KG.fmt.moneyShort(max - (max * g) / 4), pad.l - 8, gy + 4);
      }
      ctx.textAlign = "center";
      vals.forEach((v, i) => {
        const bh = ((v / max) * ch) * ease;
        const bx = pad.l + gap * i + (gap - bw) / 2;
        const by = pad.t + ch - bh;
        const grad = ctx.createLinearGradient(0, by, 0, pad.t + ch);
        grad.addColorStop(0, brand4); grad.addColorStop(1, brand);
        ctx.fillStyle = grad;
        roundRect(ctx, bx, by, bw, bh, 6); ctx.fill();
        ctx.fillStyle = muted;
        ctx.fillText(labels[i], bx + bw / 2, h - 8);
      });
      if (t < 1) requestAnimationFrame(frame);
    }
    frame();
  }

  function sparkline(canvas, values, color) {
    const h = 46; const { ctx, w } = setupCanvas(canvas, h);
    const max = Math.max(...values), min = Math.min(...values);
    const x = (i) => (w * i) / (values.length - 1);
    const y = (v) => h - 6 - ((v - min) / (max - min || 1)) * (h - 12);
    ctx.beginPath();
    values.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
    ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.lineJoin = "round"; ctx.stroke();
    ctx.lineTo(x(values.length - 1), h); ctx.lineTo(0, h); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + "55"); grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad; ctx.fill();
  }

  function donutChart(canvas, segments) {
    const h = 200; const { ctx, w } = setupCanvas(canvas, h);
    const cx = w / 2, cy = h / 2, r = 76, sw = 24;
    const total = segments.reduce((s, x) => s + x.value, 0);
    if (!total) { // empty state — draw a neutral ring with "No data"
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = getVar("--line"); ctx.lineWidth = sw; ctx.stroke();
      ctx.fillStyle = getVar("--muted"); ctx.textAlign = "center"; ctx.font = "12px Inter";
      ctx.fillText("No data yet", cx, cy + 4);
      return;
    }
    let t = 0;
    function frame() {
      t = Math.min(t + 0.04, 1); const ease = 1 - Math.pow(1 - t, 3);
      ctx.clearRect(0, 0, w, h);
      let ang = -Math.PI / 2;
      segments.forEach(seg => {
        const slice = (seg.value / total) * Math.PI * 2 * ease;
        ctx.beginPath(); ctx.arc(cx, cy, r, ang, ang + slice);
        ctx.strokeStyle = seg.color; ctx.lineWidth = sw; ctx.lineCap = "round"; ctx.stroke();
        ang += slice;
      });
      ctx.fillStyle = getVar("--ink"); ctx.textAlign = "center"; ctx.font = "700 24px Sora, sans-serif";
      ctx.fillText(KG.fmt.moneyShort(total), cx, cy);
      ctx.fillStyle = getVar("--muted"); ctx.font = "11px Inter"; ctx.fillText("Total units", cx, cy + 18);
      if (t < 1) requestAnimationFrame(frame);
    }
    frame();
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (h < r) r = h;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, 0);
    ctx.arcTo(x, y + h, x, y, 0);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.KGCharts = { lineChart, barChart, sparkline, donutChart, drawRing };

  /* -----------------------------------------------------------------------
     8. MODALS
  ----------------------------------------------------------------------- */
  function openModal(id) { const m = $(id); if (m) { m.classList.add("open"); document.body.style.overflow = "hidden"; } }
  function closeModal(m) { m.classList.remove("open"); document.body.style.overflow = ""; }
  function wireModals() {
    $$("[data-modal-open]").forEach(b => b.addEventListener("click", () => openModal(b.dataset.modalOpen)));
    $$(".modal-overlay").forEach(ov => {
      ov.addEventListener("click", e => { if (e.target === ov) closeModal(ov); });
      $$("[data-modal-close]", ov).forEach(b => b.addEventListener("click", () => closeModal(ov)));
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") $$(".modal-overlay.open").forEach(closeModal); });
  }
  window.kgModal = { open: openModal, close: closeModal };

  /* -----------------------------------------------------------------------
     9. TOASTS
  ----------------------------------------------------------------------- */
  function toast(type, title, msg) {
    let wrap = $(".toast-wrap");
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "toast-wrap"; document.body.appendChild(wrap); }
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="t-ico">${icon(type === "error" ? "x" : type === "info" ? "bell" : "check")}</div>
      <div class="grow"><div class="t-title">${title}</div><div class="t-msg">${msg||""}</div></div>`;
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); }, 3800);
  }
  window.toast = toast;

  /* -----------------------------------------------------------------------
     10. TABLE: sort + paginate + filter (generic)
  ----------------------------------------------------------------------- */
  function initTable(config) {
    const { tbody, rows, render, perPage = 8, mount } = config;
    let data = rows.slice(), page = 1, sortKey = null, sortDir = 1, filter = () => true;

    function draw() {
      const filtered = data.filter(filter);
      const pages = Math.max(1, Math.ceil(filtered.length / perPage));
      page = Math.min(page, pages);
      const slice = filtered.slice((page - 1) * perPage, page * perPage);
      tbody.innerHTML = slice.map(render).join("") || `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted)">No results found</td></tr>`;
      animateBars(tbody);
      drawPager(filtered.length, pages);
      config.onDraw && config.onDraw();
    }
    function drawPager(total, pages) {
      const pager = $(config.pager);
      if (!pager) return;
      let btns = "";
      for (let i = 1; i <= pages; i++) btns += `<button class="page-btn ${i === page ? "on" : ""}" data-page="${i}">${i}</button>`;
      pager.innerHTML = `
        <span class="muted" style="font-size:13px">Showing ${Math.min((page-1)*perPage+1,total)}–${Math.min(page*perPage,total)} of ${total}</span>
        <div class="pages">
          <button class="page-btn" data-page="prev" ${page===1?"disabled":""}>‹</button>
          ${btns}
          <button class="page-btn" data-page="next" ${page===pages?"disabled":""}>›</button>
        </div>`;
      $$(".page-btn", pager).forEach(b => b.addEventListener("click", () => {
        const v = b.dataset.page;
        if (v === "prev") page--; else if (v === "next") page++; else page = +v;
        draw();
      }));
    }
    // sorting
    if (config.sortable) {
      $$("th.sortable", mount).forEach(th => th.addEventListener("click", () => {
        const key = th.dataset.key;
        sortDir = sortKey === key ? -sortDir : 1;
        sortKey = key;
        $$("th.sortable", mount).forEach(t => t.classList.remove("asc", "desc"));
        th.classList.add(sortDir === 1 ? "asc" : "desc");
        data.sort((a, b) => {
          const av = a[key], bv = b[key];
          return (typeof av === "number" ? av - bv : String(av).localeCompare(String(bv))) * sortDir;
        });
        page = 1; draw();
      }));
    }
    // expose filter setter
    config.setFilter = (fn) => { filter = fn; page = 1; draw(); };
    config.setSearch = (q) => { const s = q.toLowerCase(); filter = (r) => JSON.stringify(r).toLowerCase().includes(s); page = 1; draw(); };
    draw();
    return config;
  }
  window.KGTable = initTable;

  /* -----------------------------------------------------------------------
     11. SCROLL REVEAL
  ----------------------------------------------------------------------- */
  function initReveal() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.08 });
    $$(".reveal").forEach(el => io.observe(el));
  }
  window.initReveal = initReveal;

  /* -----------------------------------------------------------------------
     12. PRELOADER
  ----------------------------------------------------------------------- */
  function hidePreloader() {
    const p = $(".preloader");
    if (p) setTimeout(() => p.classList.add("done"), 550);
  }

  /* -----------------------------------------------------------------------
     13. BOOT
  ----------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    // --- Auth guard: protected pages require a session (when the API is live) ---
    if (document.body.hasAttribute("data-app") && window.KGAuth) {
      const ok = await window.KGAuth.requireSession("login.html");
      if (!ok) return; // redirected to login

      // --- Role guard: keep salespersons out of admin-only pages & vice versa ---
      const role = await window.KGAuth.role();
      window.KG_ROLE = role;
      if (role === "relation_client") {
        const allowedPage = ["clients", "settings", "formation", "challenges", "ranking"].includes(document.body.dataset.page);
        if (document.body.hasAttribute("data-admin-only") || document.body.hasAttribute("data-salesperson-only") || !allowedPage) {
          window.location.replace("clients.html"); return;
        }
      }
      if (document.body.hasAttribute("data-admin-only") && role !== "admin") {
        window.location.replace("salesperson.html"); return;
      }
      if (document.body.hasAttribute("data-salesperson-only") && role !== "salesperson") {
        window.location.replace("dashboard.html"); return;
      }
      // Un charge de relation client n'a pas de tableau de bord commercial :
      // sa page d'accueil naturelle est le portefeuille client.
    }
    // --- Hydrate window.KG with live DB rows when the API is reachable ---
    if (window.KGData) { try { await window.KGData.hydrate(); } catch (e) { console.warn(e); } }

    // Derive notifications from real activity; mark the current section as seen
    buildNotifications();
    if (document.body.dataset.page === "challenges") setSeen("chal", (window.KG.challenges || []).length);

    buildLayout();
    wireModals();
    // Draw rings
    $$("[data-ring]").forEach(drawRing);
    window.addEventListener("kg:redraw", () => $$("[data-ring]").forEach(drawRing));
    // Run page-specific hook if present (may be async)
    if (typeof window.KGPage === "function") await window.KGPage({ icon, avatar, toast, KGCharts: window.KGCharts, KGTable: initTable });
    animateCounters();
    animateBars();
    initReveal();
    hidePreloader();
  });

  // Re-fit canvases on resize (debounced) → let page re-run its chart draws
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => window.dispatchEvent(new Event("kg:redraw")), 200); });
})();
