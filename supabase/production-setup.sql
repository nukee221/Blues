-- Huntsville Golf Tour: the whole database setup in one file, for the Supabase SQL Editor.
-- Generated from supabase/migrations/0001 to 0014, in order (do not edit by hand; rebuild it
-- after adding a migration). Paste all of it into SQL Editor > New query and press Run, once.

-- ===================== 0001_core.sql =====================
-- 0001_core.sql — Huntsville Golf Tour core schema.
-- Row-level security and grants live in 0002_rls.sql.

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.players (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  user_id          uuid unique null references auth.users (id) on delete set null,
  name             text not null,
  email            extensions.citext not null unique,
  handicap_index   numeric(4,1),
  handicap_source  text check (handicap_source in ('GHIN', 'TheGrint', '18Birdies', 'Other')),
  is_commissioner  boolean not null default false,
  pin_hash         text null
);

-- ---------------------------------------------------------------------------
-- Courses
-- ---------------------------------------------------------------------------
create table public.courses (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null
);

create table public.tees (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  name        text not null,
  rating      numeric(4,1) not null,
  slope       int not null,
  par         int not null
);
create index tees_course_id_idx on public.tees (course_id);

create table public.holes (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  tee_id        uuid not null references public.tees (id) on delete cascade,
  number        int not null check (number between 1 and 18),
  par           int not null,
  stroke_index  int not null check (stroke_index between 1 and 18),
  unique (tee_id, number)
);

-- ---------------------------------------------------------------------------
-- Seasons and events
-- ---------------------------------------------------------------------------
create table public.seasons (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  year        int not null unique
);

create table public.points_tables (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  season_id      uuid not null references public.seasons (id) on delete cascade,
  event_type     text not null,
  winner_points  numeric not null,
  table_values   numeric[] not null,
  unique (season_id, event_type)
);

create table public.events (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  season_id              uuid not null references public.seasons (id) on delete restrict,
  name                   text not null,
  event_type             text not null check (event_type in ('regular', 'major', 'ryder_cup', 'championship', 'match_play')),
  format                 text,
  status                 text not null default 'draft'
                           check (status in ('draft', 'published', 'registration_closed', 'in_progress', 'final')),
  registration_deadline  timestamptz,
  handicap_mode          text check (handicap_mode in ('gross', 'net')),
  allowance_pct          int not null default 100,
  handicap_basis         text not null default 'index' check (handicap_basis in ('index', 'course')),
  match_strokes          text not null default 'full' check (match_strokes in ('full', 'offLow'))
);
create index events_season_id_idx on public.events (season_id);

create table public.registrations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  event_id    uuid not null references public.events (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  status      text not null default 'registered' check (status in ('registered', 'withdrawn')),
  unique (event_id, player_id)
);
create index registrations_player_id_idx on public.registrations (player_id);

-- ---------------------------------------------------------------------------
-- Rounds, groups, scoring
-- ---------------------------------------------------------------------------
create table public.rounds (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  event_id      uuid not null references public.events (id) on delete cascade,
  round_number  int not null,
  tee_id        uuid not null references public.tees (id) on delete restrict,
  play_date     date,
  kind          text not null check (kind in ('stroke', 'match')),
  unique (event_id, round_number)
);

-- groups: authenticated clients get only a column list (no code or
-- scorer_device_token); see the groups column grant in 0002_rls.sql.
create table public.groups (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  round_id             uuid not null references public.rounds (id) on delete cascade,
  tee_time             time null,
  start_hole           int not null default 1,
  code                 text unique,
  scorer_player_id     uuid null references public.players (id) on delete set null,
  scorer_device_token  text null,
  signed_at            timestamptz null,
  locked               boolean not null default false
);
create index groups_round_id_idx on public.groups (round_id);

create table public.group_players (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  group_id          uuid not null references public.groups (id) on delete cascade,
  player_id         uuid not null references public.players (id) on delete cascade,
  index_snapshot    numeric(4,1),
  playing_handicap  int,
  unique (group_id, player_id)
);
create index group_players_player_id_idx on public.group_players (player_id);

create table public.scores (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  hole        int not null check (hole between 1 and 18),
  gross       int check (gross > 0),
  client_ts   timestamptz,
  unique (group_id, player_id, hole)
);

create table public.signatures (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  role        text not null check (role in ('scorer', 'attest')),
  signed_at   timestamptz not null default now(),
  unique (group_id, role)
);

-- ---------------------------------------------------------------------------
-- Match play brackets
-- ---------------------------------------------------------------------------
create table public.brackets (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  event_id    uuid not null unique references public.events (id) on delete cascade,
  size        int not null,
  rounds      int not null,
  state       jsonb not null default '{}'::jsonb  -- serialized Bracket from @hgt/scoring
);

create table public.bracket_matches (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  bracket_id  uuid not null references public.brackets (id) on delete cascade,
  match_key   text not null,
  round       int not null,
  deadline    timestamptz,
  group_id    uuid null references public.groups (id) on delete set null,
  result      text null,
  forfeit     boolean not null default false,
  unique (bracket_id, match_key)
);

-- ---------------------------------------------------------------------------
-- Points and audit
-- ---------------------------------------------------------------------------
create table public.points_awards (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  event_id    uuid not null references public.events (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  points      numeric(8,2) not null,
  override    boolean not null default false,
  unique (event_id, player_id)
);
create index points_awards_player_id_idx on public.points_awards (player_id);

create table public.audit_log (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  actor_player_id  uuid references public.players (id) on delete set null,
  entity           text not null,
  entity_id        uuid,
  before           jsonb,
  after            jsonb,
  at               timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

-- ===================== 0002_rls.sql =====================
-- 0002_rls.sql — helpers, grants and row-level security.
--
-- Model:
--   * Commissioners (players.is_commissioner) have full access to every table.
--   * Authenticated players read reference data (courses, tees, holes, seasons,
--     points_tables), non-draft events, and everything hanging off a non-draft
--     event. They manage only their own registrations while the event is
--     published and before its deadline, and update only their own pin_hash.
--   * scores, signatures, audit_log, groups, group_players have no write
--     policies for players: those writes go through the service role (server
--     actions), which bypasses RLS.
--   * anon has no policies and therefore sees nothing.

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies do not recurse through RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_player_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.id from public.players p where p.user_id = auth.uid()
$$;

create or replace function public.is_commissioner()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_commissioner from public.players p where p.user_id = auth.uid()),
    false
  )
$$;

create or replace function public.event_visible(p_event_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.status <> 'draft'
  )
$$;

create or replace function public.round_visible(p_round_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rounds r
    join public.events e on e.id = r.event_id
    where r.id = p_round_id and e.status <> 'draft'
  )
$$;

create or replace function public.group_visible(p_group_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.groups g
    join public.rounds r on r.id = g.round_id
    join public.events e on e.id = r.event_id
    where g.id = p_group_id and e.status <> 'draft'
  )
$$;

create or replace function public.bracket_visible(p_bracket_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.brackets b
    join public.events e on e.id = b.event_id
    where b.id = p_bracket_id and e.status <> 'draft'
  )
$$;

create or replace function public.registration_open(p_event_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.status = 'published'
      and now() < e.registration_deadline
  )
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.current_player_id()',
    'public.is_commissioner()',
    'public.event_visible(uuid)',
    'public.round_visible(uuid)',
    'public.group_visible(uuid)',
    'public.bracket_visible(uuid)',
    'public.registration_open(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
-- Supabase's default privileges grant TRUNCATE (which bypasses RLS),
-- REFERENCES, TRIGGER and MAINTAIN to anon/authenticated. Strip them.
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;

-- Column grants below apply to the whole authenticated role, commissioners
-- included. By design, all commissioner writes to these columns go through
-- service-role server actions (which also write audit_log rows).
--
-- players: authenticated may UPDATE only pin_hash (row restricted by policy).
revoke update on public.players from authenticated;
grant update (pin_hash) on public.players to authenticated;

-- groups: code (bearer secret that opens a scorecard) and scorer_device_token
-- are not readable by authenticated clients; the service role reads them.
revoke select on public.groups from authenticated;
grant select (id, created_at, round_id, tee_time, start_hole, scorer_player_id, signed_at, locked)
  on public.groups to authenticated;

-- registrations: players may UPDATE only status, so a registration can never
-- be moved to another event.
revoke update on public.registrations from authenticated;
grant update (status) on public.registrations to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.players         enable row level security;
alter table public.courses         enable row level security;
alter table public.tees            enable row level security;
alter table public.holes           enable row level security;
alter table public.seasons         enable row level security;
alter table public.points_tables   enable row level security;
alter table public.events          enable row level security;
alter table public.registrations   enable row level security;
alter table public.rounds          enable row level security;
alter table public.groups          enable row level security;
alter table public.group_players   enable row level security;
alter table public.scores          enable row level security;
alter table public.signatures      enable row level security;
alter table public.brackets        enable row level security;
alter table public.bracket_matches enable row level security;
alter table public.points_awards   enable row level security;
alter table public.audit_log       enable row level security;

-- ---------------------------------------------------------------------------
-- Commissioners: full access on every table except scores, signatures and
-- audit_log, which are read-only (edits go through service-role server
-- actions that write audit rows).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'players', 'courses', 'tees', 'holes', 'seasons', 'points_tables', 'events',
    'registrations', 'rounds', 'groups', 'group_players',
    'brackets', 'bracket_matches', 'points_awards'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.is_commissioner()) with check (public.is_commissioner())',
      t || '_commissioner_all', t
    );
  end loop;
end
$$;

create policy scores_commissioner_select on public.scores
  for select to authenticated using (public.is_commissioner());
create policy signatures_commissioner_select on public.signatures
  for select to authenticated using (public.is_commissioner());
create policy audit_log_commissioner_select on public.audit_log
  for select to authenticated using (public.is_commissioner());

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------
create policy players_select_own on public.players
  for select to authenticated
  using (user_id = auth.uid());

create policy players_update_own on public.players
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Directory of players without email / pin_hash. Runs with the owner's
-- privileges (security_invoker = false) so every authenticated player can list
-- everyone despite the own-row policy on the base table.
create view public.public_players
with (security_invoker = false)
as
  select id, name, handicap_index, handicap_source, is_commissioner
  from public.players;

revoke all on public.public_players from public, anon, authenticated;
grant select on public.public_players to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reference data: readable by any authenticated player
-- ---------------------------------------------------------------------------
create policy courses_select on public.courses
  for select to authenticated using (true);
create policy tees_select on public.tees
  for select to authenticated using (true);
create policy holes_select on public.holes
  for select to authenticated using (true);
create policy seasons_select on public.seasons
  for select to authenticated using (true);
create policy points_tables_select on public.points_tables
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Events and dependents: visible once the event is not a draft
-- ---------------------------------------------------------------------------
create policy events_select_non_draft on public.events
  for select to authenticated using (status <> 'draft');

create policy rounds_select on public.rounds
  for select to authenticated using (public.event_visible(event_id));

create policy groups_select on public.groups
  for select to authenticated using (public.round_visible(round_id));

create policy group_players_select on public.group_players
  for select to authenticated using (public.group_visible(group_id));

create policy scores_select on public.scores
  for select to authenticated using (public.group_visible(group_id));

create policy signatures_select on public.signatures
  for select to authenticated using (public.group_visible(group_id));

create policy brackets_select on public.brackets
  for select to authenticated using (public.event_visible(event_id));

create policy bracket_matches_select on public.bracket_matches
  for select to authenticated using (public.bracket_visible(bracket_id));

create policy points_awards_select on public.points_awards
  for select to authenticated using (public.event_visible(event_id));

-- ---------------------------------------------------------------------------
-- Registrations: readable for any non-draft event (the field list); writes
-- own rows only, while published and before the deadline
-- ---------------------------------------------------------------------------
create policy registrations_select_visible on public.registrations
  for select to authenticated
  using (public.event_visible(event_id));

create policy registrations_insert_own on public.registrations
  for insert to authenticated
  with check (player_id = public.current_player_id() and public.registration_open(event_id));

create policy registrations_update_own on public.registrations
  for update to authenticated
  using (player_id = public.current_player_id() and public.registration_open(event_id))
  with check (player_id = public.current_player_id() and public.registration_open(event_id));

-- Writes to scores / signatures / audit_log (everyone) and groups /
-- group_players (non-commissioners) go through the service role.

-- ===================== 0003_extra_holes.sql =====================
-- 0003_extra_holes.sql — match-play extra holes and self-claimed scorers.
--
-- scores.hole: 19..36 are extra holes of a match (hole n maps to tee hole
-- ((n - 1) % 18) + 1 for par and stroke index). Server actions accept 19+
-- only for rounds of kind 'match'.
alter table public.scores drop constraint scores_hole_check;
alter table public.scores add constraint scores_hole_check check (hole between 1 and 36);

-- groups.scorer_self_claimed: true when scorer_player_id was set by a phone
-- claiming the card (not assigned by the commissioner), so a later hand-off
-- may name a different player. Not in the authenticated column grant
-- (0002_rls.sql), so players cannot read it; the service role can.
alter table public.groups add column scorer_self_claimed boolean not null default false;

-- ===================== 0004_pin_attempts.sql =====================
-- 0004_pin_attempts.sql — PIN lockout, atomic card signing, locked-card guard.
--
-- Everything here is for the service role (server actions); players reach none of it.
--   * pin_attempts: one row per PIN check. Five failures for a player within ten
--     minutes block that player's signing for ten minutes from the fifth failure.
--   * sign_card / admin_sign_card: insert a signature and lock the card once both
--     roles are signed, in one transaction.
--   * scores_guard trigger: scores of a locked (or signed) card cannot change, except
--     through admin_edit_score, which also writes the audit row. A change to an unlocked
--     card's gross clears its signatures (a signer signed different numbers).
--   * reopen_card: commissioner unlock with an audit row.
--   * groups_lock_guard trigger: a signed-in client (even a commissioner) cannot change
--     groups.locked / signed_at directly.
--
-- Errors raised for the app (PostgREST passes the SQLSTATE through as error.code):
--   HGLCK card is locked        HGNFD group not found       HGSAM same player both roles
--   HGNLK card is not signed    HGNIG player not in group   HGROL wrong role
--   23505 role already signed by another player

-- ---------------------------------------------------------------------------
-- PIN attempts
-- ---------------------------------------------------------------------------
create table public.pin_attempts (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players (id) on delete cascade,
  attempted_at  timestamptz not null default now(),
  success       boolean not null
);
create index pin_attempts_player_idx on public.pin_attempts (player_id, attempted_at desc);

alter table public.pin_attempts enable row level security;
revoke all on public.pin_attempts from public, anon, authenticated;

-- True while the player is blocked: some failure in the last ten minutes is the fifth
-- (or later) failure within a ten-minute window.
create or replace function public.pin_blocked(p_player uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pin_attempts f
    where f.player_id = p_player
      and not f.success
      and f.attempted_at > now() - interval '10 minutes'
      and (
        select count(*) from public.pin_attempts w
        where w.player_id = p_player
          and not w.success
          and w.attempted_at <= f.attempted_at
          and w.attempted_at >= f.attempted_at - interval '10 minutes'
      ) >= 5
  )
$$;

-- Reserve a PIN check: null when the player is blocked (nothing recorded), else the id
-- of a new attempt row recorded as a failure. The caller marks it a success with
-- pin_attempt_succeeded after the hash matches. Serialized per player, so concurrent
-- guesses each count before any of them is compared.
create or replace function public.pin_attempt_begin(p_player uuid)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('pin:' || p_player::text, 0));
  if public.pin_blocked(p_player) then
    return null;
  end if;
  insert into public.pin_attempts (player_id, success) values (p_player, false) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.pin_attempt_succeeded(p_attempt uuid)
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.pin_attempts set success = true where id = p_attempt
$$;

-- ---------------------------------------------------------------------------
-- Locked-card guard on scores
-- ---------------------------------------------------------------------------
create or replace function public.scores_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_signed boolean;
begin
  foreach v_group in array array_remove(array[
    case when tg_op <> 'INSERT' then old.group_id end,
    case when tg_op <> 'DELETE' then new.group_id end
  ], null) loop
    -- A group deleted in this transaction (ON DELETE CASCADE) is no longer found: allowed.
    select g.locked or g.signed_at is not null into v_signed from public.groups g where g.id = v_group;
    if coalesce(v_signed, false) then
      if coalesce(current_setting('hgt.allow_locked_edit', true), '') <> 'on' then
        raise exception 'card_locked: the card is signed; scores can no longer change'
          using errcode = 'HGLCK';
      end if;
    elsif tg_op = 'DELETE'
       or (tg_op = 'UPDATE' and new.gross is distinct from old.gross)
       or tg_op = 'INSERT' then
      -- The numbers changed under a partial signature: both sign again.
      delete from public.signatures s where s.group_id = v_group;
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger scores_guard
  before insert or update or delete on public.scores
  for each row execute function public.scores_guard();

-- Lock columns change only through sign_card / reopen_card (security definer) or the
-- service role. Commissioners have a full-access policy on groups (0002); without this
-- they could unlock a card with their own session and skip reopen_card's audit row.
create or replace function public.groups_lock_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.locked is distinct from old.locked or new.signed_at is distinct from old.signed_at) then
    raise exception 'card_lock: locked and signed_at change only by signing or reopening'
      using errcode = 'HGLCK';
  end if;
  return new;
end
$$;

create trigger groups_lock_guard
  before update on public.groups
  for each row execute function public.groups_lock_guard();

-- ---------------------------------------------------------------------------
-- Signing
-- ---------------------------------------------------------------------------
-- Insert the signature for p_role; lock the card when both roles are signed.
-- Re-signing a role by the same player is a no-op. Returns the card's locked state.
create or replace function public.sign_card(p_group uuid, p_player uuid, p_role text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_roles int;
begin
  select * into v_group from public.groups where id = p_group for update;
  if not found then
    raise exception 'group_not_found' using errcode = 'HGNFD';
  end if;
  if v_group.locked or v_group.signed_at is not null then
    raise exception 'card_locked: the card is already signed' using errcode = 'HGLCK';
  end if;
  if not exists (select 1 from public.group_players gp where gp.group_id = p_group and gp.player_id = p_player) then
    raise exception 'not_in_group' using errcode = 'HGNIG';
  end if;
  if p_role = 'scorer' and v_group.scorer_player_id is distinct from p_player then
    raise exception 'wrong_role: only the group''s scorer signs as scorer' using errcode = 'HGROL';
  end if;
  if p_role = 'attest' and v_group.scorer_player_id = p_player then
    raise exception 'same_player: the scorer cannot attest' using errcode = 'HGSAM';
  end if;
  if exists (select 1 from public.signatures s where s.group_id = p_group and s.player_id = p_player and s.role <> p_role) then
    raise exception 'same_player: one player cannot sign as scorer and attester' using errcode = 'HGSAM';
  end if;
  if not exists (select 1 from public.signatures s where s.group_id = p_group and s.role = p_role and s.player_id = p_player) then
    insert into public.signatures (group_id, player_id, role) values (p_group, p_player, p_role);
  end if;
  select count(distinct s.role) into v_roles from public.signatures s where s.group_id = p_group;
  if v_roles = 2 then
    update public.groups set locked = true, signed_at = now() where id = p_group;
    return true;
  end if;
  return false;
end
$$;

-- Commissioner signing on a player's behalf (no PIN): sign_card plus an audit row.
create or replace function public.admin_sign_card(p_group uuid, p_player uuid, p_role text, p_actor uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_locked boolean;
begin
  v_locked := public.sign_card(p_group, p_player, p_role);
  insert into public.audit_log (actor_player_id, entity, entity_id, before, after)
  values (p_actor, 'signature', p_group, null,
          jsonb_build_object('player_id', p_player, 'role', p_role, 'on_behalf', true, 'locked', v_locked));
  return v_locked;
end
$$;

-- Commissioner score edit, allowed on a locked card; audit row with before/after.
create or replace function public.admin_edit_score(p_group uuid, p_player uuid, p_hole int, p_gross int, p_actor uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_before int;
  v_had boolean;
  v_id uuid;
begin
  if not exists (select 1 from public.groups g where g.id = p_group) then
    raise exception 'group_not_found' using errcode = 'HGNFD';
  end if;
  if not exists (select 1 from public.group_players gp where gp.group_id = p_group and gp.player_id = p_player) then
    raise exception 'not_in_group' using errcode = 'HGNIG';
  end if;
  select s.gross, true into v_before, v_had from public.scores s
    where s.group_id = p_group and s.player_id = p_player and s.hole = p_hole
    for update;
  perform set_config('hgt.allow_locked_edit', 'on', true);
  insert into public.scores (group_id, player_id, hole, gross, client_ts)
  values (p_group, p_player, p_hole, p_gross, now())
  on conflict (group_id, player_id, hole) do update set gross = excluded.gross, client_ts = excluded.client_ts
  returning id into v_id;
  perform set_config('hgt.allow_locked_edit', 'off', true);
  insert into public.audit_log (actor_player_id, entity, entity_id, before, after)
  values (
    p_actor, 'score', v_id,
    case when coalesce(v_had, false)
      then jsonb_build_object('group_id', p_group, 'player_id', p_player, 'hole', p_hole, 'gross', v_before)
    end,
    jsonb_build_object('group_id', p_group, 'player_id', p_player, 'hole', p_hole, 'gross', p_gross)
  );
end
$$;

-- Commissioner reopen: unlock, clear signatures and signed_at, audit row with the reason.
create or replace function public.reopen_card(p_group uuid, p_actor uuid, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_sigs jsonb;
begin
  select * into v_group from public.groups where id = p_group for update;
  if not found then
    raise exception 'group_not_found' using errcode = 'HGNFD';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('player_id', s.player_id, 'role', s.role, 'signed_at', s.signed_at) order by s.role), '[]'::jsonb)
    into v_sigs from public.signatures s where s.group_id = p_group;
  if not (v_group.locked or v_group.signed_at is not null) and v_sigs = '[]'::jsonb then
    raise exception 'not_signed: nothing to reopen' using errcode = 'HGNLK';
  end if;
  delete from public.signatures where group_id = p_group;
  update public.groups set locked = false, signed_at = null where id = p_group;
  insert into public.audit_log (actor_player_id, entity, entity_id, before, after)
  values (
    p_actor, 'group', p_group,
    jsonb_build_object('locked', v_group.locked, 'signed_at', v_group.signed_at, 'signatures', v_sigs),
    jsonb_build_object('locked', false, 'signed_at', null, 'signatures', '[]'::jsonb, 'reason', p_reason, 'action', 'reopen')
  );
end
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.pin_blocked(uuid)',
    'public.pin_attempt_begin(uuid)',
    'public.pin_attempt_succeeded(uuid)',
    'public.sign_card(uuid, uuid, text)',
    'public.admin_sign_card(uuid, uuid, text, uuid)',
    'public.admin_edit_score(uuid, uuid, int, int, uuid)',
    'public.reopen_card(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
revoke all on function public.scores_guard() from public, anon, authenticated;
revoke all on function public.groups_lock_guard() from public, anon, authenticated;

-- ===================== 0005_signing_hardening.sql =====================
-- 0005_signing_hardening.sql — close the gaps a commissioner's own session (or any
-- signed-in client) had around signed cards and PINs, and escalate the PIN lockout.
--
--   * Delete guards: a signed-in client cannot delete a group that is signed or has a
--     signature, nor a round / event containing one, nor a player with a signature or a
--     score on a signed card (ON DELETE CASCADE would drop signed scores with no audit
--     row). The service role is not affected (server actions guard their own deletes).
--   * pin_hash: not readable by signed-in clients (column grants, like groups.code);
--     players.has_pin (generated) replaces it in the app. A signed-in client may set
--     pin_hash only on its own row, commissioners included.
--   * Changing groups.scorer_player_id clears an unlocked card's signatures; on a
--     signed card it is refused.
--   * Lockout escalation: blocks are recorded in pin_blocks; each block within 24 h of
--     an earlier one for the same player doubles (10, 20, 40 min ... capped at 24 h).

-- ---------------------------------------------------------------------------
-- Delete guards
-- ---------------------------------------------------------------------------
create or replace function public.group_is_signed(p_group uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.groups g where g.id = p_group and (g.locked or g.signed_at is not null))
      or exists (select 1 from public.signatures s where s.group_id = p_group)
$$;

-- Whether deleting this row would cascade away a signed card (or a signature).
create or replace function public.signed_delete_blocked(p_table text, p_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_table
    when 'groups' then public.group_is_signed(p_id)
    when 'rounds' then exists (select 1 from public.groups g where g.round_id = p_id and public.group_is_signed(g.id))
    when 'events' then exists (
      select 1 from public.rounds r join public.groups g on g.round_id = r.id
      where r.event_id = p_id and public.group_is_signed(g.id))
    when 'players' then exists (select 1 from public.signatures s where s.player_id = p_id)
      or exists (select 1 from public.scores sc where sc.player_id = p_id and public.group_is_signed(sc.group_id))
    else false
  end
$$;

-- Security invoker on purpose: current_user is the caller's role (the service role and
-- the cascades Postgres runs as the table owner pass through).
create or replace function public.signed_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and public.signed_delete_blocked(tg_table_name, old.id) then
    raise exception 'card_locked: % holds a signed card; reopen it first', tg_table_name
      using errcode = 'HGLCK';
  end if;
  return old;
end
$$;

create trigger groups_signed_delete_guard before delete on public.groups
  for each row execute function public.signed_delete_guard();
create trigger rounds_signed_delete_guard before delete on public.rounds
  for each row execute function public.signed_delete_guard();
create trigger events_signed_delete_guard before delete on public.events
  for each row execute function public.signed_delete_guard();
create trigger players_signed_delete_guard before delete on public.players
  for each row execute function public.signed_delete_guard();

-- ---------------------------------------------------------------------------
-- pin_hash: unreadable by clients, writable only on the caller's own row
-- ---------------------------------------------------------------------------
alter table public.players add column has_pin boolean generated always as (pin_hash is not null) stored;

revoke select on public.players from authenticated;
grant select (id, created_at, user_id, name, email, handicap_index, handicap_source, is_commissioner, has_pin)
  on public.players to authenticated;

create or replace function public.players_pin_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (case when tg_op = 'INSERT' then new.pin_hash is not null else new.pin_hash is distinct from old.pin_hash end)
     and (case when tg_op = 'INSERT' then new.user_id else old.user_id end) is distinct from auth.uid() then
    raise exception 'pin_hash: a PIN can be set only by its own player' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger players_pin_guard before insert or update on public.players
  for each row execute function public.players_pin_guard();

-- ---------------------------------------------------------------------------
-- Scorer change clears (or, when signed, refuses)
-- ---------------------------------------------------------------------------
create or replace function public.groups_scorer_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.scorer_player_id is distinct from old.scorer_player_id then
    if old.locked or old.signed_at is not null then
      raise exception 'card_locked: the scorer of a signed card cannot change' using errcode = 'HGLCK';
    end if;
    delete from public.signatures where group_id = new.id;
  end if;
  return new;
end
$$;

create trigger groups_scorer_change before update of scorer_player_id on public.groups
  for each row execute function public.groups_scorer_change();

-- ---------------------------------------------------------------------------
-- Escalating PIN lockout
-- ---------------------------------------------------------------------------
create table public.pin_blocks (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players (id) on delete cascade,
  -- The attempt whose (presumed) failure started the block; a success lifts it.
  attempt_id  uuid references public.pin_attempts (id) on delete set null,
  blocked_at  timestamptz not null default now(),
  until       timestamptz not null
);
create index pin_blocks_player_idx on public.pin_blocks (player_id, until desc);
alter table public.pin_blocks enable row level security;
revoke all on public.pin_blocks from public, anon, authenticated;

create or replace function public.pin_blocked(p_player uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.pin_blocks b where b.player_id = p_player and b.until > now())
$$;

-- Reserve a PIN check (see 0004). Null while blocked. The reservation counts as a
-- failure; when it is the fifth failure within ten minutes (since the last block
-- ended), a block starts now: 10 minutes, doubled for each block of this player in
-- the last 24 hours, capped at 24 hours. pin_attempt_succeeded lifts a block its
-- own attempt started (the fifth PIN was right after all).
create or replace function public.pin_attempt_begin(p_player uuid)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_since timestamptz;
  v_fails int;
  v_prior int;
begin
  perform pg_advisory_xact_lock(hashtextextended('pin:' || p_player::text, 0));
  if public.pin_blocked(p_player) then
    return null;
  end if;
  insert into public.pin_attempts (player_id, success) values (p_player, false) returning id into v_id;
  select greatest(now() - interval '10 minutes', coalesce(max(b.until), '-infinity'::timestamptz))
    into v_since from public.pin_blocks b where b.player_id = p_player;
  select count(*) into v_fails from public.pin_attempts a
    where a.player_id = p_player and not a.success and a.attempted_at > v_since;
  if v_fails >= 5 then
    select count(*) into v_prior from public.pin_blocks b
      where b.player_id = p_player and b.blocked_at > now() - interval '24 hours';
    insert into public.pin_blocks (player_id, attempt_id, until)
    values (p_player, v_id, now() + least(interval '10 minutes' * power(2, least(v_prior, 20))::int, interval '24 hours'));
  end if;
  return v_id;
end
$$;

create or replace function public.pin_attempt_succeeded(p_attempt uuid)
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.pin_attempts set success = true where id = p_attempt;
  delete from public.pin_blocks where attempt_id = p_attempt;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.group_is_signed(uuid)',
    'public.pin_blocked(uuid)',
    'public.pin_attempt_begin(uuid)',
    'public.pin_attempt_succeeded(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
-- The delete guard runs as the caller, so its helpers stay callable by signed-in
-- clients (they reveal only whether a card is signed, which groups.locked shows anyway).
grant execute on function public.group_is_signed(uuid) to authenticated;
revoke all on function public.signed_delete_blocked(text, uuid) from public, anon;
grant execute on function public.signed_delete_blocked(text, uuid) to authenticated, service_role;
revoke all on function public.signed_delete_guard() from public, anon, authenticated;
revoke all on function public.players_pin_guard() from public, anon, authenticated;
revoke all on function public.groups_scorer_change() from public, anon, authenticated;

-- ===================== 0006_realtime_scores.sql =====================
-- 0006_realtime_scores.sql — publish score changes over Supabase realtime so the live
-- leaderboard can refresh as scores arrive. RLS still applies to what each subscriber
-- receives (scores_select: non-draft events only). Idempotent.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scores'
  ) then
    alter publication supabase_realtime add table public.scores;
  end if;
end $$;

-- ===================== 0007_group_player_wd.sql =====================
-- 0007_group_player_wd.sql — play-in withdrawals (WD) and bracket versioning.
--
--   * group_players.withdrawn: a player who withdrew (or did not show) after the groups
--     were sent. Card completeness, signing and the play-in cut ignore them; the
--     leaderboard lists them as WD. Set only through the commissioner action
--     setGroupPlayerWithdrawn (service role, audited).
--   * group_players_wd_guard: withdrawn cannot change on a signed (locked) card; on an
--     unsigned card a change clears the card's signatures (the signers signed a
--     different field), like a scorer change (0005).
--   * brackets.version: optimistic-concurrency counter. Every write of brackets.state
--     is conditional on the version it read and bumps it, so two results recorded at
--     once cannot overwrite each other.
--
-- brackets.state holds { "advanced": [player ids], "bracket": Bracket | null }:
-- closing the play-in creates the row with the advancers and bracket null; the draw
-- fills in the serialized Bracket from @hgt/scoring.

alter table public.group_players add column withdrawn boolean not null default false;

alter table public.brackets add column version int not null default 0;

create or replace function public.group_players_wd_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.withdrawn is distinct from old.withdrawn then
    if exists (select 1 from public.groups g where g.id = new.group_id and (g.locked or g.signed_at is not null)) then
      raise exception 'card_locked: a withdrawal cannot change on a signed card' using errcode = 'HGLCK';
    end if;
    delete from public.signatures where group_id = new.group_id;
  end if;
  return new;
end
$$;

create trigger group_players_wd_guard before update of withdrawn on public.group_players
  for each row execute function public.group_players_wd_guard();

revoke all on function public.group_players_wd_guard() from public, anon, authenticated;

-- ===================== 0008_edit_locks.sql =====================
-- 0008_edit_locks.sql — a tee's numbers freeze once a signed card uses them.
--
-- Leaderboards, match status, cuts and points recalculation read the tee's rating, slope,
-- par and holes live, so changing them after a card is signed would silently change past
-- results. A signed-in client (even a commissioner's own session, via commissioner_all)
-- cannot change a tee's rating / slope / par / course, nor insert, change or delete a hole,
-- while that tee is used by a round with a signed card (locked or signed_at set). Renaming
-- stays allowed. The service role is not affected: saveCourse (actions/courses.ts) applies
-- the same rule itself and writes the audit rows. Add a new tee to change the numbers.
--
-- Error code: HGLCK (as the other lock guards, 0004/0005).

create or replace function public.tee_has_signed_card(p_tee uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rounds r join public.groups g on g.round_id = r.id
    where r.tee_id = p_tee and (g.locked or g.signed_at is not null))
$$;

-- Security invoker on purpose: current_user is the caller's role (see 0005).
create or replace function public.tees_signed_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.rating is distinct from old.rating
          or new.slope is distinct from old.slope
          or new.par is distinct from old.par
          or new.course_id is distinct from old.course_id)
     and public.tee_has_signed_card(old.id) then
    raise exception 'tee_locked: this tee has signed cards; add a new tee instead'
      using errcode = 'HGLCK';
  end if;
  return new;
end
$$;

create trigger tees_signed_guard before update on public.tees
  for each row execute function public.tees_signed_guard();

create or replace function public.holes_signed_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then
      if public.tee_has_signed_card(old.tee_id) then
        raise exception 'tee_locked: this tee has signed cards; add a new tee instead' using errcode = 'HGLCK';
      end if;
      return old;
    elsif tg_op = 'INSERT' then
      if public.tee_has_signed_card(new.tee_id) then
        raise exception 'tee_locked: this tee has signed cards; add a new tee instead' using errcode = 'HGLCK';
      end if;
    elsif (new.tee_id, new.number, new.par, new.stroke_index)
          is distinct from (old.tee_id, old.number, old.par, old.stroke_index)
          and (public.tee_has_signed_card(old.tee_id) or public.tee_has_signed_card(new.tee_id)) then
      raise exception 'tee_locked: this tee has signed cards; add a new tee instead' using errcode = 'HGLCK';
    end if;
  end if;
  return coalesce(new, old);
end
$$;

create trigger holes_signed_guard before insert or update or delete on public.holes
  for each row execute function public.holes_signed_guard();

-- The guards run as the caller, so the helper stays callable by signed-in clients (it
-- reveals only whether a tee has a signed card, which groups.locked shows anyway).
revoke all on function public.tee_has_signed_card(uuid) from public, anon;
grant execute on function public.tee_has_signed_card(uuid) to authenticated, service_role;
revoke all on function public.tees_signed_guard() from public, anon, authenticated;
revoke all on function public.holes_signed_guard() from public, anon, authenticated;

-- ===================== 0009_drop_tee_signed_guards.sql =====================
-- 0009_drop_tee_signed_guards.sql — the tour's commissioners want to correct course numbers
-- after play (mistakes are found late), so the 0008 triggers that blocked tee/hole edits
-- under signed cards are removed. saveCourse (actions/courses.ts) now requires an explicit
-- confirmResultsChange for such edits and writes audit rows with before/after.
-- tee_has_signed_card(uuid) stays: the action's confirm step and the course page use it.

drop trigger if exists tees_signed_guard on public.tees;
drop trigger if exists holes_signed_guard on public.holes;
drop function if exists public.tees_signed_guard();
drop function if exists public.holes_signed_guard();

-- ===================== 0010_profile.sql =====================
-- 0010_profile.sql: a player's home club and profile photo (roadmap step 4).
--   * players.home_club: free text, set by the player on their own row (column grant + the
--     existing players_update_own policy), shown on standings and leaderboards.
--   * player_photos: one small JPEG per player (resized in the browser to 256x256), stored
--     base64. No client access at all: written by a server action after requireUser, read by
--     the signed-in /photo/<id> route, both with the service role.
--   * players.photo_version: bumped on each new photo so image URLs (?v=) change and caches refresh.

alter table public.players
  add column home_club text check (home_club is null or char_length(home_club) between 1 and 60),
  add column photo_version int not null default 0;

grant select (home_club, photo_version) on public.players to authenticated;
grant update (pin_hash, home_club) on public.players to authenticated;

-- Directory view: same columns as before, plus the two new ones (appended, as create or replace requires).
create or replace view public.public_players
with (security_invoker = false)
as
  select id, name, handicap_index, handicap_source, is_commissioner, home_club, photo_version
  from public.players;

create table public.player_photos (
  player_id   uuid primary key references public.players (id) on delete cascade,
  updated_at  timestamptz not null default now(),
  jpeg_base64 text not null check (char_length(jpeg_base64) <= 200000)
);
alter table public.player_photos enable row level security;
revoke all on public.player_photos from public, anon, authenticated;
grant all on public.player_photos to service_role;

-- ===================== 0011_round_reminders.sql =====================
-- 0011_round_reminders.sql: the evening-before reminder (roadmap step 7).
-- rounds.reminder_sent_at is set when the 6 PM Central reminder for the round goes out, so the
-- scheduled job never sends it twice. Written only by the job, with the service role.

alter table public.rounds add column reminder_sent_at timestamptz;

-- ===================== 0012_reminder_settings.sql =====================
-- 0012_reminder_settings.sql: commissioners choose how each event's evening-before reminder goes out.
--   reminder_mode 'auto'   : sent the evening before each round at reminder_time (Central).
--                 'manual' : only when a commissioner taps "Send reminder now".
-- The scheduler runs every 15 minutes (see RUNBOOK), so times are in 15-minute steps.

alter table public.events
  add column reminder_mode text not null default 'auto' check (reminder_mode in ('auto', 'manual')),
  add column reminder_time time not null default '18:00'
    check (extract(minute from reminder_time)::int % 15 = 0 and extract(second from reminder_time) = 0);

-- ===================== 0013_pairing_rules.sql =====================
-- Pairing rules (tour-wide): two players who like to play together, or who should be kept
-- in different groups. Used by "Make groups" as a best effort; read and written only by
-- commissioner server actions through the service role.
create table public.pairing_rules (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  player_a    uuid not null references public.players (id) on delete cascade,
  player_b    uuid not null references public.players (id) on delete cascade,
  kind        text not null check (kind in ('together', 'apart')),
  -- one rule per pair, stored with the smaller id first
  check (player_a < player_b),
  unique (player_a, player_b)
);
alter table public.pairing_rules enable row level security;
revoke all on public.pairing_rules from public, anon, authenticated;
grant all on public.pairing_rules to service_role;

-- ===================== 0014_explicit_grants.sql =====================
-- 0014_explicit_grants.sql — grant the API roles' privileges explicitly.
--
-- Migrations 0001 to 0013 relied on Supabase's default privileges: a new table, view or
-- function in public is granted to anon, authenticated and service_role automatically, and
-- the earlier files only narrow that (0002 strips TRUNCATE/REFERENCES/TRIGGER/MAINTAIN and
-- sets column grants; 0004, 0005, 0010 and 0013 keep some tables service-role only).
-- A project created with "Grant API access to new tables automatically" turned off has no
-- such defaults, and the app's queries would fail with "permission denied".
--
-- This file states the end result of 0001 to 0013 on a default project, exactly, and no
-- wider. On a default project every statement below is already true (GRANT only adds), so
-- it changes nothing there. Row-level security (on for every table) still decides rows.
-- A later migration that adds a table must grant it explicitly too.

-- ---------------------------------------------------------------------------
-- Ordinary tables: anon and authenticated get SELECT, INSERT, UPDATE, DELETE
-- (RLS policies decide which rows; anon has no policies, so it sees nothing).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  public.courses,
  public.tees,
  public.holes,
  public.seasons,
  public.points_tables,
  public.events,
  public.rounds,
  public.group_players,
  public.scores,
  public.signatures,
  public.brackets,
  public.bracket_matches,
  public.points_awards,
  public.audit_log
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables with column restrictions for authenticated (see 0002, 0005, 0010).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.players, public.groups, public.registrations to anon;

-- players: no SELECT of pin_hash, UPDATE of pin_hash and home_club only.
grant insert, delete on public.players to authenticated;
grant select (id, created_at, user_id, name, email, handicap_index, handicap_source,
              is_commissioner, has_pin, home_club, photo_version)
  on public.players to authenticated;
grant update (pin_hash, home_club) on public.players to authenticated;

-- groups: code and scorer_device_token are not readable.
grant insert, update, delete on public.groups to authenticated;
grant select (id, created_at, round_id, tee_time, start_hole, scorer_player_id, signed_at, locked)
  on public.groups to authenticated;

-- registrations: UPDATE of status only.
grant select, insert, delete on public.registrations to authenticated;
grant update (status) on public.registrations to authenticated;

-- public_players view: authenticated may read it, anon may not.
grant select on public.public_players to authenticated;

-- ---------------------------------------------------------------------------
-- service_role: everything, on every table and the view. pin_attempts, pin_blocks,
-- player_photos and pairing_rules are service-role only (nothing above grants them).
-- ---------------------------------------------------------------------------
grant all on
  public.players,
  public.courses,
  public.tees,
  public.holes,
  public.seasons,
  public.points_tables,
  public.events,
  public.registrations,
  public.rounds,
  public.groups,
  public.group_players,
  public.scores,
  public.signatures,
  public.brackets,
  public.bracket_matches,
  public.points_awards,
  public.audit_log,
  public.pin_attempts,
  public.pin_blocks,
  public.player_photos,
  public.pairing_rules,
  public.public_players
to service_role;

-- ---------------------------------------------------------------------------
-- Functions. Earlier files revoke EXECUTE from public/anon (and sometimes authenticated)
-- on every function and grant some back; service_role kept the rest through the defaults.
-- ---------------------------------------------------------------------------
grant execute on function
  public.current_player_id(),
  public.is_commissioner(),
  public.event_visible(uuid),
  public.round_visible(uuid),
  public.group_visible(uuid),
  public.bracket_visible(uuid),
  public.registration_open(uuid),
  public.group_is_signed(uuid),
  public.signed_delete_blocked(text, uuid),
  public.tee_has_signed_card(uuid)
to authenticated, service_role;

grant execute on function
  public.sign_card(uuid, uuid, text),
  public.admin_sign_card(uuid, uuid, text, uuid),
  public.reopen_card(uuid, uuid, text),
  public.admin_edit_score(uuid, uuid, integer, integer, uuid),
  public.pin_attempt_begin(uuid),
  public.pin_attempt_succeeded(uuid),
  public.pin_blocked(uuid),
  public.scores_guard(),
  public.groups_lock_guard(),
  public.signed_delete_guard(),
  public.players_pin_guard(),
  public.groups_scorer_change(),
  public.group_players_wd_guard()
to service_role;
