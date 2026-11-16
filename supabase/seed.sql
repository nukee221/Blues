-- seed.sql — local development data. No auth.users rows: players link to
-- accounts (players.user_id) on first login.

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

-- 12 players; 01–03 are commissioners.
insert into public.players (name, email, handicap_index, handicap_source, is_commissioner) values
  ('Alex Turner',     'player01@example.test',  8.4, 'GHIN',      true),
  ('Blake Morgan',    'player02@example.test', 12.1, 'GHIN',      true),
  ('Casey Reynolds',  'player03@example.test',  4.7, 'TheGrint',  true),
  ('Drew Patterson',  'player04@example.test', -1.2, 'GHIN',      false),
  ('Evan Brooks',     'player05@example.test', 15.3, '18Birdies', false),
  ('Finn Gallagher',  'player06@example.test', 10.0, 'GHIN',      false),
  ('Grant Holloway',  'player07@example.test', 18.6, 'Other',     false),
  ('Hunter Lane',     'player08@example.test',  6.2, 'TheGrint',  false),
  ('Isaac Monroe',    'player09@example.test', 21.4, '18Birdies', false),
  ('Jordan Pike',     'player10@example.test',  2.9, 'GHIN',      false),
  ('Kyle Sanders',    'player11@example.test', 13.8, 'GHIN',      false),
  ('Logan Whitfield', 'player12@example.test', 24.0, 'Other',     false);
