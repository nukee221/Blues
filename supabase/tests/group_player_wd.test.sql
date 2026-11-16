-- group_players.withdrawn and brackets.version after 0007_group_player_wd.sql. Rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into public.players (id, name, email) values
  ('10000000-0000-0000-0000-00000000f701', 'WD One', 'wd-one@example.test'),
  ('10000000-0000-0000-0000-00000000f702', 'WD Two', 'wd-two@example.test');
insert into public.courses (id, name) values ('20000000-0000-0000-0000-00000000f701', 'WD Course');
insert into public.tees (id, course_id, name, rating, slope, par)
  values ('21000000-0000-0000-0000-00000000f701', '20000000-0000-0000-0000-00000000f701', 'White', 70.0, 120, 72);
insert into public.seasons (id, year) values ('30000000-0000-0000-0000-00000000f701', 2097);
insert into public.events (id, season_id, name, event_type, format, status)
  values ('40000000-0000-0000-0000-00000000f701', '30000000-0000-0000-0000-00000000f701', 'WD Event', 'match_play', 'match_play', 'in_progress');
insert into public.rounds (id, event_id, round_number, tee_id, kind)
  values ('50000000-0000-0000-0000-00000000f701', '40000000-0000-0000-0000-00000000f701', 1, '21000000-0000-0000-0000-00000000f701', 'stroke');
insert into public.groups (id, round_id, scorer_player_id)
  values ('60000000-0000-0000-0000-00000000f701', '50000000-0000-0000-0000-00000000f701', '10000000-0000-0000-0000-00000000f701');
insert into public.group_players (group_id, player_id) values
  ('60000000-0000-0000-0000-00000000f701', '10000000-0000-0000-0000-00000000f701'),
  ('60000000-0000-0000-0000-00000000f701', '10000000-0000-0000-0000-00000000f702');

select is(
  (select bool_or(withdrawn) from public.group_players where group_id = '60000000-0000-0000-0000-00000000f701'),
  false, 'group_players.withdrawn defaults to false');

-- A partial signature is cleared when someone in the group withdraws.
insert into public.signatures (group_id, player_id, role)
  values ('60000000-0000-0000-0000-00000000f701', '10000000-0000-0000-0000-00000000f701', 'scorer');
select lives_ok(
  $$ update public.group_players set withdrawn = true
     where group_id = '60000000-0000-0000-0000-00000000f701' and player_id = '10000000-0000-0000-0000-00000000f702' $$,
  'withdrawing on an unsigned card is allowed');
select is(
  (select count(*)::int from public.signatures where group_id = '60000000-0000-0000-0000-00000000f701'),
  0, 'a withdrawal clears the card''s signatures');

-- Signed card: refused.
update public.groups set locked = true, signed_at = now() where id = '60000000-0000-0000-0000-00000000f701';
select throws_ok(
  $$ update public.group_players set withdrawn = false
     where group_id = '60000000-0000-0000-0000-00000000f701' and player_id = '10000000-0000-0000-0000-00000000f702' $$,
  'HGLCK', null, 'withdrawn cannot change on a signed card');
select lives_ok(
  $$ update public.group_players set playing_handicap = 3
     where group_id = '60000000-0000-0000-0000-00000000f701' and player_id = '10000000-0000-0000-0000-00000000f702' $$,
  'other group_players columns are not guarded by the WD trigger');

insert into public.brackets (id, event_id, size, rounds, state)
  values ('70000000-0000-0000-0000-00000000f701', '40000000-0000-0000-0000-00000000f701', 8, 3, '{"advanced": [], "bracket": null}');
select is(
  (select version from public.brackets where id = '70000000-0000-0000-0000-00000000f701'),
  0, 'brackets.version defaults to 0');
select ok(
  not has_function_privilege('authenticated', 'public.group_players_wd_guard()', 'execute'),
  'signed-in clients cannot call the WD guard function');

select * from finish();
rollback;
