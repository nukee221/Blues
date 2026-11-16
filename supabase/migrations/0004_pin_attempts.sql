-- 0004_pin_attempts.sql — PIN lockout, atomic card signing, locked-card guard.
--
-- Everything here is for the service role (server actions); players reach none of it.
--   * pin_attempts: one row per PIN check. Five failures for a player within ten
--     minutes block that player's signing for ten minutes from the fifth failure.
--   * sign_card / admin_sign_card: insert a signature and lock the card once both
--     roles are signed, in one transaction.
--   * scores_guard trigger: scores of a locked (or signed) card cannot change, except
--     through admin_edit_score, which also writes the audit row. A change to an unlocked
--     card's gross clears its signatures (a signer signed different numbers).
--   * reopen_card: commissioner unlock with an audit row.
--   * groups_lock_guard trigger: a signed-in client (even a commissioner) cannot change
--     groups.locked / signed_at directly.
--
-- Errors raised for the app (PostgREST passes the SQLSTATE through as error.code):
--   HGLCK card is locked        HGNFD group not found       HGSAM same player both roles
--   HGNLK card is not signed    HGNIG player not in group   HGROL wrong role
--   23505 role already signed by another player

-- ---------------------------------------------------------------------------
-- PIN attempts
-- ---------------------------------------------------------------------------
create table public.pin_attempts (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players (id) on delete cascade,
  attempted_at  timestamptz not null default now(),
  success       boolean not null
);
create index pin_attempts_player_idx on public.pin_attempts (player_id, attempted_at desc);

alter table public.pin_attempts enable row level security;
revoke all on public.pin_attempts from public, anon, authenticated;

-- True while the player is blocked: some failure in the last ten minutes is the fifth
-- (or later) failure within a ten-minute window.
create or replace function public.pin_blocked(p_player uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pin_attempts f
    where f.player_id = p_player
      and not f.success
      and f.attempted_at > now() - interval '10 minutes'
      and (
        select count(*) from public.pin_attempts w
        where w.player_id = p_player
          and not w.success
          and w.attempted_at <= f.attempted_at
          and w.attempted_at >= f.attempted_at - interval '10 minutes'
      ) >= 5
  )
$$;

-- Reserve a PIN check: null when the player is blocked (nothing recorded), else the id
-- of a new attempt row recorded as a failure. The caller marks it a success with
-- pin_attempt_succeeded after the hash matches. Serialized per player, so concurrent
-- guesses each count before any of them is compared.
create or replace function public.pin_attempt_begin(p_player uuid)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('pin:' || p_player::text, 0));
  if public.pin_blocked(p_player) then
    return null;
  end if;
  insert into public.pin_attempts (player_id, success) values (p_player, false) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.pin_attempt_succeeded(p_attempt uuid)
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.pin_attempts set success = true where id = p_attempt
$$;

-- ---------------------------------------------------------------------------
-- Locked-card guard on scores
-- ---------------------------------------------------------------------------
create or replace function public.scores_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_signed boolean;
begin
  foreach v_group in array array_remove(array[
    case when tg_op <> 'INSERT' then old.group_id end,
    case when tg_op <> 'DELETE' then new.group_id end
  ], null) loop
    -- A group deleted in this transaction (ON DELETE CASCADE) is no longer found: allowed.
    select g.locked or g.signed_at is not null into v_signed from public.groups g where g.id = v_group;
    if coalesce(v_signed, false) then
      if coalesce(current_setting('hgt.allow_locked_edit', true), '') <> 'on' then
        raise exception 'card_locked: the card is signed; scores can no longer change'
          using errcode = 'HGLCK';
      end if;
    elsif tg_op = 'DELETE'
       or (tg_op = 'UPDATE' and new.gross is distinct from old.gross)
       or tg_op = 'INSERT' then
      -- The numbers changed under a partial signature: both sign again.
      delete from public.signatures s where s.group_id = v_group;
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger scores_guard
  before insert or update or delete on public.scores
  for each row execute function public.scores_guard();

-- Lock columns change only through sign_card / reopen_card (security definer) or the
-- service role. Commissioners have a full-access policy on groups (0002); without this
-- they could unlock a card with their own session and skip reopen_card's audit row.
create or replace function public.groups_lock_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.locked is distinct from old.locked or new.signed_at is distinct from old.signed_at) then
    raise exception 'card_lock: locked and signed_at change only by signing or reopening'
      using errcode = 'HGLCK';
  end if;
  return new;
end
$$;

create trigger groups_lock_guard
  before update on public.groups
  for each row execute function public.groups_lock_guard();

-- ---------------------------------------------------------------------------
-- Signing
-- ---------------------------------------------------------------------------
-- Insert the signature for p_role; lock the card when both roles are signed.
-- Re-signing a role by the same player is a no-op. Returns the card's locked state.
create or replace function public.sign_card(p_group uuid, p_player uuid, p_role text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_roles int;
begin
  select * into v_group from public.groups where id = p_group for update;
  if not found then
    raise exception 'group_not_found' using errcode = 'HGNFD';
  end if;
  if v_group.locked or v_group.signed_at is not null then
    raise exception 'card_locked: the card is already signed' using errcode = 'HGLCK';
  end if;
  if not exists (select 1 from public.group_players gp where gp.group_id = p_group and gp.player_id = p_player) then
    raise exception 'not_in_group' using errcode = 'HGNIG';
  end if;
  if p_role = 'scorer' and v_group.scorer_player_id is distinct from p_player then
    raise exception 'wrong_role: only the group''s scorer signs as scorer' using errcode = 'HGROL';
  end if;
  if p_role = 'attest' and v_group.scorer_player_id = p_player then
    raise exception 'same_player: the scorer cannot attest' using errcode = 'HGSAM';
  end if;
  if exists (select 1 from public.signatures s where s.group_id = p_group and s.player_id = p_player and s.role <> p_role) then
    raise exception 'same_player: one player cannot sign as scorer and attester' using errcode = 'HGSAM';
  end if;
  if not exists (select 1 from public.signatures s where s.group_id = p_group and s.role = p_role and s.player_id = p_player) then
    insert into public.signatures (group_id, player_id, role) values (p_group, p_player, p_role);
  end if;
  select count(distinct s.role) into v_roles from public.signatures s where s.group_id = p_group;
  if v_roles = 2 then
    update public.groups set locked = true, signed_at = now() where id = p_group;
    return true;
  end if;
  return false;
end
$$;

-- Commissioner signing on a player's behalf (no PIN): sign_card plus an audit row.
create or replace function public.admin_sign_card(p_group uuid, p_player uuid, p_role text, p_actor uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_locked boolean;
begin
  v_locked := public.sign_card(p_group, p_player, p_role);
  insert into public.audit_log (actor_player_id, entity, entity_id, before, after)
  values (p_actor, 'signature', p_group, null,
          jsonb_build_object('player_id', p_player, 'role', p_role, 'on_behalf', true, 'locked', v_locked));
  return v_locked;
end
$$;

-- Commissioner score edit, allowed on a locked card; audit row with before/after.
create or replace function public.admin_edit_score(p_group uuid, p_player uuid, p_hole int, p_gross int, p_actor uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_before int;
  v_had boolean;
  v_id uuid;
begin
  if not exists (select 1 from public.groups g where g.id = p_group) then
    raise exception 'group_not_found' using errcode = 'HGNFD';
  end if;
  if not exists (select 1 from public.group_players gp where gp.group_id = p_group and gp.player_id = p_player) then
    raise exception 'not_in_group' using errcode = 'HGNIG';
  end if;
  select s.gross, true into v_before, v_had from public.scores s
    where s.group_id = p_group and s.player_id = p_player and s.hole = p_hole
    for update;
  perform set_config('hgt.allow_locked_edit', 'on', true);
  insert into public.scores (group_id, player_id, hole, gross, client_ts)
  values (p_group, p_player, p_hole, p_gross, now())
  on conflict (group_id, player_id, hole) do update set gross = excluded.gross, client_ts = excluded.client_ts
  returning id into v_id;
  perform set_config('hgt.allow_locked_edit', 'off', true);
  insert into public.audit_log (actor_player_id, entity, entity_id, before, after)
  values (
    p_actor, 'score', v_id,
    case when coalesce(v_had, false)
      then jsonb_build_object('group_id', p_group, 'player_id', p_player, 'hole', p_hole, 'gross', v_before)
    end,
    jsonb_build_object('group_id', p_group, 'player_id', p_player, 'hole', p_hole, 'gross', p_gross)
  );
end
$$;

-- Commissioner reopen: unlock, clear signatures and signed_at, audit row with the reason.
create or replace function public.reopen_card(p_group uuid, p_actor uuid, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_sigs jsonb;
begin
  select * into v_group from public.groups where id = p_group for update;
  if not found then
    raise exception 'group_not_found' using errcode = 'HGNFD';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('player_id', s.player_id, 'role', s.role, 'signed_at', s.signed_at) order by s.role), '[]'::jsonb)
    into v_sigs from public.signatures s where s.group_id = p_group;
  if not (v_group.locked or v_group.signed_at is not null) and v_sigs = '[]'::jsonb then
    raise exception 'not_signed: nothing to reopen' using errcode = 'HGNLK';
  end if;
  delete from public.signatures where group_id = p_group;
  update public.groups set locked = false, signed_at = null where id = p_group;
  insert into public.audit_log (actor_player_id, entity, entity_id, before, after)
  values (
    p_actor, 'group', p_group,
    jsonb_build_object('locked', v_group.locked, 'signed_at', v_group.signed_at, 'signatures', v_sigs),
    jsonb_build_object('locked', false, 'signed_at', null, 'signatures', '[]'::jsonb, 'reason', p_reason, 'action', 'reopen')
  );
end
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.pin_blocked(uuid)',
    'public.pin_attempt_begin(uuid)',
    'public.pin_attempt_succeeded(uuid)',
    'public.sign_card(uuid, uuid, text)',
    'public.admin_sign_card(uuid, uuid, text, uuid)',
    'public.admin_edit_score(uuid, uuid, int, int, uuid)',
    'public.reopen_card(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
revoke all on function public.scores_guard() from public, anon, authenticated;
revoke all on function public.groups_lock_guard() from public, anon, authenticated;
