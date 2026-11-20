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
