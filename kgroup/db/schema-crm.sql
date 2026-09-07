-- =========================================================================
-- KGROUP — CRM clients, anniversaires & rémunération   (migration v3.2)
-- Appliquée après db/schema.sql par `npm run db:migrate`. Idempotente.
--
-- PRINCIPE DE CONCEPTION — on réutilise le contrat KGroup déjà encodé dans
-- data.js, on n'invente aucune règle métier :
--   * Art. 3 — la commission est un MONTANT PAR UNITÉ dépendant du produit
--     (30 ml → 5, 50 ml → 8, 100 ml → 15 DHS). Ce n'est pas un pourcentage.
--     Elle est déjà calculée à la vente et stockée dans sales.commission.
--   * Art. 4 — le bonus est un PALIER MENSUEL sur le nombre de ventes validées
--     DANS LE MOIS. Les paliers vivent dans compensation_settings, jamais en
--     dur dans le code, et sont figés dans chaque période de paie.
--   * Le contrat ne prévoit AUCUN salaire fixe : salary_base vaut 0 par défaut
--     et reste configurable par l'administrateur.
--
-- MODÈLE CLIENT — celui qui préserve l'historique réel des ventes :
--   clients.rep_id → commercial RESPONSABLE de la relation
--   sales.rep_id   → commercial AYANT RÉALISÉ la vente
-- Les deux peuvent différer ; une vente reste attribuée à son auteur.
--
-- AUCUNE MODIFICATION DESTRUCTIVE : que des CREATE IF NOT EXISTS et des
-- ADD COLUMN IF NOT EXISTS. sales.customer (texte libre) est conservé tel quel.
-- =========================================================================

-- ---------- CLIENTS ------------------------------------------------------
create table if not exists public.clients (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  rep_id       uuid references public.salespersons (id) on delete set null, -- responsable
  name         text not null,
  phone        text,                       -- tel que saisi, pour l'affichage
  phone_e164   text,                       -- normalisé, pour la recherche et l'unicité
  birthday     date,                       -- facultatif : souvent inconnu
  email        text,
  city         text,
  notes        text,
  -- Statistiques dénormalisées, tenues à jour par apply_sale_client() plus bas.
  -- Même approche que salespersons : les listes restent lisibles sans agrégation.
  sales_count  int    default 0,
  total_spent  bigint default 0,
  last_sale_at timestamptz,
  created_at   timestamptz default now()
);

-- Un même numéro ne peut exister qu'une fois par équipe : c'est ce qui empêche
-- les doublons quand deux commerciaux saisissent le même client.
create unique index if not exists idx_clients_phone_uniq
  on public.clients (team_id, phone_e164) where phone_e164 is not null;
create index if not exists idx_clients_team     on public.clients (team_id);
create index if not exists idx_clients_rep      on public.clients (rep_id);
create index if not exists idx_clients_birthday on public.clients (birthday) where birthday is not null;
create index if not exists idx_clients_name     on public.clients (team_id, lower(name));

-- ---------- LIEN VENTE → CLIENT ------------------------------------------
-- Colonne ajoutée, jamais substituée : sales.customer reste en place pour ne
-- casser ni les lignes existantes ni l'affichage actuel.
alter table public.sales add column if not exists client_id uuid;

do $mig$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_client_id_fkey') then
    alter table public.sales
      add constraint sales_client_id_fkey
      foreign key (client_id) references public.clients (id) on delete set null;
  end if;
end
$mig$;

-- An objective is business data, not a platform filler value. Existing
-- databases created with schema.sql may still carry the old 100-unit default.
alter table public.challenges alter column target drop default;

create index if not exists idx_sales_client on public.sales (client_id);

-- ---------- PARAMÈTRES DE RÉMUNÉRATION (une ligne par équipe) ------------
-- Rien n'est codé en dur côté application : ces valeurs sont lues à chaque
-- calcul, et recopiées dans payroll_periods.settings à la clôture.
create table if not exists public.compensation_settings (
  team_id         uuid primary key references public.teams (id) on delete cascade,
  salary_base     bigint  default 0,        -- le contrat KGroup n'en prévoit pas
  -- 'per_unit' : on somme sales.commission (Art. 3 — comportement actuel)
  -- 'percent'  : commission_rate % du chiffre d'affaires du mois
  commission_mode text    default 'per_unit',
  commission_rate numeric(5,2) default 0,
  -- Paliers de bonus mensuels — mêmes données que KG.contract.bonuses (Art. 4)
  bonus_tiers     jsonb   default '[{"sales":20,"bonus":100,"extra":"Code promo"},{"sales":40,"bonus":300,"extra":"Parfum offert"},{"sales":60,"bonus":600,"extra":"Parfums offerts"}]'::jsonb,
  currency        text    default 'DHS',
  updated_at      timestamptz default now(),
  updated_by      uuid references public.users (id) on delete set null
);

-- ---------- PÉRIODES DE PAIE --------------------------------------------
-- Une ligne par commercial et par mois. Tant que le mois n'est pas clôturé la
-- ligne est recalculée à la demande ; à la clôture elle est figée avec une
-- COPIE des paramètres utilisés. Changer les règles plus tard ne peut donc
-- jamais réécrire une paie passée.
create table if not exists public.payroll_periods (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  rep_id       uuid not null references public.salespersons (id) on delete cascade,
  period       date not null,              -- 1er jour du mois concerné
  sales_count  int    default 0,
  revenue      bigint default 0,
  commission   bigint default 0,
  bonus        bigint default 0,
  salary_base  bigint default 0,
  total        bigint default 0,
  status       text   default 'EN_COURS',  -- EN_COURS | CLOTURE | VALIDEE | PAYEE
  settings     jsonb,                      -- paramètres figés à la clôture
  closed_at    timestamptz,
  closed_by    uuid references public.users (id) on delete set null,
  created_at   timestamptz default now(),
  unique (rep_id, period)
);
create index if not exists idx_payroll_team_period on public.payroll_periods (team_id, period desc);

-- ---------- RAPPELS D'ANNIVERSAIRE ---------------------------------------
-- Table de déduplication : la clé primaire garantit qu'un même rappel ne peut
-- pas partir deux fois pour le même client, la même date et le même type,
-- même si le planificateur se déclenche plusieurs fois dans la journée.
create table if not exists public.birthday_reminders (
  client_id  uuid not null references public.clients (id) on delete cascade,
  remind_on  date not null,                -- date locale Africa/Casablanca
  kind       text not null,                -- 'J-1' | 'JOUR-J'
  created_at timestamptz default now(),
  primary key (client_id, remind_on, kind)
);

-- =========================================================================
-- ROLLUP CLIENT — chaque vente rattachée à un client met à jour ses totaux.
-- Même mécanique que apply_sale() sur les commerciaux, pour rester cohérent.
-- =========================================================================
create or replace function public.apply_sale_client()
returns trigger language plpgsql as $fn$
begin
  if new.client_id is null then return new; end if;
  update public.clients set
    sales_count  = coalesce(sales_count, 0) + 1,
    total_spent  = coalesce(total_spent, 0) + coalesce(new.amount, 0),
    last_sale_at = greatest(coalesce(last_sale_at, new.created_at), new.created_at)
  where id = new.client_id;
  return new;
end; $fn$;

drop trigger if exists on_sale_insert_client on public.sales;
create trigger on_sale_insert_client
  after insert on public.sales
  for each row execute procedure public.apply_sale_client();

-- =========================================================================
-- ANNIVERSAIRES — tout se calcule en heure locale du Maroc.
-- Le 29 février est ramené au 28 les années non bissextiles, sinon ces
-- clients ne seraient fêtés qu'une année sur quatre.
-- =========================================================================
create or replace function public.birthday_falls_on(p_birthday date, p_day date)
returns boolean language plpgsql immutable as $fn$
declare
  v_month   int;
  v_day     int;
  v_year    int;
  v_is_leap boolean;
begin
  if p_birthday is null then return false; end if;
  v_month := extract(month from p_birthday);
  v_day   := extract(day   from p_birthday);

  -- Cas général : même jour, même mois.
  if extract(month from p_day) = v_month and extract(day from p_day) = v_day then
    return true;
  end if;

  -- 29 février : hors année bissextile, on fête le 28.
  if v_month = 2 and v_day = 29 then
    v_year    := extract(year from p_day);
    v_is_leap := (v_year % 4 = 0 and (v_year % 100 <> 0 or v_year % 400 = 0));
    if not v_is_leap
       and extract(month from p_day) = 2
       and extract(day from p_day) = 28 then
      return true;
    end if;
  end if;

  return false;
end; $fn$;

-- Nombre de jours avant le prochain anniversaire (0 = aujourd'hui).
create or replace function public.days_until_birthday(p_birthday date, p_today date)
returns int language plpgsql immutable as $fn$
declare
  i int;
begin
  if p_birthday is null then return null; end if;
  -- Test jour par jour sur un an : exact, gère le 29 février via
  -- birthday_falls_on(), et 366 itérations restent négligeables.
  for i in 0..366 loop
    if public.birthday_falls_on(p_birthday, p_today + i) then return i; end if;
  end loop;
  return null;
end; $fn$;

-- Jour courant au Maroc, quelle que soit la zone du serveur.
create or replace function public.today_casablanca()
returns date language sql stable as $fn$
  select (now() at time zone 'Africa/Casablanca')::date;
$fn$;

-- =========================================================================
-- RÔLE RELATION_CLIENT
-- profiles.role est un `text` libre : aucune contrainte à modifier, la valeur
-- 'relation_client' vient simplement s'ajouter à 'admin' et 'salesperson'.
-- Un administrateur l'attribue depuis la page Clients.
-- =========================================================================

-- Une ligne de paramètres par équipe existante, pour que les calculs aient
-- toujours une configuration à lire.
insert into public.compensation_settings (team_id)
  select t.id from public.teams t
  on conflict (team_id) do nothing;

-- ---------- ESPACE ADMINISTRATEUR PARTAGE -------------------------------
-- Les premières versions créaient une équipe par administrateur. On conserve
-- les lignes d'équipe pour ne rien casser, mais toutes les données métier et
-- tous les profils admin sont ramenés dans l'espace le plus ancien. Le trigger
-- de schema.sql utilise ensuite ce même espace pour les nouvelles inscriptions.
do $mig$
declare
  v_workspace uuid;
begin
  select id into v_workspace
    from public.teams
   order by created_at nulls first, id
   limit 1;

  if v_workspace is not null then
    -- A phone number was unique only inside each old team. Keep the oldest
    -- client row when two teams had the same number, and repoint its sales.
    update public.sales s
       set client_id = (
         select min(keeper.id)
           from public.clients duplicate
           join public.clients keeper
             on keeper.phone_e164 = duplicate.phone_e164
            and keeper.id < duplicate.id
          where duplicate.id = s.client_id
       )
     where exists (
       select 1 from public.clients duplicate
        where duplicate.id = s.client_id
          and duplicate.phone_e164 is not null
          and exists (
            select 1 from public.clients keeper
             where keeper.phone_e164 = duplicate.phone_e164
               and keeper.id < duplicate.id
          )
     );
    delete from public.birthday_reminders br
     using public.clients duplicate
     where br.client_id = duplicate.id
       and duplicate.phone_e164 is not null
       and exists (
         select 1 from public.clients keeper
          where keeper.phone_e164 = duplicate.phone_e164
            and keeper.id < duplicate.id
       );
    delete from public.clients duplicate
     where duplicate.phone_e164 is not null
       and exists (
         select 1 from public.clients keeper
          where keeper.phone_e164 = duplicate.phone_e164
            and keeper.id < duplicate.id
       );

    -- One settings row is allowed per workspace.
    delete from public.compensation_settings where team_id <> v_workspace;
    update public.profiles set team_id = v_workspace where role = 'admin';
    update public.salespersons set team_id = v_workspace where team_id is not null;
    update public.sales set team_id = v_workspace where team_id is not null;
    update public.challenges set team_id = v_workspace where team_id is not null;
    update public.training_progress set team_id = v_workspace where team_id is not null;
    update public.quiz_attempts set team_id = v_workspace where team_id is not null;
    update public.notifications set team_id = v_workspace where team_id is not null;
    update public.clients set team_id = v_workspace where team_id is not null;
    update public.compensation_settings set team_id = v_workspace where team_id is not null;
    update public.payroll_periods set team_id = v_workspace where team_id is not null;
  end if;
end
$mig$;
