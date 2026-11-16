-- 0005_signing_hardening.sql — close the gaps a commissioner's own session (or any
-- signed-in client) had around signed cards and PINs, and escalate the PIN lockout.
--
--   * Delete guards: a signed-in client cannot delete a group that is signed or has a
--     signature, nor a round / event containing one, nor a player with a signature or a
--     score on a signed card (ON DELETE CASCADE would drop signed scores with no audit
--     row). The service role is not affected (server actions guard their own deletes).
--   * pin_hash: not readable by signed-in clients (column grants, like groups.code);
--     players.has_pin (generated) replaces it in the app. A signed-in client may set
--     pin_hash only on its own row, commissioners included.
--   * Changing groups.scorer_player_id clears an unlocked card's signatures; on a
--     signed card it is refused.
--   * Lockout escalation: blocks are recorded in pin_blocks; each block within 24 h of
--     an earlier one for the same player doubles (10, 20, 40 min ... capped at 24 h).

-- ---------------------------------------------------------------------------
-- Delete guards
-- ---------------------------------------------------------------------------
create or replace function public.group_is_signed(p_group uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.groups g where g.id = p_group and (g.locked or g.signed_at is not null))
      or exists (select 1 from public.signatures s where s.group_id = p_group)
$$;

-- Whether deleting this row would cascade away a signed card (or a signature).
create or replace function public.signed_delete_blocked(p_table text, p_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_table
    when 'groups' then public.group_is_signed(p_id)
    when 'rounds' then exists (select 1 from public.groups g where g.round_id = p_id and public.group_is_signed(g.id))
    when 'events' then exists (
      select 1 from public.rounds r join public.groups g on g.round_id = r.id
      where r.event_id = p_id and public.group_is_signed(g.id))
    when 'players' then exists (select 1 from public.signatures s where s.player_id = p_id)
      or exists (select 1 from public.scores sc where sc.player_id = p_id and public.group_is_signed(sc.group_id))
    else false
  end
$$;

-- Security invoker on purpose: current_user is the caller's role (the service role and
-- the cascades Postgres runs as the table owner pass through).
create or replace function public.signed_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and public.signed_delete_blocked(tg_table_name, old.id) then
    raise exception 'card_locked: % holds a signed card; reopen it first', tg_table_name
      using errcode = 'HGLCK';
  end if;
  return old;
end
$$;

create trigger groups_signed_delete_guard before delete on public.groups
  for each row execute function public.signed_delete_guard();
create trigger rounds_signed_delete_guard before delete on public.rounds
  for each row execute function public.signed_delete_guard();
create trigger events_signed_delete_guard before delete on public.events
  for each row execute function public.signed_delete_guard();
create trigger players_signed_delete_guard before delete on public.players
  for each row execute function public.signed_delete_guard();

-- ---------------------------------------------------------------------------
-- pin_hash: unreadable by clients, writable only on the caller's own row
-- ---------------------------------------------------------------------------
alter table public.players add column has_pin boolean generated always as (pin_hash is not null) stored;

revoke select on public.players from authenticated;
grant select (id, created_at, user_id, name, email, handicap_index, handicap_source, is_commissioner, has_pin)
  on public.players to authenticated;

create or replace function public.players_pin_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (case when tg_op = 'INSERT' then new.pin_hash is not null else new.pin_hash is distinct from old.pin_hash end)
     and (case when tg_op = 'INSERT' then new.user_id else old.user_id end) is distinct from auth.uid() then
    raise exception 'pin_hash: a PIN can be set only by its own player' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger players_pin_guard before insert or update on public.players
  for each row execute function public.players_pin_guard();

-- ---------------------------------------------------------------------------
-- Scorer change clears (or, when signed, refuses)
-- ---------------------------------------------------------------------------
create or replace function public.groups_scorer_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.scorer_player_id is distinct from old.scorer_player_id then
    if old.locked or old.signed_at is not null then
      raise exception 'card_locked: the scorer of a signed card cannot change' using errcode = 'HGLCK';
    end if;
    delete from public.signatures where group_id = new.id;
  end if;
  return new;
end
$$;

create trigger groups_scorer_change before update of scorer_player_id on public.groups
  for each row execute function public.groups_scorer_change();

-- ---------------------------------------------------------------------------
-- Escalating PIN lockout
-- ---------------------------------------------------------------------------
create table public.pin_blocks (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players (id) on delete cascade,
  -- The attempt whose (presumed) failure started the block; a success lifts it.
  attempt_id  uuid references public.pin_attempts (id) on delete set null,
  blocked_at  timestamptz not null default now(),
  until       timestamptz not null
);
create index pin_blocks_player_idx on public.pin_blocks (player_id, until desc);
alter table public.pin_blocks enable row level security;
revoke all on public.pin_blocks from public, anon, authenticated;

create or replace function public.pin_blocked(p_player uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.pin_blocks b where b.player_id = p_player and b.until > now())
$$;

-- Reserve a PIN check (see 0004). Null while blocked. The reservation counts as a
-- failure; when it is the fifth failure within ten minutes (since the last block
-- ended), a block starts now: 10 minutes, doubled for each block of this player in
-- the last 24 hours, capped at 24 hours. pin_attempt_succeeded lifts a block its
-- own attempt started (the fifth PIN was right after all).
create or replace function public.pin_attempt_begin(p_player uuid)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_since timestamptz;
  v_fails int;
  v_prior int;
begin
  perform pg_advisory_xact_lock(hashtextextended('pin:' || p_player::text, 0));
  if public.pin_blocked(p_player) then
    return null;
  end if;
  insert into public.pin_attempts (player_id, success) values (p_player, false) returning id into v_id;
  select greatest(now() - interval '10 minutes', coalesce(max(b.until), '-infinity'::timestamptz))
    into v_since from public.pin_blocks b where b.player_id = p_player;
  select count(*) into v_fails from public.pin_attempts a
    where a.player_id = p_player and not a.success and a.attempted_at > v_since;
  if v_fails >= 5 then
    select count(*) into v_prior from public.pin_blocks b
      where b.player_id = p_player and b.blocked_at > now() - interval '24 hours';
    insert into public.pin_blocks (player_id, attempt_id, until)
    values (p_player, v_id, now() + least(interval '10 minutes' * power(2, least(v_prior, 20))::int, interval '24 hours'));
  end if;
  return v_id;
end
$$;

create or replace function public.pin_attempt_succeeded(p_attempt uuid)
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.pin_attempts set success = true where id = p_attempt;
  delete from public.pin_blocks where attempt_id = p_attempt;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.group_is_signed(uuid)',
    'public.pin_blocked(uuid)',
    'public.pin_attempt_begin(uuid)',
    'public.pin_attempt_succeeded(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
-- The delete guard runs as the caller, so its helpers stay callable by signed-in
-- clients (they reveal only whether a card is signed, which groups.locked shows anyway).
grant execute on function public.group_is_signed(uuid) to authenticated;
revoke all on function public.signed_delete_blocked(text, uuid) from public, anon;
grant execute on function public.signed_delete_blocked(text, uuid) to authenticated, service_role;
revoke all on function public.signed_delete_guard() from public, anon, authenticated;
revoke all on function public.players_pin_guard() from public, anon, authenticated;
revoke all on function public.groups_scorer_change() from public, anon, authenticated;
