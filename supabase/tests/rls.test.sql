-- Row-level security tests for the core schema.
-- Runs inside a transaction; everything is rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- ---------------------------------------------------------------------------
-- Fixtures (created as the test superuser; RLS does not apply here)
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'rls-player-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'rls-player-b@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', 'rls-commish@example.test');

insert into public.players (id, user_id, name, email, handicap_index, handicap_source, is_commissioner, pin_hash) values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'RLS Player A', 'rls-player-a@example.test', 10.4, 'GHIN', false, 'hash-a'),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'RLS Player B', 'rls-player-b@example.test', 5.0, 'TheGrint', false, 'hash-b'),
  ('10000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c3', 'RLS Commish', 'rls-commish@example.test', 12.0, 'Other', true, null);

insert into public.courses (id, name) values ('20000000-0000-0000-0000-000000000001', 'RLS Test Course');
insert into public.tees (id, course_id, name, rating, slope, par)
  values ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'White', 70.0, 120, 72);
insert into public.seasons (id, year) values ('30000000-0000-0000-0000-000000000001', 2099);

insert into public.events (id, season_id, name, event_type, format, status, registration_deadline, handicap_mode) values
  ('40000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-000000000001', 'Draft Event',   'regular',    'stroke', 'draft',     now() + interval '7 days', 'net'),
  ('40000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-000000000001', 'Open Event',    'match_play', 'match',  'published', now() + interval '7 days', 'net'),
  ('40000000-0000-0000-0000-0000000000f1', '30000000-0000-0000-0000-000000000001', 'Closed Event',  'regular',    'stroke', 'published', now() - interval '1 day',  'gross');

insert into public.rounds (id, event_id, round_number, tee_id, play_date, kind) values
  ('50000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000d1', 1, '21000000-0000-0000-0000-000000000001', current_date + 10, 'stroke'),
  ('50000000-0000-0000-0000-0000000000e1', '40000000-0000-0000-0000-0000000000e1', 1, '21000000-0000-0000-0000-000000000001', current_date + 10, 'match');

insert into public.groups (id, round_id, code, scorer_device_token) values
  ('60000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000d1', 'RLSD01', 'tok-d'),
  ('60000000-0000-0000-0000-0000000000e1', '50000000-0000-0000-0000-0000000000e1', 'RLSE01', 'tok-e');

insert into public.group_players (group_id, player_id, index_snapshot, playing_handicap) values
  ('60000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000a1', 10.4, 11),
  ('60000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000a1', 10.4, 11);

insert into public.scores (group_id, player_id, hole, gross) values
  ('60000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000a1', 1, 5),
  ('60000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000a1', 1, 4);

insert into public.signatures (group_id, player_id, role) values
  ('60000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000a1', 'scorer'),
  ('60000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000a1', 'scorer');

insert into public.brackets (id, event_id, size, rounds, state) values
  ('70000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000d1', 8, 3, '{}'),
  ('70000000-0000-0000-0000-0000000000e1', '40000000-0000-0000-0000-0000000000e1', 8, 3, '{}');

insert into public.bracket_matches (bracket_id, match_key, round) values
  ('70000000-0000-0000-0000-0000000000d1', 'R1M1', 1),
  ('70000000-0000-0000-0000-0000000000e1', 'R1M1', 1);

insert into public.points_awards (event_id, player_id, points) values
  ('40000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000a1', 500),
  ('40000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000a1', 500);

-- Player B is registered for the draft event and the open event.
insert into public.registrations (event_id, player_id, status) values
  ('40000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000b2', 'registered'),
  ('40000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000b2', 'registered');

insert into public.audit_log (actor_player_id, entity, entity_id, before, after)
  values ('10000000-0000-0000-0000-0000000000c3', 'events', '40000000-0000-0000-0000-0000000000e1', null, '{}');

-- ---------------------------------------------------------------------------
-- As non-commissioner Player A
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(public.current_player_id(), '10000000-0000-0000-0000-0000000000a1'::uuid, 'current_player_id() resolves the signed-in player');
select is(public.is_commissioner(), false, 'is_commissioner() is false for a regular player');

-- Draft vs published visibility
select is((select count(*)::int from public.events where id = '40000000-0000-0000-0000-0000000000d1'), 0, 'player sees 0 rows from a draft event');
select is((select count(*)::int from public.events where id = '40000000-0000-0000-0000-0000000000e1'), 1, 'player sees 1 row from a published event');
select is((select count(*)::int from public.rounds where event_id = '40000000-0000-0000-0000-0000000000d1'), 0, 'draft event rounds hidden');
select is((select count(*)::int from public.rounds where event_id = '40000000-0000-0000-0000-0000000000e1'), 1, 'published event rounds visible');
select is((select count(*)::int from public.groups where id = '60000000-0000-0000-0000-0000000000d1'), 0, 'draft event groups hidden');
select is((select count(*)::int from public.group_players where group_id = '60000000-0000-0000-0000-0000000000d1'), 0, 'draft event group_players hidden');
select is((select count(*)::int from public.scores where group_id = '60000000-0000-0000-0000-0000000000d1'), 0, 'draft event scores hidden');
select is((select count(*)::int from public.scores where group_id = '60000000-0000-0000-0000-0000000000e1'), 1, 'published event scores visible');
select is((select count(*)::int from public.signatures where group_id = '60000000-0000-0000-0000-0000000000d1'), 0, 'draft event signatures hidden');
select is((select count(*)::int from public.brackets where event_id = '40000000-0000-0000-0000-0000000000d1'), 0, 'draft event brackets hidden');
select is((select count(*)::int from public.bracket_matches where bracket_id = '70000000-0000-0000-0000-0000000000d1'), 0, 'draft event bracket_matches hidden');
select is((select count(*)::int from public.points_awards where event_id = '40000000-0000-0000-0000-0000000000d1'), 0, 'draft event points_awards hidden');
select is((select count(*)::int from public.points_awards where event_id = '40000000-0000-0000-0000-0000000000e1'), 1, 'published event points_awards visible');

-- Registrations: only own rows are visible
select is((select count(*)::int from public.registrations), 0, 'player cannot see other players'' registrations');

-- Group secrets are not readable
select throws_ok($$ select scorer_device_token from public.groups $$, '42501', null, 'player cannot read groups.scorer_device_token');
select throws_ok($$ select code from public.groups $$, '42501', null, 'player cannot read groups.code');

-- Players: base table only exposes own row; public_players exposes no email/pin
select is((select count(*)::int from public.players), 1, 'player sees only own row in players');
select ok((select count(*) from public.public_players) >= 3, 'public_players lists all players');
select hasnt_column('public', 'public_players', 'email', 'public_players has no email column');
select hasnt_column('public', 'public_players', 'pin_hash', 'public_players has no pin_hash column');

-- Players may update only their own pin_hash
select lives_ok($$ update public.players set pin_hash = 'new-hash' where id = '10000000-0000-0000-0000-0000000000a1' $$, 'player can update own pin_hash');
select throws_ok($$ update public.players set name = 'Hacked' where id = '10000000-0000-0000-0000-0000000000a1' $$, '42501', null, 'player cannot update own name');
select throws_ok($$ update public.players set is_commissioner = true where id = '10000000-0000-0000-0000-0000000000a1' $$, '42501', null, 'player cannot promote self to commissioner');
update public.players set pin_hash = 'stolen' where id = '10000000-0000-0000-0000-0000000000b2';

-- Registrations: own, published, before deadline
select throws_ok(
  $$ insert into public.registrations (event_id, player_id, status) values ('40000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000b2', 'registered') $$,
  '42501', null, 'player cannot insert a registration for another player');
select throws_ok(
  $$ insert into public.registrations (event_id, player_id, status) values ('40000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000a1', 'registered') $$,
  '42501', null, 'player cannot register after registration_deadline');
select throws_ok(
  $$ insert into public.registrations (event_id, player_id, status) values ('40000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000a1', 'registered') $$,
  '42501', null, 'player cannot register for a draft event');
select lives_ok(
  $$ insert into public.registrations (event_id, player_id, status) values ('40000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000a1', 'registered') $$,
  'player can register self for a published event before the deadline');
select lives_ok(
  $$ update public.registrations set status = 'withdrawn' where event_id = '40000000-0000-0000-0000-0000000000e1' and player_id = '10000000-0000-0000-0000-0000000000a1' $$,
  'player can withdraw own registration before the deadline');

-- Writes reserved for the service role
select throws_ok(
  $$ insert into public.scores (group_id, player_id, hole, gross) values ('60000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000a1', 2, 3) $$,
  '42501', null, 'player cannot insert into scores');
update public.scores set gross = 1 where group_id = '60000000-0000-0000-0000-0000000000e1';
select throws_ok(
  $$ insert into public.signatures (group_id, player_id, role) values ('60000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000a1', 'attest') $$,
  '42501', null, 'player cannot insert into signatures');
update public.events set status = 'final' where id = '40000000-0000-0000-0000-0000000000e1';
select throws_ok($$ truncate public.scores $$, '42501', null, 'player cannot truncate scores');

-- ---------------------------------------------------------------------------
-- Back to superuser: verify the silent no-op updates above changed nothing
-- ---------------------------------------------------------------------------
reset role;
select is(
  (select pin_hash || '|' || (select gross::text from public.scores where group_id = '60000000-0000-0000-0000-0000000000e1' and hole = 1)
          || '|' || (select status from public.events where id = '40000000-0000-0000-0000-0000000000e1')
     from public.players where id = '10000000-0000-0000-0000-0000000000b2'),
  'hash-b|4|published',
  'player updates to another player''s pin, scores and event status had no effect');

-- ---------------------------------------------------------------------------
-- As commissioner
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

select is((select count(*)::int from public.events where id = '40000000-0000-0000-0000-0000000000d1'), 1, 'commissioner sees draft events');
update public.events set status = 'published' where id = '40000000-0000-0000-0000-0000000000d1';
select is((select status from public.events where id = '40000000-0000-0000-0000-0000000000d1'), 'published', 'commissioner can update events.status');
select is((select count(*)::int from public.audit_log), 1, 'commissioner can read audit_log');

select * from finish();
rollback;
