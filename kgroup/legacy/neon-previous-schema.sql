-- Snapshot du schema Neon PRECEDENT, releve avant remplacement.
-- Toutes les tables etaient VIDES (0 ligne) au moment du releve.
-- Conserve pour reference uniquement : rien dans l app ne l utilise.
-- Date du releve : 2026-08-31T00:09:42.991Z

-- challenge_participants  (0 lignes)
create table public.challenge_participants (
  challenge_id        uuid not null,
  user_id             uuid not null,
  joined_at           timestamp with time zone not null default now()
);

-- challenges  (0 lignes)
create table public.challenges (
  id                  uuid not null default gen_random_uuid(),
  owner               uuid not null,
  team_id             uuid not null,
  title               text not null,
  description         text,
  reward              text,
  icon                text not null default '🏆'::text,
  hue                 text not null default '#0B7A4B'::text,
  target              integer not null default 100,
  current             integer not null default 0,
  ends                date,
  created_at          timestamp with time zone not null default now()
);

-- email_tokens  (0 lignes)
create table public.email_tokens (
  id                  uuid not null default gen_random_uuid(),
  user_id             uuid not null,
  purpose             text not null,
  token_hash          text not null,
  expires_at          timestamp with time zone not null,
  used_at             timestamp with time zone,
  created_at          timestamp with time zone not null default now()
);

-- sales  (0 lignes)
create table public.sales (
  id                  uuid not null default gen_random_uuid(),
  owner               uuid not null,
  team_id             uuid not null,
  rep_id              uuid,
  rep_name            text,
  customer            text not null,
  product             text not null,
  qty                 integer not null default 1,
  amount              bigint not null default 0,
  commission          bigint not null default 0,
  pay                 text not null default 'Card'::text,
  remarks             text,
  created_at          timestamp with time zone not null default now()
);

-- salespersons  (0 lignes)
create table public.salespersons (
  id                  uuid not null default gen_random_uuid(),
  owner               uuid not null,
  team_id             uuid not null,
  auth_id             uuid,
  invite_code         text,
  claimed             boolean not null default false,
  name                text not null,
  city                text,
  phone               text,
  email               text,
  sales               integer not null default 0,
  today_sales         integer not null default 0,
  revenue             bigint not null default 0,
  commission          bigint not null default 0,
  status              text not null default 'Active'::text,
  level               text not null default 'Rookie'::text,
  xp                  integer not null default 0,
  xp_to_next          integer not null default 1700,
  target              integer not null default 200,
  hue                 integer not null default 150,
  badges              jsonb not null default '[]'::jsonb,
  created_at          timestamp with time zone not null default now()
);

-- sessions  (0 lignes)
create table public.sessions (
  id                  uuid not null default gen_random_uuid(),
  user_id             uuid not null,
  token_hash          text not null,
  expires_at          timestamp with time zone not null,
  created_at          timestamp with time zone not null default now()
);

-- teams  (0 lignes)
create table public.teams (
  id                  uuid not null default gen_random_uuid(),
  name                text not null,
  owner               uuid not null,
  created_at          timestamp with time zone not null default now()
);

-- users  (0 lignes)
create table public.users (
  id                  uuid not null default gen_random_uuid(),
  email               text not null,
  password_hash       text,
  full_name           text not null,
  role                text not null default 'admin'::text,
  team_id             uuid,
  salesperson_id      uuid,
  city                text,
  hue                 integer not null default 150,
  email_verified_at   timestamp with time zone,
  created_at          timestamp with time zone not null default now(),
  updated_at          timestamp with time zone not null default now()
);

-- Index
CREATE UNIQUE INDEX challenge_participants_pkey ON public.challenge_participants USING btree (challenge_id, user_id);
CREATE UNIQUE INDEX challenges_pkey ON public.challenges USING btree (id);
CREATE UNIQUE INDEX email_tokens_pkey ON public.email_tokens USING btree (id);
CREATE UNIQUE INDEX email_tokens_token_hash_key ON public.email_tokens USING btree (token_hash);
CREATE INDEX idx_challenges_team ON public.challenges USING btree (team_id);
CREATE INDEX idx_email_tokens_lookup ON public.email_tokens USING btree (token_hash, purpose, expires_at);
CREATE INDEX idx_sales_team_created ON public.sales USING btree (team_id, created_at DESC);
CREATE INDEX idx_salespersons_team ON public.salespersons USING btree (team_id);
CREATE INDEX idx_sessions_user_expiry ON public.sessions USING btree (user_id, expires_at);
CREATE UNIQUE INDEX sales_pkey ON public.sales USING btree (id);
CREATE UNIQUE INDEX salespersons_auth_id_key ON public.salespersons USING btree (auth_id);
CREATE UNIQUE INDEX salespersons_invite_code_key ON public.salespersons USING btree (invite_code);
CREATE UNIQUE INDEX salespersons_pkey ON public.salespersons USING btree (id);
CREATE UNIQUE INDEX sessions_pkey ON public.sessions USING btree (id);
CREATE UNIQUE INDEX sessions_token_hash_key ON public.sessions USING btree (token_hash);
CREATE UNIQUE INDEX teams_pkey ON public.teams USING btree (id);
CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);
CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id);

-- Contraintes
alter table challenge_participants add constraint challenge_participants_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE;
alter table challenge_participants add constraint challenge_participants_challenge_id_not_null NOT NULL challenge_id;
alter table challenge_participants add constraint challenge_participants_joined_at_not_null NOT NULL joined_at;
alter table challenge_participants add constraint challenge_participants_pkey PRIMARY KEY (challenge_id, user_id);
alter table challenge_participants add constraint challenge_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table challenge_participants add constraint challenge_participants_user_id_not_null NOT NULL user_id;
alter table challenges add constraint challenges_created_at_not_null NOT NULL created_at;
alter table challenges add constraint challenges_current_check CHECK ((current >= 0));
alter table challenges add constraint challenges_current_not_null NOT NULL current;
alter table challenges add constraint challenges_hue_not_null NOT NULL hue;
alter table challenges add constraint challenges_icon_not_null NOT NULL icon;
alter table challenges add constraint challenges_id_not_null NOT NULL id;
alter table challenges add constraint challenges_owner_fkey FOREIGN KEY (owner) REFERENCES users(id) ON DELETE CASCADE;
alter table challenges add constraint challenges_owner_not_null NOT NULL owner;
alter table challenges add constraint challenges_pkey PRIMARY KEY (id);
alter table challenges add constraint challenges_target_check CHECK ((target > 0));
alter table challenges add constraint challenges_target_not_null NOT NULL target;
alter table challenges add constraint challenges_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table challenges add constraint challenges_team_id_not_null NOT NULL team_id;
alter table challenges add constraint challenges_title_not_null NOT NULL title;
alter table email_tokens add constraint email_tokens_created_at_not_null NOT NULL created_at;
alter table email_tokens add constraint email_tokens_expires_at_not_null NOT NULL expires_at;
alter table email_tokens add constraint email_tokens_id_not_null NOT NULL id;
alter table email_tokens add constraint email_tokens_pkey PRIMARY KEY (id);
alter table email_tokens add constraint email_tokens_purpose_check CHECK ((purpose = ANY (ARRAY['verify_email'::text, 'reset_password'::text])));
alter table email_tokens add constraint email_tokens_purpose_not_null NOT NULL purpose;
alter table email_tokens add constraint email_tokens_token_hash_key UNIQUE (token_hash);
alter table email_tokens add constraint email_tokens_token_hash_not_null NOT NULL token_hash;
alter table email_tokens add constraint email_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table email_tokens add constraint email_tokens_user_id_not_null NOT NULL user_id;
alter table sales add constraint sales_amount_check CHECK ((amount >= 0));
alter table sales add constraint sales_amount_not_null NOT NULL amount;
alter table sales add constraint sales_commission_check CHECK ((commission >= 0));
alter table sales add constraint sales_commission_not_null NOT NULL commission;
alter table sales add constraint sales_created_at_not_null NOT NULL created_at;
alter table sales add constraint sales_customer_not_null NOT NULL customer;
alter table sales add constraint sales_id_not_null NOT NULL id;
alter table sales add constraint sales_owner_fkey FOREIGN KEY (owner) REFERENCES users(id) ON DELETE RESTRICT;
alter table sales add constraint sales_owner_not_null NOT NULL owner;
alter table sales add constraint sales_pay_not_null NOT NULL pay;
alter table sales add constraint sales_pkey PRIMARY KEY (id);
alter table sales add constraint sales_product_not_null NOT NULL product;
alter table sales add constraint sales_qty_check CHECK ((qty > 0));
alter table sales add constraint sales_qty_not_null NOT NULL qty;
alter table sales add constraint sales_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES salespersons(id) ON DELETE SET NULL;
alter table sales add constraint sales_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table sales add constraint sales_team_id_not_null NOT NULL team_id;
alter table salespersons add constraint salespersons_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES users(id) ON DELETE SET NULL;
alter table salespersons add constraint salespersons_auth_id_key UNIQUE (auth_id);
alter table salespersons add constraint salespersons_badges_not_null NOT NULL badges;
alter table salespersons add constraint salespersons_claimed_not_null NOT NULL claimed;
alter table salespersons add constraint salespersons_commission_check CHECK ((commission >= 0));
alter table salespersons add constraint salespersons_commission_not_null NOT NULL commission;
alter table salespersons add constraint salespersons_created_at_not_null NOT NULL created_at;
alter table salespersons add constraint salespersons_hue_check CHECK (((hue >= 0) AND (hue <= 359)));
alter table salespersons add constraint salespersons_hue_not_null NOT NULL hue;
alter table salespersons add constraint salespersons_id_not_null NOT NULL id;
alter table salespersons add constraint salespersons_invite_code_key UNIQUE (invite_code);
alter table salespersons add constraint salespersons_level_not_null NOT NULL level;
alter table salespersons add constraint salespersons_name_not_null NOT NULL name;
alter table salespersons add constraint salespersons_owner_fkey FOREIGN KEY (owner) REFERENCES users(id) ON DELETE CASCADE;
alter table salespersons add constraint salespersons_owner_not_null NOT NULL owner;
alter table salespersons add constraint salespersons_pkey PRIMARY KEY (id);
alter table salespersons add constraint salespersons_revenue_check CHECK ((revenue >= 0));
alter table salespersons add constraint salespersons_revenue_not_null NOT NULL revenue;
alter table salespersons add constraint salespersons_sales_check CHECK ((sales >= 0));
alter table salespersons add constraint salespersons_sales_not_null NOT NULL sales;
alter table salespersons add constraint salespersons_status_check CHECK ((status = ANY (ARRAY['Active'::text, 'Inactive'::text])));
alter table salespersons add constraint salespersons_status_not_null NOT NULL status;
alter table salespersons add constraint salespersons_target_check CHECK ((target > 0));
alter table salespersons add constraint salespersons_target_not_null NOT NULL target;
alter table salespersons add constraint salespersons_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
alter table salespersons add constraint salespersons_team_id_not_null NOT NULL team_id;
alter table salespersons add constraint salespersons_today_sales_check CHECK ((today_sales >= 0));
alter table salespersons add constraint salespersons_today_sales_not_null NOT NULL today_sales;
alter table salespersons add constraint salespersons_xp_check CHECK ((xp >= 0));
alter table salespersons add constraint salespersons_xp_not_null NOT NULL xp;
alter table salespersons add constraint salespersons_xp_to_next_not_null NOT NULL xp_to_next;
alter table sessions add constraint sessions_created_at_not_null NOT NULL created_at;
alter table sessions add constraint sessions_expires_at_not_null NOT NULL expires_at;
alter table sessions add constraint sessions_id_not_null NOT NULL id;
alter table sessions add constraint sessions_pkey PRIMARY KEY (id);
alter table sessions add constraint sessions_token_hash_key UNIQUE (token_hash);
alter table sessions add constraint sessions_token_hash_not_null NOT NULL token_hash;
alter table sessions add constraint sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table sessions add constraint sessions_user_id_not_null NOT NULL user_id;
alter table teams add constraint teams_created_at_not_null NOT NULL created_at;
alter table teams add constraint teams_id_not_null NOT NULL id;
alter table teams add constraint teams_name_not_null NOT NULL name;
alter table teams add constraint teams_owner_fkey FOREIGN KEY (owner) REFERENCES users(id) ON DELETE CASCADE;
alter table teams add constraint teams_owner_not_null NOT NULL owner;
alter table teams add constraint teams_pkey PRIMARY KEY (id);
alter table users add constraint users_created_at_not_null NOT NULL created_at;
alter table users add constraint users_email_check CHECK ((email = lower(email)));
alter table users add constraint users_email_key UNIQUE (email);
alter table users add constraint users_email_not_null NOT NULL email;
alter table users add constraint users_full_name_not_null NOT NULL full_name;
alter table users add constraint users_hue_check CHECK (((hue >= 0) AND (hue <= 359)));
alter table users add constraint users_hue_not_null NOT NULL hue;
alter table users add constraint users_id_not_null NOT NULL id;
alter table users add constraint users_pkey PRIMARY KEY (id);
alter table users add constraint users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'salesperson'::text])));
alter table users add constraint users_role_not_null NOT NULL role;
alter table users add constraint users_salesperson_id_fkey FOREIGN KEY (salesperson_id) REFERENCES salespersons(id) ON DELETE SET NULL;
alter table users add constraint users_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
alter table users add constraint users_updated_at_not_null NOT NULL updated_at;
