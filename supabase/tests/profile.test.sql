-- 0010_profile.sql: home club writable on your own row only; photos unreachable by clients.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000f0a1', 'authenticated', 'authenticated', 'pf-me@example.test');
insert into public.players (id, user_id, name, email) values
  ('10000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-00000000f0a1', 'PF Me', 'pf-me@example.test'),
  ('10000000-0000-0000-0000-00000000f0a2', null, 'PF Other', 'pf-other@example.test');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f0a1","role":"authenticated"}';

update public.players set home_club = 'Cherokee Ridge' where id = '10000000-0000-0000-0000-00000000f0a1';
select is((select home_club from public.players where id = '10000000-0000-0000-0000-00000000f0a1'), 'Cherokee Ridge', 'a player sets their own home club');

update public.players set home_club = 'Hijack' where id = '10000000-0000-0000-0000-00000000f0a2';
select is((select home_club from public.public_players where id = '10000000-0000-0000-0000-00000000f0a2'), null, 'not on someone else''s row');

select throws_ok($$ update public.players set photo_version = 9 where id = '10000000-0000-0000-0000-00000000f0a1' $$, '42501', null, 'photo_version is not client-writable');
select throws_ok($$ update public.players set name = 'Renamed' where id = '10000000-0000-0000-0000-00000000f0a1' $$, '42501', null, 'name still not client-writable');
select throws_ok($$ select * from public.player_photos $$, '42501', null, 'photos are not readable by clients');
select throws_ok($$ insert into public.player_photos (player_id, jpeg_base64) values ('10000000-0000-0000-0000-00000000f0a1', 'x') $$, '42501', null, 'photos are not writable by clients');
select is((select home_club from public.public_players where id = '10000000-0000-0000-0000-00000000f0a1'), 'Cherokee Ridge', 'the directory shows home clubs');

select * from finish();
rollback;
