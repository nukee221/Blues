-- 0001_core.sql — Huntsville Golf Tour core schema.
-- Row-level security and grants live in 0002_rls.sql.

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.players (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  user_id          uuid unique null references auth.users (id) on delete set null,
  name             text not null,
  email            extensions.citext not null unique,
  handicap_index   numeric(4,1),
  handicap_source  text check (handicap_source in ('GHIN', 'TheGrint', '18Birdies', 'Other')),
  is_commissioner  boolean not null default false,
  pin_hash         text null
);

-- ---------------------------------------------------------------------------
-- Courses
-- ---------------------------------------------------------------------------
create table public.courses (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null
);

create table public.tees (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  name        text not null,
  rating      numeric(4,1) not null,
  slope       int not null,
  par         int not null
);
create index tees_course_id_idx on public.tees (course_id);

create table public.holes (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  tee_id        uuid not null references public.tees (id) on delete cascade,
  number        int not null check (number between 1 and 18),
  par           int not null,
  stroke_index  int not null check (stroke_index between 1 and 18),
  unique (tee_id, number)
);

-- ---------------------------------------------------------------------------
-- Seasons and events
-- ---------------------------------------------------------------------------
create table public.seasons (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  year        int not null unique
);

create table public.points_tables (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  season_id      uuid not null references public.seasons (id) on delete cascade,
  event_type     text not null,
  winner_points  numeric not null,
  table_values   numeric[] not null,
  unique (season_id, event_type)
);

create table public.events (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  season_id              uuid not null references public.seasons (id) on delete restrict,
  name                   text not null,
  event_type             text not null check (event_type in ('regular', 'major', 'ryder_cup', 'championship', 'match_play')),
  format                 text,
  status                 text not null default 'draft'
                           check (status in ('draft', 'published', 'registration_closed', 'in_progress', 'final')),
  registration_deadline  timestamptz,
  handicap_mode          text check (handicap_mode in ('gross', 'net')),
  allowance_pct          int not null default 100,
  handicap_basis         text not null default 'index' check (handicap_basis in ('index', 'course')),
  match_strokes          text not null default 'full' check (match_strokes in ('full', 'offLow'))
);
create index events_season_id_idx on public.events (season_id);

create table public.registrations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  event_id    uuid not null references public.events (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  status      text not null default 'registered' check (status in ('registered', 'withdrawn')),
  unique (event_id, player_id)
);
create index registrations_player_id_idx on public.registrations (player_id);

-- ---------------------------------------------------------------------------
-- Rounds, groups, scoring
-- ---------------------------------------------------------------------------
create table public.rounds (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  event_id      uuid not null references public.events (id) on delete cascade,
  round_number  int not null,
  tee_id        uuid not null references public.tees (id) on delete restrict,
  play_date     date,
  kind          text not null check (kind in ('stroke', 'match')),
  unique (event_id, round_number)
);

create table public.groups (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  round_id             uuid not null references public.rounds (id) on delete cascade,
  tee_time             time null,
  start_hole           int not null default 1,
  code                 text unique,
  scorer_player_id     uuid null references public.players (id) on delete set null,
  scorer_device_token  text null,
  signed_at            timestamptz null,
  locked               boolean not null default false
);
create index groups_round_id_idx on public.groups (round_id);

create table public.group_players (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  group_id          uuid not null references public.groups (id) on delete cascade,
  player_id         uuid not null references public.players (id) on delete cascade,
  index_snapshot    numeric(4,1),
  playing_handicap  int,
  unique (group_id, player_id)
);
create index group_players_player_id_idx on public.group_players (player_id);

create table public.scores (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  hole        int not null check (hole between 1 and 18),
  gross       int check (gross > 0),
  client_ts   timestamptz,
  unique (group_id, player_id, hole)
);

create table public.signatures (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  role        text not null check (role in ('scorer', 'attest')),
  signed_at   timestamptz not null default now(),
  unique (group_id, role)
);

-- ---------------------------------------------------------------------------
-- Match play brackets
-- ---------------------------------------------------------------------------
create table public.brackets (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  event_id    uuid not null unique references public.events (id) on delete cascade,
  size        int not null,
  rounds      int not null,
  state       jsonb not null default '{}'::jsonb  -- serialized Bracket from @hgt/scoring
);

create table public.bracket_matches (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  bracket_id  uuid not null references public.brackets (id) on delete cascade,
  match_key   text not null,
  round       int not null,
  deadline    timestamptz,
  group_id    uuid null references public.groups (id) on delete set null,
  result      text null,
  forfeit     boolean not null default false,
  unique (bracket_id, match_key)
);

-- ---------------------------------------------------------------------------
-- Points and audit
-- ---------------------------------------------------------------------------
create table public.points_awards (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  event_id    uuid not null references public.events (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  points      numeric not null,
  override    boolean not null default false,
  unique (event_id, player_id)
);
create index points_awards_player_id_idx on public.points_awards (player_id);

create table public.audit_log (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  actor_player_id  uuid references public.players (id) on delete set null,
  entity           text not null,
  entity_id        uuid,
  before           jsonb,
  after            jsonb,
  at               timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
