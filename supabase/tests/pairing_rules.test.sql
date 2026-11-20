-- 0013_pairing_rules.sql: one rule per pair (smaller id first); unreachable by clients.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.players (id, name, email) values
  ('10000000-0000-0000-0000-0000000fa001', 'PR One', 'pr-one@example.test'),
  ('10000000-0000-0000-0000-0000000fa002', 'PR Two', 'pr-two@example.test');

select lives_ok($$ insert into public.pairing_rules (player_a, player_b, kind) values
  ('10000000-0000-0000-0000-0000000fa001', '10000000-0000-0000-0000-0000000fa002', 'together') $$, 'a rule is stored');
select throws_ok($$ insert into public.pairing_rules (player_a, player_b, kind) values
  ('10000000-0000-0000-0000-0000000fa001', '10000000-0000-0000-0000-0000000fa002', 'apart') $$, '23505', null, 'one rule per pair');
select throws_ok($$ insert into public.pairing_rules (player_a, player_b, kind) values
  ('10000000-0000-0000-0000-0000000fa002', '10000000-0000-0000-0000-0000000fa001', 'apart') $$, '23514', null, 'smaller id first');

set local role authenticated;
select throws_ok($$ select * from public.pairing_rules $$, '42501', null, 'rules are not readable by clients');
select throws_ok($$ delete from public.pairing_rules $$, '42501', null, 'rules are not writable by clients');

select * from finish();
rollback;
