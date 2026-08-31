# Enabling Real Accounts (Supabase)

The app ships in **demo mode** — it works immediately, but data resets on reload
and any credentials "log in". Follow these steps to switch it to **real accounts
with a cloud database**. Takes ~10 minutes, and it's free.

---

## 1. Create a Supabase project
1. Go to **https://supabase.com** → sign in → **New project**.
2. Pick a name, a strong database password, and a region → **Create**.
3. Wait ~1 minute for it to provision.

## 2. Create the database tables
1. In the left sidebar open **SQL Editor** → **New query**.
2. Open [`supabase-schema.sql`](supabase-schema.sql), copy **all** of it, paste, and click **Run**.
   This creates `profiles`, `salespersons`, `sales`, the security policies, and a
   trigger that auto-creates a profile for every new user.

## 3. Get your API keys
1. Sidebar → **Project Settings** (gear) → **API**.
2. Copy the **Project URL** and the **anon public** key.
3. Open [`supabase.js`](supabase.js) and paste them into the `CONFIG` block at the top:

```js
const CONFIG = {
  url:  "https://xxxxxxxx.supabase.co",   // ← your Project URL
  anon: "eyJhbGciOi...",                  // ← your anon public key
};
```

> The anon key is **safe** to expose in the browser — Row Level Security (from the
> SQL script) ensures each user only ever reads/writes their own rows.

## 4. (Optional) Turn off email confirmation for quick testing
By default Supabase emails a confirmation link before first login.
To let new sign-ups log in instantly while developing:
**Authentication → Providers → Email → turn OFF "Confirm email" → Save.**

## 5. (Optional) Enable Google sign-in
1. **Authentication → Providers → Google → Enable.**
2. Create OAuth credentials in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   and paste the Client ID/Secret into Supabase.
3. Add your site URL and `.../login.html` under
   **Authentication → URL Configuration → Redirect URLs**.

## 6. Test the full flow (admin → invite → salesperson)
1. Open **`login.html`** (via a local server or your deployed URL — not `file://`,
   OAuth/sessions need real HTTP). The "Demo mode" banner disappears once keys are set.
2. Click **Create an account** and sign up — this creates an **admin** with an empty team,
   landing on the admin **dashboard**.
3. Go to **Salespersons → Add Salesperson**, fill in a name, and **Save**.
   A modal shows a single-use **invite link** (`register.html?invite=…`). Copy it.
4. Open that link in a private/incognito window. It shows who the invite is for; set a
   password → the account is created and **bound to your team** automatically.
5. That user lands on the **salesperson dashboard** — their own stats, XP, ranking,
   with admin-only pages (Salespersons, Reports) hidden and blocked.
6. Back as the admin, register sales and watch the team's Rankings/Reports update. 🎉

## How roles work
| Who | How they get in | What they see |
|---|---|---|
| **Admin** | Self sign-up on `login.html` (becomes a team owner) | Everything — team management, all reps' sales, reports |
| **Salesperson** | **Invite link** from an admin (`register.html?invite=CODE`) | Only their own dashboard + shared Rankings/Challenges; can register only their own sales |

Row Level Security (from `supabase-schema.sql`) enforces this on the server: a
salesperson physically cannot read another team's data or write to the roster.

---

## What's wired to the database
| Feature | Status |
|---|---|
| Admin email sign-up / sign-in / sign-out | ✅ real |
| **Salesperson invite links + claim on sign-up** | ✅ real (team-bound) |
| **Role-based routing + page guards + nav** | ✅ real |
| Google OAuth (admins) | ✅ real (after step 5) |
| Password reset email | ✅ real |
| Team-scoped Salespersons list + add | ✅ reads/writes `salespersons` |
| Sales list + register (rep locked to self) | ✅ reads/writes `sales` |
| **Sales roll up live** — units, revenue, XP, level-ups, milestone badges | ✅ `apply_sale()` DB trigger on every sale |
| Dashboard KPIs / Top 10 / Rankings — move as sales land | ✅ recomputed from live rows |
| **Admin-created challenges** (title, reward, target, deadline) | ✅ reads/writes `challenges` (team-scoped) |
| **Commissions** per sale (Art. 3: 5 / 8 / 15 DHS) | ✅ stored on each sale, rolled up per rep |
| **Monthly bonus ladder** (Art. 4: 20→100, 40→300, 60→600 DHS) | ✅ shown on the salesperson dashboard |
| Rewards catalogue | ✅ generated from the contract bonuses |

> **Note on "Today's sales":** it accumulates until reset. To zero it every midnight,
> enable the **pg_cron** extension and uncomment the `cron.schedule(...)` line at the
> bottom of `supabase-schema.sql`.

## Deploying
It's static — drag the folder onto **https://app.netlify.com/drop**, or use
Vercel / GitHub Pages. Remember to add your deployed URL to Supabase's
**Redirect URLs** so OAuth and password-reset links come back to the right place.
