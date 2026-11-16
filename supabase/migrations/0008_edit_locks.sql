-- 0008_edit_locks.sql — a tee's numbers freeze once a signed card uses them.
--
-- Leaderboards, match status, cuts and points recalculation read the tee's rating, slope,
-- par and holes live, so changing them after a card is signed would silently change past
-- results. A signed-in client (even a commissioner's own session, via commissioner_all)
-- cannot change a tee's rating / slope / par / course, nor insert, change or delete a hole,
-- while that tee is used by a round with a signed card (locked or signed_at set). Renaming
-- stays allowed. The service role is not affected: saveCourse (actions/courses.ts) applies
-- the same rule itself and writes the audit rows. Add a new tee to change the numbers.
--
-- Error code: HGLCK (as the other lock guards, 0004/0005).

create or replace function public.tee_has_signed_card(p_tee uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rounds r join public.groups g on g.round_id = r.id
    where r.tee_id = p_tee and (g.locked or g.signed_at is not null))
$$;

-- Security invoker on purpose: current_user is the caller's role (see 0005).
create or replace function public.tees_signed_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.rating is distinct from old.rating
          or new.slope is distinct from old.slope
          or new.par is distinct from old.par
          or new.course_id is distinct from old.course_id)
     and public.tee_has_signed_card(old.id) then
    raise exception 'tee_locked: this tee has signed cards; add a new tee instead'
      using errcode = 'HGLCK';
  end if;
  return new;
end
$$;

create trigger tees_signed_guard before update on public.tees
  for each row execute function public.tees_signed_guard();

create or replace function public.holes_signed_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then
      if public.tee_has_signed_card(old.tee_id) then
        raise exception 'tee_locked: this tee has signed cards; add a new tee instead' using errcode = 'HGLCK';
      end if;
      return old;
    elsif tg_op = 'INSERT' then
      if public.tee_has_signed_card(new.tee_id) then
        raise exception 'tee_locked: this tee has signed cards; add a new tee instead' using errcode = 'HGLCK';
      end if;
    elsif (new.tee_id, new.number, new.par, new.stroke_index)
          is distinct from (old.tee_id, old.number, old.par, old.stroke_index)
          and (public.tee_has_signed_card(old.tee_id) or public.tee_has_signed_card(new.tee_id)) then
      raise exception 'tee_locked: this tee has signed cards; add a new tee instead' using errcode = 'HGLCK';
    end if;
  end if;
  return coalesce(new, old);
end
$$;

create trigger holes_signed_guard before insert or update or delete on public.holes
  for each row execute function public.holes_signed_guard();

-- The guards run as the caller, so the helper stays callable by signed-in clients (it
-- reveals only whether a tee has a signed card, which groups.locked shows anyway).
revoke all on function public.tee_has_signed_card(uuid) from public, anon;
grant execute on function public.tee_has_signed_card(uuid) to authenticated, service_role;
revoke all on function public.tees_signed_guard() from public, anon, authenticated;
revoke all on function public.holes_signed_guard() from public, anon, authenticated;
