-- 0009: tee/hole edits under signed cards are allowed again (0008 guards dropped); the helper stays.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000e8c1', 'authenticated', 'authenticated', 'el-commish@example.test');
insert into public.players (id, user_id, name, email, is_commissioner) values
  ('10000000-0000-0000-0000-00000000e801', null, 'EL Scorer', 'el-scorer@example.test', false),
  ('10000000-0000-0000-0000-00000000e8c1', '00000000-0000-0000-0000-00000000e8c1', 'EL Commish', 'el-commish@example.test', true);
insert into public.courses (id, name) values ('20000000-0000-0000-0000-00000000e801', 'EL Course');
insert into public.tees (id, course_id, name, rating, slope, par) values
  ('21000000-0000-0000-0000-00000000e801', '20000000-0000-0000-0000-00000000e801', 'Signed', 70.0, 120, 72),
  ('21000000-0000-0000-0000-00000000e802', '20000000-0000-0000-0000-00000000e801', 'Unsigned', 70.0, 120, 72);
insert into public.holes (tee_id, number, par, stroke_index)
  select t, n, 4, n from unnest(array['21000000-0000-0000-0000-00000000e801', '21000000-0000-0000-0000-00000000e802']::uuid[]) t, generate_series(1, 18) n;
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
select hasnt_trigger('public', 'tees', 'tees_signed_guard', 'tee guard trigger is gone');
select hasnt_trigger('public', 'holes', 'holes_signed_guard', 'hole guard trigger is gone');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000e8c1","role":"authenticated"}';

select lives_ok($$ update public.tees set slope = 130, rating = 71.2 where id = '21000000-0000-0000-0000-00000000e801' $$,
  'a signed tee can change (the action asks for confirmation and audits)');
select lives_ok($$ update public.holes set par = 5, stroke_index = 2 where tee_id = '21000000-0000-0000-0000-00000000e801' and number = 1 $$,
  'a hole of a signed tee can change');
reset role;

select is((select slope from public.tees where id = '21000000-0000-0000-0000-00000000e801'), 130, 'edit applied');
select is((select par from public.holes where tee_id = '21000000-0000-0000-0000-00000000e801' and number = 1), 5, 'hole edit applied');
select ok(not exists (select 1 from pg_proc where proname in ('tees_signed_guard', 'holes_signed_guard')), 'guard functions dropped');

select * from finish();
rollback;
