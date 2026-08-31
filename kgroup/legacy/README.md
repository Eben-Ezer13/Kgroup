# Retired Supabase files

Nothing in the running application loads anything in this folder. These files are
kept only as a reference for the Supabase → Neon migration, and so the previous
setup can be inspected or rolled back to if needed.

| File | What it was | What replaced it |
| --- | --- | --- |
| `supabase.js` | Browser client: `KGAuth`, `KGDB`, `KGData.hydrate()`, talking to Supabase PostgREST/GoTrue over the CDN SDK. | [`../api.js`](../api.js) — identical public surface, talks to this project's `/api` instead. |
| `supabase-schema.sql` | The Supabase schema (tables, RLS policies, triggers, functions). | [`../db/schema.sql`](../db/schema.sql) — same tables/triggers/functions; the RLS policies became server-side rules in [`../server/policies.js`](../server/policies.js). |
| `setup-supabase.md` | Setup guide for creating a Supabase project and pasting its keys. | [`../MIGRATION-NEON.md`](../MIGRATION-NEON.md) |

## Before deleting this folder

`supabase.js` contains the project's Supabase **anon** key. That key is designed to
be public (it was shipped to every browser), so it is not a leak — but the
Supabase project it points at is still live. Once you are satisfied the Neon
migration is complete:

1. Run `npm run data:import` so no data is left behind (see `../MIGRATION-NEON.md`).
2. Verify the row counts with `npm run db:check`.
3. Pause or delete the Supabase project in its dashboard.
4. Then this folder can go.
