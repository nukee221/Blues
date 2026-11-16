-- scores.hole range after 0003_extra_holes.sql. Rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.players (id, name, email) values
  ('10000000-0000-0000-0000-00000000e401', 'XH Player', 'xh-player@example.test');
insert into public.courses (id, name) values ('20000000-0000-0000-0000-00000000e401', 'XH Course');
insert into public.tees (id, course_id, name, rating, slope, par)
  values ('21000000-0000-0000-0000-00000000e401', '20000000-0000-0000-0000-00000000e401', 'White', 70.0, 120, 72);
insert into public.seasons (id, year) values ('30000000-0000-0000-0000-00000000e401', 2098);
insert into public.events (id, season_id, name, event_type, status)
  values ('40000000-0000-0000-0000-00000000e401', '30000000-0000-0000-0000-00000000e401', 'XH Event', 'match_play', 'in_progress');
insert into public.rounds (id, event_id, round_number, tee_id, kind)
  values ('50000000-0000-0000-0000-00000000e401', '40000000-0000-0000-0000-00000000e401', 1, '21000000-0000-0000-0000-00000000e401', 'match');
insert into public.groups (id, round_id) values ('60000000-0000-0000-0000-00000000e401', '50000000-0000-0000-0000-00000000e401');

select lives_ok(
  $$ insert into public.scores (group_id, player_id, hole, gross) values ('60000000-0000-0000-0000-00000000e401', '10000000-0000-0000-0000-00000000e401', 19, 4) $$,
  'hole 19 (first extra hole) is allowed');
select lives_ok(
  $$ insert into public.scores (group_id, player_id, hole, gross) values ('60000000-0000-0000-0000-00000000e401', '10000000-0000-0000-0000-00000000e401', 36, 4) $$,
  'hole 36 is allowed');
select throws_ok(
  $$ insert into public.scores (group_id, player_id, hole, gross) values ('60000000-0000-0000-0000-00000000e401', '10000000-0000-0000-0000-00000000e401', 37, 4) $$,
  '23514', null, 'hole 37 is rejected');
select throws_ok(
  $$ insert into public.scores (group_id, player_id, hole, gross) values ('60000000-0000-0000-0000-00000000e401', '10000000-0000-0000-0000-00000000e401', 0, 4) $$,
  '23514', null, 'hole 0 is rejected');
select is(
  (select scorer_self_claimed from public.groups where id = '60000000-0000-0000-0000-00000000e401'),
  false, 'groups.scorer_self_claimed defaults to false');

select * from finish();
rollback;
