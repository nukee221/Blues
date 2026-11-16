-- 0003_extra_holes.sql — match-play extra holes and self-claimed scorers.
--
-- scores.hole: 19..36 are extra holes of a match (hole n maps to tee hole
-- ((n - 1) % 18) + 1 for par and stroke index). Server actions accept 19+
-- only for rounds of kind 'match'.
alter table public.scores drop constraint scores_hole_check;
alter table public.scores add constraint scores_hole_check check (hole between 1 and 36);

-- groups.scorer_self_claimed: true when scorer_player_id was set by a phone
-- claiming the card (not assigned by the commissioner), so a later hand-off
-- may name a different player. Not in the authenticated column grant
-- (0002_rls.sql), so players cannot read it; the service role can.
alter table public.groups add column scorer_self_claimed boolean not null default false;
