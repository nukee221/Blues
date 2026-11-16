-- 0005_signing_hardening.sql: delete guards, pin_hash privacy, scorer change, lockout
-- escalation. Rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000a5c1', 'authenticated', 'authenticated', 'hd-commish@example.test'),
  ('00000000-0000-0000-0000-00000000a5c2', 'authenticated', 'authenticated', 'hd-player@example.test');
insert into public.players (id, user_id, name, email, is_commissioner, pin_hash) values
  ('10000000-0000-0000-0000-00000000a501', null, 'HD Scorer', 'hd-scorer@example.test', false, 'hash-scorer'),
  ('10000000-0000-0000-0000-00000000a502', null, 'HD Marker', 'hd-marker@example.test', false, null),
  ('10000000-0000-0000-0000-00000000a5c1', '00000000-0000-0000-0000-00000000a5c1', 'HD Commish', 'hd-commish@example.test', true, null),
  ('10000000-0000-0000-0000-00000000a5c2', '00000000-0000-0000-0000-00000000a5c2', 'HD Player', 'hd-player@example.test', false, null),
  ('10000000-0000-0000-0000-00000000a503', null, 'HD Lockout', 'hd-lockout@example.test', false, null),
  ('10000000-0000-0000-0000-00000000a504', null, 'HD Lucky', 'hd-lucky@example.test', false, null);
insert into public.courses (id, name) values ('20000000-0000-0000-0000-00000000a501', 'HD Course');
insert into public.tees (id, course_id, name, rating, slope, par)
  values ('21000000-0000-0000-0000-00000000a501', '20000000-0000-0000-0000-00000000a501', 'White', 70.0, 120, 72);
insert into public.seasons (id, year) values ('30000000-0000-0000-0000-00000000a501', 2096);
-- E1: locked card G1. E2: card G2 with one signature. E3: unsigned card G3.
insert into public.events (id, season_id, name, event_type, status) values
  ('40000000-0000-0000-0000-00000000a501', '30000000-0000-0000-0000-00000000a501', 'HD Locked', 'regular', 'in_progress'),
  ('40000000-0000-0000-0000-00000000a502', '30000000-0000-0000-0000-00000000a501', 'HD Partial', 'regular', 'in_progress'),
  ('40000000-0000-0000-0000-00000000a503', '30000000-0000-0000-0000-00000000a501', 'HD Unsigned', 'regular', 'in_progress');
insert into public.rounds (id, event_id, round_number, tee_id, kind) values
  ('50000000-0000-0000-0000-00000000a501', '40000000-0000-0000-0000-00000000a501', 1, '21000000-0000-0000-0000-00000000a501', 'stroke'),
  ('50000000-0000-0000-0000-00000000a502', '40000000-0000-0000-0000-00000000a502', 1, '21000000-0000-0000-0000-00000000a501', 'stroke'),
  ('50000000-0000-0000-0000-00000000a503', '40000000-0000-0000-0000-00000000a503', 1, '21000000-0000-0000-0000-00000000a501', 'stroke');
insert into public.groups (id, round_id, scorer_player_id) values
  ('60000000-0000-0000-0000-00000000a501', '50000000-0000-0000-0000-00000000a501', '10000000-0000-0000-0000-00000000a501'),
  ('60000000-0000-0000-0000-00000000a502', '50000000-0000-0000-0000-00000000a502', '10000000-0000-0000-0000-00000000a501'),
  ('60000000-0000-0000-0000-00000000a503', '50000000-0000-0000-0000-00000000a503', '10000000-0000-0000-0000-00000000a501');
insert into public.group_players (group_id, player_id)
  select g, p from unnest(array['60000000-0000-0000-0000-00000000a501', '60000000-0000-0000-0000-00000000a502', '60000000-0000-0000-0000-00000000a503']::uuid[]) g,
                   unnest(array['10000000-0000-0000-0000-00000000a501', '10000000-0000-0000-0000-00000000a502']::uuid[]) p;
insert into public.scores (group_id, player_id, hole, gross)
  select g, '10000000-0000-0000-0000-00000000a501', 1, 4
  from unnest(array['60000000-0000-0000-0000-00000000a501', '60000000-0000-0000-0000-00000000a502', '60000000-0000-0000-0000-00000000a503']::uuid[]) g;
do $$ begin
  perform public.sign_card('60000000-0000-0000-0000-00000000a501', '10000000-0000-0000-0000-00000000a501', 'scorer');
  perform public.sign_card('60000000-0000-0000-0000-00000000a501', '10000000-0000-0000-0000-00000000a502', 'attest');
  perform public.sign_card('60000000-0000-0000-0000-00000000a502', '10000000-0000-0000-0000-00000000a502', 'attest');
end $$;

-- ---------------------------------------------------------------------------
-- As the commissioner's own session
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a5c1","role":"authenticated"}';

select throws_ok($$ delete from public.groups where id = '60000000-0000-0000-0000-00000000a501' $$,
  'HGLCK', null, 'commissioner session cannot delete a locked group');
select throws_ok($$ delete from public.groups where id = '60000000-0000-0000-0000-00000000a502' $$,
  'HGLCK', null, 'commissioner session cannot delete a group with a signature');
select throws_ok($$ delete from public.rounds where id = '50000000-0000-0000-0000-00000000a501' $$,
  'HGLCK', null, 'commissioner session cannot delete a round holding a signed card');
select throws_ok($$ delete from public.events where id = '40000000-0000-0000-0000-00000000a501' $$,
  'HGLCK', null, 'commissioner session cannot delete an event holding a signed card');
select throws_ok($$ delete from public.events where id = '40000000-0000-0000-0000-00000000a502' $$,
  'HGLCK', null, 'commissioner session cannot delete an event holding a partly signed card');
select throws_ok($$ delete from public.players where id = '10000000-0000-0000-0000-00000000a502' $$,
  'HGLCK', null, 'commissioner session cannot delete a player who signed a card');
select lives_ok($$ delete from public.events where id = '40000000-0000-0000-0000-00000000a503' $$,
  'an event with only unsigned cards can still be deleted');

select throws_ok($$ select pin_hash from public.players where id = '10000000-0000-0000-0000-00000000a501' $$,
  '42501', null, 'commissioner cannot read another player''s pin_hash');
select throws_ok($$ select * from public.players $$, '42501', null, 'select * on players is refused (pin_hash is not granted)');
select is((select has_pin from public.players where id = '10000000-0000-0000-0000-00000000a501'), true,
  'has_pin is readable instead');
select throws_ok(
  $$ update public.players set pin_hash = 'evil' where id = '10000000-0000-0000-0000-00000000a501' $$,
  '42501', null, 'commissioner cannot overwrite another player''s pin_hash');
select throws_ok(
  $$ update public.players set pin_hash = null where id = '10000000-0000-0000-0000-00000000a501' $$,
  '42501', null, 'commissioner cannot clear another player''s pin_hash');
select throws_ok(
  $$ insert into public.players (name, email, pin_hash) values ('HD New', 'hd-new@example.test', 'x') $$,
  '42501', null, 'commissioner cannot create a player with a pin_hash');
select lives_ok(
  $$ update public.players set pin_hash = 'commish-own' where id = '10000000-0000-0000-0000-00000000a5c1' $$,
  'commissioner can set their own pin_hash');

-- As a regular player.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a5c2","role":"authenticated"}';
select lives_ok(
  $$ update public.players set pin_hash = 'player-own' where id = '10000000-0000-0000-0000-00000000a5c2' $$,
  'a player can still set their own pin_hash');
select is((select has_pin from public.players where id = '10000000-0000-0000-0000-00000000a5c2'), true, 'and sees has_pin');
select lives_ok(
  $$ select id, created_at, user_id, name, email, handicap_index, handicap_source, is_commissioner, has_pin
       from public.players where user_id = '00000000-0000-0000-0000-00000000a5c2' $$,
  'the column list requireUser selects is readable');
reset role;

select is(
  (select array_agg(coalesce(pin_hash, '-') order by name) from public.players where id in (
     '10000000-0000-0000-0000-00000000a501', '10000000-0000-0000-0000-00000000a5c1', '10000000-0000-0000-0000-00000000a5c2')),
  array['commish-own', 'player-own', 'hash-scorer'],
  'only own pin_hash values changed');

-- The service role can still delete (server actions guard their own deletes).
set local role service_role;
select lives_ok($$ delete from public.groups where id = '60000000-0000-0000-0000-00000000a501' $$,
  'the service role can delete a locked group');
reset role;

-- ---------------------------------------------------------------------------
-- Scorer change
-- ---------------------------------------------------------------------------
insert into public.groups (id, round_id, scorer_player_id, locked, signed_at)
  values ('60000000-0000-0000-0000-00000000a504', '50000000-0000-0000-0000-00000000a501', '10000000-0000-0000-0000-00000000a501', true, now());
select throws_ok(
  $$ update public.groups set scorer_player_id = '10000000-0000-0000-0000-00000000a502' where id = '60000000-0000-0000-0000-00000000a504' $$,
  'HGLCK', null, 'the scorer of a signed card cannot change');
update public.groups set scorer_player_id = '10000000-0000-0000-0000-00000000a502' where id = '60000000-0000-0000-0000-00000000a502';
select is((select count(*)::int from public.signatures where group_id = '60000000-0000-0000-0000-00000000a502'), 0,
  'changing the scorer of an unlocked card clears its signatures');

-- ---------------------------------------------------------------------------
-- Lockout escalation
-- ---------------------------------------------------------------------------
-- n begins for the lockout player; true when all were allowed.
create function pg_temp.tries(n int) returns boolean language sql as $$
  select bool_and(public.pin_attempt_begin('10000000-0000-0000-0000-00000000a503') is not null) from generate_series(1, n)
$$;
-- Move every attempt and block of the lockout player into the past.
create function pg_temp.age(m int) returns void language sql as $$
  update public.pin_attempts set attempted_at = attempted_at - make_interval(mins => m) where player_id = '10000000-0000-0000-0000-00000000a503';
  update public.pin_blocks set blocked_at = blocked_at - make_interval(mins => m), until = until - make_interval(mins => m)
    where player_id = '10000000-0000-0000-0000-00000000a503';
$$;
create function pg_temp.last_block() returns interval language sql as $$
  select until - blocked_at from public.pin_blocks where player_id = '10000000-0000-0000-0000-00000000a503' order by blocked_at desc limit 1
$$;

select ok(pg_temp.tries(5), 'five attempts are allowed');
select is(pg_temp.last_block(), interval '10 minutes', 'the fifth failure starts a 10 minute block');
select is(public.pin_attempt_begin('10000000-0000-0000-0000-00000000a503'), null, 'the sixth attempt is blocked');
do $$ begin perform pg_temp.age(11); end $$;
select ok(pg_temp.tries(4), 'after the block: failures from before it do not count');
select ok(pg_temp.tries(1), 'the fifth new failure is allowed');
select is(pg_temp.last_block(), interval '20 minutes', 'a second block within 24 h lasts 20 minutes');
do $$ begin perform pg_temp.age(21); end $$;
select ok(pg_temp.tries(5), 'five more attempts are allowed');
select is(pg_temp.last_block(), interval '40 minutes', 'a third block within 24 h lasts 40 minutes');
do $$ begin perform pg_temp.age(25 * 60); end $$;
select ok(pg_temp.tries(5), 'five more attempts are allowed');
select is(pg_temp.last_block(), interval '10 minutes', 'blocks older than 24 h no longer escalate');
do $$ begin perform pg_temp.age(11); end $$;
insert into public.pin_blocks (player_id, blocked_at, until)
  select '10000000-0000-0000-0000-00000000a503', now() - interval '5 hours', now() - interval '4 hours' from generate_series(1, 9);
select ok(pg_temp.tries(5), 'five more attempts are allowed');
select is(pg_temp.last_block(), interval '24 hours', 'escalation is capped at 24 hours');

-- A correct fifth PIN lifts the block it started.
do $$
declare
  i int;
begin
  for i in 1..4 loop perform public.pin_attempt_begin('10000000-0000-0000-0000-00000000a504'); end loop;
  perform public.pin_attempt_succeeded(public.pin_attempt_begin('10000000-0000-0000-0000-00000000a504'));
end $$;
select ok(not public.pin_blocked('10000000-0000-0000-0000-00000000a504')
  and not exists (select 1 from public.pin_blocks where player_id = '10000000-0000-0000-0000-00000000a504'),
  'a correct fifth PIN is not blocked');
select isnt(public.pin_attempt_begin('10000000-0000-0000-0000-00000000a504'), null, 'the next failure (fifth failure) is still allowed');
select is(public.pin_attempt_begin('10000000-0000-0000-0000-00000000a504'), null, 'and then the block applies');

select * from finish();
rollback;
