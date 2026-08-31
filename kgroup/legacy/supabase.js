/* =========================================================================
   KGROUP SALES PERFORMANCE PLATFORM — Supabase Integration
   -------------------------------------------------------------------------
   Real authentication + cloud database with a graceful DEMO fallback.

   ► HOW TO ACTIVATE (see SETUP-SUPABASE.md for full steps):
     1. Create a free project at https://supabase.com
     2. Run supabase-schema.sql in the SQL editor
     3. Paste your Project URL + anon public key below
   Until you do, the app keeps running on the local demo data in data.js.

   Exposes: window.KGAuth, window.KGDB, window.KGData, window.KG_SUPA_READY
   ========================================================================= */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. CONFIG — paste your Supabase credentials here                   *
   * ------------------------------------------------------------------ */
  const CONFIG = {
    url:  "https://yntdmpephvufqjurahbe.supabase.co",       // e.g. https://abcdefgh.supabase.co
    anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InludGRtcGVwaHZ1ZnFqdXJhaGJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NzE4NjYsImV4cCI6MjA5ODQ0Nzg2Nn0.uPAsl-yKiSDBYB205vF2fqFTj_27hdv-5jTmKbCur3I",  // the public "anon" key (safe for browsers)

    // URL PUBLIQUE de ton site déployé (Netlify / Vercel / GitHub Pages).
    // Les liens des e-mails (confirmation + reset mot de passe) pointeront ICI
    // au lieu de localhost. Laisse "" pour utiliser l'URL courante (dev local).
    // ⚠️ Doit finir par un "/". Ex: "https://kgroup.netlify.app/"
    siteUrl: "https://kgroupmanagement.netlify.app/",
  };

  const IS_CONFIGURED =
    CONFIG.url && CONFIG.anon &&
    !CONFIG.url.includes("YOUR_") && !CONFIG.anon.includes("YOUR_");

  const CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  let _client = null;

  /* Lazily inject the Supabase SDK from CDN, then create the client.
     Only runs when credentials are configured — demo mode stays offline. */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error("Failed to load Supabase SDK"));
      document.head.appendChild(s);
    });
  }
  async function client() {
    if (!IS_CONFIGURED) return null;
    if (_client) return _client;
    if (!window.supabase) await loadScript(CDN);
    _client = window.supabase.createClient(CONFIG.url, CONFIG.anon);
    return _client;
  }

  // Base URL for email/OAuth redirects: the configured production site URL when
  // set, otherwise the current folder URL (fine for same-machine local dev).
  const origin = () => {
    if (CONFIG.siteUrl) return CONFIG.siteUrl.endsWith("/") ? CONFIG.siteUrl : CONFIG.siteUrl + "/";
    return window.location.href.replace(/[^/]*$/, ""); // folder URL
  };

  /* ------------------------------------------------------------------ *
   * 2. AUTH                                                             *
   * ------------------------------------------------------------------ */
  const DEMO_KEY = "kg-demo-session";

  const KGAuth = {
    configured: IS_CONFIGURED,

    /* opts: { role: 'admin'|'salesperson', inviteCode: string } */
    async signUp(email, password, fullName, opts = {}) {
      if (!IS_CONFIGURED) { localStorage.setItem(DEMO_KEY, email); return { demo: true }; }
      const c = await client();
      const meta = { full_name: fullName };
      if (opts.role) meta.role = opts.role;
      if (opts.inviteCode) meta.invite_code = opts.inviteCode;
      const { data, error } = await c.auth.signUp({
        email, password,
        options: { data: meta, emailRedirectTo: origin() + "login.html" },
      });
      if (error) throw error;
      return data;
    },

    async signIn(email, password) {
      if (!IS_CONFIGURED) { localStorage.setItem(DEMO_KEY, email); return { demo: true }; }
      const c = await client();
      const { data, error } = await c.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },

    async signInWithGoogle() {
      if (!IS_CONFIGURED) { localStorage.setItem(DEMO_KEY, "google-demo"); return { demo: true }; }
      const c = await client();
      const { error } = await c.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: origin() + "dashboard.html" },
      });
      if (error) throw error;
    },

    async resetPassword(email) {
      if (!IS_CONFIGURED) return { demo: true };
      const c = await client();
      const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: origin() + "login.html" });
      if (error) throw error;
    },

    async signOut() {
      localStorage.removeItem(DEMO_KEY);
      this._profile = null;
      if (IS_CONFIGURED) { const c = await client(); await c.auth.signOut(); }
    },

    /* Update the signed-in user's password (Settings → Security). */
    async updatePassword(newPassword) {
      if (!IS_CONFIGURED) return { demo: true };
      const c = await client();
      const { error } = await c.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },

    /* Returns the current auth user (or a demo stub), else null. */
    async user() {
      if (!IS_CONFIGURED) {
        const e = localStorage.getItem(DEMO_KEY);
        return e ? { email: e, user_metadata: { full_name: "Demo Admin" } } : null;
      }
      const c = await client();
      const { data } = await c.auth.getUser();
      return data.user || null;
    },

    /* Current user's profile row (cached). Demo mode returns an admin stub. */
    _profile: null,
    async profile(force) {
      if (!IS_CONFIGURED) return { role: "admin", full_name: "Demo Admin" };
      if (this._profile && !force) return this._profile;
      const c = await client();
      const u = await this.user();
      if (!u) return null;
      const { data } = await c.from("profiles").select("*").eq("id", u.id).single();
      this._profile = data;
      return data;
    },

    async role() { const p = await this.profile(); return (p && p.role) || "admin"; },

    /* Where a given role should land after login. */
    homeForRole(role) { return role === "salesperson" ? "salesperson.html" : "dashboard.html"; },

    /* Look up who an invite is for (works before sign-up). */
    async inviteInfo(code) {
      if (!IS_CONFIGURED || !code) return null;
      const c = await client();
      const { data } = await c.rpc("invite_info", { p_code: code });
      return data && data[0] ? data[0] : null;
    },

    /* Page guard. Redirects to login when no session (real mode only). */
    async requireSession(redirect = "login.html") {
      const u = await this.user();
      if (!u) { window.location.replace(redirect); return false; }
      return true;
    },

    /* If already logged in, bounce away from the login page. */
    async redirectIfAuthed(to = "dashboard.html") {
      const u = await this.user();
      if (u) { window.location.replace(to); return true; }
      return false;
    },
  };

  /* ------------------------------------------------------------------ *
   * 3. DATABASE API (each method falls back to demo KG data)           *
   * ------------------------------------------------------------------ */
  const KGDB = {
    async listSalespersons() {
      if (!IS_CONFIGURED) return null; // signal: use demo
      const c = await client();
      const { data, error } = await c.from("salespersons").select("*").order("revenue", { ascending: false });
      if (error) { console.warn(error); return null; }
      return data;
    },

    async deleteSalesperson(id) {
      if (!IS_CONFIGURED) return { demo: true };
      const c = await client();
      const { error } = await c.from("salespersons").delete().eq("id", id);
      if (error) throw error;
      return { ok: true };
    },

    async addSalesperson(rep) {
      const code = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
      if (!IS_CONFIGURED) return { demo: true, invite_code: "DEMO" + code.slice(0, 6).toUpperCase() };
      const c = await client();
      const u = await KGAuth.user();
      const p = await KGAuth.profile();
      const { data, error } = await c.from("salespersons")
        .insert({ owner: u.id, team_id: p ? p.team_id : null, invite_code: code, claimed: false, ...rep })
        .select().single();
      if (error) throw error;
      return data; // includes invite_code → build the invite link client-side
    },

    async listSales(limit = 40) {
      if (!IS_CONFIGURED) return null;
      const c = await client();
      const { data, error } = await c.from("sales").select("*").order("created_at", { ascending: false }).limit(limit);
      if (error) { console.warn(error); return null; }
      return data;
    },

    async addSale(sale) {
      if (!IS_CONFIGURED) return { demo: true };
      const c = await client();
      const u = await KGAuth.user();
      const p = await KGAuth.profile();
      const { data, error } = await c.from("sales")
        .insert({ owner: u.id, team_id: p ? p.team_id : null, ...sale }).select().single();
      if (error) throw error;
      return data;
    },

    async myProfile() {
      if (!IS_CONFIGURED) return null;
      const c = await client();
      const u = await KGAuth.user();
      if (!u) return null;
      const { data } = await c.from("profiles").select("*").eq("id", u.id).single();
      return data;
    },

    /* Update the signed-in user's own profile (name, city, avatar hue). */
    async updateProfile(fields) {
      if (!IS_CONFIGURED) return { demo: true };
      const c = await client();
      const u = await KGAuth.user();
      const { error } = await c.from("profiles").update(fields).eq("id", u.id);
      if (error) throw error;
      KGAuth._profile = null; // bust cache so next read is fresh
      return { ok: true };
    },

    async listChallenges() {
      if (!IS_CONFIGURED) return null;
      const c = await client();
      const { data, error } = await c.from("challenges").select("*").order("created_at", { ascending: false });
      if (error) { console.warn(error); return null; }
      return data;
    },

    async addChallenge(ch) {
      if (!IS_CONFIGURED) return { demo: true };
      const c = await client();
      const u = await KGAuth.user();
      const p = await KGAuth.profile();
      const { data, error } = await c.from("challenges")
        .insert({ owner: u.id, team_id: p ? p.team_id : null, ...ch }).select().single();
      if (error) throw error;
      return data;
    },
  };

  /* ------------------------------------------------------------------ *
   * 4. HYDRATION — overlay real DB rows onto window.KG                  *
   *    Pages keep reading window.KG synchronously; this just swaps the *
   *    demo arrays for live data (when configured) before they render. *
   * ------------------------------------------------------------------ */
  const levels = ["Rookie", "Bronze", "Silver", "Gold", "Platinum", "Diamond"];
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
      if (k in mUnits) { mUnits[k] += s.qty || 0; mRev[k] += s.amount || 0; }
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
    let ms = new Date(ends + "T23:59:59") - new Date();
    if (ms < 0) ms = 0;
    return { daysLeft: Math.floor(ms / 86400000), hrsLeft: Math.floor((ms % 86400000) / 3600000) };
  }

  const KGData = {
    async hydrate() {
      const KG = window.KG;
      if (!KG || !IS_CONFIGURED) return;              // demo mode → keep data.js data
      try {
        const reps = await KGDB.listSalespersons();
        if (reps) {
          KG.salespersons = reps.map(r => ({
            id: r.id, name: r.name, initials: initialsOf(r.name),
            city: r.city || "—", phone: r.phone || "—", email: r.email || "",
            sales: r.sales || 0, todaySales: r.today_sales || 0, revenue: r.revenue || 0,
            status: r.status || "Active", level: r.level || "Rookie",
            xp: r.xp || 0, xpToNext: r.xp_to_next || 1700, target: r.target || 200,
            commission: r.commission || 0,
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
            amount: t.amount, pay: t.pay, rep: t.rep_name || "—",
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
   * 5. EXPOSE                                                           *
   * ------------------------------------------------------------------ */
  window.KGAuth = KGAuth;
  window.KGDB = KGDB;
  window.KGData = KGData;
  window.KG_SUPA_READY = true;
  window.KG_SUPA_CONFIGURED = IS_CONFIGURED;
  window.KG_ROLE = window.KG_ROLE || "admin"; // default until hydrate resolves the real role
})();
