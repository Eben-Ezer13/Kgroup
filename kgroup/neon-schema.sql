-- KGROUP Neon schema. Run with DATABASE_URL through the migration command.
-- Business data is intentionally not deleted by this file.
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text,
  full_name text not null,
  role text not null default 'admin' check (role in ('admin', 'salesperson')),
  team_id uuid,
  salesperson_id uuid,
  city text,
  hue int not null default 150 check (hue between 0 and 359),
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table users drop constraint if exists users_team_id_fkey;
alter table users add constraint users_team_id_fkey foreign key (team_id) references teams(id) on delete set null;

create table if not exists salespersons (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  auth_id uuid unique references users(id) on delete set null,
  invite_code text unique,
  claimed boolean not null default false,
  name text not null,
  city text,
  phone text,
  email text,
  sales int not null default 0 check (sales >= 0),
  today_sales int not null default 0 check (today_sales >= 0),
  revenue bigint not null default 0 check (revenue >= 0),
  commission bigint not null default 0 check (commission >= 0),
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  level text not null default 'Rookie',
  xp int not null default 0 check (xp >= 0),
  xp_to_next int not null default 1700,
  target int not null default 200 check (target > 0),
  hue int not null default 150 check (hue between 0 and 359),
  badges jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table users drop constraint if exists users_salesperson_id_fkey;
alter table users add constraint users_salesperson_id_fkey foreign key (salesperson_id) references salespersons(id) on delete set null;

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references users(id) on delete restrict,
  team_id uuid not null references teams(id) on delete cascade,
  rep_id uuid references salespersons(id) on delete set null,
  rep_name text,
  customer text not null,
  product text not null,
  qty int not null default 1 check (qty > 0),
  amount bigint not null default 0 check (amount >= 0),
  commission bigint not null default 0 check (commission >= 0),
  pay text not null default 'Card',
  remarks text,
  created_at timestamptz not null default now()
);

create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  title text not null,
  description text,
  reward text,
  icon text not null default '🏆',
  hue text not null default '#0B7A4B',
  target int not null default 100 check (target > 0),
  current int not null default 0 check (current >= 0),
  ends date,
  created_at timestamptz not null default now()
);

create table if not exists challenge_participants (
  challenge_id uuid not null references challenges(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists email_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null check (purpose in ('verify_email', 'reset_password')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_salespersons_team on salespersons(team_id);
create index if not exists idx_sales_team_created on sales(team_id, created_at desc);
create index if not exists idx_challenges_team on challenges(team_id);
create index if not exists idx_sessions_user_expiry on sessions(user_id, expires_at);
create index if not exists idx_email_tokens_lookup on email_tokens(token_hash, purpose, expires_at);

create or replace function apply_sale() returns trigger language plpgsql as $$
declare
  levels text[] := array['Rookie','Bronze','Silver','Gold','Platinum','Diamond'];
  new_xp int; level_index int; new_badges jsonb;
begin
  if new.rep_id is null then return new; end if;
  select coalesce(xp, 0) + greatest(10, round(new.amount / 60.0))::int,
         coalesce(badges, '[]'::jsonb)
    into new_xp, new_badges from salespersons where id = new.rep_id for update;
  if not found then raise exception 'Unknown salesperson'; end if;
  level_index := least(5, floor(new_xp / 1700.0)::int);
  if (select sales + new.qty from salespersons where id = new.rep_id) >= 1 and not new_badges ? 'starter' then new_badges := new_badges || '["starter"]'::jsonb; end if;
  if (select sales + new.qty from salespersons where id = new.rep_id) >= 50 and not new_badges ? 'closer' then new_badges := new_badges || '["closer"]'::jsonb; end if;
  if (select revenue + new.amount from salespersons where id = new.rep_id) >= 100000 and not new_badges ? 'revenue' then new_badges := new_badges || '["revenue"]'::jsonb; end if;
  update salespersons set sales = sales + new.qty, today_sales = today_sales + new.qty,
    revenue = revenue + new.amount, commission = commission + new.commission,
    xp = new_xp, level = levels[level_index + 1], xp_to_next = (level_index + 1) * 1700,
    badges = new_badges where id = new.rep_id;
  return new;
end $$;
drop trigger if exists on_sale_insert on sales;
create trigger on_sale_insert after insert on sales for each row execute function apply_sale();
