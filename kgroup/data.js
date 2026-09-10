/* =========================================================================
   KGROUP SALES PERFORMANCE PLATFORM — Sample Data
   All demo data lives here. Replace with real API calls later.
   Exposed globally as `KG` (window.KG).
   ========================================================================= */
(function () {
  "use strict";

  // ---- Helpers -----------------------------------------------------------
  const money = (n) => n; // stored raw; formatted in UI
  const firstNames = ["Amine","Sofia","Youssef","Lina","Karim","Nadia","Omar","Salma","Rachid","Imane","Hicham","Meryem","Anas","Ghita","Yassine","Sara","Bilal","Aya","Zakaria","Hajar"];
  const lastNames  = ["El Amrani","Benali","Bouchra","Cherkaoui","Idrissi","Lahlou","Fassi","Alaoui","Bennani","Tazi","Sabri","Rami","Ouazzani","Chraibi","Belhaj"];
  const cities = ["Casablanca","Rabat","Marrakech","Tangier","Fès","Agadir","Meknès","Oujda"];

  // Deterministic pseudo-random so the demo is stable across reloads
  let seed = 20260701;
  function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;

  // Contract-defined catalogue (KGroup Parfumery — Art. 2 & 3).
  // Price is the "Prix de Vente"; commission is what the Commercial earns per sale.
  const products = [
    { id: "P30",  name: "Parfum 30 ml",  price: 50,  commission: 5,  cat: "30 ml" },
    { id: "P50",  name: "Parfum 50 ml",  price: 80,  commission: 8,  cat: "50 ml" },
    { id: "P100", name: "Parfum 100 ml", price: 150, commission: 15, cat: "100 ml" },
  ];

  // Contract reference data — commissions, monthly bonus ladder, payment terms.
  const contract = {
    company: "KGroup Parfumery",
    representedBy: "Bénédicte Kashala",
    phone: "06 96 97 56 99",
    tagline: "La senteur du luxe",
    currency: "DHS",
    // Art. 4 — monthly performance bonuses (validated sales in the month)
    bonuses: [
      { sales: 20, bonus: 100, extra: "Code promo" },
      { sales: 40, bonus: 300, extra: "Parfum offert" },
      { sales: 60, bonus: 600, extra: "Parfums offerts" },
    ],
    payments: ["Espèces", "Virement", "Mobile Money"], // Art. 5
    noticeDays: 7, // Art. 8
  };

  const badgeCatalog = [
    { key: "starter",  emoji: "🌱", name: "First Sale", desc: "Closed 1st sale" },
    { key: "closer",   emoji: "🔥", name: "Closer",     desc: "50 sales" },
    { key: "elite",    emoji: "💎", name: "Elite",      desc: "Top 3 month" },
    { key: "streak",   emoji: "⚡", name: "On Fire",    desc: "7-day streak" },
    { key: "revenue",  emoji: "👑", name: "Rainmaker",  desc: "100k revenue" },
    { key: "mentor",   emoji: "🎓", name: "Mentor",     desc: "Trained a rookie" },
  ];

  // ---- Salespersons ------------------------------------------------------
  const levels = ["Rookie","Bronze","Silver","Gold","Platinum","Diamond"];
  const salespersons = [];
  for (let i = 0; i < 24; i++) {
    const fn = pick(firstNames), ln = pick(lastNames);
    const sales = between(38, 340);
    const revenue = sales * between(60, 140);      // realistic avg basket in DHS
    const commission = Math.round(sales * between(7, 12));
    const xp = between(400, 9800);
    const lvlIndex = Math.min(levels.length - 1, Math.floor(xp / 1700));
    salespersons.push({
      id: "S" + String(i + 1).padStart(2, "0"),
      name: `${fn} ${ln}`,
      initials: (fn[0] + ln[0]).toUpperCase(),
      city: pick(cities),
      phone: "+212 6" + between(10, 99) + " " + between(100, 999) + " " + between(100, 999),
      email: `${fn}.${ln.split(" ").join("").toLowerCase()}@kgroup.ma`,
      sales,
      todaySales: between(0, 9),
      revenue,
      commission,
      status: rnd() > 0.18 ? "Active" : "Inactive",
      level: levels[lvlIndex],
      xp,
      xpToNext: (lvlIndex + 1) * 1700,
      target: between(180, 320),
      badges: badgeCatalog.filter(() => rnd() > 0.45).map(b => b.key),
      hue: between(0, 359),
    });
  }
  // Sort by revenue → assign ranking
  salespersons.sort((a, b) => b.revenue - a.revenue);
  salespersons.forEach((s, i) => { s.rank = i + 1; });

  // ---- The signed-in salesperson (for salesperson dashboard) -------------
  const me = salespersons[3]; // arbitrary "logged in" rep

  // ---- Recent sales ------------------------------------------------------
  const customers = ["Yasmine T.","Reda M.","Sami B.","Lucas P.","Fatima Z.","Nour A.","Adam K.","Selma R.","Walid H.","Ines D."];
  const payMethods = contract.payments; // Espèces / Virement / Mobile Money (Art. 5)
  const recentSales = [];
  for (let i = 0; i < 40; i++) {
    const p = pick(products);
    const qty = between(1, 3);
    const rep = pick(salespersons);
    recentSales.push({
      id: "TX" + (10480 - i),
      customer: pick(customers),
      product: p.name,
      qty,
      amount: p.price * qty,
      pay: pick(payMethods),
      rep: rep.name,
      repInitials: rep.initials,
      hue: rep.hue,
      minsAgo: (i + 1) * between(4, 18),
    });
  }

  // ---- Time series (chart data) -----------------------------------------
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const salesSeries = months.map((m, i) => between(120 + i * 8, 240 + i * 12));
  const revenueSeries = salesSeries.map(v => v * between(1100, 1450));
  const weekDays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const weekSeries = weekDays.map(() => between(18, 64));
  const targetSeries = months.map((m, i) => 180 + i * 10);

  // ---- Challenges --------------------------------------------------------
  const challenges = [
    { id:"C1", icon:"🏆", hue:"var(--brand)", title:"Summer Sprint", desc:"Hit 250 units before the season closes and unlock the grand bonus.",
      reward:"15 000 DHS + Diamond badge", current:187, target:250, participants:14, daysLeft:9, hrsLeft:14 },
    { id:"C2", icon:"💎", hue:"#7C3AED", title:"Oud Royal Push", desc:"Sell the most Oud Royal — our top signature line — this month.",
      reward:"Weekend in Marrakech", current:64, target:100, participants:9, daysLeft:16, hrsLeft:3 },
    { id:"C3", icon:"⚡", hue:"#2563EB", title:"Speed Closer", desc:"Close 20 sales in a single week to prove you're the fastest rep.",
      reward:"Premium gift set", current:12, target:20, participants:21, daysLeft:4, hrsLeft:8 },
    { id:"C4", icon:"🌟", hue:"#D89A28", title:"Newcomer Rise", desc:"Rookies only — climb from level Bronze to Gold this quarter.",
      reward:"1 000 DHS voucher", current:2, target:4, participants:6, daysLeft:38, hrsLeft:0 },
    { id:"C5", icon:"🤝", hue:"#16965E", title:"Team Titans", desc:"Collective goal: the whole floor pushes 800 units together.",
      reward:"Team dinner + bonus pool", current:612, target:800, participants:24, daysLeft:11, hrsLeft:20 },
    { id:"C6", icon:"🎯", hue:"#E24C4B", title:"Precision Upsell", desc:"Average basket above 1 800 DHS across 15 sales.",
      reward:"Elite badge + spotlight", current:9, target:15, participants:11, daysLeft:6, hrsLeft:12 },
  ];

  // ---- Notifications -----------------------------------------------------
  // No prefilled notifications — they are derived at runtime from real
  // activity (recent sales + challenges) in dashboard.js → buildNotifications().
  const notifications = [];

  // ---- Activity feed -----------------------------------------------------
  const activity = [
    { icon:"bag",    title:"Closed a sale — Émeraude Noire", time:"12 minutes ago" },
    { icon:"trophy", title:"Earned the “On Fire” badge ⚡", time:"1 hour ago" },
    { icon:"star",   title:"Reached 75% of monthly target", time:"3 hours ago" },
    { icon:"users",  title:"Overtook 2 reps in the ranking", time:"Yesterday" },
    { icon:"chart",  title:"Best day this week — 9 sales", time:"Yesterday" },
  ];

  // ---- Aggregate KPIs ----------------------------------------------------
  const totalSales = salespersons.reduce((s, x) => s + x.sales, 0);
  const totalRevenue = salespersons.reduce((s, x) => s + x.revenue, 0);
  const totalCommission = salespersons.reduce((s, x) => s + (x.commission || 0), 0);
  const activeReps = salespersons.filter(s => s.status === "Active").length;

  // ---- Expose ------------------------------------------------------------
  window.KG = {
    products, badgeCatalog, salespersons, me, recentSales, challenges, contract,
    notifications, activity, cities, payMethods,
    series: { months, salesSeries, revenueSeries, weekDays, weekSeries, targetSeries },
    kpis: {
      totalSales, totalRevenue, totalCommission, activeReps, challengeCount: challenges.length,
    },
    fmt: {
      money: (n) => new Intl.NumberFormat("fr-MA").format(Math.round(n)) + " DHS",
      moneyShort: (n) => n >= 1e6 ? (n/1e6).toFixed(2)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"K" : String(Math.round(n)),
      num: (n) => new Intl.NumberFormat("fr-MA").format(Math.round(n)),
    },
  };
})();
