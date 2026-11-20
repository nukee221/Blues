-- Pairing rules (tour-wide): two players who like to play together, or who should be kept
-- in different groups. Used by "Make groups" as a best effort; read and written only by
-- commissioner server actions through the service role.
create table public.pairing_rules (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  player_a    uuid not null references public.players (id) on delete cascade,
  player_b    uuid not null references public.players (id) on delete cascade,
  kind        text not null check (kind in ('together', 'apart')),
  -- one rule per pair, stored with the smaller id first
  check (player_a < player_b),
  unique (player_a, player_b)
);
alter table public.pairing_rules enable row level security;
revoke all on public.pairing_rules from public, anon, authenticated;
grant all on public.pairing_rules to service_role;
