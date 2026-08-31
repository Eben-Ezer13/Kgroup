# KGROUP SALES PERFORMANCE PLATFORM

A premium, responsive sales-team management dashboard for **KGROUP PARFUMERY** —
frontend in **pure HTML5, CSS3 and Vanilla JavaScript** (no frameworks, no bundler),
backed by a small **Express API on Neon PostgreSQL**.

> Design language: Stripe × Notion × Linear × Apple — white + emerald `#0B7A4B`,
> glassmorphism, soft shadows, smooth animations.

## ▶️ Run it

**Preview the UI** — open `login.html` in a browser. With no API reachable the app
runs on the sample data in `data.js`, exactly as before.

**Run it for real** — needs Node 18+ and a Neon database:

```bash
npm install
cp .env.example .env      # add DATABASE_URL + JWT_SECRET
npm run db:migrate        # create the schema on Neon
npm start                 # http://localhost:3000/login.html
```

Full runbook: [`MIGRATION-NEON.md`](MIGRATION-NEON.md).

```
kgroup-platform/
├── index.html          # entry → redirects to login
├── login.html          # split-screen auth (brand hero + form)
├── register.html       # invite acceptance (salespersons)
├── reset-password.html # set a new password from an emailed link
├── dashboard.html      # Administrator dashboard
├── salesperson.html    # Salesperson (gamified) dashboard
├── salespersons.html   # Team management table
├── sales.html          # Sale registration form
├── ranking.html        # Rankings + animated podium
├── challenges.html     # Challenges + rewards + leaderboard
├── formation.html      # Sales training: lessons, quizzes, badges
├── training-content.js # Training material (Jour 1 & Jour 2)
├── training.css        # Styles for the training section
├── clients.html        # CRM: portefeuille client + anniversaires
├── remuneration.html   # Admin: commissions, bonus, cloture mensuelle
├── crm.css             # Styles CRM + remuneration
├── reports.html        # Analytics, charts, exports, print
├── style.css           # Full design system (tokens, glass, dark mode, responsive)
├── data.js             # Sample data (window.KG) — used when no API is reachable
├── api.js              # Browser client: KGAuth, KGDB, KGData.hydrate()
├── dashboard.js        # App engine: layout, charts, counters, modals, toasts, tables
├── server/             # Express API — the only holder of DATABASE_URL
│   ├── app.js          #   routes, CORS, static allow-list, error handling
│   ├── db.js           #   Neon connection pool (pg)
│   ├── auth.js         #   bcrypt + JWT sessions (replaces Supabase Auth)
│   ├── policies.js     #   the RLS rules, enforced server-side
│   ├── crm.js          #   phone / birthdays / WhatsApp / compensation
│   └── routes/         #   auth, data, training, clients, payroll, reminders
├── db/schema.sql       # Neon schema: tables, FKs, indexes, functions, triggers
├── scripts/            # migrate, check, smoke-test, import, lint, build
├── tests/              # 70 tests — run with `npm test`
├── netlify/functions/  # the same Express app, as a Netlify Function
├── legacy/             # retired Supabase files, kept for reference only
└── assets/{images,icons}
```

## ✨ Features

- **Reusable shell** — the sidebar + topbar are injected from `dashboard.js`
  onto any page marked `<body data-app data-page="…">`. Zero markup duplication.
- **Canvas charts** — animated line, bar, donut & sparkline charts drawn from
  scratch (no chart library).
- **Gamification** — levels, XP bars, badges, circular target rings, podium.
- **Dark mode** — persisted, palette-aware (charts redraw on toggle).
- **Bilingual (EN / FR)** — language switch in the top bar (`data-i18n`), persisted;
  covers the nav, top bar, and page headers. Extend `DICT` in `dashboard.js` to add
  languages or strings.
- **Live, real data** — when the API is configured, the sales-performance charts,
  KPIs, Top 10 and monthly-target are all derived from actual admin-entered sales
  (12-month + weekly series built in `hydrate()`), with empty states when there's
  nothing yet. No prebuilt numbers.
- **Interactivity** — animated counters, sortable/filterable/paginated tables,
  live search, modals, toasts, notification dropdown, collapsible sidebar.
- **Fully responsive** — desktop → tablet → mobile with an off-canvas sidebar.
- **CRM clients** — chaque vente rattache automatiquement un client par son
  numero de telephone (normalise, unique par equipe : aucun doublon). Fiche
  client avec historique d'achats, total depense et commercial responsable.
- **Anniversaires** — detection J-1 et jour J en heure **Africa/Casablanca**
  (29 fevrier gere), rappels automatiques horaires et **idempotents**, et un
  bouton **WhatsApp** qui pre-remplit un message personnalise sans jamais
  l'envoyer.
- **Remuneration** — salaire fixe + commissions (Art. 3) + bonus mensuel
  (Art. 4), calcule depuis les ventes reelles et remis a jour a chaque vente.
  Vue commerciale, vue administrateur, historique, et cloture mensuelle qui
  **fige** les montants avec les parametres en vigueur.
- **Formation commerciale** — the two Kgroup training days (univers olfactif,
  stratégie de vente) as readable lessons, each closed by a quiz. Quizzes are
  **graded server-side**, so the browser never sees the answer key and a score
  cannot be forged. Passing awards a badge (👃 Expert Olfactif, 💼 Vendeur
  Confirmé, 🏅 Diplômé Kgroup) and notifies the team's administrators, who get a
  per-member progress table on the same page.

## 🔐 Two modes

**Demo mode** — works instantly, no setup. Open the HTML directly, or run without a
database: any credentials log in and data comes from `data.js`. Great for
previewing the UI.

**Real accounts (Neon)** — genuine authentication and a cloud database with
**two roles**:

- **Admins** self-register on `login.html` and own a team.
- **Salespersons** join through a single-use **invite link** an admin generates in
  the Salespersons page (`register.html?invite=CODE`); their login is bound to that
  team. They see only their own dashboard, and admin-only pages are hidden + blocked.

Role-based routing, navigation, and page guards are enforced in the browser, and
the same rules are enforced again server-side in
[`server/policies.js`](server/policies.js) — which is where the old Row Level
Security policies now live. Every registered sale rolls up **live** via a database
trigger (`apply_sale()`): the rep's units, revenue, XP, level and badges update,
and because rankings derive from revenue, the leaderboards move too.

## 🔌 Data architecture

```
Frontend (HTML/CSS/JS)
      |  fetch('/api/...') + httpOnly session cookie
      v
Express API (server/)        <-- the only holder of DATABASE_URL
      |  parameterised SQL (pg)
      v
Neon PostgreSQL
```

- `data.js` → `window.KG` holds the sample data and app config.
- `api.js` → auth (`KGAuth`), database API (`KGDB`), and `KGData.hydrate()` which
  overlays live DB rows onto `window.KG` before each page renders — so the page
  code never changed, it just reads live data when the API is reachable.
- `server/` → the API. It holds the connection string; the browser never sees it.

Why an API layer at all: a Supabase anon key is meant to be public, with the
database enforcing access through RLS. A Neon `DATABASE_URL` is a database
password, so it can only live on a server. See
[`MIGRATION-NEON.md`](MIGRATION-NEON.md) §1.

## 🧪 Checks

```bash
npm run lint      # syntax, secret scan, no stale Supabase wiring
npm run build     # page wiring, asset resolution, server modules load
npm test          # 70 tests: routes, auth, permissions, quiz, CRM, remuneration
npm run e2e:crm   # parcours CRM complet contre Neon (serveur demarre)
npm run db:check  # schema + row counts on Neon
npm run db:smoke  # CRUD, constraints, transactions, triggers on Neon
```

## 🚀 Deploy

**Netlify** (current setup) — `netlify.toml` publishes the site and routes
`/api/*` to the Express app as a function. Set `DATABASE_URL`, `JWT_SECRET` and
`APP_URL` in **Project configuration → Environment variables**.

**Any Node host** (Render, Railway, Fly, a VPS) — `npm start` serves the API and
the pages on one origin. Same variables, plus `NODE_ENV=production`.

Deployment details, including hosting the API separately from the pages, are in
[`MIGRATION-NEON.md`](MIGRATION-NEON.md) §8.
