create table if not exists public.watchlist_tv_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  tmdb_id integer not null,
  last_progress text not null check (last_progress in ('unwatched', 'watching', 'completed')),
  last_total_aired integer not null default 0,
  last_watched_count integer not null default 0,
  alert_active boolean not null default false,
  alert_notified_watch_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists watchlist_tv_states_unique
  on public.watchlist_tv_states (user_id, project_id, tmdb_id);

create index if not exists watchlist_tv_states_user_project
  on public.watchlist_tv_states (user_id, project_id, tmdb_id);

alter table public.watchlist_tv_states enable row level security;

create policy "Watchlist tv states are self readable"
on public.watchlist_tv_states
for select
using (auth.uid() = user_id);

create policy "Watchlist tv states are self insertable"
on public.watchlist_tv_states
for insert
with check (auth.uid() = user_id);

create policy "Watchlist tv states are self updatable"
on public.watchlist_tv_states
for update
using (auth.uid() = user_id);

create policy "Watchlist tv states are self deletable"
on public.watchlist_tv_states
for delete
using (auth.uid() = user_id);
