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
