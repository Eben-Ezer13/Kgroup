-- =========================================================================
-- KGROUP SALES PERFORMANCE PLATFORM — Neon PostgreSQL schema  (v3)
-- Ported 1:1 from supabase-schema.sql (v2: teams + invites).
--
-- Run once against your Neon database:   npm run db:migrate
-- Idempotent — safe to re-run (IF EXISTS / IF NOT EXISTS + backfill).
--
-- WHAT CHANGED VS SUPABASE, AND WHY
--   * `auth.users` (a Supabase-managed schema) becomes `public.users`, owned by
--     this app. Column names are kept identical so handle_new_user() ports verbatim.
--   * `auth.uid()` does not exist outside Supabase. The helper functions
--     my_team_id()/my_role() therefore take the user id as a parameter:
--     team_id_of(uuid) / role_of(uuid).
--   * RLS policies are NOT recreated here. They depended on auth.uid(), which
--     PostgREST sets from a Supabase JWT. Neon is reached only through this
--     project's trusted API (server/), so the identical rules are enforced there
--     in server/policies.js — see that file for the policy-by-policy mapping.
--   * Everything else (tables, columns, types, defaults, FKs, indexes, the
--     apply_sale() roll-up trigger, the signup trigger, invite_info()) is unchanged.
-- =========================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------- USERS (replaces Supabase auth.users) -------------------------
-- Mirrors the subset of auth.users this app actually relied on, so the signup
-- trigger below is a verbatim port. `encrypted_password` keeps Supabase's own
-- column name and bcrypt format, which lets existing passwords migrate as-is.
create table if not exists public.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  encrypted_password text,                       -- bcrypt; null for OAuth-only accounts
  email_confirmed_at timestamptz,
  provider           text default 'email',       -- 'email' | 'google'
  provider_id        text,                       -- subject id from the OAuth provider
  raw_user_meta_data jsonb default '{}'::jsonb,  -- { full_name, role, invite_code }
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
-- Emails are matched case-insensitively, exactly like Supabase Auth.
create unique index if not exists idx_users_email_lower on public.users (lower(email));
create index if not exists idx_users_provider on public.users (provider, provider_id);

-- ---------- TEAMS --------------------------------------------------------
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  owner      uuid not null references public.users (id) on delete cascade,
  created_at timestamptz default now()
);

-- ---------- PROFILES (one row per authenticated user) --------------------
create table if not exists public.profiles (
  id             uuid primary key references public.users (id) on delete cascade,
  full_name      text,
  email          text,
  role           text default 'admin',        -- 'admin' | 'salesperson'
  team_id        uuid references public.teams (id) on delete set null,
  salesperson_id uuid,                          -- link to the roster row (reps)
  city           text,
  hue            int  default 150,
  created_at     timestamptz default now()
);
alter table public.profiles add column if not exists team_id        uuid;
alter table public.profiles add column if not exists salesperson_id uuid;

-- ---------- SALESPERSONS (team roster) -----------------------------------
create table if not exists public.salespersons (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references public.users (id) on delete cascade,
  team_id     uuid references public.teams (id) on delete cascade,
  auth_id     uuid references public.users (id) on delete set null, -- set when claimed
  invite_code text,                                                 -- null once claimed
  claimed     boolean default false,
  name        text not null,
  city        text,
  phone       text,
  email       text,
  sales       int  default 0,
  today_sales int  default 0,
  revenue     bigint default 0,
  commission  bigint default 0,                                     -- Art. 3
  status      text default 'Active',
  level       text default 'Rookie',
  xp          int  default 0,
  xp_to_next  int  default 1700,
  target      int  default 200,
  hue         int  default 150,
  badges      jsonb default '[]'::jsonb,
  created_at  timestamptz default now()
);
alter table public.salespersons add column if not exists team_id     uuid;
alter table public.salespersons add column if not exists auth_id     uuid;
alter table public.salespersons add column if not exists invite_code text;
alter table public.salespersons add column if not exists claimed     boolean default false;
alter table public.salespersons add column if not exists commission  bigint default 0;

-- ---------- SALES --------------------------------------------------------
create table if not exists public.sales (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references public.users (id) on delete cascade,
  team_id    uuid references public.teams (id) on delete cascade,
  rep_id     uuid references public.salespersons (id) on delete set null,
  rep_name   text,
  customer   text not null,
  product    text not null,
  qty        int  default 1,
  amount     bigint default 0,
  commission bigint default 0,                                       -- Art. 3
  pay        text default 'Card',
  remarks    text,
  created_at timestamptz default now()
);
alter table public.sales add column if not exists team_id    uuid;
alter table public.sales add column if not exists commission bigint default 0;

-- ---------- CHALLENGES (admin-created competitions) ----------------------
create table if not exists public.challenges (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references public.users (id) on delete cascade,
  team_id     uuid references public.teams (id) on delete cascade,
  title       text not null,
  description text,
  reward      text,
  icon        text default '🏆',
  hue         text default '#0B7A4B',
  target      int  default 100,
  current     int  default 0,
  ends        date,
  created_at  timestamptz default now()
);

-- ---------- PASSWORD RESET TOKENS ----------------------------------------
-- Replaces Supabase Auth's resetPasswordForEmail recovery links. Only the
-- SHA-256 of the token is stored, so a database leak cannot be replayed as a
-- reset link.
create table if not exists public.password_reset_tokens (
  token_hash text primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_reset_user on public.password_reset_tokens (user_id);

-- =========================================================================
-- HELPER FUNCTIONS
-- The Supabase versions read auth.uid(); here the caller passes the user id,
-- which the API resolves from the session JWT before querying.
-- =========================================================================
create or replace function public.team_id_of(p_user uuid)
returns uuid language sql stable as $fn$
  select team_id from public.profiles where id = p_user;
$fn$;

create or replace function public.role_of(p_user uuid)
returns text language sql stable as $fn$
  select role from public.profiles where id = p_user;
$fn$;

-- Public lookup so an invited (not-yet-authenticated) user can see who the
-- invite is for. Returns nothing for used/invalid codes. Unchanged.
create or replace function public.invite_info(p_code text)
returns table (name text, email text, team_name text)
language sql stable as $fn$
  select s.name, s.email, t.name
  from public.salespersons s
  left join public.teams t on t.id = s.team_id
  where s.invite_code = p_code and coalesce(s.claimed, false) = false
  limit 1;
$fn$;

-- =========================================================================
-- SIGNUP TRIGGER — create team+profile for admins, claim roster row for reps.
-- Verbatim port: only the table it fires on changed (auth.users -> public.users).
-- Role & invite code still arrive from the client via raw_user_meta_data.
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql as $fn$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'admin');
  v_name text := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_code text := new.raw_user_meta_data->>'invite_code';
  v_team uuid;
  v_sp   public.salespersons%rowtype;
begin
  if v_role = 'salesperson' and v_code is not null then
    select * into v_sp from public.salespersons
      where invite_code = v_code and coalesce(claimed, false) = false limit 1;

    if found then
      update public.salespersons
        set auth_id = new.id, claimed = true, invite_code = null, email = new.email
        where id = v_sp.id;
      insert into public.profiles (id, full_name, email, role, team_id, salesperson_id)
        values (new.id, coalesce(v_sp.name, v_name), new.email, 'salesperson', v_sp.team_id, v_sp.id)
        on conflict (id) do update
          set role = 'salesperson', team_id = excluded.team_id, salesperson_id = excluded.salesperson_id;
      return new;
    end if;

    -- invalid/used code -> create an unlinked salesperson profile
    insert into public.profiles (id, full_name, email, role)
      values (new.id, v_name, new.email, 'salesperson')
      on conflict (id) do nothing;
    return new;
  end if;

  -- ADMIN path -> all administrators share the platform workspace. The former
  -- implementation created one isolated team per administrator, which made
  -- the roster and dashboard differ between admin accounts.
  select id into v_team
    from public.teams
   order by created_at nulls first, id
   limit 1;
  if v_team is null then
    insert into public.teams (name, owner)
      values ('KGROUP Workspace', new.id)
      returning id into v_team;
  end if;
  insert into public.profiles (id, full_name, email, role, team_id)
    values (new.id, v_name, new.email, 'admin', v_team)
    on conflict (id) do update set role = 'admin', team_id = excluded.team_id;
  return new;
end; $fn$;

drop trigger if exists on_auth_user_created on public.users;
create trigger on_auth_user_created
  after insert on public.users
  for each row execute procedure public.handle_new_user();

-- ---------- Indexes ------------------------------------------------------
create index if not exists idx_salespersons_team   on public.salespersons (team_id);
create index if not exists idx_salespersons_invite on public.salespersons (invite_code);
create index if not exists idx_sales_team          on public.sales (team_id);
create index if not exists idx_sales_created       on public.sales (created_at desc);
create index if not exists idx_challenges_team     on public.challenges (team_id);

-- =========================================================================
-- LIVE STATS TRIGGER — every new sale rolls up onto its salesperson:
--   units + revenue + today's units, XP gain, level recalculation, and
--   milestone badges. Rankings are derived from revenue, so they move too.
-- Verbatim port. SECURITY DEFINER is dropped because it only existed to let a
-- rep's own sale bypass the salespersons RLS write policy, and RLS is gone.
-- =========================================================================
create or replace function public.apply_sale()
returns trigger language plpgsql as $fn$
declare
  v_levels  text[] := array['Rookie','Bronze','Silver','Gold','Platinum','Diamond'];
  v_xp_gain int;
  v_new_xp  int;
  v_idx     int;
  v_sp      public.salespersons%rowtype;
  v_badges  jsonb;
begin
  if new.rep_id is null then return new; end if;
  select * into v_sp from public.salespersons where id = new.rep_id;
  if not found then return new; end if;

  -- XP earned = ~1 XP per 60 MAD (matches the "+XP" preview on the sale form)
  v_xp_gain := greatest(10, round(new.amount / 60.0))::int;
  v_new_xp  := coalesce(v_sp.xp, 0) + v_xp_gain;
  v_idx     := least(5, floor(v_new_xp / 1700.0))::int;   -- 6 levels (0..5)

  -- Milestone badges: add a key once its threshold is crossed
  v_badges := coalesce(v_sp.badges, '[]'::jsonb);
  if (coalesce(v_sp.sales,0)   + new.qty)    >= 1      and not (v_badges ? 'starter') then v_badges := v_badges || '["starter"]'::jsonb; end if;
  if (coalesce(v_sp.sales,0)   + new.qty)    >= 50     and not (v_badges ? 'closer')  then v_badges := v_badges || '["closer"]'::jsonb;  end if;
  if (coalesce(v_sp.revenue,0) + new.amount) >= 100000 and not (v_badges ? 'revenue') then v_badges := v_badges || '["revenue"]'::jsonb; end if;

  update public.salespersons set
    sales       = coalesce(sales,0)       + new.qty,
    today_sales = coalesce(today_sales,0) + new.qty,
    revenue     = coalesce(revenue,0)     + new.amount,
    commission  = coalesce(commission,0)  + coalesce(new.commission, 0),  -- Art. 3
    xp          = v_new_xp,
    level       = v_levels[v_idx + 1],          -- pg arrays are 1-based
    xp_to_next  = (v_idx + 1) * 1700,
    badges      = v_badges
  where id = new.rep_id;

  return new;
end; $fn$;

drop trigger if exists on_sale_insert on public.sales;
create trigger on_sale_insert
  after insert on public.sales
  for each row execute procedure public.apply_sale();

-- Optional daily reset of "today_sales". Neon has no pg_cron; run it from a
-- scheduled job instead (Netlify scheduled function / GitHub Action / cron):
--   update public.salespersons set today_sales = 0;

-- =========================================================================
-- BACKFILL for rows imported from v1/v2 (admins with no team yet)
-- =========================================================================
insert into public.teams (name, owner)
  select coalesce(p.full_name, 'My') || '''s Team', p.id
  from public.profiles p
  where coalesce(p.role, 'admin') = 'admin' and p.team_id is null
    and not exists (select 1 from public.teams t where t.owner = p.id);

update public.profiles p set team_id = t.id
  from public.teams t where t.owner = p.id and p.team_id is null;

update public.salespersons s set team_id = pr.team_id
  from public.profiles pr where pr.id = s.owner and s.team_id is null;

update public.sales s set team_id = pr.team_id
  from public.profiles pr where pr.id = s.owner and s.team_id is null;

-- =========================================================================
-- FORMATION COMMERCIALE  (ajout v3.1)
-- Deux journees de formation (univers olfactif / strategie de vente), chacune
-- close par un quiz. Les quiz sont corriges COTE SERVEUR (server/training.js) :
-- le navigateur ne recoit jamais les bonnes reponses, donc un score ne peut
-- pas etre falsifie.
-- =========================================================================

-- Progression de lecture, une ligne par lecon terminee.
create table if not exists public.training_progress (
  user_id      uuid not null references public.users (id) on delete cascade,
  team_id      uuid references public.teams (id) on delete cascade,
  lesson_id    text not null,
  completed_at timestamptz default now(),
  primary key (user_id, lesson_id)
);
create index if not exists idx_training_progress_team on public.training_progress (team_id);

-- Chaque passage de quiz est conserve : l historique permet de voir la
-- progression, et le meilleur score fait foi pour l obtention du badge.
create table if not exists public.quiz_attempts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  team_id    uuid references public.teams (id) on delete cascade,
  quiz_id    text not null,                 -- 'jour1' | 'jour2'
  score      int  not null,
  total      int  not null,
  passed     boolean not null,
  created_at timestamptz default now()
);
create index if not exists idx_quiz_attempts_user on public.quiz_attempts (user_id, quiz_id);
create index if not exists idx_quiz_attempts_team on public.quiz_attempts (team_id, created_at desc);

-- Fil de notifications de l equipe. Alimente cote serveur quand un commercial
-- reussit un quiz ou termine la formation ; lu par les administrateurs.
-- L etat "lu" reste cote client (localStorage), comme le fil existant.
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  actor_id   uuid references public.users (id) on delete set null,
  actor_name text,
  type       text not null,                 -- 'quiz_passed' | 'training_completed'
  title      text not null,
  body       text,
  created_at timestamptz default now()
);
create index if not exists idx_notifications_team on public.notifications (team_id, created_at desc);
