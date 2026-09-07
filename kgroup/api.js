/* =========================================================================
   KGROUP SALES PERFORMANCE PLATFORM — API client  (Neon PostgreSQL)
   -------------------------------------------------------------------------
   Replaces supabase.js. Same job, same public surface, different backend:

     before :  browser  ->  Supabase PostgREST/GoTrue  ->  Supabase Postgres
     now    :  browser  ->  this project's /api        ->  Neon PostgreSQL

   Why the extra hop: a Supabase anon key is designed to be published, with Row
   Level Security enforcing access in the database. A Neon DATABASE_URL is a
   database password — it can never reach the browser. So the API server holds
   it, and enforces the very same rules the RLS policies used to (see
   server/policies.js).

   The demo fallback is unchanged: when no API is reachable, every method
   returns the same "use the local data" signal it did before, and the pages
   keep rendering the sample data from data.js.

   Exposes: window.KGAuth, window.KGDB, window.KGData, window.KGTraining,
            window.KGClients, window.KGPayroll,
            window.KG_API_READY, window.KG_API_CONFIGURED, window.KG_ROLE
   ========================================================================= */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. CONFIG                                                           *
   * -------------------------------------------------------------------
   * There is nothing secret to configure here any more — the connection
   * string lives in the server's environment. All the browser needs is where
   * the API is. Same-origin ("/api") covers both `npm start` and the Netlify
   * deployment; set window.KG_API_URL before this script only when the API is
   * hosted somewhere else.
   * ------------------------------------------------------------------ */
  const CONFIG = {
    apiUrl:
      (typeof window.KG_API_URL === "string" && window.KG_API_URL) ||
      (location.protocol === "http:" || location.protocol === "https:" ? "/api" : ""),
  };

  const TOKEN_KEY = "kg-access-token";
  const DEMO_KEY = "kg-demo-session";

  /* Optimistic: assume the API is there when we have a URL for it, so pages can
     read window.KG_API_CONFIGURED immediately. The health probe below corrects
     this to `false` if nothing answers, which drops the app into demo mode
     exactly as unconfigured Supabase keys used to. */
  let IS_CONFIGURED = Boolean(CONFIG.apiUrl);

  const url = (path) => CONFIG.apiUrl + path;

  /* ------------------------------------------------------------------ *
   * 2. TRANSPORT                                                        *
   * -------------------------------------------------------------------
   * The session is an httpOnly cookie, which page scripts cannot read. The
   * Bearer token is a fallback for deployments where the API sits on another
   * origin and the browser refuses third-party cookies.
   * ------------------------------------------------------------------ */
  const token = {
    get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch (_) { return null; } },
    set: (v) => { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch (_) {} },
  };

  async function request(path, options) {
    const opts = options || {};
    const headers = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const t = token.get();
    if (t) headers.Authorization = "Bearer " + t;

    const res = await fetch(url(path), {
      method: opts.method || "GET",
      credentials: "include",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    let payload = null;
    if (text) { try { payload = JSON.parse(text); } catch (_) { payload = null; } }

    if (!res.ok) {
      // Surface the server's message so the existing toasts and inline error
      // slots read the same as they did with Supabase's error.message.
      const err = new Error((payload && payload.error) || "Request failed (" + res.status + ").");
      err.status = res.status;
      throw err;
    }
    return payload;
  }

  /* One health probe per page load. Everything else awaits it, so a missing or
     sleeping backend degrades to demo mode instead of throwing at the user. */
  let _ready = null;
  function ready() {
    if (_ready) return _ready;
    if (!CONFIG.apiUrl) {
      IS_CONFIGURED = false;
      window.KG_API_CONFIGURED = false;
      _ready = Promise.resolve(false);
      return _ready;
    }
    _ready = fetch(url("/health"), { credentials: "include" })
      .then((r) => r.ok)
      .catch(() => false)
      .then((ok) => {
        IS_CONFIGURED = ok;
        window.KG_API_CONFIGURED = ok;
        if (!ok) console.warn("[KG] API unreachable — running on the demo data in data.js.");
        return ok;
      });
    return _ready;
  }

  /* ------------------------------------------------------------------ *
   * 3. AUTH                                                             *
   * ------------------------------------------------------------------ */
  const KGAuth = {
    get configured() { return IS_CONFIGURED; },

    /** Resolves once the API has been probed. Pages that branch on
        window.KG_API_CONFIGURED at parse time should await this first. */
    ready,

    /* opts: { role: 'admin'|'salesperson', inviteCode: string } */
    async signUp(email, password, fullName, opts) {
      opts = opts || {};
      if (!(await ready())) { localStorage.setItem(DEMO_KEY, email); return { demo: true }; }
      const data = await request("/auth/signup", {
        method: "POST",
        body: {
          email, password,
          full_name: fullName,
          role: opts.role,
          invite_code: opts.inviteCode,
        },
      });
      if (data.session) token.set(data.session.access_token);
      this._user = data.user || null;
      this._profile = null;
      return data; // { user, session } — callers test `user && !session`
    },

    async signIn(email, password) {
      if (!(await ready())) { localStorage.setItem(DEMO_KEY, email); return { demo: true }; }
      const data = await request("/auth/signin", { method: "POST", body: { email, password } });
      if (data.session) token.set(data.session.access_token);
      this._user = data.user || null;
      this._profile = null;
      return data;
    },

    async signInWithGoogle() {
      if (!(await ready())) { localStorage.setItem(DEMO_KEY, "google-demo"); return { demo: true }; }
      // Check first so an unconfigured provider produces a readable message
      // instead of a redirect to a JSON error page.
      const status = await request("/auth/google/status");
      if (!status || !status.configured) {
        throw new Error("Google sign-in is not configured on this deployment.");
      }
      window.location.href = url("/auth/google") + "?next=" + encodeURIComponent("dashboard.html");
    },

    async resetPassword(email) {
      if (!(await ready())) return { demo: true };
      return request("/auth/reset", { method: "POST", body: { email } });
    },

    /* Completes a reset started from the emailed link (reset-password.html). */
    async confirmPasswordReset(resetToken, newPassword) {
      if (!(await ready())) return { demo: true };
      return request("/auth/reset/confirm", { method: "POST", body: { token: resetToken, password: newPassword } });
    },

    async signOut() {
      localStorage.removeItem(DEMO_KEY);
      this._profile = null;
      this._user = null;
      token.set(null);
      if (await ready()) {
        try { await request("/auth/signout", { method: "POST" }); } catch (_) { /* already gone */ }
      }
    },

    /* Update the signed-in user's password (Settings → Security). */
    async updatePassword(newPassword) {
      if (!(await ready())) return { demo: true };
      return request("/auth/password", { method: "POST", body: { password: newPassword } });
    },

    /* Returns the current auth user (or a demo stub), else null.
       Cached per page load: Supabase read this from localStorage, so the
       original callers assumed it was cheap to call repeatedly. */
    _user: undefined,
    async user(force) {
      if (!(await ready())) {
        const e = localStorage.getItem(DEMO_KEY);
        return e ? { email: e, user_metadata: { full_name: "Demo Admin" } } : null;
      }
      if (this._user !== undefined && !force) return this._user;
      try {
        const data = await request("/auth/user");
        this._user = (data && data.user) || null;
      } catch (_) {
        this._user = null;
      }
      return this._user;
    },

    /* Current user's profile row (cached). Demo mode returns an admin stub. */
    _profile: null,
    async profile(force) {
      if (!(await ready())) return { role: "admin", full_name: "Demo Admin" };
      if (this._profile && !force) return this._profile;
      const u = await this.user();
      if (!u) return null;
      try {
        this._profile = await request("/profile");
      } catch (_) {
        this._profile = null;
      }
      return this._profile;
    },

    async role() { const p = await this.profile(); return (p && p.role) || "admin"; },

    /* Where a given role should land after login. */
    homeForRole(role) { return role === "salesperson" ? "salesperson.html" : "dashboard.html"; },

    /* Look up who an invite is for (works before sign-up). */
    async inviteInfo(code) {
      if (!(await ready()) || !code) return null;
      try {
        const data = await request("/auth/invite?code=" + encodeURIComponent(code));
        return (data && data.invite) || null;
      } catch (_) {
        return null;
      }
    },

    /* Page guard. Redirects to login when no session (real mode only). */
    async requireSession(redirect) {
      const u = await this.user();
      if (!u) { window.location.replace(redirect || "login.html"); return false; }
      return true;
    },

    /* If already logged in, bounce away from the login page. */
    async redirectIfAuthed(to) {
      const u = await this.user();
      if (u) { window.location.replace(to || "dashboard.html"); return true; }
      return false;
    },
  };

  /* ------------------------------------------------------------------ *
   * 4. DATABASE API (each method falls back to demo KG data)           *
   * ------------------------------------------------------------------ */
  const KGDB = {
    async listSalespersons() {
      if (!(await ready())) return null; // signal: use demo
      try {
        return await request("/salespersons");
      } catch (e) { console.warn(e); return null; }
    },

    async deleteSalesperson(id) {
      if (!(await ready())) return { demo: true };
      await request("/salespersons/" + encodeURIComponent(id), { method: "DELETE" });
      return { ok: true };
    },

    async addSalesperson(rep) {
      if (!(await ready())) {
        const code = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
          : Math.random().toString(36).slice(2, 14);
        return { demo: true, invite_code: "DEMO" + code.slice(0, 6).toUpperCase() };
      }
      // owner, team_id and the invite code are assigned server-side now — the
      // browser has no business choosing any of them.
      return request("/salespersons", { method: "POST", body: rep });
    },

    async updateSalesperson(id, fields) {
      if (!(await ready())) return { demo: true };
      return request("/salespersons/" + encodeURIComponent(id), { method: "PATCH", body: fields });
    },

    async listSales(limit) {
      if (!(await ready())) return null;
      try {
        return await request("/sales?limit=" + (limit || 40));
      } catch (e) { console.warn(e); return null; }
    },

    async addSale(sale) {
      if (!(await ready())) return { demo: true };
      return request("/sales", { method: "POST", body: sale });
    },

    async myProfile() {
      if (!(await ready())) return null;
      try { return await request("/profile"); } catch (_) { return null; }
    },

    /* Update the signed-in user's own profile (name, city, avatar hue). */
    async updateProfile(fields) {
      if (!(await ready())) return { demo: true };
      await request("/profile", { method: "PATCH", body: fields });
      KGAuth._profile = null; // bust cache so next read is fresh
      return { ok: true };
    },

    async listChallenges() {
      if (!(await ready())) return null;
      try { return await request("/challenges"); } catch (e) { console.warn(e); return null; }
    },

    async addChallenge(ch) {
      if (!(await ready())) return { demo: true };
      return request("/challenges", { method: "POST", body: ch });
    },
  };

  /* ------------------------------------------------------------------ *
   * 5. FORMATION                                                        *
   * -------------------------------------------------------------------
   * Les quiz sont corriges par le serveur : le navigateur envoie des choix,
   * jamais un score. En mode demo tout reste local, comme le reste de l app.
   * ------------------------------------------------------------------ */
  const KGTraining = {
    /* Progression, meilleurs scores et badges de l utilisateur courant. */
    async state() {
      if (!(await ready())) return null;   // signal : mode demo
      try { return await request("/training"); } catch (e) { console.warn(e); return null; }
    },

    /* Marque une lecon comme lue. Sans effet en mode demo. */
    async markLesson(lessonId) {
      if (!(await ready())) return { demo: true };
      return request("/training/lesson", { method: "POST", body: { lesson_id: lessonId } });
    },

    /* Les questions du quiz, sans les bonnes reponses. */
    async quiz(quizId) {
      if (!(await ready())) return null;
      return request("/training/quiz/" + encodeURIComponent(quizId));
    },

    /* Remet la copie et recupere la correction + les badges obtenus. */
    async submit(quizId, answers) {
      if (!(await ready())) return { demo: true };
      return request("/training/quiz/" + encodeURIComponent(quizId), {
        method: "POST", body: { answers },
      });
    },

    /* Vue administrateur : ou en est chaque membre de l equipe. */
    async team() {
      if (!(await ready())) return null;
      try { return await request("/training/team"); } catch (e) { console.warn(e); return null; }
    },

    /* Fil de notifications de l equipe (reussites de formation). */
    async notifications(limit) {
      if (!(await ready())) return null;
      try { return await request("/notifications?limit=" + (limit || 20)); }
      catch (e) { console.warn(e); return null; }
    },
  };

  /* ------------------------------------------------------------------ *
   * 6. CRM : CLIENTS, ANNIVERSAIRES, REMUNERATION                       *
   * -------------------------------------------------------------------
   * Le serveur renvoie deja les champs derives (numero formate, libelle de
   * l anniversaire, jours restants, lien WhatsApp) : une seule implementation
   * de ces regles, cote serveur, testee une seule fois.
   * ------------------------------------------------------------------ */
  const qs = (params) => {
    const u = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") u.set(k, v);
    });
    const s2 = u.toString();
    return s2 ? "?" + s2 : "";
  };

  const KGClients = {
    /* Liste filtrable. filters: { q, rep_id, birthday_month, has_birthday, limit } */
    async list(filters) {
      if (!(await ready())) return null;          // signal : mode demo
      try { return await request("/clients" + qs(filters)); }
      catch (e) { console.warn(e); return null; }
    },

    /* Recherche par numero — sert au preremplissage du formulaire de vente. */
    async lookupByPhone(phone) {
      if (!(await ready()) || !phone) return null;
      try {
        const d = await request("/clients/lookup" + qs({ phone }));
        return (d && d.client) || null;
      } catch (_) { return null; }
    },

    /* Fiche complete : { client, sales }. */
    async get(id) {
      if (!(await ready())) return null;
      return request("/clients/" + encodeURIComponent(id));
    },

    async create(fields) {
      if (!(await ready())) return { demo: true };
      return request("/clients", { method: "POST", body: fields });
    },

    async update(id, fields) {
      if (!(await ready())) return { demo: true };
      return request("/clients/" + encodeURIComponent(id), { method: "PATCH", body: fields });
    },

    /* Anniversaires : { todays, tomorrow, upcoming, today, timezone }. */
    async birthdays(days) {
      if (!(await ready())) return null;
      try { return await request("/birthdays" + qs({ days })); }
      catch (e) { console.warn(e); return null; }
    },

    /* Membres de l equipe (pour le filtre par commercial et les roles). */
    async members() {
      if (!(await ready())) return null;
      try { return await request("/team/members"); } catch (e) { console.warn(e); return null; }
    },

    async setRole(userId, role) {
      if (!(await ready())) return { demo: true };
      return request("/team/members/" + encodeURIComponent(userId) + "/role",
        { method: "PATCH", body: { role } });
    },
  };

  const KGPayroll = {
    /* Ma remuneration du mois. month: "YYYY-MM" (mois courant par defaut). */
    async mine(month) {
      if (!(await ready())) return null;
      try { return await request("/payroll" + qs({ month })); }
      catch (e) { console.warn(e); return null; }
    },

    /* Vue equipe + synthese (administrateur uniquement). */
    async team(month) {
      if (!(await ready())) return null;
      try { return await request("/payroll/team" + qs({ month })); }
      catch (e) { console.warn(e); return null; }
    },

    /* Evolution mensuelle. */
    async history(months) {
      if (!(await ready())) return null;
      try { return await request("/payroll/history" + qs({ months })); }
      catch (e) { console.warn(e); return null; }
    },

    /* Cloturer un mois (administrateur). status: CLOTURE | VALIDEE | PAYEE */
    async close(month, status) {
      if (!(await ready())) return { demo: true };
      return request("/payroll/close", { method: "POST", body: { month, status } });
    },

    async settings() {
      if (!(await ready())) return null;
      try { return await request("/compensation-settings"); }
      catch (e) { console.warn(e); return null; }
    },

    async saveSettings(fields) {
      if (!(await ready())) return { demo: true };
      return request("/compensation-settings", { method: "PUT", body: fields });
    },
  };

  /* ------------------------------------------------------------------ *
   * 7. HYDRATION — overlay real DB rows onto window.KG                  *
   *    Pages keep reading window.KG synchronously; this just swaps the *
   *    demo arrays for live data (when configured) before they render. *
   *    Unchanged from the Supabase version: same rows in, same shapes  *
   *    out — only the transport underneath is different.               *
   * ------------------------------------------------------------------ */
  const initialsOf = (name) => (name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  /* Roll real sales rows into the chart series the dashboard expects:
     last 12 months (units + revenue) and the current week (units/day).
     No prebuilt numbers — everything here comes from admin-entered sales. */
  function buildSeries(sales) {
    const now = new Date();
    const monthKeys = [], monthLabels = [], mUnits = {}, mRev = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = d.getFullYear() + "-" + d.getMonth();
      monthKeys.push(k); mUnits[k] = 0; mRev[k] = 0;
      monthLabels.push(d.toLocaleString("en-US", { month: "short" }));
    }
    const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const weekSeries = [0, 0, 0, 0, 0, 0, 0];
    const weekStart = new Date(now); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(now.getDate() - 6);
    (sales || []).forEach(s => {
      const d = new Date(s.created_at);
      const k = d.getFullYear() + "-" + d.getMonth();
      if (k in mUnits) { mUnits[k] += s.qty || 0; mRev[k] += Number(s.amount) || 0; }
      if (d >= weekStart) { const wd = (d.getDay() + 6) % 7; weekSeries[wd] += s.qty || 0; }
    });
    return {
      months: monthLabels,
      salesSeries: monthKeys.map(k => mUnits[k]),
      revenueSeries: monthKeys.map(k => mRev[k]),
      weekDays, weekSeries,
      targetSeries: monthKeys.map(() => 0),
    };
  }

  // Short "x min/h/days ago" label for the activity feed.
  function timeAgo(ts) {
    if (!ts) return "";
    const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return "Just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    const d = Math.floor(s / 86400);
    return d === 1 ? "Yesterday" : d + " days ago";
  }

  // Days/hours remaining until a challenge's end date (for the countdown UI).
  function daysHrsUntil(ends) {
    if (!ends) return { daysLeft: 0, hrsLeft: 0 };
    // A `date` column arrives as an ISO timestamp over JSON; keep just the day
    // part so the countdown matches the date the admin picked.
    const day = String(ends).slice(0, 10);
    let ms = new Date(day + "T23:59:59") - new Date();
    if (ms < 0) ms = 0;
    return { daysLeft: Math.floor(ms / 86400000), hrsLeft: Math.floor((ms % 86400000) / 3600000) };
  }

  // `bigint` columns (revenue, amount, commission) arrive as strings from pg,
  // because they can exceed Number.MAX_SAFE_INTEGER. This app's values are far
  // below that, so coercing is safe and keeps the arithmetic below unchanged.
  const num = (v) => (v == null ? 0 : Number(v) || 0);

  const KGData = {
    async hydrate() {
      const KG = window.KG;
      if (!KG) return;
      if (!(await ready())) return;                  // demo mode → keep data.js data
      try {
        const reps = await KGDB.listSalespersons();
        if (reps) {
          KG.salespersons = reps.map(r => ({
            id: r.id, name: r.name, initials: initialsOf(r.name),
            city: r.city || "—", phone: r.phone || "—", email: r.email || "",
            sales: r.sales || 0, todaySales: r.today_sales || 0, revenue: num(r.revenue),
            status: r.status || "Active", level: r.level || "Rookie",
            xp: r.xp || 0, xpToNext: r.xp_to_next || 1700, target: r.target || 200,
            commission: num(r.commission),
            invite_code: r.invite_code || null, claimed: !!r.claimed,
            badges: r.badges || [], hue: r.hue != null ? r.hue : 150,
          })).sort((a, b) => b.revenue - a.revenue);
          KG.salespersons.forEach((s, i) => s.rank = i + 1);

          // Recompute aggregate KPIs from live data
          KG.kpis.totalSales      = KG.salespersons.reduce((s, x) => s + x.sales, 0);
          KG.kpis.totalRevenue    = KG.salespersons.reduce((s, x) => s + x.revenue, 0);
          KG.kpis.totalCommission = KG.salespersons.reduce((s, x) => s + (x.commission || 0), 0);
          KG.kpis.activeReps      = KG.salespersons.filter(s => s.status === "Active").length;
        }

        // Admin-created challenges (team-scoped)
        const chs = await KGDB.listChallenges();
        if (chs) {
          KG.challenges = chs.map(c => {
            const { daysLeft, hrsLeft } = daysHrsUntil(c.ends);
            return {
              id: c.id, icon: c.icon || "🏆", hue: c.hue || "var(--brand)",
              title: c.title, desc: c.description || "", reward: c.reward || "—",
              current: c.current || 0, target: c.target || 100,
              participants: KG.salespersons.length, daysLeft, hrsLeft,
            };
          });
          KG.kpis.challengeCount = KG.challenges.length;
        }

        const sales = await KGDB.listSales(1000);
        if (sales) {
          KG.recentSales = sales.slice(0, 40).map((t) => ({
            id: t.id, customer: t.customer, product: t.product, qty: t.qty,
            amount: num(t.amount), pay: t.pay, rep: t.rep_name || "—",
            repInitials: initialsOf(t.rep_name), hue: 150,
            at: t.created_at, // real timestamp from the DB
          }));
          // Replace the prebuilt demo series with charts derived from real sales
          KG.series = Object.assign({}, KG.series, buildSeries(sales));
        }

        // Identify the signed-in user + expose their role
        const prof = await KGAuth.profile();
        const u = await KGAuth.user();
        window.KG_ROLE = (prof && prof.role) || "admin";
        if (prof || u) {
          const name = (prof && prof.full_name) || (u && u.user_metadata && u.user_metadata.full_name) || (u && u.email) || "User";
          // A salesperson is linked to their roster row via profile.salesperson_id
          const mine =
            (prof && prof.salesperson_id && KG.salespersons.find(s => s.id === prof.salesperson_id)) ||
            (u && KG.salespersons.find(s => s.email && s.email === u.email)) || null;
          KG.me = mine || {
            id: u ? u.id : "me", name, initials: initialsOf(name),
            email: u ? u.email : "", city: (prof && prof.city) || "—",
            level: "Rookie", xp: 0, xpToNext: 1700, sales: 0, todaySales: 0,
            revenue: 0, target: 200, rank: KG.salespersons.length + 1,
            badges: [], hue: (prof && prof.hue) || 150,
          };
        }

        // Replace leftover demo activity/perf with THIS user's real data (empty when new).
        const myId = u ? u.id : null;
        const mySales = (sales || []).filter(s => s.owner === myId);
        if (KG.me) {
          const now = new Date();
          const weekStart = new Date(now); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(now.getDate() - 6);
          const wk = [0, 0, 0, 0, 0, 0, 0];
          mySales.forEach(s => { const d = new Date(s.created_at); if (d >= weekStart) wk[(d.getDay() + 6) % 7] += s.qty || 0; });
          KG.me.weekSeries = wk; // salesperson dashboard "My Performance" reads this
        }
        // Reussites de formation de l equipe : elles alimentent la cloche de
        // notifications, pour qu un admin les voie sans ouvrir la page Formation.
        try {
          const teamNotes = await KGTraining.notifications(10);
          if (teamNotes) KG.teamNotifications = teamNotes;
        } catch (_) { /* la formation ne doit jamais casser le tableau de bord */ }

        // Recent-activity feed: a salesperson sees their own sales, an admin the team's.
        const actSrc = (window.KG_ROLE === "salesperson") ? mySales : (sales || []);
        KG.activity = actSrc.slice(0, 6).map(s => ({
          icon: "bag",
          title: "Closed a sale — " + (s.product || "perfume") + (s.customer ? " · " + s.customer : ""),
          time: timeAgo(s.created_at),
        }));
      } catch (e) {
        console.warn("KG hydrate failed, using demo data:", e);
      }
    },
  };

  /* ------------------------------------------------------------------ *
   * 8. EXPOSE                                                           *
   * ------------------------------------------------------------------ */
  window.KGAuth = KGAuth;
  window.KGDB = KGDB;
  window.KGData = KGData;
  window.KGTraining = KGTraining;
  window.KGClients = KGClients;
  window.KGPayroll = KGPayroll;
  window.KG_API_READY = true;
  window.KG_API_CONFIGURED = IS_CONFIGURED;   // refined by the health probe
  window.KG_ROLE = window.KG_ROLE || "admin"; // default until hydrate resolves the real role

  ready(); // start probing immediately so pages rarely have to wait
})();
