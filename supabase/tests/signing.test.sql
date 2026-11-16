-- 0004_pin_attempts.sql: PIN lockout, sign_card, locked-card trigger, admin edit, reopen.
-- Rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

insert into public.players (id, name, email) values
  ('10000000-0000-0000-0000-00000000f501', 'SG Scorer', 'sg-scorer@example.test'),
  ('10000000-0000-0000-0000-00000000f502', 'SG Marker', 'sg-marker@example.test'),
  ('10000000-0000-0000-0000-00000000f503', 'SG Commish', 'sg-commish@example.test'),
  ('10000000-0000-0000-0000-00000000f504', 'SG Locked Out', 'sg-lockout@example.test'),
  ('10000000-0000-0000-0000-00000000f505', 'SG Old Fails', 'sg-oldfails@example.test');
insert into public.courses (id, name) values ('20000000-0000-0000-0000-00000000f501', 'SG Course');
insert into public.tees (id, course_id, name, rating, slope, par)
  values ('21000000-0000-0000-0000-00000000f501', '20000000-0000-0000-0000-00000000f501', 'White', 70.0, 120, 72);
insert into public.seasons (id, year) values ('30000000-0000-0000-0000-00000000f501', 2097);
insert into public.events (id, season_id, name, event_type, status)
  values ('40000000-0000-0000-0000-00000000f501', '30000000-0000-0000-0000-00000000f501', 'SG Event', 'regular', 'in_progress');
insert into public.rounds (id, event_id, round_number, tee_id, kind)
  values ('50000000-0000-0000-0000-00000000f501', '40000000-0000-0000-0000-00000000f501', 1, '21000000-0000-0000-0000-00000000f501', 'stroke');
insert into public.groups (id, round_id, scorer_player_id) values
  ('60000000-0000-0000-0000-00000000f501', '50000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f501'),
  ('60000000-0000-0000-0000-00000000f502', '50000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f501');
insert into public.group_players (group_id, player_id) values
  ('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f501'),
  ('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f502'),
  ('60000000-0000-0000-0000-00000000f502', '10000000-0000-0000-0000-00000000f501'),
  ('60000000-0000-0000-0000-00000000f502', '10000000-0000-0000-0000-00000000f502');
insert into public.scores (group_id, player_id, hole, gross) values
  ('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f501', 1, 5),
  ('60000000-0000-0000-0000-00000000f502', '10000000-0000-0000-0000-00000000f501', 1, 5);

-- ---------------------------------------------------------------------------
-- sign_card
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.sign_card('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f502', 'scorer') $$,
  'HGROL', null, 'only the group scorer signs as scorer');
select throws_ok(
  $$ select public.sign_card('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f501', 'attest') $$,
  'HGSAM', null, 'the scorer cannot attest');
select throws_ok(
  $$ select public.sign_card('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f503', 'attest') $$,
  'HGNIG', null, 'a player outside the group cannot attest');
select is(public.sign_card('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f501', 'scorer'), false,
  'scorer signature alone does not lock');
select is(public.sign_card('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f501', 'scorer'), false,
  're-signing the same role is a no-op');

-- A gross change under a partial signature clears it.
update public.scores set gross = 6 where group_id = '60000000-0000-0000-0000-00000000f501' and hole = 1;
select is((select count(*)::int from public.signatures where group_id = '60000000-0000-0000-0000-00000000f501'), 0,
  'changing a score on an unlocked card clears its signatures');

select is(public.sign_card('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f501', 'scorer'), false, 'scorer signs again');
select is(public.sign_card('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f502', 'attest'), true,
  'both roles signed: sign_card returns true');
select ok((select locked and signed_at is not null from public.groups where id = '60000000-0000-0000-0000-00000000f501'),
  'card is locked with signed_at');
select throws_ok(
  $$ select public.sign_card('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f502', 'attest') $$,
  'HGLCK', null, 'a locked card cannot be signed again');

-- ---------------------------------------------------------------------------
-- Locked-card trigger
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.scores (group_id, player_id, hole, gross) values ('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f502', 2, 4) $$,
  'HGLCK', null, 'insert into scores of a locked group fails');
select throws_ok(
  $$ update public.scores set gross = 3 where group_id = '60000000-0000-0000-0000-00000000f501' $$,
  'HGLCK', null, 'update of a locked group''s scores fails');
select throws_ok(
  $$ delete from public.scores where group_id = '60000000-0000-0000-0000-00000000f501' $$,
  'HGLCK', null, 'delete of a locked group''s scores fails');
select throws_ok(
  $$ update public.scores set group_id = '60000000-0000-0000-0000-00000000f501' where group_id = '60000000-0000-0000-0000-00000000f502' $$,
  'HGLCK', null, 'moving scores into a locked group fails');
select lives_ok(
  $$ insert into public.scores (group_id, player_id, hole, gross) values ('60000000-0000-0000-0000-00000000f502', '10000000-0000-0000-0000-00000000f502', 1, 4) $$,
  'an unlocked group still takes scores');

-- admin_edit_score: allowed on the locked card, writes the audit row.
select lives_ok(
  $$ select public.admin_edit_score('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f501', 1, 4, '10000000-0000-0000-0000-00000000f503') $$,
  'admin_edit_score succeeds on a locked card');
select is((select gross from public.scores where group_id = '60000000-0000-0000-0000-00000000f501' and hole = 1), 4, 'score changed');
select is(
  (select jsonb_build_array(before ->> 'gross', after ->> 'gross', actor_player_id::text) from public.audit_log
     where entity = 'score' and after ->> 'group_id' = '60000000-0000-0000-0000-00000000f501' and after ->> 'hole' = '1'),
  jsonb_build_array('6', '4', '10000000-0000-0000-0000-00000000f503'),
  'audit row has before/after gross and the actor');
select lives_ok(
  $$ select public.admin_edit_score('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f502', 7, 5, '10000000-0000-0000-0000-00000000f503') $$,
  'admin_edit_score can add a missing hole');
select ok(
  (select before is null and (after ->> 'gross') = '5' from public.audit_log
     where entity = 'score' and after ->> 'hole' = '7' and after ->> 'group_id' = '60000000-0000-0000-0000-00000000f501'),
  'a new score audits before = null');
select is((select count(*)::int from public.signatures where group_id = '60000000-0000-0000-0000-00000000f501'), 2,
  'an admin edit on a locked card keeps its signatures');
select throws_ok(
  $$ insert into public.scores (group_id, player_id, hole, gross) values ('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f502', 3, 4) $$,
  'HGLCK', null, 'the locked-edit flag does not leak past admin_edit_score');
select throws_ok(
  $$ select public.admin_edit_score('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f503', 1, 4, null) $$,
  'HGNIG', null, 'admin_edit_score refuses a player outside the group');

-- ---------------------------------------------------------------------------
-- reopen_card
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.reopen_card('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f503', 'Wrong score on 7') $$,
  'reopen_card succeeds');
select ok(
  (select not locked and signed_at is null from public.groups where id = '60000000-0000-0000-0000-00000000f501')
    and not exists (select 1 from public.signatures where group_id = '60000000-0000-0000-0000-00000000f501'),
  'reopen unlocks, clears signed_at and signatures');
select is(
  (select jsonb_build_array(before -> 'locked', jsonb_array_length(before -> 'signatures'), after -> 'locked', after ->> 'reason')
     from public.audit_log where entity = 'group' and entity_id = '60000000-0000-0000-0000-00000000f501'),
  jsonb_build_array(true, 2, false, 'Wrong score on 7'),
  'reopen audit row has before/after and the reason');
select lives_ok(
  $$ insert into public.scores (group_id, player_id, hole, gross) values ('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f502', 3, 4) $$,
  'a reopened card takes scores again');
select throws_ok(
  $$ select public.reopen_card('60000000-0000-0000-0000-00000000f501', null, 'again') $$,
  'HGNLK', null, 'reopening an unsigned card is refused');

-- ---------------------------------------------------------------------------
-- PIN lockout
-- ---------------------------------------------------------------------------
select ok((select bool_and(public.pin_attempt_begin('10000000-0000-0000-0000-00000000f504') is not null) from generate_series(1, 4)),
  'four failures: still allowed');
-- A success between failures is not a failure.
do $$ begin
  perform public.pin_attempt_succeeded(public.pin_attempt_begin('10000000-0000-0000-0000-00000000f504'));
end $$;
select ok(not public.pin_blocked('10000000-0000-0000-0000-00000000f504'), 'successes do not count as failures');
select isnt(public.pin_attempt_begin('10000000-0000-0000-0000-00000000f504'), null, 'the fifth failure is recorded');
select is(public.pin_attempt_begin('10000000-0000-0000-0000-00000000f504'), null, 'sixth attempt within 10 minutes is blocked');
select is((select count(*)::int from public.pin_attempts where player_id = '10000000-0000-0000-0000-00000000f504'), 6,
  'a blocked attempt records nothing (the block does not extend)');

-- Window and escalation rules after 0005: see signing_hardening.test.sql.

-- Privileges: players reach none of this.
select ok(
  not has_function_privilege('authenticated', 'public.sign_card(uuid, uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.admin_edit_score(uuid, uuid, int, int, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.reopen_card(uuid, uuid, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.pin_attempt_begin(uuid)', 'execute')
    and not has_table_privilege('authenticated', 'public.pin_attempts', 'select')
    and has_function_privilege('service_role', 'public.sign_card(uuid, uuid, text)', 'execute'),
  'signing functions and pin_attempts are service-role only');

-- A commissioner's own session cannot unlock a card around reopen_card's audit row.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000f503', 'authenticated', 'authenticated', 'sg-commish@example.test');
update public.players set user_id = '00000000-0000-0000-0000-00000000f503', is_commissioner = true
  where id = '10000000-0000-0000-0000-00000000f503';
do $$ begin
  perform public.sign_card('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f501', 'scorer');
  perform public.sign_card('60000000-0000-0000-0000-00000000f501', '10000000-0000-0000-0000-00000000f502', 'attest');
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f503","role":"authenticated"}';
select throws_ok(
  $$ update public.groups set locked = false, signed_at = null where id = '60000000-0000-0000-0000-00000000f501' $$,
  'HGLCK', null, 'a commissioner session cannot unlock a card directly');
select lives_ok(
  $$ update public.groups set tee_time = '08:00' where id = '60000000-0000-0000-0000-00000000f501' $$,
  'other group columns stay editable by the commissioner');
reset role;

select * from finish();
rollback;
