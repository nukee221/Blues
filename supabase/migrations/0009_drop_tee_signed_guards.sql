-- 0009_drop_tee_signed_guards.sql — the tour's commissioners want to correct course numbers
-- after play (mistakes are found late), so the 0008 triggers that blocked tee/hole edits
-- under signed cards are removed. saveCourse (actions/courses.ts) now requires an explicit
-- confirmResultsChange for such edits and writes audit rows with before/after.
-- tee_has_signed_card(uuid) stays: the action's confirm step and the course page use it.

drop trigger if exists tees_signed_guard on public.tees;
drop trigger if exists holes_signed_guard on public.holes;
drop function if exists public.tees_signed_guard();
drop function if exists public.holes_signed_guard();
