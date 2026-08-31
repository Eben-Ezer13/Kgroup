# Supabase → Neon PostgreSQL

This document is the audit and the runbook for the migration. The application's
features, pages and UI are unchanged; what changed is everything underneath them.

---

## 1. Why the architecture had to grow a backend

The project was a **pure static site**: HTML pages loading `supabase.js` straight
in the browser, with no `package.json`, no server, and no build step.

That worked because of what Supabase is:

| | Supabase | Neon |
| --- | --- | --- |
| What it exposes | An HTTPS REST API (PostgREST) + hosted auth (GoTrue) | A raw PostgreSQL server |
| Browser credential | `anon` key — **designed to be public** | none — the connection string *is* the password |
| Who enforces access | The database, via Row Level Security + `auth.uid()` | nobody, until you write it |

A Neon `DATABASE_URL` cannot go in browser JavaScript. Anyone opening DevTools
would get full read/write/DROP on the whole database, and every RLS policy would
be gone because `auth.uid()` only exists inside Supabase.

So the migration adds the one layer that makes Neon reachable safely — the same
architecture named in the brief:

```
Frontend (unchanged HTML/CSS/JS)
      |  fetch('/api/...') + session cookie
      v
Express API  (server/)          <-- the only holder of DATABASE_URL
      |  parameterised SQL (pg)
      v
Neon PostgreSQL
```

**No page, component, or feature was rewritten.** `api.js` exposes byte-for-byte
the same `window.KGAuth` / `window.KGDB` / `window.KGData` surface that
`supabase.js` did, so the pages did not have to change — only the `<script>` tag
they load.

---

## 2. Why `pg` and not Prisma

The brief asked for Prisma "if it fits the current architecture". It does not, and
forcing it would have meant the rewrite the brief rules out:

- **The schema is not ORM-shaped.** Its core behaviour lives in PL/pgSQL: the
  `handle_new_user()` signup trigger (creates teams, claims invites) and the
  `apply_sale()` roll-up trigger (units, revenue, XP, levels, badges). Prisma
  does not model triggers or functions — they would stay hand-written SQL
  regardless, so the ORM would manage only the easy half.
- **The project had no toolchain.** No TypeScript, no bundler, no build. Prisma
  brings a generated client, a schema language and a codegen step to a codebase
  that has none of those.
- **Serverless cold starts.** The API runs as a Netlify Function; Prisma's query
  engine is heavy there, `pg` is not.
- **The queries are simple.** Five tables, ten endpoints, no dynamic query
  building. There is nothing for an ORM to simplify.

`pg` lets `db/schema.sql` stay a direct port of `supabase-schema.sql` — same
tables, same triggers, same functions — which is what keeps behaviour identical.

---

## 3. Migration map

### Database

| Element | Supabase (before) | Neon (after) |
| --- | --- | --- |
| **Tables** | `teams`, `profiles`, `salespersons`, `sales`, `challenges` + Supabase-managed `auth.users` | Same five, unchanged, **plus** `users` (replaces `auth.users`) and `password_reset_tokens` |
| **Columns / types / defaults** | see `legacy/supabase-schema.sql` | identical, incl. `bigint` money, `jsonb` badges, `int` XP ladder |
| **Relations** | 9 foreign keys, several `on delete cascade` | identical; `auth.users` references retargeted to `public.users` |
| **Indexes** | 5 (`idx_salespersons_team/_invite`, `idx_sales_team/_created`, `idx_challenges_team`) | same 5, **plus** `idx_users_email_lower` (case-insensitive email) and `idx_users_provider` |
| **Enums** | none — roles/levels/status are `text` with defaults | unchanged |
| **Functions** | `my_team_id()`, `my_role()`, `invite_info()`, `handle_new_user()`, `apply_sale()` | `invite_info()`, `handle_new_user()`, `apply_sale()` ported verbatim. `my_team_id()`/`my_role()` read `auth.uid()`, which does not exist here → became `team_id_of(uuid)` / `role_of(uuid)` |
| **Triggers** | `on_auth_user_created`, `on_sale_insert` | both ported; the first now fires on `public.users` |
| **Views / procedures** | none in the project | none |
| **RLS + policies** | 17 policies across 5 tables, all keyed on `auth.uid()` | **Moved up a layer, not dropped.** Every predicate is reproduced in `server/policies.js`, applied as a `WHERE` clause on the query itself. See §4. |
| **Auth** | Supabase GoTrue (hosted) | `server/auth.js` — bcrypt + JWT sessions. See §5. |
| **Storage** | **not used anywhere in the project** — no `supabase.storage` call exists | nothing to migrate |

### Code

| Was | Now |
| --- | --- |
| `supabase.js` | `api.js` — identical public API, `fetch` instead of the Supabase SDK |
| `supabase.from("x").select()` | `GET /api/x` |
| `supabase.from("x").insert()` | `POST /api/x` |
| `supabase.from("x").delete().eq("id", …)` | `DELETE /api/x/:id` |
| `supabase.from("profiles").update().eq("id", uid)` | `PATCH /api/profile` |
| `supabase.rpc("invite_info", …)` | `GET /api/auth/invite?code=` |
| `supabase.auth.signUp / signInWithPassword / signOut / getUser / updateUser` | `POST /api/auth/signup / signin / signout`, `GET /api/auth/user`, `POST /api/auth/password` |
| `supabase.auth.resetPasswordForEmail` | `POST /api/auth/reset` → `POST /api/auth/reset/confirm` |
| `supabase.auth.signInWithOAuth({provider:"google"})` | `GET /api/auth/google` → `/api/auth/google/callback` |
| `window.KG_SUPA_CONFIGURED` / `KG_SUPA_READY` | `window.KG_API_CONFIGURED` / `KG_API_READY` |

### Features audited (all verified in the code, none assumed)

| Feature | Page | Data it uses | Status |
| --- | --- | --- | --- |
| Sign in / sign up (admin) | `login.html` | `users`, `profiles`, `teams` | migrated |
| Join by invite (salesperson) | `register.html` | `salespersons.invite_code`, `profiles` | migrated |
| Password reset | `login.html` → `reset-password.html` | `password_reset_tokens` | migrated + completed (see §7) |
| Change password / sign out | `settings.html` | `users` | migrated |
| Profile edit (name, city) | `settings.html` | `profiles` | migrated |
| Admin dashboard + KPIs + charts | `dashboard.html` | `salespersons`, `sales` | migrated |
| Salesperson dashboard | `salesperson.html` | `sales` filtered to the user | migrated |
| Roster: list / add / delete / invite link | `salespersons.html` | `salespersons` | migrated |
| Register a sale | `sales.html` | `sales` → `apply_sale()` roll-up | migrated |
| Rankings | `ranking.html` | `salespersons` ordered by revenue | migrated |
| Challenges: list / create | `challenges.html` | `challenges` | migrated |
| Reports | `reports.html` | `salespersons`, `sales` | migrated |
| Notifications | derived in `dashboard.js` from activity — no table | unchanged |
| Contract reference, products, bonuses | `data.js` — static config, never in the DB | unchanged |
| Theme / language | `localStorage` | unchanged |

---

## 4. Where the RLS policies went

Each of the 17 policies is reproduced in `server/policies.js` and applied as part
of the SQL, so a caller can never read or write outside their team.

| Supabase policy | Predicate | Now enforced by |
| --- | --- | --- |
| `profiles: self read/update/insert` | `id = auth.uid()` | `GET`/`PATCH /api/profile` query on `req.user.id` |
| `profiles: team read` | `team_id = my_team_id()` | `teamScope(req)` |
| `teams: member read` / `owner all` | `id = my_team_id()` / `owner = auth.uid()` | `teamScope(req)`; teams are only created by the signup trigger |
| `salespersons: team read` | `team_id = my_team_id()` | `WHERE team_id = $1` |
| `salespersons: admin insert/update/delete` | `team_id = my_team_id() AND my_role() = 'admin'` | `requireAdmin(req)` + `WHERE team_id = $1` |
| `sales: team read` / `team insert` | `team_id = my_team_id()` | `WHERE team_id = $1` / server-set `team_id` |
| `sales: mine or admin update/delete` | `owner = auth.uid() OR my_role() = 'admin'` | `canMutateSale(req, row)` |
| `challenges: team read` | `team_id = my_team_id()` | `WHERE team_id = $1` |
| `challenges: admin write` | `team_id = my_team_id() AND my_role() = 'admin'` | `requireAdmin(req)` + `WHERE team_id = $1` |

This model is **strictly tighter** than the original in three places, because RLS
let the browser send arbitrary column values that policies never inspected:

1. `owner`, `team_id`, `auth_id`, `invite_code`, `claimed` and `id` are now set by
   the server and stripped from request bodies. Previously the client spread a
   whole object into the insert.
2. `profiles.role` and `profiles.team_id` are no longer client-writable. Under
   `profiles: self update`, any user could have promoted themselves to `admin`.
3. A sale's `rep_id` must belong to the caller's team. RLS never checked this, so
   a sale could credit another team's rep through `apply_sale()`.

`npm test` covers all three (`writes cannot forge ownership columns`, `a user
cannot promote themselves through the profile endpoint`, `teams cannot see each
other's data`).

> **Optional hardening.** True database-level RLS can be layered back on with
> `current_setting('app.user_id')` GUCs set per transaction, giving defence in
> depth if a second client ever talks to Neon directly. It is not needed while
> this API is the only path to the database.

---

## 5. What replaced Supabase Auth

| GoTrue provided | Replacement |
| --- | --- |
| `auth.users` table | `public.users` — same column names, so the signup trigger ported verbatim |
| bcrypt password hashing | `bcryptjs`, same `$2a`/`$2b` format → **migrated hashes still verify, users keep their passwords** |
| JWT session + refresh | `jsonwebtoken`, 7-day expiry (`SESSION_TTL_DAYS`) |
| Session in `localStorage` | httpOnly cookie (page scripts cannot read it), plus a Bearer token fallback for cross-origin hosting |
| `auth.uid()` in policies | `req.user.id`, resolved by `attachUser` middleware |
| Confirmation + reset emails | Resend via `server/mailer.js` (`RESEND_API_KEY`) |
| Google OAuth broker | Standard authorization-code flow in `server/routes/auth.js` |

Security properties kept or added: no account enumeration on sign-in or reset
(identical responses either way), reset tokens stored only as SHA-256 and
single-use, and generic 500s so SQL errors never reach the browser.

---

## 6. Runbook

```bash
npm install

# 1. Configure
cp .env.example .env
#    Fill DATABASE_URL  (Neon console -> Connection Details -> Pooled connection)
#    Fill JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 2. Create the schema on Neon
npm run db:migrate

# 3. Verify it
npm run db:check      # tables, functions, triggers, indexes, FKs, row counts
npm run db:smoke      # SELECT/INSERT/UPDATE/DELETE, constraints, transactions, triggers

# 4. Bring existing data across (only if the Supabase project has data)
#    Add SUPABASE_DB_URL to .env first (Supabase -> Settings -> Database -> URI)
npm run data:import -- --dry-run    # preview
npm run data:import                 # copy, then reconcile counts
#    Then delete SUPABASE_DB_URL from .env

# 5. Run
npm start             # http://localhost:3000/login.html

# 6. Checks that need no database
npm run lint
npm run build
npm test
```

### Data import guarantees

- Primary keys, foreign keys and timestamps are copied verbatim → every relation
  survives.
- Password hashes come across as-is → existing users keep their passwords.
- Triggers are **disabled during the copy**. Without that, inserting users would
  re-run `handle_new_user()` and create duplicate teams, and inserting sales would
  re-run `apply_sale()` and double every rep's revenue.
- Every insert is `ON CONFLICT DO NOTHING`, so the import is re-runnable.
- **Nothing is deleted from either database.** The Supabase project stays intact
  until you choose to pause it.
- The script prints a reconciliation table (Supabase count vs Neon count) and
  checks for orphaned foreign keys. All primary keys are `uuid`
  `gen_random_uuid()` — there are no sequences to reset.

---

## 7. Behaviour changes

Everything else is identical. These four are deliberate:

1. **Password reset now completes.** Before, `resetPasswordForEmail` sent users to
   `login.html`, which had no way to set a new password — the flow dead-ended.
   There is now a `reset-password.html` page and a `POST /api/auth/reset/confirm`
   endpoint. Sending the email requires `RESEND_API_KEY`; without it the endpoint
   still succeeds (no enumeration) and logs the link to the server console.
2. **Google sign-in needs its own credentials.** Supabase brokered OAuth. Set
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` with
   `{APP_URL}api/auth/google/callback` as the authorised redirect URI. Until then
   the button reports that it is not configured instead of failing silently.
3. **Email confirmation is off by default** (`REQUIRE_EMAIL_CONFIRMATION=false`),
   so signup returns a session immediately. Turn it on only once a mailer is
   configured — otherwise nobody can complete a signup.
4. **`today_sales` no longer resets automatically.** The Supabase schema suggested
   a `pg_cron` job; Neon has no `pg_cron`. Run
   `update public.salespersons set today_sales = 0;` from a scheduled job
   (Netlify scheduled function, GitHub Action, or any cron) at midnight.

The SSO button was always a placeholder toast, and still is.

---

## 8. Deployment

### Netlify (keeps the current setup)

`netlify.toml` publishes the site and routes `/api/*` to the Express app running
as a function. Set these in **Project configuration → Environment variables**:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon **pooled** connection string |
| `JWT_SECRET` | yes | ≥32 chars, generated once |
| `APP_URL` | recommended | `https://kgroupmanagement.netlify.app/` — used for reset links |
| `RESEND_API_KEY`, `MAIL_FROM` | optional | password-reset email |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Google sign-in |

### Any Node host (Render, Railway, Fly, a VPS)

`npm start` serves both the API and the pages on one origin. Set the same
variables plus `NODE_ENV=production`.

### If the API is hosted separately from the pages

Set `CORS_ORIGINS` to the exact site origin and `CROSS_SITE_COOKIES=true`, and
set `window.KG_API_URL` before `api.js` loads on each page.

---

## 9. Secret handling

- `DATABASE_URL` appears only in `.env` (gitignored) and the host's env panel.
  It is never in JS, HTML, SQL, Markdown, or any committed file.
- `npm run lint` fails the build on any committed connection string, JWT, Resend
  key, or Google client secret, and on any browser-side file reading
  `process.env.DATABASE_URL`.
- Neither the API nor the server logs ever echo the connection string; internal
  errors are reported to the browser as a generic message.
- The frontend and backend share a directory, so both Express and Netlify are
  configured to 404 `server/`, `scripts/`, `db/`, `tests/`, `legacy/`,
  `node_modules/`, `package.json` and dotfiles.

---

## 10. Retiring Supabase

`legacy/` holds `supabase.js`, `supabase-schema.sql` and `setup-supabase.md` for
reference. Nothing in the running app loads them. Once the Neon deployment is
verified:

1. `npm run data:import`, then `npm run db:check` to confirm the counts match.
2. Pause or delete the Supabase project in its dashboard.
3. Delete `legacy/`.

The Supabase anon key inside `legacy/supabase.js` was always public by design, so
it is not a leak — but the project it points at is still live until you pause it.
