-- =========================================================================
-- KGROUP SALES PERFORMANCE PLATFORM — Supabase schema  (v2: teams + invites)
-- Run this once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run over the v1 schema (uses IF EXISTS / IF NOT EXISTS + backfill).
--
-- Model: an ADMIN owns a TEAM. The admin adds SALESPERSONS to the roster and
-- shares an invite code. A salesperson signs up with that code and their login
-- is bound to the admin's team. Team-scoped RLS lets everyone on a team see the
-- team's rankings, while only admins manage the roster.
-- =========================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------- TEAMS --------------------------------------------------------
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  owner      uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz default now()
);
alter table public.teams enable row level security;

-- ---------- PROFILES (one row per authenticated user) --------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  full_name      text,
  email          text,
  role           text default 'admin',        -- 'admin' | 'salesperson'
  team_id        uuid references public.teams (id) on delete set null,
  salesperson_id uuid,                          -- link to the roster row (reps)
  city           text,
  hue            int  default 150,
  created_at     timestamptz default now()
);
alter table public.profiles enable row level security;
-- Upgrade path from v1 (add new columns if missing)
alter table public.profiles add column if not exists team_id        uuid;
alter table public.profiles add column if not exists salesperson_id uuid;

-- ---------- SALESPERSONS (team roster) -----------------------------------
create table if not exists public.salespersons (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade,
  team_id     uuid references public.teams (id) on delete cascade,
  auth_id     uuid references auth.users (id) on delete set null, -- set when claimed
  invite_code text,                                               -- null once claimed
  claimed     boolean default false,
  name        text not null,
  city        text,
  phone       text,
  email       text,
  sales       int  default 0,
  today_sales int  default 0,
  revenue     bigint default 0,
  status      text default 'Active',
  level       text default 'Rookie',
  xp          int  default 0,
  xp_to_next  int  default 1700,
  target      int  default 200,
  hue         int  default 150,
  badges      jsonb default '[]'::jsonb,
  created_at  timestamptz default now()
);
alter table public.salespersons enable row level security;
alter table public.salespersons add column if not exists team_id     uuid;
alter table public.salespersons add column if not exists auth_id     uuid;
alter table public.salespersons add column if not exists invite_code text;
alter table public.salespersons add column if not exists claimed     boolean default false;

-- ---------- SALES --------------------------------------------------------
create table if not exists public.sales (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users (id) on delete cascade,
  team_id    uuid references public.teams (id) on delete cascade,
  rep_id     uuid references public.salespersons (id) on delete set null,
  rep_name   text,
  customer   text not null,
  product    text not null,
  qty        int  default 1,
  amount     bigint default 0,
  pay        text default 'Card',
  remarks    text,
  created_at timestamptz default now()
);
alter table public.sales enable row level security;
alter table public.sales add column if not exists team_id    uuid;
alter table public.sales add column if not exists commission bigint default 0;  -- Art. 3
alter table public.salespersons add column if not exists commission bigint default 0;

-- ---------- CHALLENGES (admin-created competitions) ----------------------
create table if not exists public.challenges (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade,
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
alter table public.challenges enable row level security;

-- =========================================================================
-- HELPER FUNCTIONS  (SECURITY DEFINER → read profiles without RLS recursion)
-- =========================================================================
create or replace function public.my_team_id()
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.my_team_id() to authenticated, anon;
grant execute on function public.my_role()    to authenticated, anon;

-- Public lookup so an invited (not-yet-authenticated) user can see who the
-- invite is for. Returns nothing for used/invalid codes.
create or replace function public.invite_info(p_code text)
returns table (name text, email text, team_name text)
language sql stable security definer set search_path = public as $$
  select s.name, s.email, t.name
  from public.salespersons s
  left join public.teams t on t.id = s.team_id
  where s.invite_code = p_code and coalesce(s.claimed, false) = false
  limit 1;
$$;
grant execute on function public.invite_info(text) to anon, authenticated;

-- =========================================================================
-- SIGNUP TRIGGER — create team+profile for admins, claim roster row for reps
-- Role & invite code are passed from the client via user metadata.
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
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

    -- invalid/used code → create an unlinked salesperson profile
    insert into public.profiles (id, full_name, email, role)
      values (new.id, v_name, new.email, 'salesperson')
      on conflict (id) do nothing;
    return new;
  end if;

  -- ADMIN path → spin up a team and link the profile to it
  insert into public.teams (name, owner) values (v_name || '''s Team', new.id) returning id into v_team;
  insert into public.profiles (id, full_name, email, role, team_id)
    values (new.id, v_name, new.email, 'admin', v_team)
    on conflict (id) do update set role = 'admin', team_id = excluded.team_id;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =========================================================================
-- ROW LEVEL SECURITY POLICIES
-- =========================================================================
-- profiles ---------------------------------------------------------------
drop policy if exists "profiles: self read"   on public.profiles;
drop policy if exists "profiles: team read"   on public.profiles;
drop policy if exists "profiles: self update" on public.profiles;
drop policy if exists "profiles: self insert" on public.profiles;
create policy "profiles: self read"   on public.profiles for select using (id = auth.uid());
create policy "profiles: team read"   on public.profiles for select using (team_id = public.my_team_id());
create policy "profiles: self update" on public.profiles for update using (id = auth.uid());
create policy "profiles: self insert" on public.profiles for insert with check (id = auth.uid());

-- teams ------------------------------------------------------------------
drop policy if exists "teams: member read" on public.teams;
drop policy if exists "teams: owner all"   on public.teams;
create policy "teams: member read" on public.teams for select using (id = public.my_team_id());
create policy "teams: owner all"   on public.teams for all
  using (owner = auth.uid()) with check (owner = auth.uid());

-- salespersons -----------------------------------------------------------
drop policy if exists "salespersons: owner all"     on public.salespersons;
drop policy if exists "salespersons: team read"     on public.salespersons;
drop policy if exists "salespersons: admin insert"  on public.salespersons;
drop policy if exists "salespersons: admin update"  on public.salespersons;
drop policy if exists "salespersons: admin delete"  on public.salespersons;
create policy "salespersons: team read"    on public.salespersons for select
  using (team_id = public.my_team_id());
create policy "salespersons: admin insert" on public.salespersons for insert
  with check (team_id = public.my_team_id() and public.my_role() = 'admin');
create policy "salespersons: admin update" on public.salespersons for update
  using (team_id = public.my_team_id() and public.my_role() = 'admin');
create policy "salespersons: admin delete" on public.salespersons for delete
  using (team_id = public.my_team_id() and public.my_role() = 'admin');

-- sales ------------------------------------------------------------------
drop policy if exists "sales: owner all"           on public.sales;
drop policy if exists "sales: team read"           on public.sales;
drop policy if exists "sales: team insert"         on public.sales;
drop policy if exists "sales: mine or admin update" on public.sales;
drop policy if exists "sales: mine or admin delete" on public.sales;
create policy "sales: team read"   on public.sales for select using (team_id = public.my_team_id());
create policy "sales: team insert" on public.sales for insert with check (team_id = public.my_team_id());
create policy "sales: mine or admin update" on public.sales for update
  using (owner = auth.uid() or public.my_role() = 'admin');
create policy "sales: mine or admin delete" on public.sales for delete
  using (owner = auth.uid() or public.my_role() = 'admin');

-- challenges (team reads; only admins create/edit) -----------------------
drop policy if exists "challenges: team read"  on public.challenges;
drop policy if exists "challenges: admin write" on public.challenges;
create policy "challenges: team read"  on public.challenges for select
  using (team_id = public.my_team_id());
create policy "challenges: admin write" on public.challenges for all
  using (team_id = public.my_team_id() and public.my_role() = 'admin')
  with check (team_id = public.my_team_id() and public.my_role() = 'admin');

-- ---------- Indexes ------------------------------------------------------
create index if not exists idx_salespersons_team   on public.salespersons (team_id);
create index if not exists idx_salespersons_invite on public.salespersons (invite_code);
create index if not exists idx_sales_team          on public.sales (team_id);
create index if not exists idx_sales_created       on public.sales (created_at desc);
create index if not exists idx_challenges_team      on public.challenges (team_id);

-- =========================================================================
-- LIVE STATS TRIGGER — every new sale rolls up onto its salesperson:
--   units + revenue + today's units, XP gain, level recalculation, and
--   milestone badges. Rankings are derived from revenue, so they move too.
-- Runs SECURITY DEFINER so a salesperson's own sale can update their roster
-- row even though reps cannot write to `salespersons` directly (RLS).
-- =========================================================================
create or replace function public.apply_sale()
returns trigger language plpgsql security definer set search_path = public as $$
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
end; $$;

drop trigger if exists on_sale_insert on public.sales;
create trigger on_sale_insert
  after insert on public.sales
  for each row execute procedure public.apply_sale();

-- Optional daily reset of "today_sales" — schedule with pg_cron if you enable it:
--   select cron.schedule('kg-reset-today','0 0 * * *',
--     $$update public.salespersons set today_sales = 0$$);

-- =========================================================================
-- BACKFILL for anyone who signed up under v1 (admins with no team yet)
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
-- Done. Admins self-register (see login.html); salespersons join via an
-- invite link generated in the Salespersons page (register.html?invite=CODE).
-- =========================================================================
