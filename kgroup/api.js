/* KGROUP browser API. Real mode uses same-origin Netlify Functions; demo mode remains local. */
(function () {
  "use strict";
  const DEMO_KEY = "kg-demo-session";
  const DEMO_MODE_KEY = "kg-demo-mode";
  const base = "/api";
  const request = async (path, options = {}) => {
    const response = await fetch(base + path, { credentials: "same-origin", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Request failed.");
    return body;
  };
  const isDemo = () => localStorage.getItem(DEMO_MODE_KEY) === "1";
  const initials = name => (name || "?").split(" ").map(part => part[0]).slice(0, 2).join("").toUpperCase();

  const KGAuth = {
    get configured() { return !isDemo(); },
    isDemo,
    useDemo(enabled = true) { localStorage.toggleItem ? localStorage.toggleItem(DEMO_MODE_KEY, enabled) : (enabled ? localStorage.setItem(DEMO_MODE_KEY, "1") : localStorage.removeItem(DEMO_MODE_KEY)); },
    async signUp(email, password, fullName, opts = {}) {
      if (isDemo()) { localStorage.setItem(DEMO_KEY, email); return { demo: true }; }
      return request("/auth/signup", { method: "POST", body: JSON.stringify({ email, password, fullName, inviteCode: opts.inviteCode || "" }) });
    },
    async signIn(email, password) {
      if (isDemo()) { localStorage.setItem(DEMO_KEY, email); return { demo: true }; }
      return request("/auth/signin", { method: "POST", body: JSON.stringify({ email, password }) });
    },
    async signInWithGoogle() {
      if (isDemo()) { localStorage.setItem(DEMO_KEY, "google-demo"); return { demo: true }; }
      throw new Error("Google OAuth is not configured yet. See README.md.");
    },
    async resetPassword(email) {
      if (isDemo()) return { demo: true };
      return request("/auth/reset/request", { method: "POST", body: JSON.stringify({ email }) });
    },
    async confirmEmail(token) { return request("/auth/confirm", { method: "POST", body: JSON.stringify({ token }) }); },
    async completePasswordReset(token, password) { return request("/auth/reset/confirm", { method: "POST", body: JSON.stringify({ token, password }) }); },
    async signOut() { localStorage.removeItem(DEMO_KEY); if (!isDemo()) await request("/auth/signout", { method: "POST", body: "{}" }); },
    async updatePassword(password) { if (isDemo()) return { demo: true }; return request("/auth/password", { method: "PUT", body: JSON.stringify({ password }) }); },
    async user() {
      if (isDemo()) { const email = localStorage.getItem(DEMO_KEY); return email ? { id: "demo", email, user_metadata: { full_name: "Demo Admin" } } : null; }
      return (await request("/auth/me")).user || null;
    },
    _profile: null,
    async profile(force) {
      if (isDemo()) return { role: "admin", full_name: "Demo Admin" };
      if (!force && this._profile) return this._profile;
      const user = await this.user(); if (!user) return null;
      this._profile = user; return user;
    },
    async role() { return (await this.profile())?.role || "admin"; },
    homeForRole(role) { return role === "salesperson" ? "salesperson.html" : "dashboard.html"; },
    async inviteInfo() { return null; },
    async requireSession(redirect = "login.html") { const user = await this.user().catch(() => null); if (!user) { window.location.replace(redirect); return false; } return true; },
    async redirectIfAuthed(to = "dashboard.html") { const user = await this.user().catch(() => null); if (user) { window.location.replace(this.homeForRole(user.role) || to); return true; } return false; },
  };

  const KGDB = {
    async listSalespersons() { return isDemo() ? null : (await request("/salespersons")).salespersons; },
    async deleteSalesperson(id) { return isDemo() ? { demo: true } : request(`/salespersons/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }); },
    async addSalesperson(rep) { return isDemo() ? { demo: true, invite_code: "DEMO" + Math.random().toString(36).slice(2, 8).toUpperCase() } : (await request("/salespersons", { method: "POST", body: JSON.stringify(rep) })).salesperson; },
    async listSales() { return isDemo() ? null : (await request("/sales")).sales; },
    async addSale(sale) { return isDemo() ? { demo: true } : (await request("/sales", { method: "POST", body: JSON.stringify(sale) })).sale; },
    async myProfile() { return isDemo() ? null : (await request("/profile")).profile; },
    async updateProfile(fields) { if (isDemo()) return { demo: true }; KGAuth._profile = null; return request("/profile", { method: "PUT", body: JSON.stringify(fields) }); },
    async listChallenges() { return isDemo() ? null : (await request("/challenges")).challenges; },
    async addChallenge(challenge) { return isDemo() ? { demo: true } : (await request("/challenges", { method: "POST", body: JSON.stringify(challenge) })).challenge; },
    async joinChallenge(id) { return isDemo() ? { demo: true } : request(`/challenges/${encodeURIComponent(id)}/join`, { method: "POST", body: "{}" }); },
  };

  function buildSeries(sales) {
    const now = new Date(), keys = [], labels = [], units = {}, revenue = {};
    for (let i = 11; i >= 0; i--) { const date = new Date(now.getFullYear(), now.getMonth() - i, 1), key = `${date.getFullYear()}-${date.getMonth()}`; keys.push(key); labels.push(date.toLocaleString("en-US", { month: "short" })); units[key] = revenue[key] = 0; }
    const weekSeries = [0, 0, 0, 0, 0, 0, 0], weekStart = new Date(now); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(now.getDate() - 6);
    sales.forEach(sale => { const date = new Date(sale.created_at), key = `${date.getFullYear()}-${date.getMonth()}`; if (key in units) { units[key] += sale.qty || 0; revenue[key] += Number(sale.amount) || 0; } if (date >= weekStart) weekSeries[(date.getDay() + 6) % 7] += sale.qty || 0; });
    return { months: labels, salesSeries: keys.map(key => units[key]), revenueSeries: keys.map(key => revenue[key]), weekDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], weekSeries, targetSeries: keys.map(() => 0) };
  }
  const relativeTime = timestamp => { const seconds = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 1000); return seconds < 60 ? "Just now" : seconds < 3600 ? `${Math.floor(seconds / 60)} min ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)} h ago` : `${Math.floor(seconds / 86400)} days ago`; };
  const KGData = { async hydrate() {
    const KG = window.KG; if (!KG || isDemo()) return;
    const [reps, sales, challenges, profile] = await Promise.all([KGDB.listSalespersons(), KGDB.listSales(), KGDB.listChallenges(), KGAuth.profile()]);
    KG.salespersons = (reps || []).map((rep, index) => ({ id: rep.id, name: rep.name, initials: initials(rep.name), city: rep.city || "—", phone: rep.phone || "—", email: rep.email || "", sales: rep.sales || 0, todaySales: rep.today_sales || 0, revenue: Number(rep.revenue) || 0, commission: Number(rep.commission) || 0, status: rep.status, level: rep.level, xp: rep.xp, xpToNext: rep.xp_to_next, target: rep.target, hue: rep.hue, badges: rep.badges || [], invite_code: rep.invite_code, claimed: rep.claimed, rank: index + 1 })).sort((a,b) => b.revenue - a.revenue);
    KG.salespersons.forEach((rep, index) => rep.rank = index + 1);
    KG.kpis.totalSales = KG.salespersons.reduce((sum, rep) => sum + rep.sales, 0); KG.kpis.totalRevenue = KG.salespersons.reduce((sum, rep) => sum + rep.revenue, 0); KG.kpis.totalCommission = KG.salespersons.reduce((sum, rep) => sum + rep.commission, 0); KG.kpis.activeReps = KG.salespersons.filter(rep => rep.status === "Active").length;
    KG.challenges = (challenges || []).map(challenge => { const left = Math.max(0, new Date(`${challenge.ends || "1970-01-01"}T23:59:59`) - new Date()); return { id: challenge.id, icon: challenge.icon, hue: challenge.hue, title: challenge.title, desc: challenge.description || "", reward: challenge.reward || "—", current: challenge.current, target: challenge.target, participants: challenge.participants || 0, daysLeft: Math.floor(left / 86400000), hrsLeft: Math.floor((left % 86400000) / 3600000) }; });
    KG.kpis.challengeCount = KG.challenges.length;
    KG.recentSales = (sales || []).slice(0, 40).map(sale => ({ ...sale, amount: Number(sale.amount), rep: sale.rep_name || "—", repInitials: initials(sale.rep_name), hue: 150, at: sale.created_at })); KG.series = { ...KG.series, ...buildSeries(sales || []) };
    window.KG_ROLE = profile.role; const mine = KG.salespersons.find(rep => rep.id === profile.salesperson_id) || { id: profile.id, name: profile.full_name, initials: initials(profile.full_name), email: profile.email, city: profile.city || "—", level: "Rookie", xp: 0, xpToNext: 1700, sales: 0, todaySales: 0, revenue: 0, target: 200, rank: KG.salespersons.length + 1, badges: [], hue: profile.hue || 150 }; KG.me = mine;
    const mySales = (sales || []).filter(sale => sale.owner === profile.id); KG.me.weekSeries = buildSeries(mySales).weekSeries; KG.activity = (profile.role === "salesperson" ? mySales : sales || []).slice(0, 6).map(sale => ({ icon: "bag", title: `Closed a sale — ${sale.product || "perfume"}${sale.customer ? ` · ${sale.customer}` : ""}`, time: relativeTime(sale.created_at) }));
  }};
  window.KGAuth = KGAuth; window.KGDB = KGDB; window.KGData = KGData; window.KG_API_READY = true; window.KG_API_CONFIGURED = !isDemo(); window.KG_ROLE = window.KG_ROLE || "admin";
})();
