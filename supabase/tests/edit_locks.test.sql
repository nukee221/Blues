-- 0008_edit_locks.sql: a tee used by a signed card keeps its numbers. Rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000e8c1', 'authenticated', 'authenticated', 'el-commish@example.test');
insert into public.players (id, user_id, name, email, is_commissioner) values
  ('10000000-0000-0000-0000-00000000e801', null, 'EL Scorer', 'el-scorer@example.test', false),
  ('10000000-0000-0000-0000-00000000e8c1', '00000000-0000-0000-0000-00000000e8c1', 'EL Commish', 'el-commish@example.test', true);
insert into public.courses (id, name) values ('20000000-0000-0000-0000-00000000e801', 'EL Course');
-- T1: used by a round with a signed card. T2: used by a round with an unsigned card. T3: unused.
insert into public.tees (id, course_id, name, rating, slope, par) values
  ('21000000-0000-0000-0000-00000000e801', '20000000-0000-0000-0000-00000000e801', 'Signed', 70.0, 120, 72),
  ('21000000-0000-0000-0000-00000000e802', '20000000-0000-0000-0000-00000000e801', 'Unsigned', 70.0, 120, 72),
  ('21000000-0000-0000-0000-00000000e803', '20000000-0000-0000-0000-00000000e801', 'Unused', 70.0, 120, 72);
insert into public.holes (tee_id, number, par, stroke_index)
  select t, n, 4, n from unnest(array['21000000-0000-0000-0000-00000000e801', '21000000-0000-0000-0000-00000000e802',
                                      '21000000-0000-0000-0000-00000000e803']::uuid[]) t, generate_series(1, 18) n;
insert into public.seasons (id, year) values ('30000000-0000-0000-0000-00000000e801', 2095);
insert into public.events (id, season_id, name, event_type, status) values
  ('40000000-0000-0000-0000-00000000e801', '30000000-0000-0000-0000-00000000e801', 'EL Event', 'regular', 'in_progress');
insert into public.rounds (id, event_id, round_number, tee_id, kind) values
  ('50000000-0000-0000-0000-00000000e801', '40000000-0000-0000-0000-00000000e801', 1, '21000000-0000-0000-0000-00000000e801', 'stroke'),
  ('50000000-0000-0000-0000-00000000e802', '40000000-0000-0000-0000-00000000e801', 2, '21000000-0000-0000-0000-00000000e802', 'stroke');
insert into public.groups (id, round_id, scorer_player_id, locked, signed_at) values
  ('60000000-0000-0000-0000-00000000e801', '50000000-0000-0000-0000-00000000e801', '10000000-0000-0000-0000-00000000e801', true, now()),
  ('60000000-0000-0000-0000-00000000e802', '50000000-0000-0000-0000-00000000e802', '10000000-0000-0000-0000-00000000e801', false, null);

select ok(public.tee_has_signed_card('21000000-0000-0000-0000-00000000e801'), 'tee with a signed card is reported');
select ok(not public.tee_has_signed_card('21000000-0000-0000-0000-00000000e802'), 'tee with only an unsigned card is not');

-- ---------------------------------------------------------------------------
-- As the commissioner's own session
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e8c1","role":"authenticated"}';

select throws_ok($$ update public.tees set slope = 130 where id = '21000000-0000-0000-0000-00000000e801' $$,
  'HGLCK', null, 'slope of a signed tee cannot change');
select throws_ok($$ update public.tees set rating = 71.2, par = 71 where id = '21000000-0000-0000-0000-00000000e801' $$,
  'HGLCK', null, 'rating/par of a signed tee cannot change');
select lives_ok($$ update public.tees set name = 'Signed (renamed)' where id = '21000000-0000-0000-0000-00000000e801' $$,
  'a signed tee can be renamed');
select throws_ok($$ update public.holes set par = 5 where tee_id = '21000000-0000-0000-0000-00000000e801' and number = 1 $$,
  'HGLCK', null, 'a hole par of a signed tee cannot change');
select throws_ok($$ update public.holes set stroke_index = 2 where tee_id = '21000000-0000-0000-0000-00000000e801' and number = 1 $$,
  'HGLCK', null, 'a stroke index of a signed tee cannot change');
select lives_ok($$ update public.holes set par = par where tee_id = '21000000-0000-0000-0000-00000000e801' $$,
  'an identical-value hole update is not refused');
select throws_ok($$ delete from public.holes where tee_id = '21000000-0000-0000-0000-00000000e801' and number = 18 $$,
  'HGLCK', null, 'a hole of a signed tee cannot be deleted');
select lives_ok($$ update public.tees set slope = 131 where id = '21000000-0000-0000-0000-00000000e802' $$,
  'a tee with only unsigned cards can change');
select lives_ok($$ update public.holes set par = 5 where tee_id = '21000000-0000-0000-0000-00000000e803' and number = 1 $$,
  'holes of an unused tee can change');

reset role;

-- The service role (server actions) is not affected; saveCourse guards and audits itself.
set local role service_role;
select lives_ok($$ update public.tees set slope = 125 where id = '21000000-0000-0000-0000-00000000e801' $$,
  'service role is not blocked by the guard');
reset role;

select is((select slope from public.tees where id = '21000000-0000-0000-0000-00000000e801'), 125, 'service-role write applied');
select ok(not has_function_privilege('authenticated', 'public.holes_signed_guard()', 'execute'),
  'signed-in clients cannot call the guard function');

select * from finish();
rollback;
