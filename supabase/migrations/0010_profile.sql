-- 0010_profile.sql: a player's home club and profile photo (roadmap step 4).
--   * players.home_club: free text, set by the player on their own row (column grant + the
--     existing players_update_own policy), shown on standings and leaderboards.
--   * player_photos: one small JPEG per player (resized in the browser to 256x256), stored
--     base64. No client access at all: written by a server action after requireUser, read by
--     the signed-in /photo/<id> route, both with the service role.
--   * players.photo_version: bumped on each new photo so image URLs (?v=) change and caches refresh.

alter table public.players
  add column home_club text check (home_club is null or char_length(home_club) between 1 and 60),
  add column photo_version int not null default 0;

grant select (home_club, photo_version) on public.players to authenticated;
grant update (pin_hash, home_club) on public.players to authenticated;

-- Directory view: same columns as before, plus the two new ones (appended, as create or replace requires).
create or replace view public.public_players
with (security_invoker = false)
as
  select id, name, handicap_index, handicap_source, is_commissioner, home_club, photo_version
  from public.players;

create table public.player_photos (
  player_id   uuid primary key references public.players (id) on delete cascade,
  updated_at  timestamptz not null default now(),
  jpeg_base64 text not null check (char_length(jpeg_base64) <= 200000)
);
alter table public.player_photos enable row level security;
revoke all on public.player_photos from public, anon, authenticated;
grant all on public.player_photos to service_role;
