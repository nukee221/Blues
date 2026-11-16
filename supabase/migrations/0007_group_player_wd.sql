-- 0007_group_player_wd.sql — play-in withdrawals (WD) and bracket versioning.
--
--   * group_players.withdrawn: a player who withdrew (or did not show) after the groups
--     were sent. Card completeness, signing and the play-in cut ignore them; the
--     leaderboard lists them as WD. Set only through the commissioner action
--     setGroupPlayerWithdrawn (service role, audited).
--   * group_players_wd_guard: withdrawn cannot change on a signed (locked) card; on an
--     unsigned card a change clears the card's signatures (the signers signed a
--     different field), like a scorer change (0005).
--   * brackets.version: optimistic-concurrency counter. Every write of brackets.state
--     is conditional on the version it read and bumps it, so two results recorded at
--     once cannot overwrite each other.
--
-- brackets.state holds { "advanced": [player ids], "bracket": Bracket | null }:
-- closing the play-in creates the row with the advancers and bracket null; the draw
-- fills in the serialized Bracket from @hgt/scoring.

alter table public.group_players add column withdrawn boolean not null default false;

alter table public.brackets add column version int not null default 0;

create or replace function public.group_players_wd_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.withdrawn is distinct from old.withdrawn then
    if exists (select 1 from public.groups g where g.id = new.group_id and (g.locked or g.signed_at is not null)) then
      raise exception 'card_locked: a withdrawal cannot change on a signed card' using errcode = 'HGLCK';
    end if;
    delete from public.signatures where group_id = new.group_id;
  end if;
  return new;
end
$$;

create trigger group_players_wd_guard before update of withdrawn on public.group_players
  for each row execute function public.group_players_wd_guard();

revoke all on function public.group_players_wd_guard() from public, anon, authenticated;
