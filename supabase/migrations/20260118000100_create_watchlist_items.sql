create extension if not exists "pgcrypto";

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  tmdb_id integer not null,
  title text not null,
  year text,
  poster_path text,
  is_anime boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists watchlist_items_unique
  on public.watchlist_items (user_id, project_id, media_type, tmdb_id);

create index if not exists watchlist_items_user_project
  on public.watchlist_items (user_id, project_id, media_type, is_anime);

alter table public.watchlist_items enable row level security;

create policy "Watchlist items are self readable"
on public.watchlist_items
for select
using (auth.uid() = user_id);

create policy "Watchlist items are self insertable"
on public.watchlist_items
for insert
with check (auth.uid() = user_id);

create policy "Watchlist items are self updatable"
on public.watchlist_items
for update
using (auth.uid() = user_id);

create policy "Watchlist items are self deletable"
on public.watchlist_items
for delete
using (auth.uid() = user_id);
