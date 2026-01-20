create table if not exists public.watch_history_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  target_user_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  tmdb_id integer not null,
  season_number integer,
  episode_number integer,
  watched_at date not null,
  created_at timestamptz not null default now(),
  check (owner_id <> target_user_id)
);

create unique index if not exists watch_history_shares_unique
  on public.watch_history_shares (
    owner_id, target_user_id, project_id, media_type, tmdb_id, season_number, episode_number
  );

create index if not exists watch_history_shares_target_lookup
  on public.watch_history_shares (target_user_id, project_id, media_type, tmdb_id);

alter table public.watch_history_shares enable row level security;

create policy "Watch history shares readable by owner or target"
on public.watch_history_shares
for select
using (auth.uid() = owner_id or auth.uid() = target_user_id);

create policy "Watch history shares insertable by owner"
on public.watch_history_shares
for insert
with check (auth.uid() = owner_id);

create policy "Watch history shares updatable by owner"
on public.watch_history_shares
for update
using (auth.uid() = owner_id);

create policy "Watch history shares deletable by owner"
on public.watch_history_shares
for delete
using (auth.uid() = owner_id);
