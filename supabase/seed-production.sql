-- seed-production.sql: the starting data for a REAL Supabase project (no test players).
-- Run it ONCE, in the Supabase dashboard: SQL Editor > New query > paste this whole file > Run.
-- (`supabase db push` only applies the migrations; it never runs seed files.)
-- It adds: Cherokee Ridge Country Club with its blue tee, the 2027 season, and that season's
-- three points tables (regular, match_play, major). The points values are the same as seed.sql:
-- check them against the PGA Tour's published FedExCup table (docs/RUNBOOK.md, part 7).
-- Players are NOT included: add the first commissioner with the snippet in docs/RUNBOOK.md,
-- the rest in the app under Admin > Players.

-- Stops here (nothing is changed) if this was already run.
do $$
begin
  if exists (select 1 from public.seasons where year = 2027) then
    raise exception 'The 2027 season already exists: this file was already run.';
  end if;
end $$;

-- Cherokee Ridge Country Club, Union Grove AL — blue tee (from the club card).
with course as (
  insert into public.courses (name) values ('Cherokee Ridge Country Club')
  returning id
), tee as (
  insert into public.tees (course_id, name, rating, slope, par)
  select id, 'Blue', 71.8, 140, 72 from course
  returning id
)
insert into public.holes (tee_id, number, par, stroke_index)
select tee.id, h.number, h.par, h.stroke_index
from tee,
     unnest(
       array[4,4,5,4,3,5,4,3,4,5,3,4,4,5,3,4,4,4],
       array[18,4,10,8,16,12,6,14,2,3,15,11,7,1,17,5,13,9]
     ) with ordinality as h(par, stroke_index, number);

-- 2027 season with FedEx-style points tables.
with season as (
  insert into public.seasons (year) values (2027) returning id
), fedex_500 as (
  select array[500,300,190,135,110,100,90,85,80,75,70,65,60,57,55,53,51,49,47,45,
               43,41,39,37,35.5,34,32.5,31,29.5,28]::numeric[] as v
)
insert into public.points_tables (season_id, event_type, winner_points, table_values)
select season.id, t.event_type, t.winner_points,
       array(select case when t.scale = 1 then x else x * t.scale end from unnest(fedex_500.v) with ordinality as u(x, i) order by i)
from season, fedex_500,
     (values ('regular', 500, 1.0), ('match_play', 500, 1.0), ('major', 750, 1.5))
       as t(event_type, winner_points, scale);
