-- The Break — Supabase schema
-- Run this in the Supabase SQL editor (or `supabase db push`) on a fresh project.

create extension if not exists "pgcrypto";

-- players
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- matches: one row per World Cup fixture the worker is tracking
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  txline_match_id text not null unique,     -- external id from TxLINE
  home_team text not null,
  away_team text not null,
  kickoff_utc timestamptz,
  status text not null default 'scheduled', -- scheduled | live | half_time | finished
  phase text,                               -- 1H | HT | 2H | ET1 | ET2 | PEN | FT
  match_clock_seconds integer,
  updated_at timestamptz not null default now()
);

-- rounds: one row per detected hydration break.
-- This is the table the frontend subscribes to via Supabase Realtime —
-- every INSERT/UPDATE here drives the UI instead of a custom WebSocket server.
create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  half smallint not null,                   -- 1 or 2
  status text not null default 'open',      -- open | resolved | voided
  stat_key text not null,                   -- e.g. 'total_shots', 'corners', 'fouls'
  baseline_value numeric not null,          -- stat value at break start
  resolved_value numeric,                   -- stat value when round resolves
  outcome text,                             -- 'higher' | 'lower' | 'push' (set on resolve)
  opened_at timestamptz not null default now(),
  resolves_at timestamptz,                  -- opened_at + break window, informational only
  resolved_at timestamptz
);

-- predictions: one row per player guess within a round
create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  guess text not null check (guess in ('higher', 'lower')),
  correct boolean,
  created_at timestamptz not null default now(),
  unique (round_id, player_id)
);

-- streaks
create table if not exists streaks (
  player_id uuid primary key references players(id) on delete cascade,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  total_correct integer not null default 0,
  total_predictions integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_rounds_match_id on rounds(match_id);
create index if not exists idx_rounds_status on rounds(status);
create index if not exists idx_predictions_round_id on predictions(round_id);
create index if not exists idx_predictions_player_id on predictions(player_id);

-- Realtime: enable specifically on rounds (what the frontend subscribes to)
-- and predictions (so live reveal state can update too).
alter publication supabase_realtime add table rounds;
alter publication supabase_realtime add table predictions;

-- Row Level Security
-- The worker writes with the service-role key (bypasses RLS). Browsers read
-- with the anon key and only ever read matches/rounds; predictions are the
-- one player-writable table.
alter table players enable row level security;
alter table matches enable row level security;
alter table rounds enable row level security;
alter table predictions enable row level security;
alter table streaks enable row level security;

create policy "public read players" on players for select using (true);
create policy "public read matches" on matches for select using (true);
create policy "public read rounds" on rounds for select using (true);
create policy "public read predictions" on predictions for select using (true);
create policy "public read streaks" on streaks for select using (true);

-- Players can upsert their own row (wallet_address supplied by the client
-- after wallet-connect). No password — this is a soft guard, not a hard
-- security boundary. See docs/KNOWN_LIMITATIONS.md.
create policy "players can upsert self" on players for insert with check (true);
create policy "players can update self" on players for update using (true);

-- Players can insert their own prediction, only into a round that's open.
create policy "players can insert own prediction" on predictions
  for insert
  with check (
    exists (select 1 from rounds r where r.id = round_id and r.status = 'open')
  );
